-- Google Play Billing server-side ledger and account deletion support.
-- No product identifier is seeded here: Play Console remains the source of
-- truth and the owner must explicitly map each product after creating it.

create table if not exists public.google_play_products (
  product_id text primary key,
  product_type text not null check (product_type in ('subscription', 'one_time', 'consumable')),
  entitlement_kind text not null check (entitlement_kind in ('subscription', 'lifetime', 'crystals')),
  plan_code text references public.subscription_plans(code),
  base_plan_id text,
  offer_id text,
  crystal_amount integer not null default 0 check (crystal_amount >= 0),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_play_products_mapping_check check (
    (product_type = 'subscription' and entitlement_kind = 'subscription' and plan_code is not null and base_plan_id is not null and crystal_amount = 0)
    or (product_type = 'one_time' and entitlement_kind = 'lifetime' and plan_code is not null and crystal_amount = 0)
    or (product_type = 'consumable' and entitlement_kind = 'crystals' and plan_code is null and crystal_amount > 0)
  )
);

create table if not exists public.google_play_purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  product_id text not null references public.google_play_products(product_id),
  purchase_token_hash text not null,
  provider_order_id text,
  purchase_type text not null check (purchase_type in ('subscription', 'one_time', 'consumable')),
  entitlement_kind text not null check (entitlement_kind in ('subscription', 'lifetime', 'crystals')),
  purchase_state text not null,
  entitlement_status text not null,
  acknowledged boolean not null default false,
  consumed boolean not null default false,
  purchased_at timestamptz,
  expires_at timestamptz,
  verified_payload jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_token_hash, product_id)
);

create index if not exists google_play_receipts_user_idx
  on public.google_play_purchase_receipts(user_id);
create index if not exists google_play_receipts_product_idx
  on public.google_play_purchase_receipts(product_id);
create unique index if not exists user_subscriptions_google_play_token_uidx
  on public.user_subscriptions(provider, provider_subscription_id)
  where provider = 'google_play' and provider_subscription_id is not null;
create unique index if not exists crystal_transactions_google_play_ref_uidx
  on public.crystal_transactions(external_ref)
  where external_ref like 'google-play:%';

