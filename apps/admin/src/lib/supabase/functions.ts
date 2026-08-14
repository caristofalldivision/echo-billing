import { FunctionsHttpError, FunctionsFetchError, FunctionsRelayError } from "@supabase/supabase-js";

// supabase.functions.invoke() returns `data: null` on any non-2xx response —
// the JSON error body our functions return (`{ error: "..." }`) only lives
// on `error.context`, a raw Response. This unwraps it with a safe fallback,
// and distinguishes network/config failures from a function's own error
// response so a misconfigured deployment doesn't just say "something broke."
export async function getFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return `${body.error} (HTTP ${error.context.status})`;
    } catch {
      // response wasn't JSON — fall through with at least the status code
    }
    return `${fallback} (HTTP ${error.context.status})`;
  }
  if (error instanceof FunctionsRelayError) {
    return `${fallback} (Supabase relay error: ${error.message})`;
  }
  if (error instanceof FunctionsFetchError) {
    return `${fallback} (couldn't reach Supabase — check NEXT_PUBLIC_SUPABASE_URL is configured correctly)`;
  }
  return fallback;
}
