begin;
-- Entries currently store the category's natural key (name, kind, unit).
-- Keep it synchronized atomically for ordinary entries, cards and every series.
create or replace function public.sync_personal_category_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.kind, new.unit) is distinct from (old.kind, old.unit) and exists (
    select 1 from public.entries where category=old.name and kind=old.kind and unit=old.unit
  ) then
    raise exception 'Esta categoria possui lançamentos. Mantenha o tipo e o centro de custo ao editar o nome.';
  end if;
  if new.name is distinct from old.name then
    update public.entries set category=new.name
      where category=old.name and kind=old.kind and unit=old.unit;
  end if;
  return new;
end $$;
revoke all on function public.sync_personal_category_name() from public, anon, authenticated;
create trigger personal_category_rename
  after update of name, kind, unit on public.categories
  for each row execute function public.sync_personal_category_name();
commit;
