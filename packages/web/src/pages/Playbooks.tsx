import { createResource, createSignal, For, Show } from "solid-js";

interface Playbook {
  id: string;
  name: string;
  description: string;
  permissionProfile: string;
  agentIds: string[];
  skillIds: string[];
  agentsRules: string;
  createdAt: string;
}

interface AgentRow { id: string; name: string }
interface SkillRow { id: string; name: string }

async function fetchPlaybooks(): Promise<{ data: Playbook[] }> {
  const res = await fetch("/api/v1/playbooks");
  return res.json();
}
async function fetchAgents(): Promise<{ data: AgentRow[] }> {
  const res = await fetch("/api/v1/agents?pageSize=100");
  return res.json();
}
async function fetchSkills(): Promise<{ data: SkillRow[] }> {
  const res = await fetch("/api/v1/skills?pageSize=100");
  return res.json();
}

const input = "w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 placeholder-gray-600";

const profileColor: Record<string, string> = {
  autonomous:  "bg-emerald-900/40 text-emerald-300",
  assisted:    "bg-amber-900/40 text-amber-300",
  restrictive: "bg-red-900/40 text-red-300",
};

export default function Playbooks() {
  const [playbooks, { refetch }] = createResource(fetchPlaybooks);
  const [agents]  = createResource(fetchAgents);
  const [skills]  = createResource(fetchSkills);

  const [importing, setImporting] = createSignal(false);
  const [status, setStatus]       = createSignal<{ ok: boolean; msg: string } | null>(null);
  const [githubUrl, setGithubUrl] = createSignal("");
  const [expandedId, setExpandedId] = createSignal<string | null>(null);

  const agentMap  = () => Object.fromEntries((agents()?.data  ?? []).map((a) => [a.id, a.name]));
  const skillMap  = () => Object.fromEntries((skills()?.data  ?? []).map((s) => [s.id, s.name]));

  async function handleResult(res: Response) {
    const json = await res.json() as { data?: { imported: number }; error?: { message: string } };
    if (json.data !== undefined) {
      setStatus({ ok: true, msg: `${json.data.imported} playbook(s) imported` });
      refetch();
    } else {
      setStatus({ ok: false, msg: json.error?.message ?? "Unknown error" });
    }
  }

  async function importZip(file: File) {
    setImporting(true);
    setStatus(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/v1/playbooks/import", { method: "POST", body: form });
    await handleResult(res);
    setImporting(false);
  }

  async function importUrl() {
    const url = githubUrl().trim();
    if (!url) return;
    setImporting(true);
    setStatus(null);
    const res = await fetch("/api/v1/playbooks/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    await handleResult(res);
    setImporting(false);
  }

  async function deletePlaybook(id: string) {
    await fetch(`/api/v1/playbooks/${id}`, { method: "DELETE" });
    refetch();
  }

  return (
    <div class="p-8 max-w-5xl">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div class="mb-6">
        <h1 class="text-2xl font-bold">Playbooks</h1>
        <p class="text-gray-400 text-sm">{(playbooks()?.data ?? []).length} configured</p>
      </div>

      {/* ── Import panel ───────────────────────────────────────── */}
      <div class="mb-8 p-5 bg-gray-900 border border-gray-700 rounded-xl space-y-5">
        <h2 class="font-semibold text-base">Import Playbooks</h2>
        <p class="text-xs text-gray-500 -mt-3">
          Playbook files are Markdown with YAML frontmatter:
          <span class="font-mono"> name</span>,
          <span class="font-mono"> description</span>,
          <span class="font-mono"> permission_profile</span> (autonomous | assisted | restrictive),
          <span class="font-mono"> agents</span> and
          <span class="font-mono"> skills</span> (comma-separated names).
          The Markdown body defines the work sequence.
        </p>

        {/* ZIP upload */}
        <div>
          <p class="text-xs text-gray-400 mb-2">From ZIP file <span class="text-gray-600">(containing .md playbook files)</span></p>
          <label
            class={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-lg cursor-pointer transition-colors bg-gray-800/50 ${
              importing() ? "border-gray-700 opacity-50 pointer-events-none" : "border-gray-700 hover:border-emerald-600"
            }`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer?.files[0];
              if (file) importZip(file);
            }}
          >
            <input
              type="file"
              accept=".zip"
              class="hidden"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) importZip(file);
                e.currentTarget.value = "";
              }}
            />
            <span class="text-3xl mb-1">📦</span>
            <span class="text-sm text-gray-400">Drop .zip or click to browse</span>
          </label>
        </div>

        {/* GitHub URL */}
        <div>
          <p class="text-xs text-gray-400 mb-2">From GitHub</p>
          <div class="flex gap-2">
            <input
              class={input}
              placeholder="https://github.com/user/repo/blob/main/playbooks/qa-pipeline.md"
              value={githubUrl()}
              onInput={(e) => setGithubUrl(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && importUrl()}
              disabled={importing()}
            />
            <button
              onClick={importUrl}
              disabled={importing() || !githubUrl().trim()}
              class="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded text-sm font-medium transition-colors whitespace-nowrap"
            >
              Import
            </button>
          </div>
          <p class="text-xs text-gray-600 mt-1">
            Blob URL (single .md) or tree URL (directory of .md playbooks)
          </p>
        </div>

        {/* Status */}
        <Show when={importing()}>
          <p class="text-sm text-gray-400 animate-pulse">Importing…</p>
        </Show>
        <Show when={status()}>
          <p class={`text-sm ${status()!.ok ? "text-emerald-400" : "text-red-400"}`}>
            {status()!.ok ? "✓" : "✗"} {status()!.msg}
          </p>
        </Show>
      </div>

      {/* ── Playbook list ──────────────────────────────────────── */}
      <Show when={!playbooks.loading} fallback={<p class="text-gray-500">Loading…</p>}>
        <Show
          when={(playbooks()?.data ?? []).length > 0}
          fallback={<p class="text-gray-600 text-sm">No playbooks yet. Import one above.</p>}
        >
          <div class="space-y-3">
            <For each={playbooks()?.data ?? []}>
              {(pb) => {
                const expanded = () => expandedId() === pb.id;
                return (
                  <div class="bg-gray-900 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors overflow-hidden">
                    <div
                      class="flex items-center gap-3 p-4 cursor-pointer"
                      onClick={() => setExpandedId(expanded() ? null : pb.id)}
                    >
                      <span class="text-gray-500 text-xs w-3">{expanded() ? "▾" : "▸"}</span>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <h3 class="font-semibold">{pb.name}</h3>
                          <span class={`text-xs px-2 py-0.5 rounded ${profileColor[pb.permissionProfile] ?? "bg-gray-700 text-gray-400"}`}>
                            {pb.permissionProfile}
                          </span>
                          <Show when={pb.agentIds.length > 0}>
                            <span class="text-xs text-gray-500">{pb.agentIds.length} agent{pb.agentIds.length !== 1 ? "s" : ""}</span>
                          </Show>
                        </div>
                        <Show when={pb.description}>
                          <p class="text-gray-400 text-sm mt-0.5">{pb.description}</p>
                        </Show>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deletePlaybook(pb.id); }}
                        class="text-gray-600 hover:text-red-400 text-xs transition-colors flex-shrink-0"
                      >
                        Remove
                      </button>
                    </div>

                    <Show when={expanded()}>
                      <div class="px-4 pb-4 pt-0 space-y-3 border-t border-gray-800">
                        <Show when={pb.agentIds.length > 0}>
                          <div>
                            <p class="text-xs text-gray-500 mb-2 mt-3">Agents</p>
                            <div class="flex flex-wrap gap-2">
                              <For each={pb.agentIds}>
                                {(id) => (
                                  <span class="text-xs bg-emerald-900/30 text-emerald-300 border border-emerald-900/50 px-2.5 py-1 rounded">
                                    {agentMap()[id] ?? id}
                                  </span>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>
                        <Show when={pb.skillIds.length > 0}>
                          <div>
                            <p class="text-xs text-gray-500 mb-2 mt-3">Skills</p>
                            <div class="flex flex-wrap gap-2">
                              <For each={pb.skillIds}>
                                {(id) => (
                                  <span class="text-xs bg-blue-900/30 text-blue-300 border border-blue-900/50 px-2.5 py-1 rounded">
                                    {skillMap()[id] ?? id}
                                  </span>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>
                        <Show when={pb.agentsRules}>
                          <div>
                            <p class="text-xs text-gray-500 mb-1 mt-3">Work sequence</p>
                            <pre class="text-xs text-gray-400 font-mono bg-gray-800 rounded p-3 whitespace-pre-wrap">{pb.agentsRules}</pre>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
