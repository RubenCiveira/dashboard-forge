/**
 * Markdown file sync service.
 *
 * Agents    → data/agents/{slug}.md
 * Skills    → data/skills/{slug}/SKILL.md
 * Playbooks → data/playbooks/{slug}.md
 *
 * File format matches Claude Code / OpenCode conventions:
 *   YAML frontmatter between --- delimiters, then Markdown body.
 *
 * Playbook frontmatter fields:
 *   name, description, permission_profile, agents (comma-sep names), skills (comma-sep names)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { db, schema } from "../db/index.js";
import { eq, inArray } from "drizzle-orm";

// ─── Paths ───────────────────────────────────────────────────────────

const DATA_DIR       = resolve(process.cwd(), "data");
const AGENTS_DIR     = join(DATA_DIR, "agents");
const SKILLS_DIR     = join(DATA_DIR, "skills");
const PLAYBOOKS_DIR  = join(DATA_DIR, "playbooks");

const PERMISSION_PRESETS: Record<string, Record<string, string>> = {
  autonomous:  { bash: "allow", edit: "allow", write: "allow", webfetch: "allow", externalDirectory: "allow" },
  assisted:    { bash: "ask",   edit: "ask",   write: "allow", webfetch: "allow", externalDirectory: "ask"   },
  restrictive: { bash: "ask",   edit: "ask",   write: "ask",   webfetch: "ask",   externalDirectory: "deny"  },
};

function ensureDirs() {
  mkdirSync(AGENTS_DIR,    { recursive: true });
  mkdirSync(SKILLS_DIR,    { recursive: true });
  mkdirSync(PLAYBOOKS_DIR, { recursive: true });
}

// ─── Slug helpers ────────────────────────────────────────────────────

/** Convert an arbitrary name to a filesystem-safe slug. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Frontmatter parser ──────────────────────────────────────────────

interface Frontmatter {
  [key: string]: string | undefined;
}

/**
 * Parse a YAML frontmatter block.
 * Supports only the scalar subset used by Claude Code / OpenCode:
 *   key: value
 *   key: >
 *     multi-line folded scalar
 */
function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  const fence = /^---\r?\n([\s\S]*?)\n---\r?\n?([\s\S]*)$/;
  const match = fence.exec(raw);
  if (!match) return { meta: {}, body: raw };

  const yamlBlock = match[1]!;
  const body = match[2]!;
  const meta: Frontmatter = {};

  // State machine for folded scalars (>)
  let currentKey: string | null = null;
  let foldedLines: string[] = [];

  function flushFolded() {
    if (currentKey !== null) {
      meta[currentKey] = foldedLines.join(" ").trim();
      currentKey = null;
      foldedLines = [];
    }
  }

  for (const line of yamlBlock.split(/\r?\n/)) {
    if (currentKey !== null) {
      // Continuation of a folded scalar — indented line
      if (line.startsWith("  ")) {
        foldedLines.push(line.trim());
        continue;
      }
      flushFolded();
    }

    const kv = /^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;

    const key = kv[1]!;
    const val = kv[2]!.trim();

    if (val === ">") {
      currentKey = key;
      foldedLines = [];
    } else {
      meta[key] = val;
    }
  }

  flushFolded();

  return { meta, body: body.trimStart() };
}

