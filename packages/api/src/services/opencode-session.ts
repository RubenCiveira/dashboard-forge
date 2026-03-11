import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join } from "path";

const OPENCODE_DB = join(homedir(), ".local", "share", "opencode", "opencode.db");

interface RawMessage {
  id: string;
  session_id: string;
  time_created: number;
  data: string;
}

interface RawPart {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  data: string;
}

export interface ConversationPart {
  id: string;
  type: string;
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  snapshot?: string;
  tokens?: { total: number; input: number; output: number; reasoning: number };
  cost?: number;
  finishReason?: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  createdAt: number;
  model?: string;
  provider?: string;
  parts: ConversationPart[];
}

/**
 * Reads a session's conversation from OpenCode's local SQLite database.
 * Returns messages with their parts ordered by creation time.
 */
export function getOpenCodeSession(sessionId: string): ConversationMessage[] {
  let db: Database;
  try {
    db = new Database(OPENCODE_DB, { readonly: true });
  } catch {
    return [];
  }

  try {
    const messages = db.query<RawMessage, string>(
      "SELECT id, session_id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC",
    ).all(sessionId);

    const parts = db.query<RawPart, string>(
      "SELECT id, message_id, session_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created ASC",
    ).all(sessionId);

    const partsByMessage = new Map<string, ConversationPart[]>();
    for (const rawPart of parts) {
      const parsed = JSON.parse(rawPart.data) as Record<string, unknown>;
      const part: ConversationPart = {
        id: rawPart.id,
        type: parsed.type as string,
        text: parsed.text as string | undefined,
        toolName: parsed.toolName as string | undefined,
        toolInput: parsed.input,
        toolOutput: parsed.output as string | undefined,
        snapshot: parsed.snapshot as string | undefined,
        finishReason: parsed.reason as string | undefined,
      };
      if (parsed.tokens) {
        const t = parsed.tokens as { total: number; input: number; output: number; reasoning: number };
        part.tokens = { total: t.total, input: t.input, output: t.output, reasoning: t.reasoning };
      }
      if (typeof parsed.cost === "number") part.cost = parsed.cost;

      const list = partsByMessage.get(rawPart.message_id) ?? [];
      list.push(part);
      partsByMessage.set(rawPart.message_id, list);
    }

    return messages.map((rawMsg) => {
      const data = JSON.parse(rawMsg.data) as {
        role: "user" | "assistant";
        modelID?: string;
        providerID?: string;
      };
      return {
        id: rawMsg.id,
        role: data.role,
        createdAt: rawMsg.time_created,
        model: data.modelID,
        provider: data.providerID,
        parts: partsByMessage.get(rawMsg.id) ?? [],
      };
    });
  } finally {
    db.close();
  }
}

/**
 * Extracts the sessionID from OpenCode's NDJSON stdout.
 * Returns the first sessionID found in a step_start event.
 */
export function extractSessionId(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as { type?: string; sessionID?: string };
      if (ev.sessionID) return ev.sessionID;
    } catch { /* skip */ }
  }
  return null;
}
