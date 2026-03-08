import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { instanceConfigSchema, updateInstanceConfigSchema } from "@agentforge/shared";
import type { InstanceConfig, UpdateInstanceConfig } from "@agentforge/shared";

const CONFIG_PATH = resolve(import.meta.dir, "../../../agentforge.config.json");

/**
 * Reads and validates the instance config file.
 * Falls back to schema defaults if the file is missing or malformed.
 */
export function readConfig(): InstanceConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return instanceConfigSchema.parse(JSON.parse(raw));
  } catch {
    return instanceConfigSchema.parse({});
  }
}

/**
 * Deep-merges a partial config update and persists it to disk.
 */
export function writeConfig(patch: UpdateInstanceConfig): InstanceConfig {
  const validated = updateInstanceConfigSchema.parse(patch);
  const current = readConfig();

  const next: InstanceConfig = {
    ollama: { ...current.ollama, ...validated.ollama },
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", "utf-8");
  return next;
}
