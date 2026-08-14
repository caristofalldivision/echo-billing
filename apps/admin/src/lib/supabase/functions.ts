import { FunctionsHttpError } from "@supabase/supabase-js";

// supabase.functions.invoke() returns `data: null` on any non-2xx response —
// the JSON error body our functions return (`{ error: "..." }`) only lives
// on `error.context`, a raw Response. This unwraps it with a safe fallback.
export async function getFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error as string;
    } catch {
      // response wasn't JSON — fall through to fallback
    }
  }
  return fallback;
}
