/**
 * Importer service — brings agent/skill/playbook files into the data directory
 * from a ZIP archive or a GitHub URL, then triggers file-system sync to DB.
 *
 * Supported GitHub URL forms:
 *   blob  → https://github.com/user/repo/blob/main/agents/code-reviewer.md
 *   tree  → https://github.com/user/repo/tree/main/agents/
 */

import { unzipSync } from "fflate";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
  syncAgentsFromFiles,
  syncSkillsFromFiles,
  syncPlaybooksFromFiles,
} from "./markdown-sync.js";

export type ImportType = "agents" | "skills" | "playbooks";

const DATA_DIR = resolve(process.cwd(), "data");

// ─── ZIP import ──────────────────────────────────────────────────────

/**
 * Extract relevant files from a ZIP buffer into data/{type}/, then sync to DB.
 * - agents/playbooks: any *.md file (except SKILL.md)
 * - skills: {slug}/SKILL.md files, using the parent directory name as slug
 */
export async function importFromZip(
  buffer: ArrayBuffer,
  type: ImportType,
): Promise<number> {
  const uint8  = new Uint8Array(buffer);
  const files  = unzipSync(uint8);
  const destDir = join(DATA_DIR, type);
  mkdirSync(destDir, { recursive: true });

  for (const [path, data] of Object.entries(files)) {
    const parts = path.split("/");
    const name  = parts[parts.length - 1]!;

    if (type === "agents" || type === "playbooks") {
      if (!name.endsWith(".md") || name === "SKILL.md") continue;
      writeFileSync(join(destDir, name), data);
    } else {
      // skills: look for SKILL.md files, use parent dir as slug
      if (name !== "SKILL.md") continue;
      const slug = parts[parts.length - 2];
      if (!slug) continue;
      const skillDir = join(destDir, slug);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), data);
    }
  }

  return runSync(type);
}

// ─── GitHub import ───────────────────────────────────────────────────

interface GHEntry {
  name: string;
  type: "file" | "dir";
  download_url: string | null;
}

interface ParsedGHUrl {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  isDir: boolean;
}

function parseGitHubUrl(url: string): ParsedGHUrl | null {
  const blob = /github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/.exec(url);
  if (blob) {
    return { owner: blob[1]!, repo: blob[2]!, ref: blob[3]!, path: blob[4]!, isDir: false };
  }
  const tree = /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?(.*)$/.exec(url);
  if (tree) {
    return { owner: tree[1]!, repo: tree[2]!, ref: tree[3]!, path: tree[4]!.replace(/\/$/, ""), isDir: true };
  }
  return null;
}

function rawUrl(owner: string, repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

function apiUrl(owner: string, repo: string, path: string, ref: string): string {
  const p = path ? `/${path}` : "";
  return `https://api.github.com/repos/${owner}/${repo}/contents${p}?ref=${ref}`;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "agentforge" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function listDir(
  owner: string, repo: string, path: string, ref: string,
): Promise<GHEntry[]> {
  const res = await fetch(apiUrl(owner, repo, path, ref), {
    headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "agentforge" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} listing ${path}`);
  return res.json() as Promise<GHEntry[]>;
}

/**
 * Import from a GitHub blob (single file) or tree (directory) URL.
 * Writes files to data/{type}/ and syncs to DB.
 */
export async function importFromGitHubUrl(
  url: string,
  type: ImportType,
): Promise<number> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    throw new Error(
      "Invalid GitHub URL. Provide a blob (file) or tree (directory) URL.",
    );
  }

  const { owner, repo, ref, path, isDir } = parsed;
  const destDir = join(DATA_DIR, type);
  mkdirSync(destDir, { recursive: true });

  if (!isDir) {
    // Single file
    const content = await fetchText(rawUrl(owner, repo, ref, path));
    const name    = path.split("/").pop()!;

    if (type === "skills") {
      // Treat it as a SKILL.md; use filename stem as slug
      const slug = name.replace(/\.md$/i, "");
      const skillDir = join(destDir, slug);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), content);
    } else {
      if (!name.endsWith(".md")) throw new Error("File must end in .md");
      writeFileSync(join(destDir, name), content);
    }
  } else {
    // Directory listing
    const entries = await listDir(owner, repo, path, ref);

    if (type === "agents" || type === "playbooks") {
      // Download every .md file in this directory level
      const mdFiles = entries.filter(
        (e) => e.type === "file" && e.name.endsWith(".md") && e.name !== "SKILL.md",
      );
      for (const file of mdFiles) {
        const content = await fetchText(
          rawUrl(owner, repo, ref, path ? `${path}/${file.name}` : file.name),
        );
        writeFileSync(join(destDir, file.name), content);
      }
    } else {
      // Skills: each subdirectory is a skill; fetch SKILL.md from each
      const dirs = entries.filter((e) => e.type === "dir");
      for (const dir of dirs) {
        const skillMdPath = path ? `${path}/${dir.name}/SKILL.md` : `${dir.name}/SKILL.md`;
        try {
          const content = await fetchText(rawUrl(owner, repo, ref, skillMdPath));
          const skillDir = join(destDir, dir.name);
          mkdirSync(skillDir, { recursive: true });
          writeFileSync(join(skillDir, "SKILL.md"), content);
        } catch {
          // no SKILL.md in this subdir — skip silently
        }
      }
    }
  }

  return runSync(type);
}

// ─── helpers ─────────────────────────────────────────────────────────

function runSync(type: ImportType): Promise<number> {
  if (type === "agents")    return syncAgentsFromFiles();
  if (type === "skills")    return syncSkillsFromFiles();
  return syncPlaybooksFromFiles();
}
