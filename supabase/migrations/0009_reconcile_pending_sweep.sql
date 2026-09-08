-- ---------------------------------------------------------------------------
-- Safety-net sweep for stuck-pending Pesapal transactions.
--
-- Found 2026-09-08: a customer paid successfully (confirmed directly against
-- Pesapal's GetTransactionStatus) but got no SMS, no voucher, and the router
-- never reconnected them. Root cause was a separate bug (the /status route's
-- ambiguous `vouchers` embed, fixed alongside this migration) that made the
-- client's own poll return "Transaction not found" for every transaction —
-- meaning fulfillment depended entirely on Pesapal's IPN webhook, which is
-- documented (see CLAUDE.md) to sometimes just never fire on sandbox/demo
-- credentials. Once IPN also didn't fire for these two, nothing was left to
-- reconcile them: the captive-portal purchase flow deliberately sends
-- Pesapal's callback straight back to the router's login.html (not through
-- portal-api's own /return "third chance") to avoid an extra redirect hop
-- the OS's captive-portal mini-browser handles badly, so /return never runs
-- for a real hotspot purchase either.
--
-- This sweep is a fourth, independent trigger that needs neither the
-- client's browser to still be open nor Pesapal's IPN to fire: every minute,
-- ask Pesapal directly about every transaction we still have marked pending,
-- via the same idempotent, re-verified reconcileTransaction() used by the
-- webhook and the poll. See supabase/functions/reconcile-pending.
-- ---------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_net with schema extensions;
  create extension if not exists pg_cron with schema extensions;
  perform cron.schedule(
    'echo-reconcile-pending-transactions',
    '* * * * *',
    $sql$
      select net.http_post(
        url := 'https://fazfsiqbugasqsxjpbpo.supabase.co/functions/v1/reconcile-pending',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      );
    $sql$
  );
exception when others then
  raise notice 'pg_cron/pg_net scheduling skipped: %', sqlerrm;
end $$;
