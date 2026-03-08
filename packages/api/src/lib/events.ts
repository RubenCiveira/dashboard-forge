import type { SseEvent } from "@agentforge/shared";

type Listener = (event: SseEvent) => void;

/**
 * Simple in-memory event bus for SSE broadcasting.
 * Listeners subscribe and receive all events or filter by job ID.
 */
class EventBus {
  private listeners = new Set<Listener>();

  /** Subscribe to all events. Returns unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Emit an event to all listeners */
  emit(event: SseEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors should not break the bus
      }
    }
  }

  /** Current number of active listeners */
  get size(): number {
    return this.listeners.size;
  }
}

/** Singleton event bus for the API */
export const eventBus = new EventBus();
