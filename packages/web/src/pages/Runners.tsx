import { createResource, createSignal, For, Show, createEffect } from "solid-js";
import type { Model, InstanceConfig } from "@agentforge/shared";

// ─── Types ────────────────────────────────────────────────────────────

interface RunnerConfig {
  binaryPath?: string;
  defaultModel?: string;
  [key: string]: unknown;
}

interface Runner {
  id: string;
  type: string;
  name: string;
  config: string;
  enabled: boolean;
  status: "online" | "offline" | "unknown";
  createdAt: string;
  updatedAt: string;
}

interface OCModel { id: string; provider: string; modelId: string }

// ─── API helpers ──────────────────────────────────────────────────────

async function fetchRunners(): Promise<{ data: Runner[] }> {
  const res = await fetch("/api/v1/runners");
  return res.json();
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

async function fetchConfig(): Promise<InstanceConfig> {
  const res = await fetch("/api/v1/config");
  return (await res.json() as { data: InstanceConfig }).data;
}

// ─── Shared styles ────────────────────────────────────────────────────

const inp = "w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 placeholder-gray-600";

const statusDot: Record<string, string> = {
  online:  "bg-emerald-400",
  offline: "bg-red-500",
  unknown: "bg-gray-500",
};

const statusLabel: Record<string, string> = {
  online:  "Online",
  offline: "Offline",
  unknown: "Unknown",
};

// ─── AddModelDialog ───────────────────────────────────────────────────

function AddModelDialog(props: {
  initial: OCModel | null;       // pre-selected model (from row Add button)
  catalog: OCModel[];
  ollamaEnabled: boolean;
  onClose: () => void;
  onConfirm: (model: OCModel, pullToOllama: boolean) => Promise<void>;
}) {
  const [query, setQuery] = createSignal(props.initial?.id ?? "");
  const [selected, setSelected] = createSignal<OCModel | null>(props.initial);
  const [dropOpen, setDropOpen] = createSignal(!props.initial);
  const [confirming, setConfirming] = createSignal(false);
  const [pullLog, setPullLog] = createSignal("");

  const isOllama = () => selected()?.provider === "ollama";
  const willPull = () => isOllama() && props.ollamaEnabled;

  const filtered = () => {
    const q = query().toLowerCase();
    if (!q) return props.catalog.slice(0, 50);
    return props.catalog.filter((m) => m.id.toLowerCase().includes(q)).slice(0, 50);
  };

  function pick(m: OCModel) {
    setSelected(m);
    setQuery(m.id);
    setDropOpen(false);
  }

  async function confirm() {
    const m = selected();
    if (!m) return;
    setConfirming(true);
    setPullLog("");
    await props.onConfirm(m, willPull());
    setConfirming(false);
    props.onClose();
  }

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div class="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4">

        {/* Title */}
        <div class="px-5 py-4 border-b border-gray-800">
          <h2 class="font-semibold">Add model to AgentForge</h2>
          <p class="text-xs text-gray-500 mt-0.5">Search and select a model from the OpenCode catalog.</p>
        </div>

        <div class="px-5 py-4 space-y-4">

          {/* Autocomplete */}
          <div class="relative">
            <input
              class={inp}
              placeholder="Search model… e.g. claude, llama, qwen"
              value={query()}
              onInput={(e) => { setQuery(e.currentTarget.value); setDropOpen(true); setSelected(null); }}
              onFocus={() => setDropOpen(true)}
              autofocus
            />
            <Show when={dropOpen() && filtered().length > 0}>
              <div class="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl">
                <For each={filtered()}>
                  {(m) => (
                    <button
                      class="w-full text-left px-3 py-2 text-sm hover:bg-gray-700 transition-colors flex items-center gap-2"
                      onMouseDown={() => pick(m)}
                    >
                      <span class="text-xs text-gray-500 font-mono w-24 shrink-0 truncate">{m.provider}</span>
                      <span class="font-mono truncate">{m.modelId}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Selected model info */}
          <Show when={selected()}>
            {(m) => (
              <div class="rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 space-y-2">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono text-sm font-medium">{m().id}</span>
                  <span class="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">{m().provider}</span>
                </div>
                <Show when={willPull()}>
                  <div class="flex items-start gap-2 text-xs text-amber-300 bg-amber-900/20 border border-amber-900/40 rounded px-3 py-2">
                    <span class="mt-0.5 shrink-0">⬇</span>
                    <span>
                      Ollama is enabled locally. This model will be pulled to your Ollama instance
                      if it is not already installed.
                    </span>
                  </div>
                </Show>
                <Show when={isOllama() && !props.ollamaEnabled}>
                  <p class="text-xs text-gray-500">
                    Ollama is not enabled. Configure it in the <a href="/ollama" class="text-emerald-400 hover:underline">Ollama</a> section to auto-pull models.
                  </p>
                </Show>
                <Show when={pullLog()}>
                  <p class="text-xs font-mono text-gray-400">{pullLog()}</p>
                </Show>
              </div>
            )}
          </Show>
        </div>

        {/* Actions */}
        <div class="px-5 py-4 border-t border-gray-800 flex justify-end gap-2">
          <button
            onClick={props.onClose}
            disabled={confirming()}
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!selected() || confirming()}
            class="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded text-sm font-medium transition-colors"
          >
            {confirming() ? (willPull() ? "Pulling…" : "Adding…") : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ProviderGroup ────────────────────────────────────────────────────

function ProviderGroup(props: {
  provider: string;
  models: OCModel[];
  addedIds: Set<string>;
  onAddClick: (m: OCModel) => void;
  onRemove: (m: OCModel) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const addedCount = () => props.models.filter((m) => props.addedIds.has(m.id)).length;

  return (
    <div>
      <button
        class="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-gray-800/40 transition-colors text-left"
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
                <div class="flex items-center gap-3 px-10 py-2 border-t border-gray-800/40 hover:bg-gray-800/30 transition-colors">
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
                      onClick={() => props.onAddClick(m)}
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

// ─── OpenCodeRunnerCard ────────────────────────────────────────────────

function OpenCodeRunnerCard(props: {
  runner: Runner;
  models: Model[];
  ocModels: OCModel[];
  config: InstanceConfig | undefined;
  onSaved: () => void;
  onModelsChanged: () => void;
}) {
  const cfg = (): RunnerConfig => {
    try { return JSON.parse(props.runner.config) as RunnerConfig; } catch { return {}; }
  };

  const [binaryPath, setBinaryPath] = createSignal(cfg().binaryPath ?? "opencode");
  const [defaultModel, setDefaultModel] = createSignal(cfg().defaultModel ?? "");
  const [enabled, setEnabled] = createSignal(props.runner.enabled);
  const [saving, setSaving] = createSignal(false);
  const [checking, setChecking] = createSignal(false);
  const [checkResult, setCheckResult] = createSignal<{ status: string; version?: string | null } | null>(null);
  const [status, setStatus] = createSignal(props.runner.status);

  // Catalog state
  const [search, setSearch] = createSignal("");
  const [dialogModel, setDialogModel] = createSignal<OCModel | null | "new">(null); // null = closed, "new" = blank dialog, OCModel = pre-filled

  const addedIds = () => new Set(props.models.map((m) => `${m.provider}/${m.modelId}`));

  const groupedOCModels = () => {
    const q = search().toLowerCase();
    const all = props.ocModels.filter((m) => !q || m.id.toLowerCase().includes(q));
    const map = new Map<string, OCModel[]>();
    for (const m of all) {
      if (!map.has(m.provider)) map.set(m.provider, []);
      map.get(m.provider)!.push(m);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  };

  const extraModels = () => {
    const ocIds = new Set(props.ocModels.map((m) => m.id));
    return props.models.filter((m) => !ocIds.has(`${m.provider}/${m.modelId}`));
  };

  async function save() {
    setSaving(true);
    await fetch(`/api/v1/runners/${props.runner.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: enabled(),
        config: { binaryPath: binaryPath().trim() || "opencode", defaultModel: defaultModel().trim() },
      }),
    });
    setSaving(false);
    props.onSaved();
  }

  async function check() {
    setChecking(true);
    setCheckResult(null);
    await fetch(`/api/v1/runners/${props.runner.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { binaryPath: binaryPath().trim() || "opencode", defaultModel: defaultModel().trim() } }),
    });
    const res = await fetch(`/api/v1/runners/${props.runner.id}/check`, { method: "POST" });
    const json = await res.json() as { data: { status: string; version: string | null } };
    setCheckResult(json.data);
    setStatus(json.data.status as "online" | "offline" | "unknown");
    setChecking(false);
    props.onSaved();
  }

  async function addModel(provider: string, modelId: string) {
    await fetch("/api/v1/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, modelId, displayName: `${provider}/${modelId}`, enabled: true }),
    });
    props.onModelsChanged();
  }

  async function removeModelByKey(key: string) {
    const m = props.models.find((m) => `${m.provider}/${m.modelId}` === key);
    if (!m) return;
    await fetch(`/api/v1/models/${m.id}`, { method: "DELETE" });
    props.onModelsChanged();
  }

  async function removeModelById(id: string) {
    await fetch(`/api/v1/models/${id}`, { method: "DELETE" });
    props.onModelsChanged();
  }

  async function handleDialogConfirm(model: OCModel, pullToOllama: boolean) {
    // Add to models DB
    await addModel(model.provider, model.modelId);

    // Pull to Ollama if applicable
    if (pullToOllama) {
      const ollamaBaseUrl = props.config?.ollama.baseUrl ?? "http://localhost:11434";
      // Use the existing SSE pull endpoint
      await fetch("/api/v1/models/ollama/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model.modelId }),
      });
      // We don't stream here — user can see progress in Ollama page
    }
  }

  const dialogInitial = () => {
    const d = dialogModel();
    if (!d || d === "new") return null;
    return d;
  };

  return (
    <>
      {/* Add Model dialog */}
      <Show when={dialogModel() !== null}>
        <AddModelDialog
          initial={dialogInitial()}
          catalog={props.ocModels}
          ollamaEnabled={props.config?.ollama.enabled ?? false}
          onClose={() => setDialogModel(null)}
          onConfirm={handleDialogConfirm}
        />
      </Show>

      <div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

        {/* ── Runner config ─────────────────────────────────────── */}
        <div class="p-6 space-y-5">

          {/* Header */}
          <div class="flex items-center gap-3">
            <div class="flex-1 flex items-center gap-3">
              <h2 class="text-lg font-semibold">{props.runner.name}</h2>
              <span class="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded font-mono">{props.runner.type}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class={`w-2 h-2 rounded-full ${statusDot[status()]}`} />
              <span class="text-sm text-gray-400">{statusLabel[status()]}</span>
            </div>
            <button
              onClick={() => setEnabled(!enabled())}
              class={`relative w-10 h-5 rounded-full transition-colors ${enabled() ? "bg-emerald-600" : "bg-gray-700"}`}
            >
              <span class={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled() ? "translate-x-5" : ""}`} />
            </button>
          </div>

          <p class="text-xs text-gray-500">
            OpenCode is the primary runner for launching AI agent sessions via <span class="font-mono">opencode run</span>.
          </p>

          {/* Binary path */}
          <div>
            <label class="block text-xs text-gray-400 mb-1.5">Binary path</label>
            <input
              class={inp}
              placeholder="opencode"
              value={binaryPath()}
              onInput={(e) => setBinaryPath(e.currentTarget.value)}
            />
            <p class="text-xs text-gray-600 mt-1">
              Path to the <span class="font-mono">opencode</span> executable, or just <span class="font-mono">opencode</span> if it is in your PATH.
            </p>
          </div>

          {/* Default model */}
          <div>
            <label class="block text-xs text-gray-400 mb-1.5">Default model <span class="text-gray-600">(optional)</span></label>
            <input
              class={inp}
              placeholder="anthropic/claude-sonnet-4-5"
              value={defaultModel()}
              onInput={(e) => setDefaultModel(e.currentTarget.value)}
            />
            <p class="text-xs text-gray-600 mt-1">
              Override the model for all sessions launched through this runner. Leave empty to use each agent's own model.
            </p>
          </div>

          {/* Check result */}
          <Show when={checkResult()}>
            <div class={`text-sm px-3 py-2 rounded ${checkResult()!.status === "online" ? "bg-emerald-900/30 text-emerald-300" : "bg-red-900/30 text-red-400"}`}>
              {checkResult()!.status === "online"
                ? `Connected${checkResult()!.version ? ` — version ${checkResult()!.version}` : ""}`
                : "Could not connect. Check the binary path."}
            </div>
          </Show>

          {/* Actions */}
          <div class="flex gap-2">
            <button
              onClick={check}
              disabled={checking()}
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-sm transition-colors"
            >
              {checking() ? "Checking…" : "Check connection"}
            </button>
            <button
              onClick={save}
              disabled={saving()}
              class="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded text-sm font-medium transition-colors"
            >
              {saving() ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {/* ── Model catalog ─────────────────────────────────────── */}
        <div class="border-t border-gray-800">
          <div class="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <div>
              <h3 class="font-semibold text-sm mb-0.5">Model Catalog</h3>
              <p class="text-xs text-gray-500">
                Models available through your OpenCode installation.
                {props.models.length > 0 && <span class="text-gray-600"> · {props.models.length} active</span>}
              </p>
            </div>
            <button
              onClick={() => setDialogModel("new")}
              class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-xs font-medium transition-colors"
            >
              + Add model
            </button>
          </div>

          <Show
            when={props.ocModels.length > 0}
            fallback={
              <p class="px-5 py-4 text-sm text-gray-600">
                OpenCode CLI not found or returned no models. Check the binary path above and run "Check connection".
              </p>
            }
          >
            {/* Search */}
            <div class="px-5 py-3 border-b border-gray-800">
              <input
                class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500 placeholder-gray-600"
                placeholder="Filter providers and models…"
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
                    onAddClick={(m) => setDialogModel(m)}
                    onRemove={(m) => removeModelByKey(m.id)}
                  />
                )}
              </For>
            </div>
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
        </div>
      </div>
    </>
  );
}

// ─── Runners page ─────────────────────────────────────────────────────

export default function Runners() {
  const [runners, { refetch: refetchRunners }] = createResource(fetchRunners);
  const [models,  { refetch: refetchModels }]  = createResource(fetchModels);
  const [ocModels]                             = createResource(fetchOCModels);
  const [config]                               = createResource(fetchConfig);

  const openCodeRunner = () => runners()?.data.find((r) => r.type === "opencode") ?? null;

  return (
    <div class="p-8 max-w-4xl">

      {/* Header */}
      <div class="mb-8">
        <h1 class="text-2xl font-bold">Runners</h1>
        <p class="text-gray-400 text-sm mt-1">
          Runners are the execution engines that launch agent sessions.
          Each implementation connects AgentForge to a different AI toolchain.
        </p>
      </div>

      <Show when={!runners.loading && !models.loading} fallback={<p class="text-gray-500">Loading…</p>}>

        {/* OpenCode runner */}
        <Show when={openCodeRunner()}>
          {(runner) => (
            <OpenCodeRunnerCard
              runner={runner()}
              models={models() ?? []}
              ocModels={ocModels() ?? []}
              config={config()}
              onSaved={refetchRunners}
              onModelsChanged={refetchModels}
            />
          )}
        </Show>

        {/* Future runners placeholder */}
        <div class="mt-6 p-5 border border-dashed border-gray-800 rounded-xl text-center">
          <p class="text-gray-600 text-sm">More runner implementations coming soon (Claude Code, custom CLI, …)</p>
        </div>
      </Show>
    </div>
  );
}
