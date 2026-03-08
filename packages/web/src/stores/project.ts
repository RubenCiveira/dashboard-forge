import { createSignal } from "solid-js";

const STORAGE_KEY = "agentforge:activeProjectId";

const [activeProjectId, setActiveProjectIdInternal] = createSignal<string | null>(
  localStorage.getItem(STORAGE_KEY),
);

/** Set the active project and persist it across page reloads */
export function setActiveProjectId(id: string | null) {
  if (id) {
    localStorage.setItem(STORAGE_KEY, id);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  setActiveProjectIdInternal(id);
}

export { activeProjectId };
