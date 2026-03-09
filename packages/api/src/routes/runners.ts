import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { runners } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { NotFoundError } from "../lib/errors.js";

export const runnersRouter = new Hono();

/** GET /api/v1/runners — List all configured runners */
runnersRouter.get("/", async (ctx) => {
  const rows = await db.select().from(runners).all();
  return ctx.json({ data: rows });
});

/** GET /api/v1/runners/:id — Get a single runner */
runnersRouter.get("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const row = await db.select().from(runners).where(eq(runners.id, id)).get();
  if (!row) throw new NotFoundError("Runner", id);
  return ctx.json({ data: row });
});

/** PATCH /api/v1/runners/:id — Update runner name, config or enabled state */
runnersRouter.patch(
  "/:id",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).optional(),
      config: z.record(z.unknown()).optional(),
      enabled: z.boolean().optional(),
    }),
  ),
  async (ctx) => {
    const id = ctx.req.param("id");
    const body = ctx.req.valid("json");

    const existing = await db.select().from(runners).where(eq(runners.id, id)).get();
    if (!existing) throw new NotFoundError("Runner", id);

    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.name !== undefined) update.name = body.name;
    if (body.config !== undefined) update.config = JSON.stringify(body.config);
    if (body.enabled !== undefined) update.enabled = body.enabled;

    await db.update(runners).set(update).where(eq(runners.id, id));
    const updated = await db.select().from(runners).where(eq(runners.id, id)).get();
    return ctx.json({ data: updated });
  },
);

/** POST /api/v1/runners/:id/check — Health-check a runner */
runnersRouter.post("/:id/check", async (ctx) => {
  const id = ctx.req.param("id");
  const runner = await db.select().from(runners).where(eq(runners.id, id)).get();
  if (!runner) throw new NotFoundError("Runner", id);

  let status: "online" | "offline" = "offline";
  let version: string | null = null;

  if (runner.type === "opencode") {
    const cfg = JSON.parse(runner.config) as { binaryPath?: string };
    const binary = cfg.binaryPath || "opencode";
    try {
      const proc = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "pipe" });
      const text = (await new Response(proc.stdout).text()).trim();
      await proc.exited;
      if (proc.exitCode === 0) {
        status = "online";
        version = text || null;
      }
    } catch {
      status = "offline";
    }
  }

  await db
    .update(runners)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(runners.id, id));

  return ctx.json({ data: { status, version } });
});
