import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { updateInstanceConfigSchema } from "@agentforge/shared";
import { readConfig, writeConfig } from "../config.js";
import { checkOllamaHealth, applyNumCtxToAllModels } from "../services/ollama.js";

export const configRouter = new Hono();

/** GET /api/v1/config — Returns current instance configuration */
configRouter.get("/", (ctx) => {
  return ctx.json({ data: readConfig() });
});

/** PUT /api/v1/config — Updates instance configuration */
configRouter.put(
  "/",
  zValidator("json", updateInstanceConfigSchema),
  (ctx) => {
    const patch = ctx.req.valid("json");
    const updated = writeConfig(patch);
    return ctx.json({ data: updated });
  },
);

/** GET /api/v1/config/health — Checks connectivity to configured services */
configRouter.get("/health", async (ctx) => {
  const ollama = await checkOllamaHealth();
  return ctx.json({ data: { ollama } });
});

/**
 * POST /api/v1/config/ollama/apply-ctx — Apply the configured num_ctx to all
 * installed Ollama models via the `ollama create` CLI command.
 */
configRouter.post("/ollama/apply-ctx", async (ctx) => {
  const { numCtx } = readConfig().ollama;
  const result = await applyNumCtxToAllModels(numCtx);
  return ctx.json({ data: result });
});
