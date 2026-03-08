import { createResource } from "solid-js";

async function fetchHealth() {
  const res = await fetch("/api/health");
  return res.json();
}

export default function Dashboard() {
  const [health] = createResource(fetchHealth);

  return (
    <div class="min-h-screen bg-gray-950 text-gray-100 p-8">
      <h1 class="text-3xl font-bold mb-2">AgentForge</h1>
      <p class="text-gray-400 mb-8">Agent Orchestration Dashboard</p>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <a href="/agents" class="block p-6 bg-gray-900 rounded-lg border border-gray-800 hover:border-emerald-600 transition-colors">
          <h2 class="text-lg font-semibold mb-1">Agents</h2>
          <p class="text-gray-400 text-sm">Manage AI agent definitions</p>
        </a>
        <a href="/jobs" class="block p-6 bg-gray-900 rounded-lg border border-gray-800 hover:border-emerald-600 transition-colors">
          <h2 class="text-lg font-semibold mb-1">Jobs</h2>
          <p class="text-gray-400 text-sm">Launch and monitor tasks</p>
        </a>
        <a href="/models" class="block p-6 bg-gray-900 rounded-lg border border-gray-800 hover:border-emerald-600 transition-colors">
          <h2 class="text-lg font-semibold mb-1">Models</h2>
          <p class="text-gray-400 text-sm">Configure models for agents</p>
        </a>
        <div class="p-6 bg-gray-900 rounded-lg border border-gray-800">
          <h2 class="text-lg font-semibold mb-1">Status</h2>
          <p class="text-sm">
            API:{" "}
            <span class={health()?.status === "ok" ? "text-emerald-400" : "text-red-400"}>
              {health()?.status ?? "loading..."}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
