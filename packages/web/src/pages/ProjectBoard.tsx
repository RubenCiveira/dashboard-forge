import { createResource, createSignal, For, Show, onCleanup } from "solid-js";
import { useParams } from "@solidjs/router";
import type { Agent, Model } from "@agentforge/shared";

// ─── Types ───────────────────────────────────────────────────────────

interface Job {
  id: string;
  prompt: string;
  agentId: string | null;
  status: string;
  summary: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface Project {
  id: string;
  name: string;
  sourcePath: string;
}

// ─── Kanban config ───────────────────────────────────────────────────

const COLUMNS = [
  { key: "pending",       label: "Pending",  color: "text-gray-400",    border: "border-gray-700" },
  { key: "running",       label: "Active",   color: "text-blue-400",    border: "border-blue-800" },
  { key: "waiting_input", label: "Blocked",  color: "text-amber-400",   border: "border-amber-800" },
  { key: "done",          label: "Done",     color: "text-emerald-400", border: "border-emerald-900" },
] as const;

const DONE_STATUSES = new Set(["completed", "failed", "cancelled"]);

function columnForJob(status: string): string {
  if (DONE_STATUSES.has(status)) return "done";
  return status;
}

// ─── API helpers ─────────────────────────────────────────────────────

async function fetchProject(id: string): Promise<Project> {
  const res = await fetch(`/api/v1/projects/${id}`);
  const json = await res.json() as { data: Project };
  return json.data;
}

async function fetchJobs(projectId: string): Promise<Job[]> {
  const res = await fetch(`/api/v1/jobs?project_id=${projectId}`);
  const json = await res.json() as { data: Job[] };
  return json.data;
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch("/api/v1/agents");
  const json = await res.json() as { data: Agent[] };
  return json.data;
}

async function fetchModels(): Promise<Model[]> {
  const res = await fetch("/api/v1/models");
  const json = await res.json() as { data: Model[] };
  return json.data.filter((m) => m.enabled);
}

// ─── Component ───────────────────────────────────────────────────────

export default function ProjectBoard() {
  const params = useParams<{ id: string }>();

  const [project] = createResource(() => params.id, fetchProject);
  const [agents] = createResource(fetchAgents);
  const [enabledModels] = createResource(fetchModels);

  // Jobs with polling every 5 s
  const [jobs, { refetch: refetchJobs }] = createResource(
    () => params.id,
    fetchJobs,
  );
  const interval = setInterval(refetchJobs, 5000);
  onCleanup(() => clearInterval(interval));

  // New task modal
  const [showModal, setShowModal] = createSignal(false);
  const [selectedAgent, setSelectedAgent] = createSignal("");
  const [selectedModel, setSelectedModel] = createSignal("");
  const [prompt, setPrompt] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  async function submitTask() {
    if (!selectedAgent() || !prompt().trim()) return;
    setSubmitting(true);
    await fetch("/api/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt().trim(),
        projectId: params.id,
        agentId: selectedAgent(),
        modelOverride: selectedModel() || undefined,
      }),
    });
    setPrompt("");
    setSelectedAgent("");
    setSelectedModel("");
    setShowModal(false);
    setSubmitting(false);
    refetchJobs();
  }

  async function cancelJob(id: string) {
    await fetch(`/api/v1/jobs/${id}/cancel`, { method: "POST" });
    refetchJobs();
  }

  const agentMap = () => {
    const map: Record<string, Agent> = {};
    for (const a of agents() ?? []) map[a.id] = a;
    return map;
  };

  const jobsByColumn = () => {
    const cols: Record<string, Job[]> = { pending: [], running: [], waiting_input: [], done: [] };
    for (const job of jobs() ?? []) {
      const col = columnForJob(job.status);
      cols[col]?.push(job);
    }
    return cols;
  };

  return (
    <div class="flex flex-col h-full">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div class="flex items-center justify-between px-8 py-5 border-b border-gray-800 flex-shrink-0">
        <div>
          <Show when={project()} fallback={<div class="h-6 w-40 bg-gray-800 rounded animate-pulse" />}>
            <h1 class="text-xl font-bold">{project()!.name}</h1>
            <p class="text-xs text-gray-500 font-mono mt-0.5">{project()!.sourcePath}</p>
          </Show>
        </div>
        <button
          onClick={() => setShowModal(true)}
          class="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm font-medium transition-colors"
        >
          <span class="text-lg leading-none">+</span>
          New Task
        </button>
      </div>

      {/* ── Kanban board ─────────────────────────────────────────── */}
      <div class="flex-1 overflow-x-auto overflow-y-hidden">
        <div class="flex gap-4 h-full px-6 py-6 min-w-max">
          <For each={COLUMNS}>
            {(col) => {
              const colJobs = () => jobsByColumn()[col.key] ?? [];
              return (
                <div class={`flex flex-col w-72 flex-shrink-0 rounded-lg border ${col.border} bg-gray-900/60`}>
                  {/* Column header */}
                  <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                    <span class={`text-sm font-semibold ${col.color}`}>{col.label}</span>
                    <span class="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full">
                      {colJobs().length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div class="flex-1 overflow-y-auto p-3 space-y-2">
                    <Show
                      when={!jobs.loading}
                      fallback={
                        <div class="space-y-2">
                          <div class="h-16 bg-gray-800 rounded animate-pulse" />
                          <div class="h-16 bg-gray-800 rounded animate-pulse" />
                        </div>
                      }
                    >
                      <For each={colJobs()} fallback={
                        <p class="text-xs text-gray-700 text-center py-4">Empty</p>
                      }>
                        {(job) => (
                          <JobCard
                            job={job}
                            agentName={agentMap()[job.agentId ?? ""]?.name}
                            onCancel={() => cancelJob(job.id)}
                          />
                        )}
                      </For>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      {/* ── New Task Modal ────────────────────────────────────────── */}
      <Show when={showModal()}>
        <div
          class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={(e) => e.target === e.currentTarget && setShowModal(false)}
        >
          <div class="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg mx-4 p-6 space-y-4">
            <h2 class="text-lg font-semibold">New Task</h2>

            {/* Agent selector */}
            <div>
              <label class="text-xs text-gray-400 block mb-1.5">Agent *</label>
              <Show
                when={(agents() ?? []).length > 0}
                fallback={
                  <p class="text-xs text-gray-500 bg-gray-800 rounded px-3 py-2">
                    No agents registered yet. <a href="/agents" class="text-emerald-400 hover:underline">Add one first.</a>
                  </p>
                }
              >
                <select
                  class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  value={selectedAgent()}
                  onChange={(e) => setSelectedAgent(e.currentTarget.value)}
                >
                  <option value="">Select an agent…</option>
                  <For each={agents()}>
                    {(a) => <option value={a.id}>{a.name}</option>}
                  </For>
                </select>
              </Show>
            </div>

            {/* Model selector */}
            <div>
              <label class="text-xs text-gray-400 block mb-1.5">Model <span class="text-gray-600">(optional — uses project default)</span></label>
              <select
                class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                value={selectedModel()}
                onChange={(e) => setSelectedModel(e.currentTarget.value)}
              >
                <option value="">Project default</option>
                <For each={enabledModels()}>
                  {(m) => <option value={`${m.provider}/${m.modelId}`}>{m.displayName}</option>}
                </For>
              </select>
            </div>

            {/* Prompt */}
            <div>
              <label class="text-xs text-gray-400 block mb-1.5">Task prompt *</label>
              <textarea
                class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none placeholder-gray-600"
                rows={5}
                placeholder="Describe the task in detail…"
                value={prompt()}
                onInput={(e) => setPrompt(e.currentTarget.value)}
              />
            </div>

            {/* Actions */}
            <div class="flex gap-3 pt-1">
              <button
                onClick={submitTask}
                disabled={submitting() || !selectedAgent() || !prompt().trim()}
                class="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded text-sm font-medium transition-colors"
              >
                {submitting() ? "Creating…" : "Create Task"}
              </button>
              <button
                onClick={() => setShowModal(false)}
                class="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

// ─── JobCard ─────────────────────────────────────────────────────────

function JobCard(props: { job: Job; agentName?: string; onCancel: () => void }) {
  const canCancel = () => props.job.status === "pending" || props.job.status === "running";

  const statusColor: Record<string, string> = {
    pending:       "bg-gray-700 text-gray-300",
    running:       "bg-blue-900/60 text-blue-300",
    waiting_input: "bg-amber-900/60 text-amber-300",
    completed:     "bg-emerald-900/60 text-emerald-300",
    failed:        "bg-red-900/60 text-red-300",
    cancelled:     "bg-gray-800 text-gray-500",
  };

  return (
    <div class="bg-gray-800/80 border border-gray-700/60 rounded-lg p-3 space-y-2 group">
      <p class="text-sm leading-snug line-clamp-3 text-gray-200">{props.job.prompt}</p>

      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0">
          <Show when={props.agentName}>
            <span class="text-xs text-gray-500 truncate">{props.agentName}</span>
          </Show>
        </div>
        <span class={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${statusColor[props.job.status] ?? "bg-gray-700 text-gray-400"}`}>
          {props.job.status}
        </span>
      </div>

      <Show when={props.job.summary}>
        <p class="text-xs text-gray-500 border-t border-gray-700 pt-2 line-clamp-2">{props.job.summary}</p>
      </Show>

      <Show when={canCancel()}>
        <button
          onClick={props.onCancel}
          class="w-full text-xs text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 pt-1"
        >
          Cancel task
        </button>
      </Show>
    </div>
  );
}
