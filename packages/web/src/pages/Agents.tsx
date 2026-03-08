import { createResource, For, Show } from "solid-js";
import type { Agent } from "@agentforge/shared";

async function fetchAgents(): Promise<{ data: Agent[]; total: number }> {
  const res = await fetch("/api/v1/agents");
  return res.json();
}

export default function Agents() {
  const [agents, { refetch }] = createResource(fetchAgents);

  return (
    <div class="min-h-screen bg-gray-950 text-gray-100 p-8">
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-2xl font-bold">Agents</h1>
          <p class="text-gray-400 text-sm">
            {agents()?.total ?? 0} registered agents
          </p>
        </div>
        <a href="/" class="text-gray-400 hover:text-gray-200 text-sm">
          ← Dashboard
        </a>
      </div>

      {/* TODO: Add create agent form */}

      <Show
        when={!agents.loading}
        fallback={<p class="text-gray-500">Loading...</p>}
      >
        <div class="grid gap-4">
          <For each={agents()?.data ?? []}>
            {(agent) => (
              <div class="p-4 bg-gray-900 rounded-lg border border-gray-800">
                <div class="flex items-start justify-between">
                  <div>
                    <h3 class="font-semibold">{agent.name}</h3>
                    <p class="text-gray-400 text-sm mt-1">
                      {agent.description}
                    </p>
                  </div>
                  <span class="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded">
                    v{agent.version}
                  </span>
                </div>
                <div class="flex gap-2 mt-3">
                  <For each={agent.tags}>
                    {(tag) => (
                      <span class="text-xs bg-emerald-900/40 text-emerald-300 px-2 py-0.5 rounded">
                        {tag}
                      </span>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
