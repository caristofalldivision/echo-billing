const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_BASE_URL ?? "http://localhost:54321/functions/v1";
const PORTAL_API = `${FUNCTIONS_BASE}/portal-api`;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000;

const $ = (sel) => document.querySelector(sel);

// --- Tabs -------------------------------------------------------------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`#panel-${tab.dataset.tab}`).classList.add("active");
  });
});

// --- MikroTik login submission -----------------------------------------
// Remembers the code in localStorage on every attempt — RADIUS's
// claimVoucher already allows the same code to re-authenticate from the
// same device within the plan's paid window (see CLAUDE.md), so if the
// hotspot session ever drops (idle timeout, router reboot, walking out of
// range and back), tryAutoReconnect() below can get the customer back
// online just by them reopening the captive portal — no digging up the
// code or re-paying.
function connectWithCode(code) {
  try {
    localStorage.setItem("echo_last_voucher_code", code);
  } catch {
    // private browsing / storage disabled — auto-reconnect just won't fire
  }
  $("#mt-username").value = code;
  $("#mt-password").value = code;
  $("#mikrotik-login").submit();
}

// --- Buy flow ------------------------------------------------------------
let selectedPlan = null;

async function loadPlans() {
  const plansEl = $("#plans");
  try {
    const res = await fetch(`${PORTAL_API}/plans?type=hotspot`);
    const { plans } = await res.json();
    if (!plans?.length) {
      plansEl.innerHTML = `<p class="muted">No plans available right now — please check back shortly.</p>`;
      return;
    }
    plansEl.innerHTML = "";
    plans.forEach((plan) => {
      const card = document.createElement("div");
      card.className = "plan-card";
      card.innerHTML = `
        <div>
          <div class="plan-name">${plan.name}</div>
          <div class="plan-meta">${formatPlanMeta(plan)}</div>
        </div>
        <div class="plan-price">${plan.currency} ${plan.price}</div>
      `;
      card.addEventListener("click", () => selectPlan(plan));
      plansEl.appendChild(card);
    });
  } catch (err) {
    plansEl.innerHTML = `<p class="muted">Couldn't load plans. Pull down to refresh.</p>`;
  }
}

function formatPlanMeta(plan) {
  const bits = [];
  bits.push(plan.duration_minutes ? `${plan.duration_minutes} min` : "No time limit");
  bits.push(plan.data_cap_mb ? `${plan.data_cap_mb} MB` : "Unlimited data");
  return bits.join(" · ");
}

function selectPlan(plan) {
  selectedPlan = plan;
  $("#plans").classList.add("hidden");
  $("#purchase-form").classList.remove("hidden");
  $("#selected-plan-name").textContent = `${plan.name} (${plan.currency} ${plan.price})`;
}

$("#back-to-plans").addEventListener("click", () => {
  $("#purchase-form").classList.add("hidden");
  $("#plans").classList.remove("hidden");
});

