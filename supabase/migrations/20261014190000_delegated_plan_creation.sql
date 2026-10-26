-- Permissão delegada para criar planos / centros, sem promover a Master.
create or replace function public.can_create_cost_centers()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'master' or '__create_plans__' = any(allowed_units))
  );
$$;
revoke all on function public.can_create_cost_centers() from public, anon;
grant execute on function public.can_create_cost_centers() to authenticated;

create or replace function public.create_managed_cost_center(
  requested_name text, requested_initials text, requested_color text
)
returns setof public.cost_centers
language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not public.can_create_cost_centers() then
    raise exception 'Sem permissão para criar planos de contas e centros de custo' using errcode = '42501';
  end if;
  if btrim(requested_name) in ('Todos', '__reports__', '__team_notes__', '__create_plans__') then
    raise exception 'Nome reservado para o sistema' using errcode = '22023';
  end if;
  -- O trigger existente cria automaticamente a conta do novo centro.
  insert into public.cost_centers (name, initials, color)
    values (btrim(requested_name), btrim(requested_initials), requested_color);
  -- O operador recebe acesso apenas ao centro que acabou de criar.
  update public.profiles
    set allowed_units = array_append(allowed_units, btrim(requested_name))
    where id = actor and role <> 'master'
      and not (btrim(requested_name) = any(allowed_units));
  return query select * from public.cost_centers where name = btrim(requested_name);
end;
$$;
revoke all on function public.create_managed_cost_center(text, text, text) from public, anon;
grant execute on function public.create_managed_cost_center(text, text, text) to authenticated;
