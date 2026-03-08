import { ollamaModelSchema, ollamaPullStatusSchema } from "@agentforge/shared";
import type { OllamaModel, OllamaPullStatus } from "@agentforge/shared";
import { readConfig } from "../config.js";
import { ApiError } from "../lib/errors.js";

function getBaseUrl(): string {
  return readConfig().ollama.baseUrl;
}

/**
 * Returns the list of models currently installed in the local Ollama instance.
 */
export async function listOllamaModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${getBaseUrl()}/api/tags`).catch(() => {
    throw new ApiError(502, "OLLAMA_UNREACHABLE", "Cannot reach Ollama at " + getBaseUrl());
  });

  if (!res.ok) {
    throw new ApiError(502, "OLLAMA_ERROR", `Ollama returned ${res.status}`);
  }

  const body = await res.json() as { models?: unknown[] };
  return (body.models ?? []).map((m) => ollamaModelSchema.parse(m));
}

/**
 * Pulls a model from Ollama registry, streaming progress via an async generator.
 */
export async function* pullOllamaModel(
  name: string,
): AsyncGenerator<OllamaPullStatus> {
  const res = await fetch(`${getBaseUrl()}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, stream: true }),
  }).catch(() => {
    throw new ApiError(502, "OLLAMA_UNREACHABLE", "Cannot reach Ollama at " + getBaseUrl());
  });

  if (!res.ok || !res.body) {
    throw new ApiError(502, "OLLAMA_ERROR", `Ollama returned ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        yield ollamaPullStatusSchema.parse(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
  }
}

/**
 * Checks if Ollama is reachable and returns its version string.
 */
export async function checkOllamaHealth(): Promise<{ reachable: boolean; version?: string }> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/version`);
    if (!res.ok) return { reachable: false };
    const body = await res.json() as { version?: string };
    return { reachable: true, version: body.version };
  } catch {
    return { reachable: false };
  }
}