$("#purchase-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const phone = $("#phone").value.trim();
  if (!selectedPlan || !phone) return;

  $("#purchase-form").classList.add("hidden");
  $("#purchase-status").classList.remove("hidden");
  $("#status-text").textContent = "Setting up your payment…";
  $("#status-subtext").textContent = "Just a moment.";
  $("#status-elapsed").textContent = "";

  try {
    const res = await fetch(`${PORTAL_API}/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: selectedPlan.id, phone, returnOrigin: window.location.origin }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not start payment");

    if (data.redirectUrl) {
      // Full-page redirect, not a popup — MikroTik hotspot logins are
      // typically opened inside the OS's restricted captive-portal
      // mini-browser (Apple's Captive Network Assistant, Android's
      // equivalent), which is known to block/mishandle window.open(). This
      // page is what actually triggers the M-Pesa STK push; there's no
      // separate API call for that. Pesapal's own callback_url (built
      // server-side with the origin we just sent) is what brings the
      // browser back here afterward — see the transactionId handling below.
      // (A tap-through "Continue to payment" link was tried here 2026-09-10
      // to work around a theorized user-gesture-loss issue, but broke the
      // flow in practice without confirmed benefit — reverted per live
      // testing. If a "not verified/open in browser" prompt resurfaces on a
      // specific device, get the exact device/OS and reproduce it before
      // reintroducing anything like that again — don't guess.)
      window.location.href = data.redirectUrl;
      return;
    }
    pollTransaction(data.transactionId);
  } catch (err) {
    // Surface what actually went wrong. This used to call showFailure()
    // with no argument, so every distinct cause — the API unreachable
    // because a domain isn't in the router's walled garden, a Pesapal
    // credential problem, a plan that vanished, a genuine decline — all
    // rendered as the same bare "Payment didn't go through." A customer
    // reported it as "failed instantly" and there was nothing in the UI,
    // and nothing server-side either (the request never arrived), to say
    // why. The message is the only diagnostic that exists at that point,
    // so it has to carry the real reason.
    showFailure(err instanceof Error ? err.message : String(err));
  }
});

// Resuming after the Pesapal round-trip — the return page sends us back to
// this same login.html with ?transactionId=..., so pick up polling
// immediately instead of showing the plan list again.
const resumeTransactionId = new URLSearchParams(window.location.search).get("transactionId");
if (resumeTransactionId) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  $("#panel-buy").classList.add("active");
  $("#plans").classList.add("hidden");
  $("#purchase-status").classList.remove("hidden");
  $("#status-text").textContent = "Confirming your payment…";
  $("#status-subtext").textContent = "Almost there.";
  $("#status-elapsed").textContent = "";
  pollTransaction(resumeTransactionId);
}

// Pesapal gives us no intermediate "STK sent" / "PIN entered" events — only
// a final status — so these stages are elapsed-time-based reassurance, not
// real backend progress. Wording says "usually"/"taking longer" rather than
// claiming precision we don't have.
const WAIT_STAGES = [
  { afterMs: 0, text: "Check your phone for the STK push prompt — usually takes 5–15 seconds." },
  { afterMs: 12000, text: "Still waiting — enter your M-Pesa PIN when prompted." },
  { afterMs: 30000, text: "Taking a little longer than usual — hang tight." },
  { afterMs: 70000, text: "This is taking a while. Didn't get a prompt? You can keep waiting or try again shortly." },
];

function pollTransaction(transactionId) {
  const startedAt = Date.now();
  const tick = setInterval(() => {
    const elapsedMs = Date.now() - startedAt;
    const stage = [...WAIT_STAGES].reverse().find((s) => elapsedMs >= s.afterMs);
    if (stage) $("#status-subtext").textContent = stage.text;
    $("#status-elapsed").textContent = `${Math.floor(elapsedMs / 1000)}s`;
  }, 1000);

  const interval = setInterval(async () => {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      clearInterval(interval);
      clearInterval(tick);
      showFailure();
      return;
    }
    try {
      const res = await fetch(`${PORTAL_API}/status?transactionId=${transactionId}`);
      const data = await res.json();
      if (data.status === "completed") {
        clearInterval(interval);
        clearInterval(tick);
        showSuccess(data.voucherCode);
      } else if (data.status === "failed" || data.status === "cancelled") {
        clearInterval(interval);
        clearInterval(tick);
        showFailure();
      }
    } catch {
      // transient network error — keep polling until timeout
    }
  }, POLL_INTERVAL_MS);
}

function showSuccess(voucherCode) {
  $("#purchase-status").classList.add("hidden");
  $("#purchase-success").classList.remove("hidden");
  $("#success-code").textContent = voucherCode ?? "—";
  if (voucherCode) {
    setTimeout(() => connectWithCode(voucherCode), 1200);
  }
}

function showFailure(reason) {
  $("#purchase-status").classList.add("hidden");
  $("#purchase-failed").classList.remove("hidden");
  // A network-layer fetch rejection ("Failed to fetch"/"Load failed") means
  // the request never left the phone, which on a hotspot almost always means
  // the API host isn't reachable pre-login rather than anything being wrong
  // with the payment. Say so, because the customer-facing wording otherwise
  // sends them to their bank or M-Pesa for a problem on our side.
  const el = $("#failure-reason");
  if (!el) return;
  if (!reason) {
    el.textContent = "";
    return;
  }
  const networkish = /failed to fetch|load failed|networkerror|typeerror/i.test(reason);
  el.textContent = networkish
    ? `Couldn't reach the payment service from this network (${reason}). Your money was not taken.`
    : reason;
}

$("#retry-purchase").addEventListener("click", () => {
  $("#purchase-failed").classList.add("hidden");
  $("#plans").classList.remove("hidden");
  selectedPlan = null;
});

// --- Self-service recovery ----------------------------------------------
// Added 2026-09-10 after a live payment where Pesapal's redirect-back
// dropped the customer before /status or /return ever polled — paid, no
// voucher shown, no automatic connect, and no way to recover short of
// paying again or texting support. This gives an explicit path: look up
// the most recent payment for a phone number and pick up wherever it left
// off (still pending → resume polling, completed → show the code and
// connect, not found/failed → say so plainly instead of a dead end).
function showRecoverForm() {
  $("#purchase-failed").classList.add("hidden");
  $("#recover-form").classList.remove("hidden");
  $("#recover-message").textContent = "";
}
$("#show-recover").addEventListener("click", showRecoverForm);
$("#show-recover-from-failed").addEventListener("click", showRecoverForm);
$("#hide-recover").addEventListener("click", () => {
  $("#recover-form").classList.add("hidden");
  $("#recover-message").textContent = "";
});

$("#recover-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const phone = $("#recover-phone").value.trim();
  if (!phone) return;
  const messageEl = $("#recover-message");
  messageEl.textContent = "Looking up your payment…";
  try {
    const res = await fetch(`${PORTAL_API}/resume?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    if (!data.found) {
      messageEl.textContent = "No recent payment found for that number. Try again or contact support.";
      return;
    }
    $("#recover-form").classList.add("hidden");
    if (data.status === "completed") {
      messageEl.textContent = "";
      $("#panel-buy").classList.add("active");
      showSuccess(data.voucherCode);
    } else if (data.status === "failed" || data.status === "cancelled") {
      messageEl.textContent = "That payment didn't go through — please try again.";
    } else {
      messageEl.textContent = "";
      $("#panel-buy").classList.add("active");
      $("#purchase-status").classList.remove("hidden");
      $("#status-text").textContent = "Confirming your payment…";
      $("#status-subtext").textContent = "Almost there.";
      $("#status-elapsed").textContent = "";
      pollTransaction(data.transactionId);
    }
  } catch {
    messageEl.textContent = "Couldn't check right now — check your connection and try again.";
  }
});

// Remembers this device's last code and, on every page load, asks the
// backend whether it's still good before doing anything with it. The check
// matters: a hotspot login that fails just bounces the browser straight back
// to this same page, so blindly resubmitting a spent code would put the
// customer in an invisible submit/redirect loop. check-voucher now reports
// a used-but-still-inside-its-paid-window code as valid with reconnect:true
// (matching what RADIUS will actually accept — see the route's comment in
// portal-api), so this asks the one component that knows, rather than
// guessing from local state that can't see redemption time or the plan's
// duration.
//
// Result: a customer whose session dropped mid-plan — phone died, walked
// out of range, router rebooted — just reopens the portal and is back
// online with no typing and no re-payment. Once their time is genuinely up,
// the stored code is cleared and they get the plan list instead of a
// confusing error. Skipped while resuming a payment so the two auto-flows
// can't race.
async function tryAutoReconnect() {
  if (resumeTransactionId) return;
  let code;
  try {
    code = localStorage.getItem("echo_last_voucher_code");
  } catch {
    return; // private browsing / storage disabled
  }
  if (!code) return;

  try {
    const res = await fetch(`${PORTAL_API}/check-voucher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) return; // backend hiccup — leave the code stored, try next load
    if (data.valid) {
      $("#voucher-message").textContent = "Welcome back — reconnecting you…";
      connectWithCode(code);
      return;
    }
    // Genuinely spent/expired/revoked: stop offering it, so the customer
    // sees the plan list rather than a silent failed reconnect.
    localStorage.removeItem("echo_last_voucher_code");
  } catch {
    // offline/unreachable — keep the code for a future attempt
  }
}

// --- Voucher flow ----------------------------------------------------
// Codes are shown to customers as XXXXX-XXXXX, but phone keyboards/
// autocomplete happily drop or mangle the dash — normalize the same way
// the backend does so a code typed without it still verifies and connects.
function normalizeVoucherCode(input) {
  const stripped = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return stripped.length === 10 ? `${stripped.slice(0, 5)}-${stripped.slice(5)}` : stripped;
}

$("#voucher-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = normalizeVoucherCode($("#voucher-code").value);
  const messageEl = $("#voucher-message");
  messageEl.textContent = "Checking…";
  try {
    const res = await fetch(`${PORTAL_API}/check-voucher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) {
      // Surface the real failure instead of falling through to "not found" —
      // a 500 here (misconfigured secret, DB error, etc.) used to look
      // identical to a genuinely nonexistent code, which made this
      // impossible to debug from the customer-facing symptom alone.
      messageEl.textContent = `Couldn't verify the code (${data.error ?? res.status}). Please try again.`;
      return;
    }
    if (data.valid) {
      messageEl.textContent = data.reconnect
        ? `Welcome back — ${data.plan.name}. Reconnecting…`
        : `Valid — ${data.plan.name}. Connecting…`;
      connectWithCode(code);
    } else {
      messageEl.textContent = {
        used: "This code has been fully used up. Please buy a new one.",
        expired: "This code has expired.",
        revoked: "This code is no longer valid. Please contact support.",
      }[data.reason] ?? "Code not found. Check and try again.";
    }
  } catch (err) {
    // Same reasoning as the purchase flow's showFailure(): a bare "check
    // your connection" hides the one useful fact, which is whether the
    // request reached us at all. On a hotspot, a fetch that never leaves the
    // phone means the API host isn't reachable before login — a router
    // walled-garden problem, not the customer's connection or their code.
    const reason = err instanceof Error ? err.message : String(err);
    messageEl.textContent = /failed to fetch|load failed|networkerror/i.test(reason)
      ? `Couldn't reach the server from this network (${reason}). This is a setup problem, not your code.`
      : `Couldn't verify the code: ${reason}`;
  }
});

// --- Branding — fetched live from the admin portal's captive portal
// customizer, so an admin's changes show up on next page load without
// rebuilding/re-pushing the static bundle to every router. -------------
async function applyBranding() {
  try {
    const res = await fetch(`${PORTAL_API}/theme`);
    const { theme } = await res.json();
    if (!theme) return;
    document.documentElement.dataset.theme = theme.theme || "waves";
    if (theme.logo_url) $(".logo").src = theme.logo_url;
    if (theme.headline) $("#headline").textContent = theme.headline;
    if (theme.tagline) $("#tagline").textContent = theme.tagline;
    if (theme.primary_color) document.documentElement.style.setProperty("--primary", theme.primary_color);
    if (theme.secondary_color) document.documentElement.style.setProperty("--secondary", theme.secondary_color);
    if (theme.support_phone || theme.support_whatsapp) {
      $("#support-line").textContent = `Need help? ${theme.support_phone ?? ""} ${
        theme.support_whatsapp ? `· WhatsApp ${theme.support_whatsapp}` : ""
      }`.trim();
    }
    if (theme.terms_text) $("#terms").textContent = theme.terms_text;
    // Where RouterOS sends the customer once the login actually succeeds.
    // Left alone, that's $(link-orig) — whatever their phone happened to be
    // requesting when the portal intercepted it, which is usually the OS's
    // own captive-portal probe or an HTTPS URL the hotspot could only serve
    // with a mismatched certificate (the "this login page might not belong
    // to the organisation shown" warning). Pointing it at a real page the
    // admin controls gives an unambiguous "you're online" landing instead.
    if (theme.success_redirect_url) {
      $("#mt-dst").value = theme.success_redirect_url;
    }
  } catch {
    // fall back to the defaults already in login.html
  }
}

applyBranding();
loadPlans();
tryAutoReconnect();
