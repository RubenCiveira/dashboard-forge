import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import type { PermissionConfig } from "@agentforge/shared";

/**
 * Materializes a playbook into a temporary directory structure
 * that OpenCode expects when pointed via OPENCODE_CONFIG_DIR.
 *
 * Generated structure:
 *   {tmpDir}/
 *     opencode.json    — model, permissions, MCP config
 *     agents/          — .md files for each agent
 *     skills/          — SKILL.md directories for each skill
 *     AGENTS.md        — general rules for the playbook
 */
export async function materializePlaybook(
  playbookId: string,
  jobId: string,
  modelOverride?: string | null,
): Promise<string> {
  // Fetch playbook
  const [playbook] = await db
    .select()
    .from(schema.playbooks)
    .where(eq(schema.playbooks.id, playbookId));

  if (!playbook) throw new Error(`Playbook ${playbookId} not found`);

  const agentIds: string[] = JSON.parse(playbook.agentIds);
  const skillIds: string[] = JSON.parse(playbook.skillIds);
  const mcpIds: string[] = JSON.parse(playbook.mcpIds);
  const permissions: PermissionConfig = JSON.parse(playbook.permissions);

  // Create temp directory
  const baseDir = join(tmpdir(), `agentforge-${jobId}`);
  mkdirSync(baseDir, { recursive: true });
  mkdirSync(join(baseDir, "agents"), { recursive: true });
  mkdirSync(join(baseDir, "skills"), { recursive: true });

  // Fetch and write agents
  for (const agentId of agentIds) {
    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId));

    if (agent) {
      writeFileSync(
        join(baseDir, "agents", `${agent.name}.md`),
        agent.markdownContent,
        "utf-8",
      );
    }
  }

  // Fetch and write skills
  for (const skillId of skillIds) {
    const [skill] = await db
      .select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId));

    if (skill) {
      const skillDir = join(baseDir, "skills", skill.name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        skill.skillMdContent,
        "utf-8",
      );
    }
  }

  // Build opencode.json
  const opencodeConfig: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    permission: {
      bash: permissions.bash,
      edit: permissions.edit,
      write: permissions.write,
      webfetch: permissions.webfetch,
      external_directory: permissions.externalDirectory,
    },
  };

  // Add MCP servers
  if (mcpIds.length > 0) {
    const mcpConfig: Record<string, unknown> = {};
    for (const mcpId of mcpIds) {
      const [mcp] = await db
        .select()
        .from(schema.mcps)
        .where(eq(schema.mcps.id, mcpId));

      if (mcp && mcp.enabled) {
        const config = JSON.parse(mcp.config);
        mcpConfig[mcp.name] = {
          type: mcp.type,
          ...config,
          enabled: true,
        };
      }
    }
    if (Object.keys(mcpConfig).length > 0) {
      opencodeConfig.mcp = mcpConfig;
    }
  }

  writeFileSync(
    join(baseDir, "opencode.json"),
    JSON.stringify(opencodeConfig, null, 2),
    "utf-8",
  );

  // Write AGENTS.md
  if (playbook.agentsRules) {
    writeFileSync(
      join(baseDir, "AGENTS.md"),
      playbook.agentsRules,
      "utf-8",
    );
  }

  return baseDir;
}
