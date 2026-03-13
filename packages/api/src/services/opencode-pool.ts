import { rmSync } from "fs";
import { createServer } from "net";
import type { AddressInfo } from "net";
import { readConfig } from "../config.js";
import { materializePlaybook } from "./materializer.js";

interface ServerEntry {
  proc: ReturnType<typeof Bun.spawn>;
  port: number;
  configDir: string;
  lastUsedAt: number;
  status: "starting" | "ready" | "dead";
}

/** pool key = `${playbookId}:${model ?? ""}` */
const pool = new Map<string, ServerEntry>();

/** in-flight creation promises, keyed same as pool, to avoid duplicate spawns */
const pending = new Map<string, Promise<number>>();

let reaperTimer: ReturnType<typeof setInterval> | null = null;

function poolKey(playbookId: string, model?: string | null): string {
  return `${playbookId}:${model ?? ""}`;
}

/** Finds a free TCP port by asking the OS to bind on 0 then releasing it. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/**
 * Polls the OpenCode server until it responds to a session list request.
 * Throws if the server does not become ready within `timeoutMs`.
 */
async function waitForReady(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/session`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `OpenCode server on port ${port} did not become ready within ${timeoutMs}ms`,
  );
}

/**
 * Spawns a new OpenCode server for the given playbook+model and waits for it
 * to be ready. Stores the entry in the pool.
 */
async function spawnServer(
  playbookId: string,
  model?: string | null,
): Promise<number> {
  const key = poolKey(playbookId, model);
  const port = await getFreePort();

  // configDir is stable per playbook — use a deterministic path so it can be
  // reused across re-materializations on the same playbook.
  const configDir = await materializePlaybook(
    playbookId,
    `pool-${playbookId}`,
    model,
  );

  const proc = Bun.spawn(
    ["opencode", "serve", "--port", String(port), "--print-logs"],
    {
      env: { ...process.env, OPENCODE_CONFIG_DIR: configDir },
      stdout: "ignore",
      stderr: "pipe",
    },
  );

  const entry: ServerEntry = {
    proc,
    port,
    configDir,
    lastUsedAt: Date.now(),
    status: "starting",
  };
  pool.set(key, entry);

  // Drain stderr in background so the pipe buffer never blocks the process.
  void new Response(proc.stderr).text().catch(() => {});

  try {
    await waitForReady(port);
    entry.status = "ready";
    console.log(`[pool] Server ready for playbook "${playbookId}" on :${port}`);
  } catch (err) {
    entry.status = "dead";
    try { proc.kill(); } catch { /* already gone */ }
    pool.delete(key);
    throw err;
  }

  return port;
}

/**
 * Returns the port of a running OpenCode server for the given playbook+model.
 * Starts a new server if none exists or the previous one has died.
 * Concurrent calls for the same key share a single spawn operation.
 */
export async function acquireServer(
  playbookId: string,
  model?: string | null,
): Promise<number> {
  const key = poolKey(playbookId, model);

  const existing = pool.get(key);
  if (existing && existing.status !== "dead") {
    existing.lastUsedAt = Date.now();
    // If it is still starting, wait until ready.
    if (existing.status === "starting") {
      await waitForReady(existing.port);
    }
    return existing.port;
  }

  // Deduplicate concurrent spawns for the same key.
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const creation = spawnServer(playbookId, model).finally(() => {
    pending.delete(key);
  });
  pending.set(key, creation);
  return creation;
}

/** Returns the PID of the server process for a given playbook+model, or null if not in pool. */
export function getServerPid(playbookId: string, model?: string | null): number | null {
  return pool.get(poolKey(playbookId, model))?.proc.pid ?? null;
}

/** Returns the port of the server for a given playbook+model, or null if not in pool. */
export function getServerPort(playbookId: string, model?: string | null): number | null {
  return pool.get(poolKey(playbookId, model))?.port ?? null;
}

/**
 * Updates the last-used timestamp for a server.
 * Call after each job session completes so the TTL clock resets.
 */
export function touchServer(playbookId: string, model?: string | null): void {
  const entry = pool.get(poolKey(playbookId, model));
  if (entry) entry.lastUsedAt = Date.now();
}

/**
 * Kills and removes the server for the given playbook+model.
 * Call when a playbook is updated or deleted so the next acquire re-materializes.
 */
export function invalidateServer(
  playbookId: string,
  model?: string | null,
): void {
  const key = poolKey(playbookId, model);
  const entry = pool.get(key);
  if (!entry) return;

  try { entry.proc.kill(); } catch { /* already gone */ }
  try { rmSync(entry.configDir, { recursive: true, force: true }); } catch { /* ignore */ }
  pool.delete(key);
  console.log(`[pool] Invalidated server for playbook "${playbookId}"`);
}

/**
 * Kills all running servers and cleans up their config dirs.
 * Safe to call synchronously from a process.on('exit') handler.
 */
export function shutdownPool(): void {
  if (reaperTimer) {
    clearInterval(reaperTimer);
    reaperTimer = null;
  }
  for (const [key, entry] of pool.entries()) {
    try { entry.proc.kill(); } catch { /* already gone */ }
    try { rmSync(entry.configDir, { recursive: true, force: true }); } catch { /* ignore */ }
    pool.delete(key);
  }
  console.log("[pool] All OpenCode servers shut down");
}

/**
 * Starts the idle reaper that kills servers unused longer than the configured TTL.
 * Checks every minute. Safe to call multiple times — only one timer runs at once.
 */
export function startIdleReaper(): void {
  if (reaperTimer) return;

  const CHECK_INTERVAL_MS = 60_000;

  reaperTimer = setInterval(() => {
    const { pool: poolCfg } = readConfig();
    const ttlMs = poolCfg.serverIdleTtlMinutes * 60_000;
    const now = Date.now();

    for (const [key, entry] of pool.entries()) {
      if (entry.status === "dead" || now - entry.lastUsedAt > ttlMs) {
        console.log(`[pool] Idle timeout reached, killing server: ${key}`);
        try { entry.proc.kill(); } catch { /* already gone */ }
        try { rmSync(entry.configDir, { recursive: true, force: true }); } catch { /* ignore */ }
        pool.delete(key);
      }
    }
  }, CHECK_INTERVAL_MS);

  // Don't keep the process alive just for the reaper timer.
  reaperTimer.unref?.();
}
