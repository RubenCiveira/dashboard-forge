import { createResource, createSignal, For, Show } from "solid-js";

interface McpConfig {
  // local
  command?: string[];
  environment?: Record<string, string>;
  // remote
  url?: string;
  headers?: Record<string, string>;
}

interface McpRow {
  id: string;
  name: string;
  type: "local" | "remote";
  config: McpConfig;
  enabled: boolean;
  healthStatus: string;
  createdAt: string;
}

async function fetchMcps(): Promise<{ data: McpRow[] }> {
  const res = await fetch("/api/v1/mcps");
  return res.json();
}

const input = "w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 placeholder-gray-600";
const label = "block text-xs text-gray-400 mb-1";

/** Parse KEY=VALUE lines into a record. Skips blank lines and comments. */
function parseKV(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return result;
}

function kvToText(kv: Record<string, string> = {}): string {
  return Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n");
}

export default function MCPs() {
  const [mcps, { refetch }] = createResource(fetchMcps);

  const [showForm, setShowForm] = createSignal(false);
  const [saving,   setSaving]   = createSignal(false);
  const [error,    setError]    = createSignal<string | null>(null);

  // Form fields
  const [name,    setName]    = createSignal("");
  const [type,    setType]    = createSignal<"local" | "remote">("local");
  const [command, setCommand] = createSignal("");        // space-separated command
  const [envText, setEnvText] = createSignal("");        // KEY=VALUE lines
  const [url,     setUrl]     = createSignal("");
  const [hdrText, setHdrText] = createSignal("");        // KEY=VALUE lines for headers

  function resetForm() {
    setName(""); setType("local"); setCommand(""); setEnvText(""); setUrl(""); setHdrText("");
    setError(null);
  }

  async function save() {
    const n = name().trim();
    if (!n) { setError("Name is required"); return; }

    let config: McpConfig;
    if (type() === "local") {
      const parts = command().trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) { setError("Command is required for local MCPs"); return; }
      config = { command: parts };
      const env = parseKV(envText());
      if (Object.keys(env).length > 0) config.environment = env;
    } else {
      const u = url().trim();
      if (!u) { setError("URL is required for remote MCPs"); return; }
      config = { url: u };
      const hdrs = parseKV(hdrText());
      if (Object.keys(hdrs).length > 0) config.headers = hdrs;
    }

    setSaving(true);
    setError(null);
    const res = await fetch("/api/v1/mcps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n, type: type(), config, enabled: true }),
    });
    const json = await res.json() as { data?: McpRow; error?: { message: string } };
    setSaving(false);

    if (json.error) { setError(json.error.message); return; }
    resetForm();
    setShowForm(false);
    refetch();
  }

  async function toggleEnabled(mcp: McpRow) {
    await fetch(`/api/v1/mcps/${mcp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !mcp.enabled }),
    });
    refetch();
  }

  async function deleteMcp(id: string) {
    await fetch(`/api/v1/mcps/${id}`, { method: "DELETE" });
    refetch();
  }

  return (
    <div class="p-8 max-w-4xl">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">MCP Servers</h1>
          <p class="text-gray-400 text-sm">{(mcps()?.data ?? []).length} configured</p>
        </div>
        <Show when={!showForm()}>
          <button
            onClick={() => setShowForm(true)}
            class="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm font-medium transition-colors"
          >
            + New MCP
          </button>
        </Show>
      </div>

      {/* ── Create form ─────────────────────────────────────────── */}
      <Show when={showForm()}>
        <div class="mb-8 p-5 bg-gray-900 border border-gray-700 rounded-xl space-y-4">
          <h2 class="font-semibold text-base">New MCP Server</h2>

          {/* Name + Type */}
          <div class="grid grid-cols-2 gap-4">
            <div>
              <p class={label}>Name</p>
              <input class={input} placeholder="my-mcp-server" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            </div>
            <div>
              <p class={label}>Type</p>
              <select
                class={input}
                value={type()}
                onChange={(e) => setType(e.currentTarget.value as "local" | "remote")}
              >
                <option value="local">local — stdio subprocess</option>
                <option value="remote">remote — HTTP/SSE</option>
              </select>
            </div>
          </div>

          {/* Local fields */}
          <Show when={type() === "local"}>
            <div>
              <p class={label}>Command <span class="text-gray-600">(space-separated, e.g. npx -y @modelcontextprotocol/server-filesystem /tmp)</span></p>
              <input
                class={`${input} font-mono`}
                placeholder="npx -y @modelcontextprotocol/server-filesystem /path/to/dir"
                value={command()}
                onInput={(e) => setCommand(e.currentTarget.value)}
              />
            </div>
            <div>
              <p class={label}>Environment variables <span class="text-gray-600">(KEY=VALUE, one per line — optional)</span></p>
              <textarea
                class={`${input} font-mono h-20 resize-none`}
                placeholder={"API_KEY=abc123\nDEBUG=true"}
                value={envText()}
                onInput={(e) => setEnvText(e.currentTarget.value)}
              />
            </div>
          </Show>

          {/* Remote fields */}
          <Show when={type() === "remote"}>
            <div>
              <p class={label}>URL</p>
              <input
                class={`${input} font-mono`}
                placeholder="https://my-mcp-server.example.com/mcp"
                value={url()}
                onInput={(e) => setUrl(e.currentTarget.value)}
              />
            </div>
            <div>
              <p class={label}>Headers <span class="text-gray-600">(KEY=VALUE, one per line — optional)</span></p>
              <textarea
                class={`${input} font-mono h-20 resize-none`}
                placeholder={"Authorization=Bearer mytoken\nX-Custom-Header=value"}
                value={hdrText()}
                onInput={(e) => setHdrText(e.currentTarget.value)}
              />
            </div>
          </Show>

          <Show when={error()}>
            <p class="text-sm text-red-400">{error()}</p>
          </Show>

          <div class="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving()}
              class="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded text-sm font-medium transition-colors"
            >
              {saving() ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => { resetForm(); setShowForm(false); }}
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </Show>

      {/* ── MCP list ────────────────────────────────────────────── */}
      <Show when={!mcps.loading} fallback={<p class="text-gray-500">Loading…</p>}>
        <Show
          when={(mcps()?.data ?? []).length > 0}
          fallback={<p class="text-gray-600 text-sm">No MCP servers yet. Add one above.</p>}
        >
          <div class="space-y-3">
            <For each={mcps()?.data ?? []}>
              {(mcp) => (
                <div class={`group p-4 bg-gray-900 rounded-lg border transition-colors ${mcp.enabled ? "border-gray-800 hover:border-gray-700" : "border-gray-800 opacity-60"}`}>
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <h3 class="font-semibold">{mcp.name}</h3>
                        <span class={`text-xs px-2 py-0.5 rounded ${mcp.type === "local" ? "bg-purple-900/40 text-purple-300" : "bg-blue-900/40 text-blue-300"}`}>
                          {mcp.type}
                        </span>
                        <Show when={!mcp.enabled}>
                          <span class="text-xs text-gray-600">disabled</span>
                        </Show>
                      </div>

                      {/* Config preview */}
                      <Show when={mcp.type === "local" && mcp.config.command}>
                        <p class="text-xs text-gray-500 font-mono mt-1 truncate" title={mcp.config.command!.join(" ")}>
                          $ {mcp.config.command!.join(" ")}
                        </p>
                      </Show>
                      <Show when={mcp.type === "remote" && mcp.config.url}>
                        <p class="text-xs text-gray-500 font-mono mt-1 truncate" title={mcp.config.url}>
                          {mcp.config.url}
                        </p>
                      </Show>
                      <Show when={mcp.type === "local" && mcp.config.environment && Object.keys(mcp.config.environment).length > 0}>
                        <p class="text-xs text-gray-600 mt-0.5">
                          {Object.keys(mcp.config.environment!).length} env var{Object.keys(mcp.config.environment!).length !== 1 ? "s" : ""}
                        </p>
                      </Show>
                    </div>

                    <div class="flex items-center gap-3 flex-shrink-0">
                      {/* Enable/disable toggle */}
                      <button
                        onClick={() => toggleEnabled(mcp)}
                        class={`text-xs transition-colors ${mcp.enabled ? "text-emerald-500 hover:text-emerald-400" : "text-gray-600 hover:text-gray-400"}`}
                        title={mcp.enabled ? "Click to disable" : "Click to enable"}
                      >
                        {mcp.enabled ? "● enabled" : "○ disabled"}
                      </button>
                      <button
                        onClick={() => deleteMcp(mcp.id)}
                        class="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 text-xs transition-all"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* ── Info box ────────────────────────────────────────────── */}
      <div class="mt-10 p-4 bg-gray-900 border border-gray-800 rounded-lg">
        <p class="text-xs font-semibold text-gray-400 mb-2">About MCP Servers</p>
        <p class="text-xs text-gray-500 leading-relaxed">
          MCP (Model Context Protocol) servers extend agent capabilities with external tools — file systems,
          databases, APIs, and more. Once added here, associate them with a Playbook from the Playbooks page.
          OpenCode will start the MCP server automatically when a job using that playbook runs.
        </p>
        <p class="text-xs text-gray-600 mt-2">
          Find available MCP servers at{" "}
          <span class="font-mono text-gray-500">modelcontextprotocol.io/servers</span>
        </p>
      </div>

    </div>
  );
}
