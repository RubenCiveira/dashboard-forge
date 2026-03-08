import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eventBus } from "../lib/events.js";

export const eventsRouter = new Hono();

/**
 * SSE endpoint for real-time events.
 * Optionally filter by job_id query parameter.
 */
eventsRouter.get("/", async (ctx) => {
  const jobIdFilter = ctx.req.query("job_id");

  return streamSSE(ctx, async (stream) => {
    const unsubscribe = eventBus.subscribe((event) => {
      // If filtering by job_id, skip events for other jobs
      if (jobIdFilter) {
        const eventJobId = (event.data as Record<string, unknown>)?.jobId;
        if (eventJobId !== jobIdFilter) return;
      }

      stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event.data),
      });
    });

    // Keep connection alive with periodic heartbeat
    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: "heartbeat", data: "" });
    }, 15_000);

    // Clean up on disconnect
    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    // Block until aborted
    await new Promise(() => {});
  });
});
