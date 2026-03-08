import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { updateInstanceConfigSchema } from "@agentforge/shared";
import { readConfig, writeConfig } from "../config.js";
import { checkOllamaHealth } from "../services/ollama.js";

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
  return ctx.json({
    data: {
      ollama,
    },
  });
});
