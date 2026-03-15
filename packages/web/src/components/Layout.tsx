import { createResource, createSignal, For, Show } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import type { JSX } from "solid-js";
import type { Project } from "@agentforge/shared";

async function fetchProjects(): Promise<Project[]> {
  const res = await fetch("/api/v1/projects");
  const json = await res.json() as { data: Project[] };
  return json.data;
}

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/agents", label: "Agents" },
  { href: "/skills", label: "Skills" },
  { href: "/playbooks", label: "Playbooks" },
  { href: "/mcps", label: "MCPs" },
  { href: "/ollama", label: "Ollama" },
  { href: "/runners", label: "Runners" },
];

export default function Layout(props: { children?: JSX.Element }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [projects, { refetch }] = createResource(fetchProjects);

  const [adding, setAdding] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [newPath, setNewPath] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  async function addProject() {
    const name = newName().trim();
    const sourcePath = newPath().trim();
    if (!name || !sourcePath) return;

    setSaving(true);
    const res = await fetch("/api/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, sourcePath, sourceType: "local" }),
    });
    const json = await res.json() as { data: Project };
    setNewName("");
    setNewPath("");
    setAdding(false);
    setSaving(false);
    await refetch();
    navigate(`/projects/${json.data.id}`);
  }

  async function removeProject(id: string) {
    await fetch(`/api/v1/projects/${id}`, { method: "DELETE" });
    if (location.pathname === `/projects/${id}`) navigate("/");
    refetch();
  }

  const isNavActive = (href: string) =>
    href === "/" ? location.pathname === "/" : location.pathname.startsWith(href);

  const isProjectActive = (id: string) =>
    location.pathname === `/projects/${id}`;

  return (
    <div class="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside class="w-52 flex-shrink-0 flex flex-col bg-gray-900 border-r border-gray-800">

        {/* Brand */}
        <div class="px-4 py-5 border-b border-gray-800">
          <a href="/" class="font-bold text-base tracking-tight hover:text-emerald-300 transition-colors">
            AgentForge
          </a>
        </div>

        {/* Navigation */}
        <nav class="px-2 py-3 space-y-0.5">
          <For each={NAV_LINKS}>
            {(link) => (
              <a
                href={link.href}
                class={`flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
                  isNavActive(link.href)
                    ? "bg-emerald-900/50 text-emerald-300"
                    : "text-gray-400 hover:text-gray-100 hover:bg-gray-800"
                }`}
              >
                {link.label}
              </a>
            )}
          </For>
        </nav>

        {/* Projects — scrollable, fills remaining space */}
        <div class="flex flex-col flex-1 min-h-0 border-t border-gray-800 mt-2">
          <p class="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Projects
          </p>

          <div class="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
            <Show
              when={!projects.loading}
              fallback={<p class="text-xs text-gray-600 px-3 py-2">Loading…</p>}
            >
              <Show
                when={(projects() ?? []).length > 0}
                fallback={<p class="text-xs text-gray-600 px-3 py-2">No projects yet</p>}
              >
                <For each={projects()}>
                  {(p) => (
                    <div
                      class={`group flex items-center gap-1 px-3 py-2 rounded text-sm cursor-pointer transition-colors ${
                        isProjectActive(p.id)
                          ? "bg-emerald-900/50 text-emerald-300"
                          : "text-gray-400 hover:text-gray-100 hover:bg-gray-800"
                      }`}
                      onClick={() => navigate(`/projects/${p.id}`)}
                    >
                      <span class="flex-1 truncate" title={p.name}>{p.name}</span>
                      <button
                        class="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all text-xs px-1"
                        onClick={(e) => { e.stopPropagation(); removeProject(p.id); }}
                        title="Remove project"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </div>

          {/* Add project */}
          <div class="px-2 pb-3 pt-1 border-t border-gray-800">
            <Show
              when={adding()}
              fallback={
                <button
                  onClick={() => setAdding(true)}
                  class="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                >
                  <span class="text-base leading-none">+</span>
                  <span>Add project</span>
                </button>
              }
            >
              <div class="space-y-2 pt-1">
                <input
                  class="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500 placeholder-gray-600"
                  placeholder="Project name"
                  value={newName()}
                  onInput={(e) => setNewName(e.currentTarget.value)}
                  autofocus
                />
                <input
                  class="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-emerald-500 placeholder-gray-600"
                  placeholder="/path/to/project"
                  value={newPath()}
                  onInput={(e) => setNewPath(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && addProject()}
                />
                <div class="flex gap-1.5">
                  <button
                    onClick={addProject}
                    disabled={saving() || !newName().trim() || !newPath().trim()}
                    class="flex-1 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded text-xs font-medium transition-colors"
                  >
                    {saving() ? "Saving…" : "Add"}
                  </button>
                  <button
                    onClick={() => { setAdding(false); setNewName(""); setNewPath(""); }}
                    class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <main class="flex-1 overflow-auto flex flex-col">
        {props.children}
      </main>
    </div>
  );
}
