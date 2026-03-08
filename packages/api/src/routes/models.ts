import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createModelSchema } from "@agentforge/shared";
import { db } from "../db/index.js";
import { models } from "../db/schema.js";
import { listOllamaModels, pullOllamaModel } from "../services/ollama.js";
import { NotFoundError } from "../lib/errors.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export const modelsRouter = new Hono();

/** GET /api/v1/models — List all configured models */
modelsRouter.get("/", async (ctx) => {
  const rows = await db.select().from(models).all();
  return ctx.json({ data: rows });
});

/** POST /api/v1/models — Add a model to the configured list */
modelsRouter.post(
  "/",
  zValidator("json", createModelSchema),
  async (ctx) => {
    const body = ctx.req.valid("json");
    const now = new Date().toISOString();
    const id = randomUUID();

    await db.insert(models).values({
      id,
      provider: body.provider,
      modelId: body.modelId,
      displayName: body.displayName,
      enabled: body.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });

    const created = await db.select().from(models).where(eq(models.id, id)).get();
    return ctx.json({ data: created }, 201);
  },
);

/** PATCH /api/v1/models/:id — Toggle enabled/disabled */
modelsRouter.patch(
  "/:id",
  zValidator("json", z.object({ enabled: z.boolean() })),
  async (ctx) => {
    const id = ctx.req.param("id");
    const { enabled } = ctx.req.valid("json");

    const existing = await db.select().from(models).where(eq(models.id, id)).get();
    if (!existing) throw new NotFoundError("Model not found");

    await db
      .update(models)
      .set({ enabled, updatedAt: new Date().toISOString() })
      .where(eq(models.id, id));

    const updated = await db.select().from(models).where(eq(models.id, id)).get();
    return ctx.json({ data: updated });
  },
);

/** DELETE /api/v1/models/:id — Remove a model from the configured list */
modelsRouter.delete("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const existing = await db.select().from(models).where(eq(models.id, id)).get();
  if (!existing) throw new NotFoundError("Model not found");

  await db.delete(models).where(eq(models.id, id));
  return ctx.json({ data: { id } });
});

/** GET /api/v1/models/ollama — List models installed in local Ollama */
modelsRouter.get("/ollama", async (ctx) => {
  const ollamaModels = await listOllamaModels();
  return ctx.json({ data: ollamaModels });
});

/** POST /api/v1/models/ollama/pull — Pull a model from Ollama (SSE stream) */
modelsRouter.post(
  "/ollama/pull",
  zValidator("json", z.object({ name: z.string().min(1) })),
  async (ctx) => {
    const { name } = ctx.req.valid("json");

    return new Response(
      new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            for await (const status of pullOllamaModel(name)) {
              const line = `data: ${JSON.stringify(status)}\n\n`;
              controller.enqueue(encoder.encode(line));
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Pull failed";
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: "error", error: msg })}\n\n`));
          } finally {
            controller.close();
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      },
    );
  },
);
