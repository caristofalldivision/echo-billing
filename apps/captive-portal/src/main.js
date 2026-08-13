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
function connectWithCode(code) {
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
  $("#status-text").textContent = "Waiting for M-Pesa confirmation…";

  try {
    const res = await fetch(`${PORTAL_API}/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: selectedPlan.id, phone }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not start payment");
    pollTransaction(data.transactionId);
  } catch (err) {
    showFailure();
  }
});

function pollTransaction(transactionId) {
  const startedAt = Date.now();
  const interval = setInterval(async () => {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      clearInterval(interval);
      showFailure();
      return;
    }
    try {
      const res = await fetch(`${PORTAL_API}/status?transactionId=${transactionId}`);
      const data = await res.json();
      if (data.status === "completed") {
        clearInterval(interval);
        showSuccess(data.voucherCode);
      } else if (data.status === "failed" || data.status === "cancelled") {
        clearInterval(interval);
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

function showFailure() {
  $("#purchase-status").classList.add("hidden");
  $("#purchase-failed").classList.remove("hidden");
}

$("#retry-purchase").addEventListener("click", () => {
  $("#purchase-failed").classList.add("hidden");
  $("#plans").classList.remove("hidden");
  selectedPlan = null;
});

// --- Voucher flow ----------------------------------------------------
$("#voucher-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("#voucher-code").value.trim().toUpperCase();
  const messageEl = $("#voucher-message");
  messageEl.textContent = "Checking…";
  try {
    const res = await fetch(`${PORTAL_API}/check-voucher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (data.valid) {
      messageEl.textContent = `Valid — ${data.plan.name}. Connecting…`;
      connectWithCode(code);
    } else {
      messageEl.textContent = { used: "This code was already used.", expired: "This code has expired." }[
        data.reason
      ] ?? "Code not found. Check and try again.";
    }
  } catch {
    messageEl.textContent = "Couldn't verify the code — check your connection.";
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
  } catch {
    // fall back to the defaults already in login.html
  }
}

applyBranding();
loadPlans();
