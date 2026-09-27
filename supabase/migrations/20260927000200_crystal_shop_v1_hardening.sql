-- Boutique Cristaux V1 · compléments issus des advisors Supabase.

create index if not exists user_owned_themes_theme_id_idx
  on public.user_owned_themes(theme_id);
create index if not exists user_owned_themes_product_code_idx
  on public.user_owned_themes(product_code);

drop policy if exists crystal_purchase_receipts_own_read on public.crystal_purchase_receipts;
create policy crystal_purchase_receipts_own_read
  on public.crystal_purchase_receipts for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Pas de GRANT SELECT : les reçus restent internes aux RPC transactionnels.
