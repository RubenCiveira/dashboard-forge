import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import { readPlaybook, readAgent, readSkill } from "./markdown-sync.js";

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
  const playbook = readPlaybook(playbookId);
  if (!playbook) throw new Error(`Playbook "${playbookId}" not found`);

  // Create temp directory
  const baseDir = join(tmpdir(), `agentforge-${jobId}`);
  mkdirSync(baseDir, { recursive: true });
  mkdirSync(join(baseDir, "agents"), { recursive: true });
  mkdirSync(join(baseDir, "skills"), { recursive: true });

  // Write agent files
  for (const agentId of playbook.agentIds) {
    const agent = readAgent(agentId);
    if (agent) {
      writeFileSync(
        join(baseDir, "agents", `${agent.name}.md`),
        agent.markdownContent,
        "utf-8",
      );
    }
  }

  // Write skill directories
  for (const skillId of playbook.skillIds) {
    const skill = readSkill(skillId);
    if (skill) {
      const skillDir = join(baseDir, "skills", skill.id);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), skill.skillMdContent, "utf-8");
    }
  }

  // Build opencode.json
  const { permissions } = playbook;
  const opencodeConfig: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    permission: {
      bash:               permissions.bash,
      edit:               permissions.edit,
      write:              permissions.write,
      webfetch:           permissions.webfetch,
      external_directory: permissions.externalDirectory,
    },
  };

  // Add MCP servers (still DB-backed)
  if (playbook.mcpIds.length > 0) {
    const mcpConfig: Record<string, unknown> = {};
    for (const mcpId of playbook.mcpIds) {
      const mcp = await db
        .select()
        .from(schema.mcps)
        .where(eq(schema.mcps.id, mcpId))
        .get();

      if (mcp?.enabled) {
        mcpConfig[mcp.name] = { type: mcp.type, ...JSON.parse(mcp.config), enabled: true };
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

  // Write AGENTS.md (work sequence / rules)
  if (playbook.agentsRules) {
    writeFileSync(join(baseDir, "AGENTS.md"), playbook.agentsRules, "utf-8");
  }

  return baseDir;
}
