import { createResource, createSignal, For, Show, onCleanup } from "solid-js";
import { useParams } from "@solidjs/router";

// ─── Types ───────────────────────────────────────────────────────────

interface Job {
  id: string;
  prompt: string;
  playbookId: string | null;
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

interface Playbook {
  id: string;
  name: string;
  description: string;
  permissionProfile: string;
  agentIds: string[];
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
  return DONE_STATUSES.has(status) ? "done" : status;
}

// ─── API helpers ─────────────────────────────────────────────────────

async function fetchProject(id: string): Promise<Project> {
  const res = await fetch(`/api/v1/projects/${id}`);
  return (await res.json() as { data: Project }).data;
}

async function fetchJobs(projectId: string): Promise<Job[]> {
  const res = await fetch(`/api/v1/jobs?project_id=${projectId}`);
  return (await res.json() as { data: Job[] }).data;
}

async function fetchPlaybooks(): Promise<Playbook[]> {
  const res = await fetch("/api/v1/playbooks");
  return (await res.json() as { data: Playbook[] }).data;
}

// ─── Component ───────────────────────────────────────────────────────

export default function ProjectBoard() {
  const params = useParams<{ id: string }>();

  const [project] = createResource(() => params.id, fetchProject);
  const [playbooks] = createResource(fetchPlaybooks);

  const [jobs, { refetch: refetchJobs }] = createResource(() => params.id, fetchJobs);
  const interval = setInterval(refetchJobs, 5000);
  onCleanup(() => clearInterval(interval));

  // Modal state
  const [showModal, setShowModal] = createSignal(false);
  const [selectedPlaybook, setSelectedPlaybook] = createSignal("");
  const [prompt, setPrompt] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  async function submitTask() {
    if (!selectedPlaybook() || !prompt().trim()) return;
    setSubmitting(true);
    await fetch("/api/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt().trim(),
        projectId: params.id,
        playbookId: selectedPlaybook(),
      }),
    });
    setPrompt("");
    setSelectedPlaybook("");
    setShowModal(false);
    setSubmitting(false);
    refetchJobs();
  }

  async function cancelJob(id: string) {
    await fetch(`/api/v1/jobs/${id}/cancel`, { method: "POST" });
    refetchJobs();
  }

  const playbookMap = () => {
    const m: Record<string, Playbook> = {};
    for (const p of playbooks() ?? []) m[p.id] = p;
    return m;
  };

  const jobsByColumn = () => {
    const cols: Record<string, Job[]> = { pending: [], running: [], waiting_input: [], done: [] };
    for (const job of jobs() ?? []) {
      const col = columnForJob(job.status);
      cols[col]?.push(job);
    }
    return cols;
  };

  const profileColor: Record<string, string> = {
    autonomous:  "text-emerald-400",
    assisted:    "text-amber-400",
    restrictive: "text-red-400",
  };

  return (
    <div class="flex flex-col h-full">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div class="flex items-center justify-between px-8 py-5 border-b border-gray-800 flex-shrink-0">
        <div>
          <Show when={project()} fallback={<div class="h-6 w-48 bg-gray-800 rounded animate-pulse" />}>
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
                  <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                    <span class={`text-sm font-semibold ${col.color}`}>{col.label}</span>
                    <span class="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full">{colJobs().length}</span>
                  </div>

                  <div class="flex-1 overflow-y-auto p-3 space-y-2">
                    <Show
                      when={!jobs.loading}
                      fallback={
                        <div class="space-y-2">
                          <div class="h-20 bg-gray-800 rounded animate-pulse" />
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
                            playbookName={playbookMap()[job.playbookId ?? ""]?.name}
                            playbookProfile={playbookMap()[job.playbookId ?? ""]?.permissionProfile}
                            profileColor={profileColor}
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

            {/* Playbook selector */}
            <div>
              <label class="text-xs text-gray-400 block mb-1.5">Playbook *</label>
              <Show
                when={(playbooks() ?? []).length > 0}
                fallback={
                  <p class="text-xs text-gray-500 bg-gray-800 rounded px-3 py-2">
                    No playbooks configured. <a href="/playbooks" class="text-emerald-400 hover:underline">Create one first.</a>
                  </p>
                }
              >
                <div class="space-y-2">
                  <For each={playbooks()}>
                    {(pb) => {
                      const selected = () => selectedPlaybook() === pb.id;
                      return (
                        <label
                          class={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            selected()
                              ? "border-emerald-600 bg-emerald-900/20"
                              : "border-gray-700 bg-gray-800 hover:border-gray-600"
                          }`}
                        >
                          <input
                            type="radio"
                            name="playbook"
                            class="mt-0.5 accent-emerald-500"
                            checked={selected()}
                            onChange={() => setSelectedPlaybook(pb.id)}
                          />
                          <div class="min-w-0">
                            <div class="flex items-center gap-2">
                              <span class="text-sm font-medium">{pb.name}</span>
                              <span class={`text-xs ${profileColor[pb.permissionProfile] ?? "text-gray-400"}`}>
                                {pb.permissionProfile}
                              </span>
                              <Show when={pb.agentIds.length > 0}>
                                <span class="text-xs text-gray-500">{pb.agentIds.length} agent{pb.agentIds.length !== 1 ? "s" : ""}</span>
                              </Show>
                            </div>
                            <Show when={pb.description}>
                              <p class="text-xs text-gray-500 mt-0.5">{pb.description}</p>
                            </Show>
                          </div>
                        </label>
                      );
                    }}
                  </For>
                </div>
              </Show>
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

            <div class="flex gap-3 pt-1">
              <button
                onClick={submitTask}
                disabled={submitting() || !selectedPlaybook() || !prompt().trim()}
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

function JobCard(props: {
  job: Job;
  playbookName?: string;
  playbookProfile?: string;
  profileColor: Record<string, string>;
  onCancel: () => void;
}) {
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
          <Show when={props.playbookName}>
            <span class="text-xs text-gray-500 truncate">{props.playbookName}</span>
            <Show when={props.playbookProfile}>
              <span class={`text-xs ${props.profileColor[props.playbookProfile!] ?? "text-gray-500"}`}>
                ·
              </span>
            </Show>
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
