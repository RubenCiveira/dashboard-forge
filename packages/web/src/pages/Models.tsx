import { createResource, createSignal, For, Show } from "solid-js";
import type { InstanceConfig, Model, OllamaModel } from "@agentforge/shared";

// ─── Types ───────────────────────────────────────────────────────────

interface OCModel { id: string; provider: string; modelId: string }

// ─── API helpers ─────────────────────────────────────────────────────

async function fetchConfig(): Promise<InstanceConfig> {
  const res = await fetch("/api/v1/config");
  return (await res.json() as { data: InstanceConfig }).data;
}

async function fetchModels(): Promise<Model[]> {
  const res = await fetch("/api/v1/models");
  return (await res.json() as { data: Model[] }).data;
}

async function fetchOCModels(): Promise<OCModel[]> {
  const res = await fetch("/api/v1/models/opencode");
  if (!res.ok) return [];
  return (await res.json() as { data: OCModel[] }).data;
}

async function fetchOllamaModels(): Promise<OllamaModel[]> {
  const res = await fetch("/api/v1/models/ollama");
  if (!res.ok) return [];
  return (await res.json() as { data: OllamaModel[] }).data;
}

// ─── Component ───────────────────────────────────────────────────────

export default function Models() {
  const [config, { refetch: refetchConfig }]  = createResource(fetchConfig);
  const [models, { refetch: refetchModels }]  = createResource(fetchModels);
  const [ocModels]                            = createResource(fetchOCModels);
  const [ollama, { refetch: refetchOllama }]  = createResource(fetchOllamaModels);

  // OpenCode catalog filter
  const [search, setSearch] = createSignal("");

  // Manual add form (for models not in OC catalog)
  const [newModel, setNewModel] = createSignal("");
  const [adding, setAdding]     = createSignal(false);

  // Ollama panel
  const [ollamaOpen, setOllamaOpen] = createSignal(false);
  const [editingUrl, setEditingUrl] = createSignal(false);
  const [urlDraft, setUrlDraft]     = createSignal("");
  const [pulling, setPulling]       = createSignal<string | null>(null);
  const [pullLog, setPullLog]       = createSignal("");

  // ── derived ──────────────────────────────────────────────────────

  /** Set of modelId values already added to our DB */
  const addedIds = () => new Set(models()?.map((m) => `${m.provider}/${m.modelId}`) ?? []);

  /** OpenCode catalog grouped by provider, filtered by search */
  const groupedOCModels = () => {
    const q = search().toLowerCase();
    const all = (ocModels() ?? []).filter(
      (m) => !q || m.id.toLowerCase().includes(q),
    );
    const map = new Map<string, OCModel[]>();
    for (const m of all) {
      if (!map.has(m.provider)) map.set(m.provider, []);
      map.get(m.provider)!.push(m);
    }
    // Return sorted providers
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  };

  /** Models in DB that are NOT from the OpenCode catalog (manually added) */
  const extraModels = () => {
    const ocIds = new Set((ocModels() ?? []).map((m) => m.id));
    return (models() ?? []).filter((m) => !ocIds.has(`${m.provider}/${m.modelId}`));
  };

  const ollamaEnabled = () => config()?.ollama.enabled ?? false;

  // ── actions ──────────────────────────────────────────────────────

  async function addModel(provider: string, modelId: string) {
    await fetch("/api/v1/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, modelId, displayName: `${provider}/${modelId}`, enabled: true }),
    });
    refetchModels();
  }

  async function removeModelByKey(key: string) {
    const m = models()?.find((m) => `${m.provider}/${m.modelId}` === key);
    if (!m) return;
    await fetch(`/api/v1/models/${m.id}`, { method: "DELETE" });
    refetchModels();
  }

  async function removeModelById(id: string) {
    await fetch(`/api/v1/models/${id}`, { method: "DELETE" });
    refetchModels();
  }

  async function addModelManual() {
    const s = newModel().trim();
    if (!s) return;
    const slash = s.indexOf("/");
    const provider = slash > 0 ? s.slice(0, slash) : "unknown";
    const modelId  = slash > 0 ? s.slice(slash + 1) : s;
    setAdding(true);
    await addModel(provider, modelId);
    setNewModel("");
    setAdding(false);
  }

  async function addFromOllama(m: OllamaModel) {
    await addModel("ollama", m.name);
  }

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
    const reader  = res.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) { setPulling(null); return; }
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split("\n").filter((l) => l.startsWith("data:"))) {
        try {
          const s = JSON.parse(line.slice(5)) as { status: string; completed?: number; total?: number };
          const pct = s.total ? ` ${Math.round((s.completed ?? 0) / s.total * 100)}%` : "";
          setPullLog(`${s.status}${pct}`);
        } catch { /* ignore */ }
      }
    }
    setPulling(null);
    refetchOllama();
  }

  // ── render ───────────────────────────────────────────────────────

  return (
    <div class="p-8 max-w-4xl">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div class="mb-6">
        <h1 class="text-2xl font-bold">Models</h1>
        <p class="text-gray-400 text-sm">
          {(models() ?? []).length} active in AgentForge
          <Show when={(ocModels() ?? []).length > 0}>
            <span class="text-gray-600"> · {(ocModels() ?? []).length} available from OpenCode</span>
          </Show>
        </p>
      </div>

      {/* ── OpenCode catalog (primary) ────────────────────────────── */}
      <section class="mb-6 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-800">
          <h2 class="font-semibold mb-1">OpenCode Catalog</h2>
          <p class="text-xs text-gray-500">Models available through your OpenCode installation. Click <span class="text-emerald-400">Add</span> to activate them in AgentForge.</p>
        </div>

        <Show
          when={!ocModels.loading}
          fallback={<p class="px-5 py-4 text-sm text-gray-500">Loading OpenCode models…</p>}
        >
          <Show
            when={(ocModels() ?? []).length > 0}
            fallback={
              <p class="px-5 py-4 text-sm text-gray-600">
                OpenCode CLI not found or returned no models.
              </p>
            }
          >
            {/* Search */}
            <div class="px-5 py-3 border-b border-gray-800">
              <input
                class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500 placeholder-gray-600"
                placeholder="Filter models…"
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
              />
            </div>

            {/* Provider groups */}
            <div class="divide-y divide-gray-800">
              <For each={groupedOCModels()}>
                {([provider, providerModels]) => (
                  <ProviderGroup
                    provider={provider}
                    models={providerModels}
                    addedIds={addedIds()}
                    onAdd={(m) => addModel(m.provider, m.modelId)}
                    onRemove={(m) => removeModelByKey(m.id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>

        {/* Manually added models outside OC catalog */}
        <Show when={extraModels().length > 0}>
          <div class="border-t border-gray-800 px-5 py-3">
            <p class="text-xs text-gray-500 mb-2">Custom / manually added</p>
            <For each={extraModels()}>
              {(m) => (
                <div class="flex items-center gap-3 py-1.5">
                  <span class="flex-1 font-mono text-sm text-gray-300">{m.provider}/{m.modelId}</span>
                  <button onClick={() => removeModelById(m.id)} class="text-xs text-gray-600 hover:text-red-400 transition-colors">Remove</button>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Manual add */}
        <div class="px-5 py-4 border-t border-gray-800">
          <p class="text-xs text-gray-500 mb-2">Add a model manually <span class="text-gray-600">(not in catalog)</span></p>
          <div class="flex gap-2">
            <input
              class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500 placeholder-gray-600"
              placeholder="provider/model-id  e.g. anthropic/claude-opus-4"
              value={newModel()}
              onInput={(e) => setNewModel(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && addModelManual()}
              disabled={adding()}
            />
            <button
              onClick={addModelManual}
              disabled={adding() || !newModel().trim()}
              class="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded text-sm font-medium transition-colors whitespace-nowrap"
            >
              Add
            </button>
          </div>
        </div>
      </section>

      {/* ── Ollama (secondary, collapsible) ──────────────────────── */}
      <section class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

        <div
          class="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-800/40 transition-colors"
          onClick={() => setOllamaOpen((v) => !v)}
        >
          <div class="flex items-center gap-3">
            <span class="text-gray-500 text-xs">{ollamaOpen() ? "▾" : "▸"}</span>
            <div>
              <h2 class="font-semibold">Local Ollama</h2>
              <Show when={config()}>
                <p class="text-xs text-gray-500 font-mono mt-0.5">{config()!.ollama.baseUrl}</p>
              </Show>
            </div>
          </div>
          <Show when={config()}>
            <span class={`text-xs px-2 py-0.5 rounded-full ${ollamaEnabled() ? "bg-emerald-900/60 text-emerald-400" : "bg-gray-700 text-gray-500"}`}>
              {ollamaEnabled() ? "connected" : "disabled"}
            </span>
          </Show>
        </div>

        <Show when={ollamaOpen()}>
          <div class="border-t border-gray-800">

            {/* URL config */}
            <div class="px-5 py-4 border-b border-gray-800">
              <p class="text-xs text-gray-500 mb-2">Server URL</p>
              <Show
                when={!editingUrl()}
                fallback={
                  <div class="flex gap-2">
                    <input
                      class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500"
                      value={urlDraft()}
                      onInput={(e) => setUrlDraft(e.currentTarget.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveOllamaUrl()}
                      placeholder="http://localhost:11434"
                    />
                    <button onClick={saveOllamaUrl} class="px-3 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm transition-colors">Save</button>
                    <button onClick={() => setEditingUrl(false)} class="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">Cancel</button>
                  </div>
                }
              >
                <div class="flex items-center gap-3">
                  <span class="flex-1 font-mono text-sm text-gray-300">{config()?.ollama.baseUrl}</span>
                  <button
                    onClick={() => { setUrlDraft(config()?.ollama.baseUrl ?? ""); setEditingUrl(true); }}
                    class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                  >
                    Edit
                  </button>
                </div>
              </Show>
            </div>

            {/* Pull progress */}
            <Show when={pulling()}>
              <div class="px-5 py-3 bg-gray-800/60 border-b border-gray-800 text-sm">
                Pulling <span class="text-emerald-400 font-mono">{pulling()}</span>
                <span class="text-gray-400 ml-2">{pullLog()}</span>
              </div>
            </Show>

            {/* Installed models */}
            <div class="px-5 py-4">
              <div class="flex items-center justify-between mb-3">
                <p class="text-xs text-gray-500">Installed models</p>
                <button onClick={refetchOllama} class="text-xs text-gray-500 hover:text-gray-300 transition-colors">Refresh</button>
              </div>

              <Show
                when={!ollama.loading}
                fallback={<p class="text-gray-600 text-sm">Connecting…</p>}
              >
                <Show
                  when={(ollama() ?? []).length > 0}
                  fallback={<p class="text-gray-600 text-sm mb-4">No models installed.</p>}
                >
                  <div class="space-y-1 mb-5">
                    <For each={ollama()}>
                      {(m) => (
                        <div class="flex items-center gap-3 py-2 border-b border-gray-800/60 last:border-0">
                          <div class="flex-1 min-w-0">
                            <p class="font-mono text-sm truncate">{m.name}</p>
                            <p class="text-xs text-gray-600">
                              {(m.size / 1e9).toFixed(1)} GB
                              {m.details?.parameter_size     && ` · ${m.details.parameter_size}`}
                              {m.details?.quantization_level && ` · ${m.details.quantization_level}`}
                            </p>
                          </div>
                          <Show
                            when={!addedIds().has(`ollama/${m.name}`)}
                            fallback={<span class="text-xs text-emerald-500 px-2 py-1 bg-emerald-900/30 rounded">Added</span>}
                          >
                            <button
                              onClick={() => addFromOllama(m)}
                              class="text-xs px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded transition-colors"
                            >
                              + Add
                            </button>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>

              <PullForm onPull={pullModel} pulling={pulling()} />
            </div>
          </div>
        </Show>
      </section>
    </div>
  );
}

// ─── ProviderGroup ────────────────────────────────────────────────────

function ProviderGroup(props: {
  provider: string;
  models: OCModel[];
  addedIds: Set<string>;
  onAdd: (m: OCModel) => void;
  onRemove: (m: OCModel) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const addedCount = () => props.models.filter((m) => props.addedIds.has(m.id)).length;

  return (
    <div>
      <button
        class="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-800/40 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span class="text-gray-500 text-xs w-3">{open() ? "▾" : "▸"}</span>
        <span class="font-mono text-sm flex-1">{props.provider}</span>
        <span class="text-xs text-gray-600">{props.models.length} models</span>
        <Show when={addedCount() > 0}>
          <span class="text-xs text-emerald-500 bg-emerald-900/30 px-2 py-0.5 rounded">{addedCount()} active</span>
        </Show>
      </button>

      <Show when={open()}>
        <div class="bg-gray-800/20">
          <For each={props.models}>
            {(m) => {
              const added = () => props.addedIds.has(m.id);
              return (
                <div class="flex items-center gap-3 px-8 py-2 border-t border-gray-800/40 hover:bg-gray-800/30 transition-colors">
                  <span class="flex-1 font-mono text-sm text-gray-300">{m.modelId}</span>
                  <Show
                    when={!added()}
                    fallback={
                      <button
                        onClick={() => props.onRemove(m)}
                        class="text-xs text-emerald-500 hover:text-red-400 px-2 py-1 transition-colors"
                      >
                        ✓ Active
                      </button>
                    }
                  >
                    <button
                      onClick={() => props.onAdd(m)}
                      class="text-xs px-3 py-1 bg-gray-700 hover:bg-emerald-700 rounded transition-colors"
                    >
                      Add
                    </button>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

// ─── PullForm ─────────────────────────────────────────────────────────

function PullForm(props: { onPull: (name: string) => void; pulling: string | null }) {
  const [name, setName] = createSignal("");

  function submit() {
    const n = name().trim();
    if (n) { props.onPull(n); setName(""); }
  }

  return (
    <div>
      <p class="text-xs text-gray-500 mb-2">Pull a new model</p>
      <div class="flex gap-2">
        <input
          class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500 placeholder-gray-600"
          placeholder="qwen3:8b  ·  llama3.2  ·  deepseek-r1:7b"
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
          {props.pulling ? "Pulling…" : "Pull"}
        </button>
      </div>
    </div>
  );
}
