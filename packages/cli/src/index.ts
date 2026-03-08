#!/usr/bin/env bun

import { DEFAULT_API_PORT } from "@agentforge/shared";

const API_URL = process.env.AGENTFORGE_API_URL ?? `http://localhost:${DEFAULT_API_PORT}`;

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case "status":
      await status();
      break;
    case "agents":
      await listAgents();
      break;
    case "health":
      await health();
      break;
    case undefined:
    case "help":
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

async function health() {
  try {
    const res = await fetch(`${API_URL}/api/health`);
    const data = await res.json();
    console.log(`✓ API is ${data.status} (v${data.version})`);
  } catch {
    console.error("✗ API is unreachable at", API_URL);
    process.exit(1);
  }
}

async function status() {
  await health();
  // TODO: Fetch active jobs count, pending inputs, etc.
  console.log("  Jobs: (not yet implemented)");
}

async function listAgents() {
  const res = await fetch(`${API_URL}/api/v1/agents`);
  const { data, total } = await res.json();
  console.log(`Agents (${total}):`);
  for (const agent of data) {
    const tags = agent.tags.length > 0 ? ` [${agent.tags.join(", ")}]` : "";
    console.log(`  ${agent.name} — ${agent.description.slice(0, 60)}...${tags}`);
  }
}

function printHelp() {
  console.log(`
AgentForge CLI v0.1.0

Usage: agentforge <command> [options]

Commands:
  health      Check API connection
  status      Overview of system state
  agents      List registered agents
  help        Show this help

Environment:
  AGENTFORGE_API_URL   API base URL (default: http://localhost:${DEFAULT_API_PORT})
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
