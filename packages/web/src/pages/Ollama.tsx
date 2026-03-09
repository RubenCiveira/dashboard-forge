import { createResource, createSignal, For, Show } from "solid-js";
import type { InstanceConfig, OllamaModel, Model } from "@agentforge/shared";

async function fetchConfig(): Promise<InstanceConfig> {
  const res = await fetch("/api/v1/config");
  return (await res.json() as { data: InstanceConfig }).data;
}

async function fetchOllamaModels(): Promise<OllamaModel[]> {
  const res = await fetch("/api/v1/models/ollama");
  if (!res.ok) return [];
  return (await res.json() as { data: OllamaModel[] }).data;
}

async function fetchModels(): Promise<Model[]> {
  const res = await fetch("/api/v1/models");
  return (await res.json() as { data: Model[] }).data;
}

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

export default function Ollama() {
  const [config, { refetch: refetchConfig }] = createResource(fetchConfig);
  const [ollama, { refetch: refetchOllama }] = createResource(fetchOllamaModels);
  const [models, { refetch: refetchModels }] = createResource(fetchModels);

  const [editingUrl, setEditingUrl] = createSignal(false);
  const [urlDraft, setUrlDraft]     = createSignal("");
  const [pulling, setPulling]       = createSignal<string | null>(null);
  const [pullLog, setPullLog]       = createSignal("");
  const [numCtxDraft, setNumCtxDraft] = createSignal<number | null>(null);
  const [savingCtx, setSavingCtx]     = createSignal(false);
  const [applyingCtx, setApplyingCtx] = createSignal(false);
  const [applyResult, setApplyResult] = createSignal<{ applied: string[]; errors: { model: string; message: string }[] } | null>(null);

  const ollamaEnabled = () => config()?.ollama.enabled ?? false;
  const addedIds = () => new Set((models() ?? []).map((m) => `${m.provider}/${m.modelId}`));

  const NUM_CTX_PRESETS = [2048, 4096, 8192, 16384, 32768, 65536, 131072];

  const currentNumCtx = () => config()?.ollama.numCtx ?? 8192;

  async function saveNumCtx(val: number) {
    setSavingCtx(true);
    await fetch("/api/v1/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ollama: { numCtx: val } }),
    });
    setNumCtxDraft(null);
    setSavingCtx(false);
    setApplyResult(null);
    refetchConfig();
  }

  async function applyNumCtx() {
    setApplyingCtx(true);
    setApplyResult(null);
    const res = await fetch("/api/v1/config/ollama/apply-ctx", { method: "POST" });
    const json = await res.json() as { data: { applied: string[]; errors: { model: string; message: string }[] } };
    setApplyResult(json.data);
    setApplyingCtx(false);
    refetchOllama();
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

  async function addFromOllama(m: OllamaModel) {
    await fetch("/api/v1/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "ollama", modelId: m.name, displayName: `ollama/${m.name}`, enabled: true }),
    });
    refetchModels();
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

  return (
    <div class="p-8 max-w-3xl">

      {/* Header */}
      <div class="mb-6">
        <h1 class="text-2xl font-bold">Ollama</h1>
        <p class="text-gray-400 text-sm mt-1">Configure your local Ollama instance and manage installed models.</p>
      </div>

      <div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

        {/* Status bar */}
        <div class="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h2 class="font-semibold">Local Ollama</h2>
            <Show when={config()}>
              <p class="text-xs text-gray-500 font-mono mt-0.5">{config()!.ollama.baseUrl}</p>
            </Show>
          </div>
          <Show when={config()}>
            <span class={`text-xs px-2.5 py-1 rounded-full ${ollamaEnabled() ? "bg-emerald-900/60 text-emerald-400" : "bg-gray-700 text-gray-500"}`}>
              {ollamaEnabled() ? "connected" : "disabled"}
            </span>
          </Show>
        </div>

        {/* URL config */}
        <div class="px-5 py-4 border-b border-gray-800">
          <p class="text-xs text-gray-400 mb-2">Server URL</p>
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

        {/* Context window limit */}
        <div class="px-5 py-4 border-b border-gray-800 space-y-3">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1">
              <p class="text-xs text-gray-400 mb-0.5">Context window limit <span class="font-mono text-gray-600">(num_ctx)</span></p>
              <p class="text-xs text-gray-600">
                Maximum tokens in the model's context. Higher values allow longer conversations but require more VRAM.
              </p>
            </div>
            <Show when={config()}>
              <div class="flex items-center gap-2 shrink-0">
                <select
                  class="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-emerald-500"
                  value={numCtxDraft() ?? currentNumCtx()}
                  onChange={(e) => setNumCtxDraft(Number(e.currentTarget.value))}
                >
                  <For each={NUM_CTX_PRESETS}>
                    {(v) => (
                      <option value={v}>
                        {v >= 1024 ? `${v / 1024}k` : String(v)}
                        {v === 8192 ? " (default)" : ""}
                      </option>
                    )}
                  </For>
                </select>
                <Show when={numCtxDraft() !== null && numCtxDraft() !== currentNumCtx()}>
                  <button
                    onClick={() => saveNumCtx(numCtxDraft()!)}
                    disabled={savingCtx()}
                    class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded text-sm transition-colors"
                  >
                    {savingCtx() ? "Saving…" : "Save"}
                  </button>
                </Show>
              </div>
            </Show>
          </div>

          {/* Apply button */}
          <div class="flex items-center gap-3">
            <button
              onClick={applyNumCtx}
              disabled={applyingCtx()}
              class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-xs transition-colors"
            >
              {applyingCtx() ? "Applying…" : `Apply ${currentNumCtx() >= 1024 ? currentNumCtx() / 1024 + "k" : currentNumCtx()} to installed models`}
            </button>
            <p class="text-xs text-gray-600">
              Runs <span class="font-mono">ollama create</span> for each installed model to set num_ctx.
            </p>
          </div>

          {/* Apply result */}
          <Show when={applyResult()}>
            {(result) => (
              <div class="space-y-1">
                <Show when={result().applied.length > 0}>
                  <p class="text-xs text-emerald-400">
                    ✓ Updated: {result().applied.join(", ")}
                  </p>
                </Show>
                <Show when={result().errors.length > 0}>
                  <For each={result().errors}>
                    {(e) => (
                      <p class="text-xs text-red-400 font-mono">✗ {e.model}: {e.message}</p>
                    )}
                  </For>
                </Show>
              </div>
            )}
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
            <p class="text-xs text-gray-400">Installed models</p>
            <button onClick={refetchOllama} class="text-xs text-gray-500 hover:text-gray-300 transition-colors">Refresh</button>
          </div>

          <Show
            when={!ollama.loading}
            fallback={<p class="text-gray-600 text-sm mb-4">Connecting…</p>}
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
    </div>
  );
}
