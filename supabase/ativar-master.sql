-- Execute depois de criar master@financeiro.com em Authentication > Users.
-- O perfil Master pode criar ambientes, receitas e despesas e administrar usuários.
begin;
do $$
declare target_id uuid;
begin
  select id into strict target_id from auth.users where lower(email) = 'master@financeiro.com';
  update public.profiles set role = 'master', full_name = 'Master', email = 'master@financeiro.com', allowed_units = '{}', hidden_screens = '{}' where id = target_id;
  if not found then raise exception 'Perfil do Master não encontrado'; end if;
end $$;
commit;
