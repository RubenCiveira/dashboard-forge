import { createResource, createSignal, For, Show } from "solid-js";

interface SkillRow {
  id: string;
  name: string;
  description: string;
  tags: string[];
  source: string;
  version: string;
}

async function fetchSkills(): Promise<{ data: SkillRow[]; total: number }> {
  const res = await fetch("/api/v1/skills?pageSize=100");
  return res.json();
}

const input = "w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 placeholder-gray-600";

export default function Skills() {
  const [skills, { refetch }] = createResource(fetchSkills);
  const [importing, setImporting] = createSignal(false);
  const [status, setStatus] = createSignal<{ ok: boolean; msg: string } | null>(null);
  const [githubUrl, setGithubUrl] = createSignal("");

  async function handleResult(res: Response) {
    const json = await res.json() as { data?: { imported: number }; error?: { message: string } };
    if (json.data !== undefined) {
      setStatus({ ok: true, msg: `${json.data.imported} skill(s) imported` });
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
    const res = await fetch("/api/v1/skills/import", { method: "POST", body: form });
    await handleResult(res);
    setImporting(false);
  }

  async function importUrl() {
    const url = githubUrl().trim();
    if (!url) return;
    setImporting(true);
    setStatus(null);
    const res = await fetch("/api/v1/skills/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    await handleResult(res);
    setImporting(false);
  }

  async function deleteSkill(id: string) {
    await fetch(`/api/v1/skills/${id}`, { method: "DELETE" });
    refetch();
  }

  return (
    <div class="p-8 max-w-4xl">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div class="mb-6">
        <h1 class="text-2xl font-bold">Skills</h1>
        <p class="text-gray-400 text-sm">{skills()?.total ?? 0} registered</p>
      </div>

      {/* ── Import panel ───────────────────────────────────────── */}
      <div class="mb-8 p-5 bg-gray-900 border border-gray-700 rounded-xl space-y-5">
        <h2 class="font-semibold text-base">Import Skills</h2>
        <p class="text-xs text-gray-500 -mt-3">
          Each skill lives in its own subdirectory with a <span class="font-mono">SKILL.md</span> file:
          YAML frontmatter (<span class="font-mono">name</span>, <span class="font-mono">description</span>)
          followed by the skill's Markdown instructions.
        </p>

        {/* ZIP upload */}
        <div>
          <p class="text-xs text-gray-400 mb-2">From ZIP file <span class="text-gray-600">(skill subdirectories each containing SKILL.md)</span></p>
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
              placeholder="https://github.com/user/repo/tree/main/skills/"
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
            Blob URL (single SKILL.md) or tree URL (directory of skill subdirectories)
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

      {/* ── Skill list ─────────────────────────────────────────── */}
      <Show when={!skills.loading} fallback={<p class="text-gray-500">Loading…</p>}>
        <Show
          when={(skills()?.data ?? []).length > 0}
          fallback={<p class="text-gray-600 text-sm">No skills yet. Import some above.</p>}
        >
          <div class="space-y-3">
            <For each={skills()?.data ?? []}>
              {(skill) => (
                <div class="group p-4 bg-gray-900 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <h3 class="font-semibold">{skill.name}</h3>
                        <span class="text-xs text-gray-600">v{skill.version}</span>
                        <Show when={skill.source !== "local"}>
                          <span class="text-xs bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded">{skill.source}</span>
                        </Show>
                      </div>
                      <p class="text-gray-400 text-sm mt-1">{skill.description}</p>
                    </div>
                    <button
                      onClick={() => deleteSkill(skill.id)}
                      class="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 text-xs transition-all flex-shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                  <Show when={skill.tags.length > 0}>
                    <div class="flex flex-wrap gap-1.5 mt-3">
                      <For each={skill.tags}>
                        {(tag) => <span class="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded">{tag}</span>}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