create table if not exists public.google_play_rtdn_events (
  message_id text primary key,
  notification_type text not null,
  product_id text,
  purchase_token_hash text,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.google_play_products enable row level security;
alter table public.google_play_purchase_receipts enable row level security;
alter table public.google_play_rtdn_events enable row level security;

revoke all on table public.google_play_products from public, anon, authenticated;
revoke all on table public.google_play_purchase_receipts from public, anon, authenticated;
revoke all on table public.google_play_rtdn_events from public, anon, authenticated;
grant all on table public.google_play_products to service_role;
grant all on table public.google_play_purchase_receipts to service_role;
grant all on table public.google_play_rtdn_events to service_role;

create or replace function public.revoke_google_play_crystals_service(
  p_user_id uuid,
  p_amount integer,
  p_external_ref text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_balance integer;
  v_deduction integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_user_id is null or p_amount is null or p_amount <= 0 or p_external_ref is null then
    raise exception 'INVALID_REVOCATION';
  end if;

  perform public.ensure_user_access_v214(p_user_id);
  if exists(select 1 from public.crystal_transactions where external_ref = p_external_ref) then
    select balance into v_balance from public.user_crystal_wallets where user_id = p_user_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'balance', coalesce(v_balance, 0));
  end if;

  select least(balance, p_amount)
    into v_deduction
    from public.user_crystal_wallets
    where user_id = p_user_id
    for update;

  update public.user_crystal_wallets
    set balance = balance - coalesce(v_deduction, 0),
        updated_at = now()
    where user_id = p_user_id
    returning balance into v_balance;

  insert into public.crystal_transactions(user_id, amount, reason, external_ref, metadata)
  values(
    p_user_id,
    -coalesce(v_deduction, 0),
    'google_play_refund',
    p_external_ref,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'deducted', coalesce(v_deduction, 0),
    'balance', coalesce(v_balance, 0)
  );
end;
$function$;

revoke all on function public.revoke_google_play_crystals_service(uuid, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.revoke_google_play_crystals_service(uuid, integer, text, jsonb) to service_role;

create or replace function public.delete_leveling_user_data_service(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_team record;
  v_new_owner uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  -- Preserve teams owned with other members by transferring ownership. A team
  -- with no remaining member is removed through its existing cascade rules.
  for v_team in
    select t.id
    from public.teams t
    where t.owner_id = p_user_id
    for update
  loop
    select tm.user_id
      into v_new_owner
      from public.team_members tm
      where tm.team_id = v_team.id
        and tm.user_id <> p_user_id
      order by tm.joined_at asc
      limit 1;

    if v_new_owner is null then
      delete from public.teams where id = v_team.id;
    else
      update public.teams set owner_id = v_new_owner where id = v_team.id;
    end if;
  end loop;

  update public.admin_broadcasts
    set target_user_id = null
    where target_user_id = p_user_id;
  update public.admin_broadcasts
    set created_by = null
    where created_by = p_user_id;

  delete from public.direct_messages where sender_id = p_user_id or recipient_id = p_user_id;
  delete from public.friendships where requester_id = p_user_id or addressee_id = p_user_id;
  delete from public.team_invites where inviter_id = p_user_id or invitee_id = p_user_id;
  delete from public.team_messages where user_id = p_user_id;
  delete from public.team_members where user_id = p_user_id;
  delete from public.activity_feed where user_id = p_user_id;
  delete from public.social_progress_snapshots where user_id = p_user_id;
  delete from public.social_profiles where user_id = p_user_id;

  delete from public.user_referrals where referrer_user_id = p_user_id or referred_user_id = p_user_id;
  delete from public.user_referral_codes where user_id = p_user_id;
  delete from public.rewarded_ad_events where user_id = p_user_id;
  delete from public.crystal_purchase_receipts where user_id = p_user_id;
  delete from public.crystal_transactions where user_id = p_user_id;
  delete from public.user_owned_themes where user_id = p_user_id;
  delete from public.user_crystal_wallets where user_id = p_user_id;
  delete from public.user_access_entitlements where user_id = p_user_id;

  delete from public.push_subscriptions where user_id = p_user_id;
  delete from public.notification_preferences where user_id = p_user_id;
  delete from public.app_ideas where user_id = p_user_id;
  delete from public.admin_users where user_id = p_user_id;
  delete from public.user_subscriptions where user_id = p_user_id;
  delete from public.test_user_subscriptions where user_id = p_user_id;

  -- Financial and anti-fraud records may need limited retention. Remove their
  -- account link and discard the provider payload while keeping event identity.
  update public.payment_events
    set user_id = null,
        payload = jsonb_build_object(
          'retained_for', 'financial_and_fraud_record',
          'provider', provider,
          'event_type', event_type
        )
    where user_id = p_user_id;
  update public.test_payment_events
    set user_id = null,
        payload = jsonb_build_object(
          'retained_for', 'test_payment_record',
          'event_type', event_type
        )
    where user_id = p_user_id;
  update public.google_play_purchase_receipts
    set user_id = null,
        verified_payload = jsonb_build_object(
          'retained_for', 'financial_and_fraud_record',
          'product_id', product_id,
          'entitlement_status', entitlement_status
        ),
        updated_at = now()
    where user_id = p_user_id;

  delete from public.licenses where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;
  delete from public.user_profiles where id = p_user_id;

  return jsonb_build_object('ok', true, 'user_id', p_user_id);
end;
$function$;

revoke all on function public.delete_leveling_user_data_service(uuid) from public, anon, authenticated;
grant execute on function public.delete_leveling_user_data_service(uuid) to service_role;

comment on function public.delete_leveling_user_data_service(uuid) is
  'Deletes LEVELING-APP application data for an authenticated deletion request. Auth identity is deleted separately and last by the Edge Function.';
