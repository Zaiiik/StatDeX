begin;

alter table public.leveling_economy_config
  alter column rewarded_ad_reward set default 10;

update public.leveling_economy_config
set rewarded_ad_reward = 10,
    rewarded_ads_daily_limit = 3,
    updated_at = now()
where config_key = 'default';

create or replace function public.claim_rewarded_ad_v1(
  p_claim_id text,
  p_placement text default 'rewarded_crystals',
  p_ads_mode text default 'production',
  p_network_reward_type text default '',
  p_network_reward_amount numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_reward integer;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_claim_id is null
     or char_length(p_claim_id) < 38
     or char_length(p_claim_id) > 128
     or p_claim_id not like v_uid::text || ':%' then
    raise exception 'INVALID_REWARDED_CLAIM';
  end if;
  if p_placement is null or char_length(trim(p_placement)) < 1 or char_length(p_placement) > 80 then
    raise exception 'INVALID_REWARDED_PLACEMENT';
  end if;
  if p_ads_mode not in ('test', 'production') then
    raise exception 'INVALID_ADS_MODE';
  end if;

  perform public.ensure_user_access_v214(v_uid);

  -- Sérialise les demandes d'un même utilisateur : deux callbacks concurrents
  -- ne peuvent ni dépasser 3 récompenses/jour, ni créditer deux fois un claim.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 2141));

  select rewarded_ad_reward
  into v_reward
  from public.leveling_economy_config
  where config_key = 'default';

  if coalesce(v_reward, 0) <> 10 then
    raise exception 'REWARDED_AD_CONFIG_INVALID';
  end if;

  v_result := public.grant_rewarded_ad_crystals_service_v2141(
    v_uid,
    p_claim_id,
    'admob',
    jsonb_build_object(
      'placement', trim(p_placement),
      'ads_mode', p_ads_mode,
      'network_reward_type', left(coalesce(p_network_reward_type, ''), 80),
      'network_reward_amount', greatest(coalesce(p_network_reward_amount, 0), 0)
    )
  );

  return v_result || jsonb_build_object(
    'credited', true,
    'crystals', 10
  );
end;
$function$;

revoke all on function public.claim_rewarded_ad_v1(text, text, text, text, numeric) from public;
revoke all on function public.claim_rewarded_ad_v1(text, text, text, text, numeric) from anon;
grant execute on function public.claim_rewarded_ad_v1(text, text, text, text, numeric) to authenticated;

comment on function public.claim_rewarded_ad_v1(text, text, text, text, numeric)
is 'Idempotent authenticated AdMob rewarded claim: exactly 10 crystals, max 3 UTC day.';

commit;
