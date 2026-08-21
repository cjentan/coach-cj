"use client";

/**
 * HTTP + SSE client for the dashboard coach API.
 *
 * These helpers handle POSTing coach actions to `/api/dashboard/coach` and,
 * for streaming actions, reading the Server-Sent-Events stream to surface
 * progress to the caller. Keeping them here (outside the React component)
 * makes the network layer independently testable and shrinks `coach-chat.tsx`.
 */

export type CoachT = (key: string, values?: Record<string, string | number | boolean | Date | null | undefined>) => string;

export async function coachApi(action: string, body: Record<string, unknown> | undefined, t: CoachT) {
  const res = await fetch("/api/dashboard/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || t("requestFailed", { status: res.status }));
  return data;
}

/**
 * SSE streaming variant of coachApi.
 * Calls the given action, delivers progress events to onProgress,
 * and resolves with the complete payload on the "complete" event.
 * Rejects on HTTP error or "error" SSE event.
 */
export async function coachApiStream(
  action: string,
  body: Record<string, unknown>,
  onProgress: (data: unknown) => void,
  t: CoachT,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const res = await fetch("/api/dashboard/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || t("requestFailed", { status: res.status }));
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error(t("responseNotReadable"));

  const decoder = new TextDecoder();
  let buffer = "";

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    async function read() {
      try {
        let currentEvent = "";
        let currentData = "";

        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() || "";

          for (const line of parts) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              currentData = line.slice(6);
            } else if (line === "" && currentEvent && currentData) {
              // Empty line delimits an SSE event
              try {
                const parsed = JSON.parse(currentData);
                if (currentEvent === "complete") {
                  resolve(parsed);
                  return;
                } else if (currentEvent === "error") {
                  reject(new Error((parsed as { error?: string }).error || t("unknownError")));
                  return;
                } else {
                  onProgress(parsed);
                }
              } catch {
                // Skip malformed events
              }
              currentEvent = "";
              currentData = "";
            }
          }
        }
      } catch (err) {
        reject(err);
      }
    }
    read();
  });
}
