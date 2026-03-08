import { createResource, createSignal, For, Show } from "solid-js";
import type { InstanceConfig, Model, OllamaModel } from "@agentforge/shared";

// ─── API helpers ─────────────────────────────────────────────────────

async function fetchConfig(): Promise<InstanceConfig> {
  const res = await fetch("/api/v1/config");
  const json = await res.json() as { data: InstanceConfig };
  return json.data;
}

async function fetchConfiguredModels(): Promise<Model[]> {
  const res = await fetch("/api/v1/models");
  const json = await res.json() as { data: Model[] };
  return json.data;
}

async function fetchOllamaModels(): Promise<OllamaModel[]> {
  const res = await fetch("/api/v1/models/ollama");
  if (!res.ok) return [];
  const json = await res.json() as { data: OllamaModel[] };
  return json.data;
}

// ─── Component ───────────────────────────────────────────────────────

export default function Models() {
  const [config, { refetch: refetchConfig }] = createResource(fetchConfig);
  const [configuredModels, { refetch: refetchConfigured }] = createResource(fetchConfiguredModels);
  const [ollamaModels, { refetch: refetchOllama }] = createResource(fetchOllamaModels);

  // Config edit state
  const [editingUrl, setEditingUrl] = createSignal(false);
  const [urlDraft, setUrlDraft] = createSignal("");

  // Pull state
  const [pulling, setPulling] = createSignal<string | null>(null);
  const [pullLog, setPullLog] = createSignal("");

  async function saveOllamaUrl() {
    const url = urlDraft().trim();
    if (!url) return;
    await fetch("/api/v1/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ollama: { baseUrl: url } }),
    });
    setEditingUrl(false);
    refetchConfig();
    refetchOllama();
  }

  async function pullModel(name: string) {
    setPulling(name);
    setPullLog("");
    const res = await fetch("/api/v1/models/ollama/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) { setPulling(null); return; }
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split("\n").filter((l) => l.startsWith("data:"));
      for (const line of lines) {
        try {
          const status = JSON.parse(line.slice(5)) as { status: string; completed?: number; total?: number };
          const pct = status.total ? ` (${Math.round((status.completed ?? 0) / status.total * 100)}%)` : "";
          setPullLog(`${status.status}${pct}`);
        } catch { /* ignore */ }
      }
    }
    setPulling(null);
    refetchOllama();
  }

  async function addModel(ollamaModel: OllamaModel) {
    await fetch("/api/v1/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "ollama",
        modelId: ollamaModel.name,
        displayName: ollamaModel.name,
        enabled: true,
      }),
    });
    refetchConfigured();
  }

  async function toggleModel(id: string, enabled: boolean) {
    await fetch(`/api/v1/models/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    refetchConfigured();
  }

  async function removeModel(id: string) {
    await fetch(`/api/v1/models/${id}`, { method: "DELETE" });
    refetchConfigured();
  }

  const configuredIds = () => new Set(configuredModels()?.map((m) => m.modelId) ?? []);

  return (
    <div class="min-h-screen bg-gray-950 text-gray-100 p-8">
      <div class="max-w-4xl mx-auto">
        <a href="/" class="text-gray-500 hover:text-gray-300 text-sm mb-6 inline-block">← Dashboard</a>
        <h1 class="text-2xl font-bold mb-1">Models</h1>
        <p class="text-gray-400 text-sm mb-8">Configure usable models for your OpenCode agents</p>

        {/* ── Ollama Config ─────────────────────────────────────────── */}
        <section class="mb-8 p-6 bg-gray-900 rounded-lg border border-gray-800">
          <h2 class="text-lg font-semibold mb-4">Ollama Instance</h2>

          <Show when={!editingUrl()} fallback={
            <div class="flex gap-3 items-center">
              <input
                class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                value={urlDraft()}
                onInput={(e) => setUrlDraft(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && saveOllamaUrl()}
                placeholder="http://localhost:11434"
              />
              <button
                onClick={saveOllamaUrl}
                class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-medium transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => setEditingUrl(false)}
                class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          }>
            <div class="flex gap-3 items-center">
              <span class="flex-1 font-mono text-sm text-gray-300">
                {config()?.ollama.baseUrl ?? "loading..."}
              </span>
              <Show when={config()}>
                <span class={`text-xs px-2 py-0.5 rounded-full ${config()!.ollama.enabled ? "bg-emerald-900 text-emerald-300" : "bg-gray-700 text-gray-400"}`}>
                  {config()!.ollama.enabled ? "enabled" : "disabled"}
                </span>
              </Show>
              <button
                onClick={() => { setUrlDraft(config()?.ollama.baseUrl ?? ""); setEditingUrl(true); }}
                class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
              >
                Edit
              </button>
            </div>
          </Show>
        </section>

        {/* ── Ollama Available Models ───────────────────────────────── */}
        <section class="mb-8 p-6 bg-gray-900 rounded-lg border border-gray-800">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold">Installed in Ollama</h2>
            <button
              onClick={refetchOllama}
              class="text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              Refresh
            </button>
          </div>

          <Show when={pulling()}>
            <div class="mb-4 p-3 bg-gray-800 rounded text-sm text-gray-300">
              Pulling <span class="text-emerald-400 font-mono">{pulling()}</span>…{" "}
              <span class="text-gray-400">{pullLog()}</span>
            </div>
          </Show>

          <Show
            when={!ollamaModels.loading}
            fallback={<p class="text-gray-500 text-sm">Connecting to Ollama…</p>}
          >
            <Show
              when={(ollamaModels() ?? []).length > 0}
              fallback={
                <div class="text-gray-500 text-sm">
                  <p>No models found. Pull one below.</p>
                  <PullForm onPull={pullModel} pulling={pulling()} />
                </div>
              }
            >
              <div class="space-y-2">
                <For each={ollamaModels()}>
                  {(m) => (
                    <div class="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
                      <div class="flex-1 min-w-0">
                        <p class="font-mono text-sm truncate">{m.name}</p>
                        <p class="text-xs text-gray-500">
                          {(m.size / 1e9).toFixed(1)} GB
                          {m.details?.parameter_size && ` · ${m.details.parameter_size}`}
                          {m.details?.quantization_level && ` · ${m.details.quantization_level}`}
                        </p>
                      </div>
                      <Show
                        when={!configuredIds().has(m.name)}
                        fallback={
                          <span class="text-xs text-emerald-400 px-2 py-1 bg-emerald-900/40 rounded">Added</span>
                        }
                      >
                        <button
                          onClick={() => addModel(m)}
                          class="text-xs px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded transition-colors"
                        >
                          + Add
                        </button>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
              <PullForm onPull={pullModel} pulling={pulling()} />
            </Show>
          </Show>
        </section>

        {/* ── Configured Models ─────────────────────────────────────── */}
        <section class="p-6 bg-gray-900 rounded-lg border border-gray-800">
          <h2 class="text-lg font-semibold mb-4">Configured Models</h2>
          <p class="text-xs text-gray-500 mb-4">These models are available when configuring agents in OpenCode.</p>

          <Show
            when={(configuredModels() ?? []).length > 0}
            fallback={<p class="text-gray-500 text-sm">No models configured yet. Add one from the list above.</p>}
          >
            <div class="space-y-2">
              <For each={configuredModels()}>
                {(m) => (
                  <div class="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
                    <div class="flex-1 min-w-0">
                      <p class="font-mono text-sm">{m.modelId}</p>
                      <p class="text-xs text-gray-500 capitalize">{m.provider}</p>
                    </div>
                    <button
                      onClick={() => toggleModel(m.id, !m.enabled)}
                      class={`text-xs px-2 py-1 rounded transition-colors ${
                        m.enabled
                          ? "bg-emerald-900 text-emerald-300 hover:bg-emerald-800"
                          : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                      }`}
                    >
                      {m.enabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      onClick={() => removeModel(m.id)}
                      class="text-xs px-2 py-1 text-red-400 hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>
      </div>
    </div>
  );
}

// ─── Pull Form subcomponent ───────────────────────────────────────────

function PullForm(props: { onPull: (name: string) => void; pulling: string | null }) {
  const [name, setName] = createSignal("");

  function submit() {
    const n = name().trim();
    if (n) { props.onPull(n); setName(""); }
  }

  return (
    <div class="mt-4 flex gap-2">
      <input
        class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500 placeholder-gray-600"
        placeholder="e.g. llama3.2, qwen3:8b"
        value={name()}
        onInput={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        disabled={!!props.pulling}
      />
      <button
        onClick={submit}
        disabled={!!props.pulling || !name().trim()}
        class="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-sm transition-colors"
      >
        Pull
      </button>
    </div>
  );
}
