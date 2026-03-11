import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { projects } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export const projectsRouter = new Hono();

const createProjectBody = z.object({
  name: z.string().min(1).max(100),
  sourcePath: z.string().min(1),
  sourceType: z.enum(["local", "git"]).default("local"),
  branch: z.string().optional(),
});

const updateProjectBody = createProjectBody.partial();

/** GET /api/v1/projects — List all projects */
projectsRouter.get("/", async (ctx) => {
  const rows = await db.select().from(projects).all();
  return ctx.json({ data: rows });
});

/** POST /api/v1/projects — Create a project */
projectsRouter.post(
  "/",
  zValidator("json", createProjectBody),
  async (ctx) => {
    const body = ctx.req.valid("json");
    const now = new Date().toISOString();
    const id = randomUUID();

    await db.insert(projects).values({
      id,
      name: body.name,
      sourcePath: body.sourcePath,
      sourceType: body.sourceType,
      branch: body.branch ?? null,
      envVars: "{}",
      playbookIds: "[]",
      createdAt: now,
      updatedAt: now,
    });

    const created = await db.select().from(projects).where(eq(projects.id, id)).get();
    return ctx.json({ data: created }, 201);
  },
);

/** GET /api/v1/projects/:id — Get a project by id */
projectsRouter.get("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const row = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) throw new NotFoundError("Project", id);
  return ctx.json({ data: row });
});

/** PUT /api/v1/projects/:id — Update a project */
projectsRouter.put(
  "/:id",
  zValidator("json", updateProjectBody),
  async (ctx) => {
    const id = ctx.req.param("id");
    const body = ctx.req.valid("json");
    const existing = await db.select().from(projects).where(eq(projects.id, id)).get();
    if (!existing) throw new NotFoundError("Project", id);

    await db.update(projects)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(projects.id, id));

    const updated = await db.select().from(projects).where(eq(projects.id, id)).get();
    return ctx.json({ data: updated });
  },
);

/** DELETE /api/v1/projects/:id — Delete a project */
projectsRouter.delete("/:id", async (ctx) => {
  const id = ctx.req.param("id");
  const existing = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!existing) throw new NotFoundError("Project", id);

  await db.delete(projects).where(eq(projects.id, id));
  return ctx.json({ data: { id } });
});
