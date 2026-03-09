import { ollamaModelSchema, ollamaPullStatusSchema } from "@agentforge/shared";
import type { OllamaModel, OllamaPullStatus } from "@agentforge/shared";
import { readConfig } from "../config.js";
import { ApiError } from "../lib/errors.js";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync } from "fs";

function getBaseUrl(): string {
  return readConfig().ollama.baseUrl;
}

/**
 * Returns the list of models currently installed in the local Ollama instance.
 */
export async function listOllamaModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${getBaseUrl()}/api/tags`).catch(() => {
    throw new ApiError("OLLAMA_UNREACHABLE", "Cannot reach Ollama at " + getBaseUrl(), 502);
  });

  if (!res.ok) {
    throw new ApiError("OLLAMA_ERROR", `Ollama returned ${res.status}`, 502);
  }

  const body = await res.json() as { models?: unknown[] };
  return (body.models ?? []).map((m) => ollamaModelSchema.parse(m));
}

/**
 * Pulls a model from Ollama registry, streaming progress via an async generator.
 */
export async function* pullOllamaModel(
  name: string,
): AsyncGenerator<OllamaPullStatus> {
  const res = await fetch(`${getBaseUrl()}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, stream: true }),
  }).catch(() => {
    throw new ApiError("OLLAMA_UNREACHABLE", "Cannot reach Ollama at " + getBaseUrl(), 502);
  });

  if (!res.ok || !res.body) {
    throw new ApiError("OLLAMA_ERROR", `Ollama returned ${res.status}`, 502);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        yield ollamaPullStatusSchema.parse(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
  }
}

/**
 * Uses the `ollama create` CLI command to apply a `num_ctx` parameter to every
 * model currently installed in the local Ollama instance.
 * For each model a temporary Modelfile is written, `ollama create` is executed
 * to update the model in-place, then the Modelfile is removed.
 *
 * Returns the list of successfully updated model names and any error messages.
 */
export async function applyNumCtxToAllModels(
  numCtx: number,
): Promise<{ applied: string[]; errors: { model: string; message: string }[] }> {
  const models = await listOllamaModels();
  const applied: string[] = [];
  const errors: { model: string; message: string }[] = [];

  for (const model of models) {
    const tmpPath = join(tmpdir(), `agentforge-modelfile-${model.name.replace(/[^a-z0-9]/gi, "_")}-${Date.now()}`);
    try {
      await Bun.write(tmpPath, `FROM ${model.name}\nPARAMETER num_ctx ${numCtx}\n`);

      const proc = Bun.spawn(["ollama", "create", model.name, "-f", tmpPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;

      if (proc.exitCode === 0) {
        applied.push(model.name);
      } else {
        const stderr = (await new Response(proc.stderr).text()).trim();
        errors.push({ model: model.name, message: stderr || `exit code ${proc.exitCode}` });
      }
    } catch (e) {
      errors.push({ model: model.name, message: e instanceof Error ? e.message : String(e) });
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  return { applied, errors };
}

/**
 * Checks if Ollama is reachable and returns its version string.
 */
export async function checkOllamaHealth(): Promise<{ reachable: boolean; version?: string }> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/version`);
    if (!res.ok) return { reachable: false };
    const body = await res.json() as { version?: string };
    return { reachable: true, version: body.version };
  } catch {
    return { reachable: false };
  }
}
