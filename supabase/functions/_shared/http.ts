// fetch() with a hard ceiling — none of the outbound calls to Pesapal,
// TalkSasa, or Resend had a timeout before this, so a slow provider had no
// bound and could hang a request indefinitely.
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