/** Serialize a key–value map as YAML frontmatter lines. */
function buildFrontmatter(fields: Record<string, string | undefined>): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === "") continue;
    // Use folded scalar for multi-sentence descriptions
    if (v.includes("\n")) {
      lines.push(`${k}: |`);
      for (const l of v.split("\n")) lines.push(`  ${l}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

// ─── Agent file I/O ──────────────────────────────────────────────────

type AgentRow = typeof schema.agents.$inferSelect;

/** Write an agent to data/agents/{slug}.md */
export function writeAgentFile(agent: AgentRow): void {
  ensureDirs();
  const slug = toSlug(agent.name);
  const tools = (JSON.parse(agent.tools) as string[]).join(", ");
  const fm = buildFrontmatter({
    name:        agent.name,
    description: agent.description,
    tools:       tools || undefined,
    model:       agent.model ?? undefined,
  });
  const content = `${fm}\n\n${agent.markdownContent ?? ""}`.trimEnd() + "\n";
  writeFileSync(join(AGENTS_DIR, `${slug}.md`), content, "utf-8");
}

/** Delete an agent's markdown file (best-effort). */
export function deleteAgentFile(name: string): void {
  const path = join(AGENTS_DIR, `${toSlug(name)}.md`);
  if (existsSync(path)) rmSync(path);
}

// ─── Skill file I/O ──────────────────────────────────────────────────

type SkillRow = typeof schema.skills.$inferSelect;

/** Write a skill to data/skills/{slug}/SKILL.md */
export function writeSkillFile(skill: SkillRow): void {
  ensureDirs();
  const slug = toSlug(skill.name);
  const dir  = join(SKILLS_DIR, slug);
  mkdirSync(dir, { recursive: true });

  const fm = buildFrontmatter({
    name:        skill.name,
    description: skill.description,
  });
  const content = `${fm}\n\n${skill.skillMdContent ?? ""}`.trimEnd() + "\n";
  writeFileSync(join(dir, "SKILL.md"), content, "utf-8");
}

/** Delete a skill's directory (best-effort). */
export function deleteSkillFile(name: string): void {
  const dir = join(SKILLS_DIR, toSlug(name));
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// ─── Import from filesystem ──────────────────────────────────────────

/**
 * Scan data/agents/ and import any .md file that doesn't already exist
 * in the database (matched by name).
 */
export async function syncAgentsFromFiles(): Promise<number> {
  ensureDirs();
  if (!existsSync(AGENTS_DIR)) return 0;

  const existing = await db.select({ name: schema.agents.name }).from(schema.agents);
  const knownNames = new Set(existing.map((r) => r.name.toLowerCase()));

  let imported = 0;

  for (const file of readdirSync(AGENTS_DIR)) {
    if (!file.endsWith(".md")) continue;

    const raw = readFileSync(join(AGENTS_DIR, file), "utf-8");
    const { meta, body } = parseFrontmatter(raw);

    const name = meta["name"];
    if (!name) continue;
    if (knownNames.has(name.toLowerCase())) continue;

    const tools = (meta["tools"] ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const now = new Date().toISOString();
    await db.insert(schema.agents).values({
      id:              crypto.randomUUID(),
      name,
      description:     meta["description"] ?? "",
      markdownContent: body,
      tools:           JSON.stringify(tools),
      model:           meta["model"] ?? null,
      tags:            "[]",
      source:          "file",
      version:         "1.0.0",
      createdAt:       now,
      updatedAt:       now,
    });

    knownNames.add(name.toLowerCase());
    imported++;
  }

  return imported;
}

/**
 * Scan data/skills/ and import any SKILL.md that doesn't already exist
 * in the database (matched by name).
 */
export async function syncSkillsFromFiles(): Promise<number> {
  ensureDirs();
  if (!existsSync(SKILLS_DIR)) return 0;

  const existing = await db.select({ name: schema.skills.name }).from(schema.skills);
  const knownNames = new Set(existing.map((r) => r.name.toLowerCase()));

  let imported = 0;

  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const skillMdPath = join(SKILLS_DIR, entry.name, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;

    const raw = readFileSync(skillMdPath, "utf-8");
    const { meta, body } = parseFrontmatter(raw);

    const name = meta["name"];
    if (!name) continue;
    if (knownNames.has(name.toLowerCase())) continue;

    const now = new Date().toISOString();
    await db.insert(schema.skills).values({
      id:             crypto.randomUUID(),
      name,
      description:    meta["description"] ?? "",
      skillMdContent: body,
      tags:           "[]",
      source:         "file",
      version:        "1.0.0",
      createdAt:      now,
      updatedAt:      now,
    });

    knownNames.add(name.toLowerCase());
    imported++;
  }

  return imported;
}

// ─── Playbook file I/O ───────────────────────────────────────────────

type PlaybookRow = typeof schema.playbooks.$inferSelect;

/** Write a playbook to data/playbooks/{slug}.md */
export function writePlaybookFile(playbook: PlaybookRow): void {
  ensureDirs();
  const slug    = toSlug(playbook.name);
  const agentIds: string[] = JSON.parse(playbook.agentIds);
  const skillIds: string[] = JSON.parse(playbook.skillIds);

  // We store names only if we can look them up — for now store IDs as-is
  const fm = buildFrontmatter({
    name:               playbook.name,
    description:        playbook.description || undefined,
    permission_profile: playbook.permissionProfile,
  });
  const body = [
    agentIds.length  ? `agents: ${agentIds.join(", ")}` : null,
    skillIds.length  ? `skills: ${skillIds.join(", ")}` : null,
    playbook.agentsRules ? `\n${playbook.agentsRules}` : null,
  ].filter(Boolean).join("\n");

  const content = `${fm}\n\n${body}`.trimEnd() + "\n";
  writeFileSync(join(PLAYBOOKS_DIR, `${slug}.md`), content, "utf-8");
}

/** Delete a playbook's markdown file (best-effort). */
export function deletePlaybookFile(name: string): void {
  const path = join(PLAYBOOKS_DIR, `${toSlug(name)}.md`);
  if (existsSync(path)) rmSync(path);
}

/**
 * Scan data/playbooks/ and import any .md that doesn't already exist in DB.
 * Agent/skill names in frontmatter are resolved to IDs by name lookup.
 */
export async function syncPlaybooksFromFiles(): Promise<number> {
  ensureDirs();
  if (!existsSync(PLAYBOOKS_DIR)) return 0;

  const existing = await db.select({ name: schema.playbooks.name }).from(schema.playbooks);
  const knownNames = new Set(existing.map((r) => r.name.toLowerCase()));

  // Pre-load all agents and skills for name → id resolution
  const allAgents = await db.select({ id: schema.agents.id, name: schema.agents.name }).from(schema.agents);
  const allSkills = await db.select({ id: schema.skills.id, name: schema.skills.name }).from(schema.skills);
  const agentByName = new Map(allAgents.map((a) => [a.name.toLowerCase(), a.id]));
  const skillByName = new Map(allSkills.map((s) => [s.name.toLowerCase(), s.id]));

  let imported = 0;

  for (const file of readdirSync(PLAYBOOKS_DIR)) {
    if (!file.endsWith(".md")) continue;

    const raw = readFileSync(join(PLAYBOOKS_DIR, file), "utf-8");
    const { meta, body } = parseFrontmatter(raw);

    const name = meta["name"];
    if (!name) continue;
    if (knownNames.has(name.toLowerCase())) continue;

    const permissionProfile =
      (meta["permission_profile"] ?? "autonomous") as "autonomous" | "assisted" | "restrictive";

    // Resolve agent names → IDs
    const agentNames = (meta["agents"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const agentIds   = agentNames.map((n) => agentByName.get(n.toLowerCase())).filter((id): id is string => !!id);

    // Resolve skill names → IDs
    const skillNames = (meta["skills"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const skillIds   = skillNames.map((n) => skillByName.get(n.toLowerCase())).filter((id): id is string => !!id);

    const permissions = PERMISSION_PRESETS[permissionProfile] ?? PERMISSION_PRESETS["autonomous"]!;
    const now = new Date().toISOString();

    await db.insert(schema.playbooks).values({
      id:                crypto.randomUUID(),
      name,
      description:       meta["description"] ?? "",
      permissionProfile,
      permissions:       JSON.stringify(permissions),
      agentIds:          JSON.stringify(agentIds),
      skillIds:          JSON.stringify(skillIds),
      mcpIds:            "[]",
      agentsRules:       body.trim(),
      createdAt:         now,
      updatedAt:         now,
    });

    knownNames.add(name.toLowerCase());
    imported++;
  }

  return imported;
}

// ─── Startup sync ────────────────────────────────────────────────────

/**
 * Run all sync operations at startup.
 * Logs results to stdout; never throws.
 */
export async function startupSync(): Promise<void> {
  try {
    const agents    = await syncAgentsFromFiles();
    const skills    = await syncSkillsFromFiles();
    const playbooks = await syncPlaybooksFromFiles();
    if (agents > 0 || skills > 0 || playbooks > 0) {
      console.log(`📂 Synced from files: ${agents} agent(s), ${skills} skill(s), ${playbooks} playbook(s)`);
    }
  } catch (err) {
    console.warn("⚠️  File sync failed:", err);
  }
}
