-- "admins write/update branding" checked auth.role() = 'authenticated' --
-- same gap class as the edge functions fixed earlier this pass: proves the
-- caller has *a* Supabase session, not that they're actually an
-- admin_users member of this org. Anyone who could create any Supabase
-- account could overwrite files in the branding bucket (defacement risk:
-- swap the org's logo, etc.) -- found during the same audit pass.
drop policy if exists "admins write branding" on storage.objects;
create policy "admins write branding" on storage.objects for insert
  with check (bucket_id = 'branding' and exists (select 1 from admin_users where id = auth.uid()));

drop policy if exists "admins update branding" on storage.objects;
create policy "admins update branding" on storage.objects for update
  using (bucket_id = 'branding' and exists (select 1 from admin_users where id = auth.uid()));

create or replace function refund_transaction(
  p_transaction_id uuid,
  p_amount         numeric,
  p_reason         text
)
returns transactions
language plpgsql
as $$
declare
  v_org_id uuid := current_org_id();
  v_txn    transactions;
begin
  if v_org_id is null then
    raise exception 'Not authorized';
  end if;

  select * into v_txn from transactions where id = p_transaction_id and org_id = v_org_id;
  if v_txn is null then
    raise exception 'Transaction not found';
  end if;
  if v_txn.status != 'completed' then
    raise exception 'Only completed transactions can be refunded (current status: %)', v_txn.status;
  end if;
  if p_amount <= 0 or p_amount > v_txn.amount then
    raise exception 'Refund amount must be between 0 and %', v_txn.amount;
  end if;

  update transactions
    set status = 'refunded', refunded_amount = p_amount, refund_reason = p_reason, refunded_at = now()
    where id = p_transaction_id
    returning * into v_txn;

  insert into audit_log (org_id, admin_user_id, action, entity_type, entity_id, metadata)
    values (
      v_org_id, auth.uid(), 'transaction_refunded', 'transactions', p_transaction_id,
      jsonb_build_object('amount', p_amount, 'reason', p_reason)
    );

  return v_txn;
end;
$$;

create or replace function compensate_transaction_with_voucher(
  p_transaction_id uuid,
  p_reason         text
)
returns vouchers
language plpgsql
as $$
declare
  v_org_id  uuid := current_org_id();
  v_txn     transactions;
  v_code    text;
  v_voucher vouchers;
begin
  if v_org_id is null then
    raise exception 'Not authorized';
  end if;

  select * into v_txn from transactions where id = p_transaction_id and org_id = v_org_id;
  if v_txn is null then
    raise exception 'Transaction not found';
  end if;
  if v_txn.status != 'completed' then
    raise exception 'Only completed transactions can be compensated (current status: %)', v_txn.status;
  end if;

  loop
    v_code := generate_voucher_code();
    exit when not exists (select 1 from vouchers where code = v_code);
  end loop;

  insert into vouchers (
    org_id, code, plan_id, status, created_by, expires_at,
    compensation_for_transaction_id, compensation_reason
  )
    values (
      v_org_id, v_code, v_txn.plan_id, 'unused', auth.uid(),
      now() + interval '7 days', v_txn.id, p_reason
    )
    returning * into v_voucher;

  insert into notifications (org_id, type, severity, title, body, related_table, related_id)
    values (
      v_org_id, 'voucher_compensation', 'info', 'Compensation voucher issued',
      v_code || coalesce(' - ' || p_reason, ''), 'vouchers', v_voucher.id
    );

  insert into audit_log (org_id, admin_user_id, action, entity_type, entity_id, metadata)
    values (
      v_org_id, auth.uid(), 'voucher_compensation_issued', 'vouchers', v_voucher.id,
      jsonb_build_object('transaction_id', p_transaction_id, 'reason', p_reason)
    );

  return v_voucher;
end;
$$;
