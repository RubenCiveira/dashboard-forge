import { createResource, createSignal, createEffect, For, Show, onCleanup, onMount } from "solid-js";
import { useParams } from "@solidjs/router";
import { Portal } from "solid-js/web";

// ─── Types ───────────────────────────────────────────────────────────

interface Job {
  id: string;
  prompt: string;
  playbookId: string | null;
  modelOverride: string | null;
  status: string;
  summary: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface JobEvent {
  id: string;
  jobId: string;
  eventType: string;
  payload: string;
  createdAt: string;
}

interface ConversationPart {
  id: string;
  type: string;
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  tokens?: { total: number; input: number; output: number; reasoning: number };
  cost?: number;
  finishReason?: string;
}

interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  createdAt: number;
  model?: string;
  provider?: string;
  parts: ConversationPart[];
}

interface JobDetail extends Job {
  events: JobEvent[];
  conversation: ConversationMessage[];
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

async function fetchJobDetail(id: string): Promise<JobDetail> {
  const res = await fetch(`/api/v1/jobs/${id}`);
  return (await res.json() as { data: JobDetail }).data;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Returns the pending request info for a waiting job.
 * Reads the last `permission_requested` or `agent_question` job event.
 */
function pendingRequest(events: JobEvent[]): {
  kind: "permission" | "question";
  title?: string;
  permissionType?: string;
  metadata?: Record<string, unknown>;
  question?: string;
} | null {
  // Scan from newest to oldest. Track whether the most recent agent_question
  // was already answered by a subsequent user_response event.
  let questionAnswered = false;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    try {
      const payload = JSON.parse(ev.payload) as Record<string, unknown>;
      if (ev.eventType === "permission_requested") {
        return {
          kind: "permission",
          title: payload.title as string | undefined,
          permissionType: payload.type as string | undefined,
          metadata: payload.metadata as Record<string, unknown> | undefined,
        };
      }
      if (ev.eventType === "user_response") {
        questionAnswered = true;
        continue;
      }
      if (ev.eventType === "agent_question") {
        if (questionAnswered) return null; // already answered — no structured question pending
        return {
          kind: "question",
          question: payload.question as string | undefined,
        };
      }
    } catch {
      // malformed payload — skip
    }
  }
  return null;
}

// ─── Component ───────────────────────────────────────────────────────

export default function ProjectBoard() {
  const params = useParams<{ id: string }>();

  const [project] = createResource(() => params.id, fetchProject);
  const [playbooks] = createResource(fetchPlaybooks);

  const [jobs, { refetch: refetchJobs }] = createResource(() => params.id, fetchJobs);

  // Fallback polling (SSE handles real-time; poll catches anything missed)
  const interval = setInterval(refetchJobs, 10_000);
  onCleanup(() => clearInterval(interval));

  // SSE — real-time job updates
  onMount(() => {
    const es = new EventSource("/api/v1/events");

    const refresh = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { jobId?: string };
        refetchJobs();
        if (data.jobId && detailJobId() === data.jobId) refetchDetail();
      } catch { /* ignore parse errors */ }
    };

    es.addEventListener("job.started",       refresh);
    es.addEventListener("job.waiting_input", refresh);
    es.addEventListener("job.completed",     refresh);
    es.addEventListener("job.failed",        refresh);
    es.addEventListener("job.cancelled",     refresh);

    onCleanup(() => es.close());
  });

  // New task modal
  const [showModal, setShowModal] = createSignal(false);
  const [selectedPlaybook, setSelectedPlaybook] = createSignal("");
  const [prompt, setPrompt] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  // Job detail drawer
  const [detailJobId, setDetailJobId] = createSignal<string | null>(null);
  const [jobDetail, { refetch: refetchDetail }] = createResource(detailJobId, (id) =>
    id ? fetchJobDetail(id) : Promise.resolve(null),
  );

  // Respond panel
  const [replyText, setReplyText] = createSignal("");
  const [responding, setResponding] = createSignal(false);

  // Auto-scroll conversation to bottom when new messages arrive
  let conversationRef: HTMLDivElement | undefined;
  createEffect(() => {
    void jobDetail(); // track changes
    setTimeout(() => conversationRef?.scrollTo({ top: conversationRef.scrollHeight, behavior: "smooth" }), 50);
  });

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

  async function respondJob(
    id: string,
    action: "approve" | "deny" | "message" | "complete",
    message?: string,
  ) {
    setResponding(true);
    try {
      await fetch(`/api/v1/jobs/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(message ? { message } : {}) }),
      });
      setReplyText("");
      refetchJobs();
      refetchDetail();
    } finally {
      setResponding(false);
    }
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
                            onClick={() => { setDetailJobId(job.id); refetchDetail(); }}
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

      {/* ── Job Detail Drawer ────────────────────────────────────── */}
      <Show when={detailJobId()}>
        <Portal>
          {/* Backdrop */}
          <div
            class="fixed inset-0 bg-black/50 z-40"
            onClick={() => setDetailJobId(null)}
          />
          {/* Drawer */}
          <div class="fixed right-0 top-0 h-full w-full max-w-2xl bg-gray-900 border-l border-gray-700 z-50 flex flex-col shadow-2xl">
            {/* Header */}
            <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
              <h2 class="font-semibold text-base">Job Detail</h2>
              <div class="flex items-center gap-3">
                <Show when={jobDetail()?.status === "running" || jobDetail()?.status === "pending"}>
                  <button
                    onClick={async () => { await cancelJob(detailJobId()!); refetchDetail(); }}
                    class="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Cancel
                  </button>
                </Show>
                <button
                  onClick={() => setDetailJobId(null)}
                  class="text-gray-500 hover:text-gray-200 transition-colors text-lg leading-none"
                >
                  ✕
                </button>
              </div>
            </div>

            <Show when={jobDetail.loading}>
              <div class="flex-1 flex items-center justify-center">
                <p class="text-gray-500 text-sm animate-pulse">Loading…</p>
              </div>
            </Show>

            <Show when={!jobDetail.loading && jobDetail()}>
              {(detail) => {
                const statusColor: Record<string, string> = {
                  pending:       "bg-gray-700 text-gray-300",
                  running:       "bg-blue-900/60 text-blue-300",
                  waiting_input: "bg-amber-900/60 text-amber-300",
                  completed:     "bg-emerald-900/60 text-emerald-300",
                  failed:        "bg-red-900/60 text-red-300",
                  cancelled:     "bg-gray-800 text-gray-500",
                };

                const tokenStats = () => {
                  for (const msg of detail().conversation) {
                    for (const part of msg.parts) {
                      if (part.type === "step-finish" && part.tokens) return part;
                    }
                  }
                  return null;
                };

                const pending = () =>
                  detail().status === "waiting_input"
                    ? pendingRequest(detail().events)
                    : null;

                return (
                  <div class="flex-1 overflow-y-auto flex flex-col min-h-0">
                    {/* Meta */}
                    <div class="px-6 py-4 space-y-3 border-b border-gray-800 flex-shrink-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class={`text-xs px-2 py-0.5 rounded ${statusColor[detail().status] ?? "bg-gray-700 text-gray-400"}`}>
                          {detail().status}
                        </span>
                        <Show when={detail().modelOverride}>
                          <span class="text-xs font-mono bg-gray-800 text-gray-400 px-2 py-0.5 rounded">{detail().modelOverride}</span>
                        </Show>
                        <Show when={detail().playbookId}>
                          <span class="text-xs text-gray-500">{playbookMap()[detail().playbookId!]?.name ?? detail().playbookId}</span>
                        </Show>
                        <Show when={tokenStats()}>
                          {(s) => (
                            <span class="text-xs text-gray-600">
                              {s().tokens!.total} tokens
                              <Show when={s().tokens!.reasoning > 0}>
                                <span class="text-purple-500"> · {s().tokens!.reasoning} reasoning</span>
                              </Show>
                            </span>
                          )}
                        </Show>
                      </div>

                      <div>
                        <p class="text-xs text-gray-500 mb-1">Prompt</p>
                        <p class="text-sm text-gray-200 whitespace-pre-wrap bg-gray-800/60 rounded px-3 py-2">{detail().prompt}</p>
                      </div>

                      <div class="flex gap-4 text-xs text-gray-600">
                        <Show when={detail().startedAt}>
                          <span>Started: {new Date(detail().startedAt!).toLocaleString()}</span>
                        </Show>
                        <Show when={detail().completedAt}>
                          <span>Finished: {new Date(detail().completedAt!).toLocaleString()}</span>
                        </Show>
                      </div>
                    </div>

                    {/* ── Respond panel (waiting_input) ──────────── */}
                    <Show when={detail().status === "waiting_input"}>
                      <div class="px-6 py-4 border-b border-amber-900/40 bg-amber-950/20 flex-shrink-0">
                        <Show
                          when={pending()}
                          fallback={
                            /* Agent replied with plain-text follow-up (no structured question tool) */
                            <div class="space-y-3">
                              <span class="text-xs font-semibold text-amber-400 uppercase tracking-wide">Agent is waiting for your reply</span>
                              <textarea
                                class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-amber-500 resize-none placeholder-gray-600"
                                rows={3}
                                placeholder="Type your reply…"
                                value={replyText()}
                                onInput={(e) => setReplyText(e.currentTarget.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && replyText().trim()) {
                                    void respondJob(detail().id, "message", replyText());
                                  }
                                }}
                              />
                              <button
                                disabled={responding() || !replyText().trim()}
                                onClick={() => respondJob(detail().id, "message", replyText())}
                                class="w-full py-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 rounded text-sm font-medium transition-colors"
                              >
                                {responding() ? "Sending…" : "Send Reply"}
                              </button>
                              <p class="text-xs text-gray-600 text-center">⌘↵ / Ctrl+↵ to send</p>
                              <button
                                disabled={responding()}
                                onClick={() => respondJob(detail().id, "complete")}
                                class="w-full py-1.5 bg-gray-700 hover:bg-emerald-900/60 disabled:opacity-40 rounded text-xs text-gray-400 hover:text-emerald-300 transition-colors"
                              >
                                Mark as done
                              </button>
                            </div>
                          }
                        >
                          {(req) => (
                            <>
                              {/* Permission request */}
                              <Show when={req().kind === "permission"}>
                                <div class="space-y-3">
                                  <div class="flex items-center gap-2">
                                    <span class="text-xs font-semibold text-amber-400 uppercase tracking-wide">Permission Required</span>
                                    <Show when={req().permissionType}>
                                      <span class="text-xs font-mono bg-amber-900/40 text-amber-300 px-2 py-0.5 rounded">{req().permissionType}</span>
                                    </Show>
                                  </div>
                                  <Show when={req().title}>
                                    <p class="text-sm text-gray-200 bg-gray-800/60 rounded px-3 py-2 font-mono leading-relaxed whitespace-pre-wrap">{req().title}</p>
                                  </Show>
                                  <Show when={req().metadata && Object.keys(req().metadata!).length > 0}>
                                    <details class="group">
                                      <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-300 list-none flex items-center gap-1">
                                        <span class="group-open:rotate-90 transition-transform inline-block">▶</span>
                                        Details
                                      </summary>
                                      <pre class="mt-2 text-xs text-gray-500 bg-gray-900/80 rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap border border-gray-800">
                                        {JSON.stringify(req().metadata, null, 2)}
                                      </pre>
                                    </details>
                                  </Show>
                                  <div class="flex gap-2 pt-1">
                                    <button
                                      disabled={responding()}
                                      onClick={() => respondJob(detail().id, "approve")}
                                      class="flex-1 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded text-sm font-medium transition-colors"
                                    >
                                      {responding() ? "…" : "Allow"}
                                    </button>
                                    <button
                                      disabled={responding()}
                                      onClick={() => respondJob(detail().id, "deny")}
                                      class="flex-1 py-2 bg-red-900/60 hover:bg-red-800/60 disabled:opacity-40 rounded text-sm font-medium text-red-300 transition-colors"
                                    >
                                      {responding() ? "…" : "Deny"}
                                    </button>
                                  </div>
                                </div>
                              </Show>

                              {/* Agent question */}
                              <Show when={req().kind === "question"}>
                                <div class="space-y-3">
                                  <span class="text-xs font-semibold text-amber-400 uppercase tracking-wide">Agent is waiting for your reply</span>
                                  <Show when={req().question}>
                                    <p class="text-sm text-gray-200 bg-gray-800/60 rounded px-3 py-2 whitespace-pre-wrap leading-relaxed">{req().question}</p>
                                  </Show>
                                  <textarea
                                    class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-amber-500 resize-none placeholder-gray-600"
                                    rows={3}
                                    placeholder="Type your reply…"
                                    value={replyText()}
                                    onInput={(e) => setReplyText(e.currentTarget.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && replyText().trim()) {
                                        void respondJob(detail().id, "message", replyText());
                                      }
                                    }}
                                  />
                                  <button
                                    disabled={responding() || !replyText().trim()}
                                    onClick={() => respondJob(detail().id, "message", replyText())}
                                    class="w-full py-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 rounded text-sm font-medium transition-colors"
                                  >
                                    {responding() ? "Sending…" : "Send Reply"}
                                  </button>
                                  <p class="text-xs text-gray-600 text-center">⌘↵ / Ctrl+↵ to send</p>
                                </div>
                              </Show>
                            </>
                          )}
                        </Show>
                      </div>
                    </Show>

                    {/* Conversation */}
                    <div ref={conversationRef} class="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                      <Show
                        when={detail().conversation.length > 0}
                        fallback={<p class="text-xs text-gray-600">No conversation data yet.</p>}
                      >
                        <For each={detail().conversation}>
                          {(msg) => (
                            <div class={`space-y-2 ${msg.role === "user" ? "pl-4" : ""}`}>
                              <p class={`text-xs font-semibold ${msg.role === "user" ? "text-blue-400" : "text-emerald-400"}`}>
                                {msg.role === "user" ? "You" : `Agent${msg.model ? ` · ${msg.model}` : ""}`}
                              </p>

                              <For each={msg.parts.filter(p => p.type === "text" || p.type === "reasoning" || p.type === "tool-call" || p.type === "tool-result")}>
                                {(part) => (
                                  <Show when={part.type === "text" && part.text}>
                                    <div class={`rounded-lg px-4 py-3 text-sm ${
                                      msg.role === "user"
                                        ? "bg-blue-900/20 border border-blue-800/30 text-gray-200"
                                        : "bg-gray-800 text-gray-200"
                                    }`}>
                                      <p class="whitespace-pre-wrap leading-relaxed">{part.text}</p>
                                    </div>
                                  </Show>
                                )}
                              </For>

                              <For each={msg.parts.filter(p => p.type === "reasoning" && p.text)}>
                                {(part) => (
                                  <details class="group">
                                    <summary class="text-xs text-purple-400/70 cursor-pointer hover:text-purple-300 transition-colors list-none flex items-center gap-1">
                                      <span class="group-open:rotate-90 transition-transform inline-block">▶</span>
                                      Reasoning ({part.text!.length} chars)
                                    </summary>
                                    <pre class="mt-2 text-xs text-gray-500 bg-gray-900/80 rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap leading-relaxed border border-gray-800">{part.text}</pre>
                                  </details>
                                )}
                              </For>

                              <For each={msg.parts.filter(p => p.type === "tool-call")}>
                                {(part) => (
                                  <div class="text-xs bg-amber-900/20 border border-amber-800/30 rounded px-3 py-2">
                                    <span class="text-amber-400 font-mono">{part.toolName}</span>
                                    <pre class="text-gray-500 mt-1 overflow-x-auto">{JSON.stringify(part.toolInput, null, 2)}</pre>
                                  </div>
                                )}
                              </For>
                            </div>
                          )}
                        </For>
                      </Show>

                      {/* Events timeline */}
                      <Show when={detail().events.length > 0}>
                        <div class="border-t border-gray-800 pt-4 mt-2">
                          <p class="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">Events</p>
                          <div class="space-y-1">
                            <For each={detail().events}>
                              {(ev) => (
                                <div class="flex items-start gap-2 text-xs">
                                  <span class="text-gray-700 shrink-0 font-mono mt-0.5">
                                    {new Date(ev.createdAt).toLocaleTimeString()}
                                  </span>
                                  <span class={`font-mono shrink-0 ${
                                    ev.eventType === "failed" || ev.eventType === "error" ? "text-red-400" :
                                    ev.eventType === "completed" ? "text-emerald-400" :
                                    ev.eventType === "permission_requested" || ev.eventType === "agent_question" ? "text-amber-400" :
                                    ev.eventType === "user_response" ? "text-blue-400" :
                                    "text-gray-400"
                                  }`}>
                                    {ev.eventType}
                                  </span>
                                  <Show when={ev.payload !== "{}"}>
                                    <span class="text-gray-600 truncate">{ev.payload}</span>
                                  </Show>
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </Show>
          </div>
        </Portal>
      </Show>

      {/* ── New Task Modal ────────────────────────────────────────── */}
      <Show when={showModal()}>
        <div
          class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={(e) => e.target === e.currentTarget && setShowModal(false)}
        >
          <div class="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg mx-4 p-6 space-y-4">
            <h2 class="text-lg font-semibold">New Task</h2>

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

            <div>
              <label class="text-xs text-gray-400 block mb-1.5">Task prompt *</label>
              <textarea
                class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-500 resize-none placeholder-gray-600"
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
  onClick: () => void;
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
    <div
      class={`border rounded-lg p-3 space-y-2 group cursor-pointer transition-colors ${
        props.job.status === "waiting_input"
          ? "bg-amber-950/30 border-amber-800/50 hover:border-amber-700"
          : "bg-gray-800/80 border-gray-700/60 hover:border-gray-600"
      }`}
      onClick={props.onClick}
    >
      <p class="text-sm leading-snug line-clamp-3 text-gray-200">{props.job.prompt}</p>

      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0">
          <Show when={props.playbookName}>
            <span class="text-xs text-gray-500 truncate">{props.playbookName}</span>
          </Show>
        </div>
        <span class={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${statusColor[props.job.status] ?? "bg-gray-700 text-gray-400"}`}>
          {props.job.status === "waiting_input" ? "blocked" : props.job.status}
        </span>
      </div>

      <Show when={props.job.summary}>
        <p class="text-xs text-gray-500 border-t border-gray-700 pt-2 line-clamp-2">{props.job.summary}</p>
      </Show>

      <Show when={canCancel()}>
        <button
          onClick={(e) => { e.stopPropagation(); props.onCancel(); }}
          class="w-full text-xs text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 pt-1"
        >
          Cancel task
        </button>
      </Show>
    </div>
  );
}
