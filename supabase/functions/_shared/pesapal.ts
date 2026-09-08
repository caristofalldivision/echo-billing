// Minimal Pesapal API v3 client. Docs: https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/api-reference
//
// Flow used by Echo:
//   1. requestToken()                — short-lived bearer token
//   2. ensureIpnRegistered()         — one-time per org, cached on organizations.pesapal_ipn_id
//   3. submitOrder()                 — creates the order, returns a redirect_url.
//      Pesapal's hosted page shows the M-Pesa STK-push prompt for Kenyan phone
//      numbers automatically; there is no separate "trigger STK" call in v3.
//   4. Pesapal calls our IPN URL, and/or the captive portal polls
//      getTransactionStatus() using the order_tracking_id.

import { fetchWithTimeout } from "./http.ts";

interface PesapalOrg {
  pesapal_env: "sandbox" | "live";
  pesapal_consumer_key: string | null;
  pesapal_consumer_secret: string | null;
  pesapal_ipn_id: string | null;
  id: string;
}

function baseUrl(env: "sandbox" | "live") {
  return env === "live"
    ? "https://pay.pesapal.com/v3"
    : "https://cybqa.pesapal.com/pesapalv3";
}

// Pesapal tokens are valid for several minutes, but reconcileTransaction
// calls requestToken() on every single /status poll tick while a
// transaction is pending — without caching, that's a full extra auth
// round-trip per poll for no reason. Cached per-org (in-memory, so it only
// helps within a warm isolate — fine, since polls for the same transaction
// land on the same warm instance far more often than not), with a 30s
// safety buffer subtracted from Pesapal's own expiry so we never hand out
// a token that expires mid-flight.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const TOKEN_SAFETY_BUFFER_MS = 30_000;
const DEFAULT_TOKEN_TTL_MS = 4 * 60 * 1000;

export async function requestToken(org: PesapalOrg): Promise<string> {
  if (!org.pesapal_consumer_key || !org.pesapal_consumer_secret) {
    throw new Error("Pesapal credentials are not configured for this organization");
  }

  const cached = tokenCache.get(org.id);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetchWithTimeout(
    `${baseUrl(org.pesapal_env)}/api/Auth/RequestToken`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        consumer_key: org.pesapal_consumer_key,
        consumer_secret: org.pesapal_consumer_secret,
      }),
    },
    15_000,
  );
  if (!res.ok) throw new Error(`Pesapal auth failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.token) throw new Error(`Pesapal auth response missing token: ${JSON.stringify(json)}`);

  const parsedExpiry = json.expiryDate ? Date.parse(json.expiryDate) : NaN;
  const expiresAt = (Number.isNaN(parsedExpiry) ? Date.now() + DEFAULT_TOKEN_TTL_MS : parsedExpiry) -
    TOKEN_SAFETY_BUFFER_MS;
  tokenCache.set(org.id, { token: json.token, expiresAt });

  return json.token as string;
}

export async function ensureIpnRegistered(
  org: PesapalOrg,
  token: string,
  ipnUrl: string,
  persist: (ipnId: string) => Promise<void>,
): Promise<string> {
  if (org.pesapal_ipn_id) return org.pesapal_ipn_id;

  const res = await fetchWithTimeout(
    `${baseUrl(org.pesapal_env)}/api/URLSetup/RegisterIPN`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url: ipnUrl, ipn_notification_type: "POST" }),
    },
    15_000,
  );
  if (!res.ok) throw new Error(`Pesapal IPN registration failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  await persist(json.ipn_id);
  return json.ipn_id as string;
}

export interface SubmitOrderInput {
  merchantReference: string;
  amount: number;
  currency: string;
  description: string;
  callbackUrl: string;
  ipnId: string;
  phone: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export async function submitOrder(org: PesapalOrg, token: string, input: SubmitOrderInput) {
  const res = await fetchWithTimeout(
    `${baseUrl(org.pesapal_env)}/api/Transactions/SubmitOrderRequest`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        id: input.merchantReference,
        currency: input.currency,
        amount: input.amount,
        description: input.description,
        callback_url: input.callbackUrl,
        notification_id: input.ipnId,
        billing_address: {
          phone_number: input.phone,
          email_address: input.email ?? undefined,
          first_name: input.firstName ?? "Echo",
          last_name: input.lastName ?? "Customer",
          country_code: "KE",
        },
      }),
    },
    15_000,
  );
  if (!res.ok) throw new Error(`Pesapal order submission failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{
    order_tracking_id: string;
    merchant_reference: string;
    redirect_url: string;
    error?: unknown;
    status: string;
  }>;
}

export async function getTransactionStatus(
  org: PesapalOrg,
  token: string,
  orderTrackingId: string,
) {
  // Shorter timeout than the other calls — this one runs on every /status
  // poll tick while a transaction is pending, so a hung request here
  // shouldn't hold up polling as long as a one-time call would be allowed to.
  const res = await fetchWithTimeout(
    `${baseUrl(org.pesapal_env)}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
    { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } },
    8_000,
  );
  if (!res.ok) throw new Error(`Pesapal status check failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{
    payment_status_description: "Completed" | "Failed" | "Pending" | "Invalid";
    status_code: number;
    amount: number;
    payment_method: string;
    merchant_reference: string;
    order_tracking_id: string;
  }>;
}
