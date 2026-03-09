/**
 * Markdown file service — file-backed storage for agents, skills and playbooks.
 *
 * Agents    → data/agents/{slug}.md
 * Skills    → data/skills/{slug}/SKILL.md
 * Playbooks → data/playbooks/{slug}.md
 *
 * File format matches Claude Code / OpenCode conventions:
 *   YAML frontmatter between --- delimiters, then Markdown body.
 *
 * IDs are always the filename stem (slug), derived from the entity name
 * via toSlug(). This ensures file names and IDs are always in sync.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";

// ─── Paths ───────────────────────────────────────────────────────────

const DATA_DIR       = resolve(import.meta.dir, "../../../../data");
const AGENTS_DIR     = join(DATA_DIR, "agents");
const SKILLS_DIR     = join(DATA_DIR, "skills");
const PLAYBOOKS_DIR  = join(DATA_DIR, "playbooks");

export { DATA_DIR, AGENTS_DIR, SKILLS_DIR, PLAYBOOKS_DIR };

const PERMISSION_PRESETS: Record<string, Record<string, string>> = {
  autonomous:  { bash: "allow", edit: "allow", write: "allow", webfetch: "allow", externalDirectory: "allow" },
  assisted:    { bash: "ask",   edit: "ask",   write: "allow", webfetch: "allow", externalDirectory: "ask"   },
  restrictive: { bash: "ask",   edit: "ask",   write: "ask",   webfetch: "ask",   externalDirectory: "deny"  },
};

export function ensureDirs() {
  mkdirSync(AGENTS_DIR,    { recursive: true });
  mkdirSync(SKILLS_DIR,    { recursive: true });
  mkdirSync(PLAYBOOKS_DIR, { recursive: true });
}

// ─── Slug helpers ────────────────────────────────────────────────────

/** Convert an arbitrary name to a filesystem-safe slug (used as entity ID). */
export function toSlug(name: string): string {
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
 * Supports the scalar subset used by Claude Code / OpenCode:
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

// ─── Entity types ────────────────────────────────────────────────────

export interface AgentEntry {
  id: string;
  name: string;
  description: string;
  markdownContent: string;
  tools: string[];
  model: string | null;
  tags: string[];
  source: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  skillMdContent: string;
  hasScripts: boolean;
  hasTemplates: boolean;
  tags: string[];
  source: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookEntry {
  id: string;
  name: string;
  description: string;
  permissionProfile: string;
  permissions: Record<string, string>;
  agentIds: string[];
  skillIds: string[];
  mcpIds: string[];
  agentsRules: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Agent file I/O ──────────────────────────────────────────────────

/** Read all agents from data/agents/*.md */
export function readAllAgents(): AgentEntry[] {
  ensureDirs();
  const results: AgentEntry[] = [];
  for (const file of readdirSync(AGENTS_DIR)) {
    if (!file.endsWith(".md")) continue;
    const filePath = join(AGENTS_DIR, file);
    try {
      const raw   = readFileSync(filePath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      const name  = meta["name"] ?? file.replace(/\.md$/, "");
      const mtime = statSync(filePath).mtime.toISOString();
      const tools = (meta["tools"] ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      results.push({
        id:              toSlug(name),
        name,
        description:     meta["description"] ?? "",
        markdownContent: body,
        tools,
        model:           meta["model"] ?? null,
        tags:            [],
        source:          "file",
        version:         meta["version"] ?? "1.0.0",
        createdAt:       mtime,
        updatedAt:       mtime,
      });
    } catch { /* skip malformed files */ }
  }
  return results;
}

/** Read a single agent by slug ID. */
export function readAgent(id: string): AgentEntry | null {
  const filePath = join(AGENTS_DIR, `${id}.md`);
  if (!existsSync(filePath)) return null;
  try {
    const raw   = readFileSync(filePath, "utf-8");
    const { meta, body } = parseFrontmatter(raw);
    const name  = meta["name"] ?? id;
    const mtime = statSync(filePath).mtime.toISOString();
    const tools = (meta["tools"] ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    return {
      id,
      name,
      description:     meta["description"] ?? "",
      markdownContent: body,
      tools,
      model:           meta["model"] ?? null,
      tags:            [],
      source:          "file",
      version:         meta["version"] ?? "1.0.0",
      createdAt:       mtime,
      updatedAt:       mtime,
    };
  } catch { return null; }
}

/** Write an agent to data/agents/{slug}.md */
export function writeAgentFile(agent: AgentEntry): void {
  ensureDirs();
  const slug  = toSlug(agent.name);
  const tools = agent.tools.join(", ");
  const fm    = buildFrontmatter({
    name:        agent.name,
    description: agent.description,
    tools:       tools || undefined,
    model:       agent.model ?? undefined,
  });
  const content = `${fm}\n\n${agent.markdownContent ?? ""}`.trimEnd() + "\n";
  writeFileSync(join(AGENTS_DIR, `${slug}.md`), content, "utf-8");
}

/** Delete an agent's markdown file. */
export function deleteAgentFile(id: string): void {
  const path = join(AGENTS_DIR, `${id}.md`);
  if (existsSync(path)) rmSync(path);
}

// ─── Skill file I/O ──────────────────────────────────────────────────

/** Read all skills from data/skills/{slug}/SKILL.md */
export function readAllSkills(): SkillEntry[] {
  ensureDirs();
  const results: SkillEntry[] = [];
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = join(SKILLS_DIR, entry.name, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;
    try {
      const raw   = readFileSync(skillMdPath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      const name  = meta["name"] ?? entry.name;
      const mtime = statSync(skillMdPath).mtime.toISOString();
      results.push({
        id:             entry.name,
        name,
        description:    meta["description"] ?? "",
        skillMdContent: body,
        hasScripts:     false,
        hasTemplates:   false,
        tags:           [],
        source:         "file",
        version:        "1.0.0",
        createdAt:      mtime,
        updatedAt:      mtime,
      });
    } catch { /* skip */ }
  }
  return results;
}

/** Read a single skill by slug ID. */
export function readSkill(id: string): SkillEntry | null {
  const skillMdPath = join(SKILLS_DIR, id, "SKILL.md");
  if (!existsSync(skillMdPath)) return null;
  try {
    const raw   = readFileSync(skillMdPath, "utf-8");
    const { meta, body } = parseFrontmatter(raw);
    const name  = meta["name"] ?? id;
    const mtime = statSync(skillMdPath).mtime.toISOString();
    return {
      id,
      name,
      description:    meta["description"] ?? "",
      skillMdContent: body,
      hasScripts:     false,
      hasTemplates:   false,
      tags:           [],
      source:         "file",
      version:        "1.0.0",
      createdAt:      mtime,
      updatedAt:      mtime,
    };
  } catch { return null; }
}

/** Write a skill to data/skills/{slug}/SKILL.md */
export function writeSkillFile(skill: SkillEntry): void {
  ensureDirs();
  const slug = toSlug(skill.name);
  const dir  = join(SKILLS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const fm      = buildFrontmatter({ name: skill.name, description: skill.description });
  const content = `${fm}\n\n${skill.skillMdContent ?? ""}`.trimEnd() + "\n";
  writeFileSync(join(dir, "SKILL.md"), content, "utf-8");
}

/** Delete a skill's directory. */
export function deleteSkillFile(id: string): void {
  const dir = join(SKILLS_DIR, id);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// ─── Playbook file I/O ───────────────────────────────────────────────

/** Read all playbooks from data/playbooks/*.md */
export function readAllPlaybooks(): PlaybookEntry[] {
  ensureDirs();
  const results: PlaybookEntry[] = [];
  for (const file of readdirSync(PLAYBOOKS_DIR)) {
    if (!file.endsWith(".md")) continue;
    const filePath = join(PLAYBOOKS_DIR, file);
    try {
      const raw   = readFileSync(filePath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      const name  = meta["name"] ?? file.replace(/\.md$/, "");
      const mtime = statSync(filePath).mtime.toISOString();

      const permissionProfile = meta["permission_profile"] ?? "autonomous";
      const permissions = PERMISSION_PRESETS[permissionProfile] ?? PERMISSION_PRESETS["autonomous"]!;

      // Agent/skill references are stored as names; resolve to slugs (= IDs)
      const agentIds = (meta["agents"] ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(toSlug);
      const skillIds = (meta["skills"] ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(toSlug);

      results.push({
        id:                file.replace(/\.md$/, ""),
        name,
        description:       meta["description"] ?? "",
        permissionProfile,
        permissions,
        agentIds,
        skillIds,
        mcpIds:            [],
        agentsRules:       body.trim(),
        createdAt:         mtime,
        updatedAt:         mtime,
      });
    } catch { /* skip malformed files */ }
  }
  return results;
}

/** Read a single playbook by slug ID (filename stem). */
export function readPlaybook(id: string): PlaybookEntry | null {
  return readAllPlaybooks().find((p) => p.id === id) ?? null;
}

/** Write a playbook to data/playbooks/{slug}.md */
export function writePlaybookFile(playbook: PlaybookEntry): void {
  ensureDirs();
  const slug = toSlug(playbook.name);
  const fm   = buildFrontmatter({
    name:               playbook.name,
    description:        playbook.description || undefined,
    permission_profile: playbook.permissionProfile,
  });
  const body = [
    playbook.agentIds.length ? `agents: ${playbook.agentIds.join(", ")}` : null,
    playbook.skillIds.length ? `skills: ${playbook.skillIds.join(", ")}` : null,
    playbook.agentsRules     ? `\n${playbook.agentsRules}` : null,
  ].filter(Boolean).join("\n");

  const content = `${fm}\n\n${body}`.trimEnd() + "\n";
  writeFileSync(join(PLAYBOOKS_DIR, `${slug}.md`), content, "utf-8");
}

/** Delete a playbook's markdown file. */
export function deletePlaybookFile(id: string): void {
  const path = join(PLAYBOOKS_DIR, `${id}.md`);
  if (existsSync(path)) rmSync(path);
}
