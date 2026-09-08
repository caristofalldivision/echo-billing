// Runs a task after the response is already on its way to the client,
// instead of the caller awaiting it on the request's critical path — used
// for receipt SMS/email and third-chance reconciliation, which are
// best-effort and shouldn't add their own latency to /status or /return.
//
// EdgeRuntime.waitUntil is Supabase Edge Runtime's documented mechanism for
// extending a function invocation's lifetime just long enough for a
// background task to finish, without blocking the response — present in
// both hosted Functions and local `supabase functions serve` (same
// edge-runtime binary). It isn't declared in Deno's own lib types, and
// isn't present at all in plain `deno test`/non-edge-runtime contexts, so
// it's guarded rather than assumed.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

export function runInBackground(task: () => Promise<unknown>): void {
  const promise = task().catch((err) => {
    console.error("background task failed", err);
  });
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(promise);
  }
}
