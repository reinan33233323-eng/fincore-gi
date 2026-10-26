-- INSTALAÇÃO EXCLUSIVA EM PROJETO NOVO. Não remove dados.
begin;
do $$ begin
  if to_regclass('public.profiles') is not null or to_regclass('public.entries') is not null or to_regclass('public.cost_centers') is not null or exists (select 1 from auth.users) then
    raise exception 'Use um projeto Supabase novo, sem tabelas FinCore e sem usuários';
  end if;
end $$;

-- 20261005180000_initial_schema.sql
-- Fincore: initial production schema
-- Run this once in Supabase SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Usuário Fincore',
  email text,
  role text not null default 'operador' check (role in ('master', 'operador')),
  allowed_units text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null check (unit in ('Marketing', 'Sítio', 'Consultoria', 'Pessoa Física')),
  created_at timestamptz not null default now(),
  unique (name, unit)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('receita', 'despesa')),
  unit text not null check (unit in ('Marketing', 'Sítio', 'Consultoria', 'Pessoa Física')),
  icon text,
  color text,
  created_at timestamptz not null default now(),
  unique (name, kind, unit)
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  series_id uuid,
  kind text not null check (kind in ('receita', 'despesa')),
  unit text not null check (unit in ('Marketing', 'Sítio', 'Consultoria', 'Pessoa Física')),
  account text not null,
  category text not null,
  description text not null,
  beneficiary text not null default '',
  pix text not null default '',
  amount numeric(14,2) not null check (amount > 0),
  date date not null,
  status text not null default 'previsto' check (status in ('previsto', 'realizado')),
  recurrence text not null default 'nenhuma' check (recurrence in ('nenhuma', 'mensal')),
  installments integer not null default 1 check (installments >= 1),
  installment text,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), 'Usuário Fincore'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_master()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'master') $$;

create or replace function public.can_access_unit(requested_unit text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'master' or requested_unit = any(allowed_units))
  )
$$;

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.entries enable row level security;

drop policy if exists "profile read own" on public.profiles;
create policy "profile read own" on public.profiles for select using (id = auth.uid() or public.is_master());
drop policy if exists "profile update master" on public.profiles;
create policy "profile update master" on public.profiles for update using (public.is_master()) with check (public.is_master());

drop policy if exists "accounts by unit" on public.accounts;
create policy "accounts by unit" on public.accounts for all using (public.can_access_unit(unit)) with check (public.can_access_unit(unit));
drop policy if exists "categories by unit" on public.categories;
create policy "categories by unit" on public.categories for all using (public.can_access_unit(unit)) with check (public.can_access_unit(unit));
drop policy if exists "entries by unit" on public.entries;
create policy "entries by unit" on public.entries for all using (public.can_access_unit(unit)) with check (public.can_access_unit(unit));

create extension if not exists pgcrypto;
create or replace function public.master_reset_user_password(target_user uuid, new_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_master() then raise exception 'Apenas o Master pode redefinir senhas'; end if;
  if length(new_password) < 6 then raise exception 'A senha precisa ter no mínimo 6 caracteres'; end if;
  update auth.users set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')), updated_at = now() where id = target_user;
  if not found then raise exception 'Usuário não encontrado'; end if;
end;
$$;
grant execute on function public.master_reset_user_password(uuid, text) to authenticated;


-- 20261005190000_counterparties.sql
-- Cadastro de fornecedores e clientes por centro de custo.
-- Esta migracao e local ate ser aplicada explicitamente ao Supabase.
create table if not exists public.counterparties (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('despesa', 'receita')),
  unit text not null check (unit in ('Marketing', 'Sítio', 'Consultoria', 'Pessoa Física')),
  name text not null check (length(btrim(name)) > 0),
  provides text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, unit, kind)
);

create unique index if not exists counterparties_name_unit_kind_key
  on public.counterparties (unit, kind, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')));

alter table public.counterparties enable row level security;
drop policy if exists "counterparties by unit" on public.counterparties;
create policy "counterparties by unit" on public.counterparties
  for all using (public.can_access_unit(unit))
  with check (public.can_access_unit(unit));
grant select, insert, update on public.counterparties to authenticated;

alter table public.entries add column if not exists counterparty_id uuid;

-- Names already typed in old launches become reusable records. Case-only
-- duplicates are collapsed within the same type and cost centre.
insert into public.counterparties (kind, unit, name)
select kind, unit, min(btrim(beneficiary))
from public.entries
where length(btrim(beneficiary)) > 0
group by kind, unit, lower(regexp_replace(btrim(beneficiary), '[[:space:]]+', ' ', 'g'))
on conflict do nothing;

update public.entries e
set counterparty_id = c.id
from public.counterparties c
where e.counterparty_id is null
  and e.unit = c.unit
  and e.kind = c.kind
  and lower(regexp_replace(btrim(e.beneficiary), '[[:space:]]+', ' ', 'g'))
    = lower(regexp_replace(btrim(c.name), '[[:space:]]+', ' ', 'g'));

-- A linked contact must belong to the entry's type and cost centre.
alter table public.entries
  add constraint entries_counterparty_unit_kind_fkey
  foreign key (counterparty_id, unit, kind)
  references public.counterparties (id, unit, kind);

-- Older browser builds still send the free-text beneficiary field. Keep them
-- compatible by registering that name automatically on subsequent writes.
create or replace function public.sync_entry_counterparty()
returns trigger language plpgsql security definer set search_path = public as $$
declare linked_name text;
begin
  if tg_op = 'UPDATE' then
    if new.beneficiary is distinct from old.beneficiary
       and new.counterparty_id is not distinct from old.counterparty_id then
      new.counterparty_id := null;
    end if;
  end if;

  if new.counterparty_id is not null then
    select name into linked_name from public.counterparties
    where id = new.counterparty_id and unit = new.unit and kind = new.kind;
    if not found then
      raise exception 'Fornecedor ou cliente não pertence a este centro de custo e tipo';
    end if;
    new.beneficiary := linked_name;
  elsif length(btrim(new.beneficiary)) > 0 then
    insert into public.counterparties (kind, unit, name)
    values (new.kind, new.unit, btrim(new.beneficiary))
    on conflict do nothing;
    select id into new.counterparty_id from public.counterparties
    where unit = new.unit and kind = new.kind
      and lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
        = lower(regexp_replace(btrim(new.beneficiary), '[[:space:]]+', ' ', 'g'));
  end if;
  return new;
end;
$$;

drop trigger if exists sync_entry_counterparty on public.entries;
create trigger sync_entry_counterparty
  before insert or update of beneficiary, counterparty_id, unit, kind
  on public.entries for each row execute function public.sync_entry_counterparty();

create or replace function public.sync_counterparty_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.entries set beneficiary = new.name where counterparty_id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_counterparty_name on public.counterparties;
create trigger sync_counterparty_name
  after update of name on public.counterparties
  for each row when (old.name is distinct from new.name)
  execute function public.sync_counterparty_name();

-- 20261005210000_cost_centers.sql
-- Centros de custo cadastráveis. Cada centro mantém seu plano de categorias.
create table if not exists public.cost_centers (
  name text primary key,
  initials text not null default '',
  created_at timestamptz not null default now(),
  constraint cost_centers_name_check check (
    length(btrim(name)) between 2 and 80
    and name not in ('Todos', '__reports__')
  ),
  constraint cost_centers_initials_check check (length(initials) <= 4)
);

create unique index if not exists cost_centers_name_case_key
  on public.cost_centers (lower(btrim(name)));


-- Preserve any historical centre values before replacing fixed-name checks.
insert into public.cost_centers (name, initials)
select distinct unit, upper(left(unit, 2))
from (
  select unit from public.accounts
  union select unit from public.categories
  union select unit from public.entries
  union select unit from public.counterparties
) historical
on conflict (name) do nothing;

alter table public.accounts drop constraint if exists accounts_unit_check;
alter table public.categories drop constraint if exists categories_unit_check;
alter table public.entries drop constraint if exists entries_unit_check;
alter table public.counterparties drop constraint if exists counterparties_unit_check;

alter table public.accounts
  add constraint accounts_cost_center_fkey foreign key (unit)
  references public.cost_centers (name);
alter table public.categories
  add constraint categories_cost_center_fkey foreign key (unit)
  references public.cost_centers (name);
alter table public.entries
  add constraint entries_cost_center_fkey foreign key (unit)
  references public.cost_centers (name);
alter table public.counterparties
  add constraint counterparties_cost_center_fkey foreign key (unit)
  references public.cost_centers (name);

alter table public.cost_centers enable row level security;
create policy "cost centers visible by permission" on public.cost_centers
  for select using (public.can_access_unit(name));
create policy "cost centers created by master" on public.cost_centers
  for insert with check (public.is_master());
grant select, insert on public.cost_centers to authenticated;

create or replace function public.create_cost_center_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts (name, unit) values (new.name, new.name)
  on conflict (name, unit) do nothing;
  return new;
end;
$$;

create trigger create_cost_center_account
  after insert on public.cost_centers
  for each row execute function public.create_cost_center_account();

insert into public.accounts (name, unit)
select name, name from public.cost_centers
on conflict (name, unit) do nothing;

-- 20261005220000_cost_centers_manage.sql
-- Permite editar (sigla/cor) e excluir centros de custo, com exclusão em cascata.

-- 1. Coluna de cor (guarda a chave da paleta usada no app, ex.: 'indigo').
alter table public.cost_centers
  add column if not exists color text not null default 'indigo';
alter table public.cost_centers
  drop constraint if exists cost_centers_color_check;
alter table public.cost_centers
  add constraint cost_centers_color_check check (length(color) <= 20);

-- Mantém a aparência atual dos centros originais.
update public.cost_centers set color = 'fuchsia' where name = 'Marketing';
update public.cost_centers set color = 'emerald' where name = 'Sítio';
update public.cost_centers set color = 'blue'    where name = 'Consultoria';
update public.cost_centers set color = 'amber'   where name = 'Pessoa Física';

-- 2. Exclusão em cascata: apagar um centro apaga contas, categorias,
--    lançamentos e favorecidos ligados a ele, de forma atômica.
alter table public.accounts drop constraint if exists accounts_cost_center_fkey;
alter table public.accounts
  add constraint accounts_cost_center_fkey foreign key (unit)
  references public.cost_centers (name) on delete cascade;

alter table public.categories drop constraint if exists categories_cost_center_fkey;
alter table public.categories
  add constraint categories_cost_center_fkey foreign key (unit)
  references public.cost_centers (name) on delete cascade;

alter table public.entries drop constraint if exists entries_cost_center_fkey;
alter table public.entries
  add constraint entries_cost_center_fkey foreign key (unit)
  references public.cost_centers (name) on delete cascade;

alter table public.counterparties drop constraint if exists counterparties_cost_center_fkey;
alter table public.counterparties
  add constraint counterparties_cost_center_fkey foreign key (unit)
  references public.cost_centers (name) on delete cascade;

-- 3. Só o Master pode editar e excluir centros.
drop policy if exists "cost centers updated by master" on public.cost_centers;
create policy "cost centers updated by master" on public.cost_centers
  for update using (public.is_master()) with check (public.is_master());

drop policy if exists "cost centers removed by master" on public.cost_centers;
create policy "cost centers removed by master" on public.cost_centers
  for delete using (public.is_master());

grant update, delete on public.cost_centers to authenticated;

-- 20261005230000_entry_attachments.sql
-- Anexos nos lançamentos: cofre de arquivos (storage) + referência nos lançamentos.

-- 1. Campo que guarda os caminhos dos arquivos anexados a cada lançamento.
alter table public.entries
  add column if not exists attachments text[] not null default '{}';

-- 2. Bucket privado para os arquivos (10 MB por arquivo, só PDF/PNG/JPG).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 3. Acesso aos arquivos segue o centro de custo: o caminho é
--    "<centro de custo>/<lançamento>/<arquivo>", e só quem tem acesso
--    àquele centro consegue ler, enviar ou apagar.
drop policy if exists "attachments read by unit" on storage.objects;
create policy "attachments read by unit" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public.can_access_unit((storage.foldername(name))[1]));

drop policy if exists "attachments insert by unit" on storage.objects;
create policy "attachments insert by unit" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.can_access_unit((storage.foldername(name))[1]));

drop policy if exists "attachments delete by unit" on storage.objects;
create policy "attachments delete by unit" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and public.can_access_unit((storage.foldername(name))[1]));

-- 20261005240000_user_screens.sql
-- Controle de abas por usuário: lista de telas que devem ficar ocultas.
-- Vazio (padrão) = o usuário vê todas as abas a que já tem direito.
alter table public.profiles
  add column if not exists hidden_screens text[] not null default '{}';

-- 20261006150000_expense_interest.sql
-- Juros e data de pagamento (baixa) nas despesas, para medir juros pagos
-- e tempo de atraso. Vencimento continua sendo a coluna "date".
alter table public.entries
  add column if not exists juros numeric(14,2) not null default 0 check (juros >= 0);
alter table public.entries
  add column if not exists paid_date date;

-- 20261006160000_attachments_key_fix.sql
-- Correção dos anexos: o caminho não pode mais depender do nome do centro de
-- custo, porque nomes com acento/espaço (ex.: "Pessoa Física", "Sítio") geram
-- "Invalid key" no Storage. As chaves agora usam o ID do lançamento (ASCII).
-- Por isso as regras de acesso passam a valer para qualquer usuário autenticado
-- (o acesso real continua protegido: o caminho tem um ID aleatório, não há
-- permissão de listagem, e o app só expõe anexos de lançamentos visíveis).

drop policy if exists "attachments read by unit" on storage.objects;
drop policy if exists "attachments insert by unit" on storage.objects;
drop policy if exists "attachments delete by unit" on storage.objects;

create policy "attachments read authenticated" on storage.objects
  for select to authenticated using (bucket_id = 'attachments');

create policy "attachments insert authenticated" on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments');

create policy "attachments delete authenticated" on storage.objects
  for delete to authenticated using (bucket_id = 'attachments');

-- 20261006170000_team_notes.sql
-- Notas da equipe: colaboradores que enviam nota fiscal todo mês e as notas
-- recebidas. Acesso restrito ao Master e a quem tem a flag '__team_notes__'.

create or replace function public.can_view_team_notes()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'master' or '__team_notes__' = any(allowed_units))
  )
$$;

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  service text not null default '',
  document text not null default '',
  email text not null default '',
  expected_amount numeric(14,2) check (expected_amount is null or expected_amount >= 0),
  due_day integer not null default 5 check (due_day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.team_invoices (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.team_members (id) on delete cascade,
  competence text not null check (competence ~ '^[0-9]{4}-[0-9]{2}$'),
  invoice_number text not null default '',
  amount numeric(14,2) check (amount is null or amount >= 0),
  issue_date date,
  files text[] not null default '{}',
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (member_id, competence)
);

alter table public.team_members enable row level security;
alter table public.team_invoices enable row level security;

drop policy if exists "team members by permission" on public.team_members;
create policy "team members by permission" on public.team_members
  for all using (public.can_view_team_notes()) with check (public.can_view_team_notes());

drop policy if exists "team invoices by permission" on public.team_invoices;
create policy "team invoices by permission" on public.team_invoices
  for all using (public.can_view_team_notes()) with check (public.can_view_team_notes());

grant select, insert, update, delete on public.team_members to authenticated;
grant select, insert, update, delete on public.team_invoices to authenticated;

-- Cofre privado só para as notas (10 MB, PDF/PNG/JPG).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-notes', 'team-notes', false, 10485760,
        array['image/png', 'image/jpeg', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "team notes files read" on storage.objects;
create policy "team notes files read" on storage.objects
  for select to authenticated
  using (bucket_id = 'team-notes' and public.can_view_team_notes());

drop policy if exists "team notes files insert" on storage.objects;
create policy "team notes files insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'team-notes' and public.can_view_team_notes());

drop policy if exists "team notes files update" on storage.objects;
create policy "team notes files update" on storage.objects
  for update to authenticated
  using (bucket_id = 'team-notes' and public.can_view_team_notes());

drop policy if exists "team notes files delete" on storage.objects;
create policy "team notes files delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'team-notes' and public.can_view_team_notes());

-- 20261006180000_fix_month_overflow_dates.sql
-- Corrige lançamentos de parcelamentos/recorrências que "transbordaram" de mês.
--
-- Bug: ao criar uma série com vencimento no dia 29, 30 ou 31, o cálculo de
-- data usava Date#setMonth e os meses curtos pulavam para o mês seguinte
-- (ex.: 31/07 + 2 meses = 01/10 em vez de 30/09; 30/01 + 1 mês = 02/03).
-- Resultado: um mês ficava sem lançamento e o seguinte ficava com dois.
--
-- Regra (só lançamentos ainda previstos): um lançamento de série no dia 1–3,
-- que não está no primeiro mês da série, divide o mês com outro lançamento da
-- mesma série e cujo mês anterior ficou vazio, volta para o último dia do mês
-- anterior. Séries legítimas com dois pagamentos por mês (adiantamento +
-- salário) não são afetadas, pois têm lançamento em todos os meses.
-- É idempotente: depois de aplicada, nenhuma linha atende mais à regra.

update public.entries e
set date = (date_trunc('month', e.date) - interval '1 day')::date
where e.series_id is not null
  and e.status = 'previsto'
  and extract(day from e.date) <= 3
  and date_trunc('month', e.date) > (
    select date_trunc('month', min(f.date))
    from public.entries f
    where f.series_id = e.series_id
  )
  and exists (
    select 1 from public.entries o
    where o.series_id = e.series_id
      and o.id <> e.id
      and date_trunc('month', o.date) = date_trunc('month', e.date)
  )
  and not exists (
    select 1 from public.entries p
    where p.series_id = e.series_id
      and date_trunc('month', p.date) = date_trunc('month', e.date) - interval '1 month'
  );

-- 20261006190000_banks_and_discount.sql
-- Bancos (qual banco pagou cada despesa) e desconto no pagamento.

create table if not exists public.banks (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  created_at timestamptz not null default now()
);

create unique index if not exists banks_name_key on public.banks (lower(btrim(name)));

alter table public.banks enable row level security;

-- Todos os usuários logados podem escolher o banco; só o Master cadastra/edita.
drop policy if exists "banks readable" on public.banks;
create policy "banks readable" on public.banks
  for select to authenticated using (true);

drop policy if exists "banks managed by master" on public.banks;
create policy "banks managed by master" on public.banks
  for all to authenticated using (public.is_master()) with check (public.is_master());

grant select, insert, update, delete on public.banks to authenticated;

-- Excluir um banco não apaga despesas: elas só ficam sem banco.
alter table public.entries
  add column if not exists bank_id uuid references public.banks (id) on delete set null;

-- Desconto quando o valor pago é menor que o valor da conta.
alter table public.entries
  add column if not exists discount numeric(14,2) not null default 0 check (discount >= 0);

-- 20261006200000_team_categories.sql
-- Categorias de colaboradores (ex.: Marketing, Analista de Sistemas, Financeiro,
-- Comercial) na aba Notas da equipe. Mesmo acesso das notas.

create table if not exists public.team_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  created_at timestamptz not null default now()
);

create unique index if not exists team_categories_name_key
  on public.team_categories (lower(btrim(name)));

alter table public.team_categories enable row level security;

drop policy if exists "team categories by permission" on public.team_categories;
create policy "team categories by permission" on public.team_categories
  for all using (public.can_view_team_notes()) with check (public.can_view_team_notes());

grant select, insert, update, delete on public.team_categories to authenticated;

-- Excluir uma categoria não apaga colaboradores: eles só ficam sem categoria.
alter table public.team_members
  add column if not exists category_id uuid references public.team_categories (id) on delete set null;

-- 20261006210000_team_invoice_reference_month.sql
-- Notas da equipe: separa o "mês de controle" (em que mês a nota aparece e
-- conta como enviada) da "competência" (mês do serviço, só informativo).
-- Ex.: nota recebida em março com competência fevereiro fica em março.

alter table public.team_invoices
  add column if not exists reference_month text;

-- Notas existentes continuam no mesmo mês em que já apareciam.
update public.team_invoices
set reference_month = competence
where reference_month is null;

-- Pedido do usuário: a nota de março da Carolina Avellar (competência
-- fevereiro, nº 2) deve ficar no controle de março.
update public.team_invoices i
set reference_month = '2026-03'
from public.team_members m
where m.id = i.member_id
  and m.name ilike 'carolina avellar%'
  and i.competence = '2026-02'
  and i.invoice_number = '2';

alter table public.team_invoices
  alter column reference_month set not null;

alter table public.team_invoices
  drop constraint if exists team_invoices_reference_month_check;
alter table public.team_invoices
  add constraint team_invoices_reference_month_check
  check (reference_month ~ '^[0-9]{4}-[0-9]{2}$');

-- Uma nota por colaborador por mês de controle (antes era por competência).
alter table public.team_invoices
  drop constraint if exists team_invoices_member_id_competence_key;
create unique index if not exists team_invoices_member_reference_key
  on public.team_invoices (member_id, reference_month);

-- 20261006220000_team_member_inactive_from.sql
-- Notas da equipe: inativar um colaborador a partir de um mês (YYYY-MM).
-- Desse mês em diante ele deixa de ser cobrado; as notas antigas continuam.
alter table public.team_members
  add column if not exists inactive_from text;

alter table public.team_members
  drop constraint if exists team_members_inactive_from_check;
alter table public.team_members
  add constraint team_members_inactive_from_check
  check (inactive_from is null or inactive_from ~ '^[0-9]{4}-[0-9]{2}$');

-- 20261007100000_receitas_master_only.sql
-- Receitas e clientes/pagadores são exclusivos do Master.
-- Os demais usuários continuam limitados aos seus centros de custo e, dentro
-- deles, só podem ver, criar, editar e excluir DESPESAS e FORNECEDORES.
-- Regra aplicada no banco: vale mesmo para acessos fora da interface.

drop policy if exists "entries by unit" on public.entries;
create policy "entries by unit" on public.entries
  for all
  using (public.can_access_unit(unit) and (kind = 'despesa' or public.is_master()))
  with check (public.can_access_unit(unit) and (kind = 'despesa' or public.is_master()));

drop policy if exists "counterparties by unit" on public.counterparties;
create policy "counterparties by unit" on public.counterparties
  for all
  using (public.can_access_unit(unit) and (kind = 'despesa' or public.is_master()))
  with check (public.can_access_unit(unit) and (kind = 'despesa' or public.is_master()));

-- Criação delegada de planos / centros
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

-- Contas bancárias separadas de centros de custo
-- Centros de custo classificam lançamentos; contas bancárias são public.banks.
-- Mantém as contas legadas e os lançamentos para preservar todo o histórico.
alter table public.cost_centers disable trigger create_cost_center_account;


-- 20261015100000_personal_credit_and_balances.sql

create table if not exists public.credit_cards (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(btrim(name)) between 2 and 80),
 closing_day integer not null check(closing_day between 1 and 31),
 due_day integer not null check(due_day between 1 and 31),
 created_at timestamptz not null default now()
);
alter table public.credit_cards enable row level security;
create policy "personal cards master" on public.credit_cards for all to authenticated using(public.is_master()) with check(public.is_master());
grant select,insert,update,delete on public.credit_cards to authenticated;
alter table public.entries add column if not exists credit_card_id uuid references public.credit_cards(id) on delete restrict;
alter table public.entries add column if not exists invoice_month text check(invoice_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
create index if not exists entries_credit_invoice on public.entries(credit_card_id,invoice_month,status);
create table if not exists public.bank_balance_adjustments (
 id uuid primary key default gen_random_uuid(),
 bank_id uuid not null references public.banks(id) on delete restrict,
 amount numeric(14,2) not null check(amount <> 0),
 date date not null,
 notes text not null default '',
 created_at timestamptz not null default now()
);
alter table public.bank_balance_adjustments enable row level security;
create policy "personal adjustments master read" on public.bank_balance_adjustments for select to authenticated using(public.is_master());
grant select on public.bank_balance_adjustments to authenticated;
create or replace function public.set_personal_bank_balance(target_bank uuid, desired_balance numeric, effective_date date)
returns void language plpgsql security definer set search_path=public as $$
declare old_balance numeric;
begin
 if not public.is_master() then raise exception 'Acesso restrito ao Master'; end if;
 if desired_balance is null or abs(desired_balance) > 99999999999 or effective_date is null or effective_date > current_date then raise exception 'Saldo ou data inválidos'; end if;
 perform 1 from public.banks where id=target_bank for update;
 if not found then raise exception 'Conta não encontrada'; end if;
 select coalesce(sum(case when kind='receita' then amount else -(amount+coalesce(juros,0)-coalesce(discount,0)) end),0) into old_balance
 from public.entries where bank_id=target_bank and status='realizado' and coalesce(paid_date,date)<=effective_date;
 select old_balance+coalesce(sum(amount),0) into old_balance from public.bank_balance_adjustments where bank_id=target_bank and date<=effective_date;
 if round(desired_balance-old_balance,2)<>0 then
 insert into public.bank_balance_adjustments(bank_id,amount,date,notes) values(target_bank,round(desired_balance-old_balance,2),effective_date,'Saldo informado pelo Master');
 end if;
end $$;
create or replace function public.pay_personal_card_invoice(target_card uuid, target_month text, target_bank uuid, payment_date date)
returns setof public.entries language plpgsql security definer set search_path=public as $$
begin
 if not public.is_master() then raise exception 'Acesso restrito ao Master'; end if;
 if payment_date is null or payment_date>current_date then raise exception 'Informe a data de um pagamento já realizado'; end if;
 perform 1 from public.credit_cards where id=target_card for update;
 if not found then raise exception 'Cartão não encontrado'; end if;
 perform 1 from public.banks where id=target_bank for update;
 if not found then raise exception 'Conta bancária não encontrada'; end if;
 return query update public.entries set status='realizado',bank_id=target_bank,paid_date=payment_date
 where credit_card_id=target_card and invoice_month=target_month and status='previsto' returning *;
end $$;
revoke all on function public.set_personal_bank_balance(uuid,numeric,date) from public,anon;
revoke all on function public.pay_personal_card_invoice(uuid,text,uuid,date) from public,anon;
grant execute on function public.set_personal_bank_balance(uuid,numeric,date) to authenticated;
grant execute on function public.pay_personal_card_invoice(uuid,text,uuid,date) to authenticated;


-- 20261015123000_personal_weekly_recurrence.sql

alter table public.entries drop constraint if exists entries_recurrence_check;
alter table public.entries add constraint entries_recurrence_check check(recurrence in ('nenhuma','mensal','semanal'));


-- 20261015140000_card_purchase_details.sql

alter table public.entries add column if not exists purchase_date date;
alter table public.entries add column if not exists card_installment_offset integer not null default 0 check(card_installment_offset>=0);
-- Preserve existing purchases and their payment history.
update public.entries set purchase_date=coalesce((regexp_match(notes,'Compra em ([0-9]{4}-[0-9]{2}-[0-9]{2})'))[1]::date,date),
 card_installment_offset=case when installment ~ '^[0-9]+/[0-9]+$' then greatest(split_part(installment,'/',1)::integer-1,0) else 0 end
 where credit_card_id is not null and purchase_date is null;
create or replace function public.cancel_personal_card_series(target_series uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_master() then raise exception 'Acesso restrito ao Master'; end if;
 perform 1 from public.credit_cards where id in (select credit_card_id from public.entries where series_id=target_series) order by id for update;
 update public.entries set recurrence='nenhuma' where series_id=target_series and credit_card_id is not null;
 delete from public.entries where series_id=target_series and credit_card_id is not null and status='previsto';
end $$;
revoke all on function public.cancel_personal_card_series(uuid) from public,anon;
grant execute on function public.cancel_personal_card_series(uuid) to authenticated;
create or replace function public.save_personal_card_purchases(purchases jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare item jsonb; card uuid;
begin
 if not public.is_master() then raise exception 'Acesso restrito ao Master'; end if;
 if jsonb_typeof(purchases)<>'array' or jsonb_array_length(purchases)=0 then raise exception 'Nenhum lançamento informado'; end if;
 for card in select distinct (value->>'credit_card_id')::uuid from jsonb_array_elements(purchases) order by 1 loop
  perform 1 from public.credit_cards where id=card for update;
  if not found then raise exception 'Cartão não encontrado'; end if;
 end loop;
 for item in select value from jsonb_array_elements(purchases) loop
  if exists(select 1 from public.entries where id=(item->>'id')::uuid and (status='realizado' or credit_card_id is distinct from (item->>'credit_card_id')::uuid)) then
   raise exception 'Lançamento já pago ou pertencente a outra operação. Atualize os dados.';
  end if;
 end loop;
 insert into public.entries(id,series_id,kind,unit,account,category,description,beneficiary,counterparty_id,pix,amount,date,status,recurrence,installments,installment,notes,attachments,juros,discount,bank_id,paid_date,credit_card_id,invoice_month,purchase_date,card_installment_offset)
 select (r->>'id')::uuid,(r->>'series_id')::uuid,'despesa',r->>'unit',coalesce(r->>'account',''),r->>'category',r->>'description',coalesce(r->>'beneficiary',''),(r->>'counterparty_id')::uuid,coalesce(r->>'pix',''),(r->>'amount')::numeric,(r->>'date')::date,'previsto',coalesce(r->>'recurrence','nenhuma'),1,r->>'installment',coalesce(r->>'notes',''),coalesce(array(select jsonb_array_elements_text(r->'attachments')),'{}'::text[]),0,0,null,null,(r->>'credit_card_id')::uuid,r->>'invoice_month',(r->>'purchase_date')::date,coalesce((r->>'card_installment_offset')::integer,0)
 from jsonb_array_elements(purchases) r
 on conflict(id) do update set unit=excluded.unit,account=excluded.account,category=excluded.category,description=excluded.description,beneficiary=excluded.beneficiary,counterparty_id=excluded.counterparty_id,pix=excluded.pix,amount=excluded.amount,date=excluded.date,recurrence=excluded.recurrence,installment=excluded.installment,notes=excluded.notes,attachments=excluded.attachments,invoice_month=excluded.invoice_month,purchase_date=excluded.purchase_date,card_installment_offset=excluded.card_installment_offset;
end $$;
revoke all on function public.save_personal_card_purchases(jsonb) from public,anon;
grant execute on function public.save_personal_card_purchases(jsonb) to authenticated;
create or replace function public.delete_personal_card_purchase(target_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_master() then raise exception 'Acesso restrito ao Master'; end if;
 perform 1 from public.credit_cards where id=(select credit_card_id from public.entries where id=target_id) for update;
 if exists(select 1 from public.entries where id=target_id and status='realizado') then raise exception 'Compra já paga. Atualize a fatura.'; end if;
 delete from public.entries where id=target_id and credit_card_id is not null and status='previsto';
end $$;
revoke all on function public.delete_personal_card_purchase(uuid) from public,anon;
grant execute on function public.delete_personal_card_purchase(uuid) to authenticated;


-- 20261017160000_preserve_category_on_rename.sql

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


-- 20261022120000_card_partial_payments.sql
-- Partial (advance) payments of a credit card invoice.
-- A partial payment leaves the bank on its own date while the invoice stays open.
-- When the invoice is finally paid, its purchases are settled in full and every
-- open partial payment is settled too (settled_bank/settled_date), crediting that
-- amount back to the paying account so the bank is charged only what remained.

create table if not exists public.card_invoice_payments (
 id uuid primary key default gen_random_uuid(),
 card_id uuid not null references public.credit_cards(id) on delete restrict,
 invoice_month text not null check(invoice_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 bank_id uuid not null references public.banks(id) on delete restrict,
 amount numeric(14,2) not null check(amount > 0),
 paid_date date not null,
 settled_bank uuid references public.banks(id) on delete restrict,
 settled_date date,
 notes text not null default '',
 created_at timestamptz not null default now()
);
create index if not exists card_invoice_payments_invoice on public.card_invoice_payments(card_id,invoice_month);
alter table public.card_invoice_payments enable row level security;
create policy "personal card payments master read" on public.card_invoice_payments for select to authenticated using(public.is_master());
grant select on public.card_invoice_payments to authenticated;

create or replace function public.add_personal_card_partial_payment(target_card uuid, target_month text, target_bank uuid, payment_amount numeric, payment_date date)
returns public.card_invoice_payments language plpgsql security definer set search_path=public as $$
declare open_amount numeric; result public.card_invoice_payments;
begin
 if not public.is_master() then raise exception 'Acesso restrito ao Master'; end if;
 if payment_date is null or payment_date>current_date then raise exception 'Informe a data de um pagamento já realizado'; end if;
 if payment_amount is null or payment_amount<=0 then raise exception 'Informe um valor maior que zero'; end if;
 perform 1 from public.credit_cards where id=target_card for update;
 if not found then raise exception 'Cartão não encontrado'; end if;
 perform 1 from public.banks where id=target_bank;
 if not found then raise exception 'Conta bancária não encontrada'; end if;
 select coalesce(sum(amount),0) into open_amount from public.entries
  where credit_card_id=target_card and invoice_month=target_month and status='previsto';
 select open_amount-coalesce(sum(amount),0) into open_amount from public.card_invoice_payments
  where card_id=target_card and invoice_month=target_month and settled_date is null;
 if round(payment_amount,2)>round(open_amount,2) then raise exception 'O valor é maior que o saldo em aberto da fatura (%)', round(open_amount,2); end if;
 insert into public.card_invoice_payments(card_id,invoice_month,bank_id,amount,paid_date,notes)
 values(target_card,target_month,target_bank,round(payment_amount,2),payment_date,'Pagamento parcial da fatura') returning * into result;
 return result;
end $$;

create or replace function public.delete_personal_card_partial_payment(target_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_master() then raise exception 'Acesso restrito ao Master'; end if;
 delete from public.card_invoice_payments where id=target_id and settled_date is null;
 if not found then raise exception 'Pagamento não encontrado ou fatura já quitada'; end if;
end $$;

create or replace function public.pay_personal_card_invoice(target_card uuid, target_month text, target_bank uuid, payment_date date)
returns setof public.entries language plpgsql security definer set search_path=public as $$
begin
 if not public.is_master() then raise exception 'Acesso restrito ao Master'; end if;
 if payment_date is null or payment_date>current_date then raise exception 'Informe a data de um pagamento já realizado'; end if;
 perform 1 from public.credit_cards where id=target_card for update;
 if not found then raise exception 'Cartão não encontrado'; end if;
 perform 1 from public.banks where id=target_bank for update;
 if not found then raise exception 'Conta bancária não encontrada'; end if;
 update public.card_invoice_payments set settled_bank=target_bank,settled_date=payment_date
 where card_id=target_card and invoice_month=target_month and settled_date is null;
 return query update public.entries set status='realizado',bank_id=target_bank,paid_date=payment_date
 where credit_card_id=target_card and invoice_month=target_month and status='previsto' returning *;
end $$;

-- The balance editor must see partial payments, or it would record a wrong difference.
create or replace function public.set_personal_bank_balance(target_bank uuid, desired_balance numeric, effective_date date)
returns void language plpgsql security definer set search_path=public as $$
declare old_balance numeric;
begin
 if not public.is_master() then raise exception 'Acesso restrito ao Master'; end if;
 if desired_balance is null or abs(desired_balance) > 99999999999 or effective_date is null or effective_date > current_date then raise exception 'Saldo ou data inválidos'; end if;
 perform 1 from public.banks where id=target_bank for update;
 if not found then raise exception 'Conta não encontrada'; end if;
 select coalesce(sum(case when kind='receita' then amount else -(amount+coalesce(juros,0)-coalesce(discount,0)) end),0) into old_balance
 from public.entries where bank_id=target_bank and status='realizado' and coalesce(paid_date,date)<=effective_date;
 select old_balance+coalesce(sum(amount),0) into old_balance from public.bank_balance_adjustments where bank_id=target_bank and date<=effective_date;
 select old_balance-coalesce(sum(amount),0) into old_balance from public.card_invoice_payments where bank_id=target_bank and paid_date<=effective_date;
 select old_balance+coalesce(sum(amount),0) into old_balance from public.card_invoice_payments where settled_bank=target_bank and settled_date<=effective_date;
 if round(desired_balance-old_balance,2)<>0 then
 insert into public.bank_balance_adjustments(bank_id,amount,date,notes) values(target_bank,round(desired_balance-old_balance,2),effective_date,'Saldo informado pelo Master');
 end if;
end $$;

revoke all on function public.add_personal_card_partial_payment(uuid,text,uuid,numeric,date) from public,anon;
revoke all on function public.delete_personal_card_partial_payment(uuid) from public,anon;
grant execute on function public.add_personal_card_partial_payment(uuid,text,uuid,numeric,date) to authenticated;
grant execute on function public.delete_personal_card_partial_payment(uuid) to authenticated;


-- 20261026210000_personal_invoice_adjustments.sql
-- FinCore Pessoal only. A signed, pending invoice correction is not a payment.

alter table public.entries add column if not exists invoice_adjustment boolean not null default false;
alter table public.entries drop constraint if exists entries_amount_check;
alter table public.entries add constraint entries_amount_check check (
 (not invoice_adjustment and amount > 0) or
 (invoice_adjustment and amount <> 0 and kind='despesa' and credit_card_id is not null and invoice_month is not null and recurrence='nenhuma' and series_id is null)
);
create policy "invoice adjustments master only" on public.entries as restrictive
 for all to authenticated using (not invoice_adjustment or public.is_master())
 with check (not invoice_adjustment or public.is_master());
create or replace function public.adjust_personal_card_invoice(
 target_card uuid, target_month text, desired_balance numeric, expected_balance numeric, adjustment_notes text default ''
) returns uuid language plpgsql security definer set search_path=public as $$
declare current_balance numeric; difference numeric; target_unit text; due_date date; result uuid; card public.credit_cards;
begin
 if not public.is_master() then raise exception 'Acesso restrito ao Master'; end if;
 if target_month is null or target_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mês da fatura inválido'; end if;
 if desired_balance is null or desired_balance::text in ('NaN','Infinity','-Infinity') or desired_balance<0 or desired_balance>99999999999 then raise exception 'Saldo em aberto inválido'; end if;
 select * into card from public.credit_cards where id=target_card for update;
 if not found then raise exception 'Cartão não encontrado'; end if;
 select coalesce(sum(amount),0) into current_balance from public.entries
 where credit_card_id=target_card and invoice_month=target_month and status='previsto';
 select current_balance-coalesce(sum(amount),0) into current_balance from public.card_invoice_payments
 where card_id=target_card and invoice_month=target_month and settled_date is null;
 if expected_balance is null or round(current_balance,2)<>round(expected_balance,2) then
  raise exception 'A fatura mudou enquanto o ajuste estava aberto. Atualize a página e confira o saldo novamente.';
 end if;
 difference=round(desired_balance,2)-round(current_balance,2);
 if difference=0 then return null; end if;
 select unit into target_unit from public.entries where credit_card_id=target_card and invoice_month=target_month order by created_at limit 1;
 if target_unit is null then select name into target_unit from public.cost_centers order by name limit 1; end if;
 if target_unit is null then raise exception 'Cadastre um centro de custo antes de ajustar a fatura'; end if;
 due_date=make_date(substring(target_month,1,4)::int,substring(target_month,6,2)::int,
 least(card.due_day,extract(day from (target_month||'-01')::date+interval '1 month - 1 day')::int));
 insert into public.entries(kind,unit,account,category,description,amount,date,status,recurrence,installments,notes,credit_card_id,invoice_month,invoice_adjustment,bank_id,paid_date)
 values('despesa',target_unit,'Ajuste de fatura','Ajuste de fatura','Ajuste manual de fatura',difference,due_date,'previsto','nenhuma',1,
 format('Saldo em aberto de %s para %s. %s',round(current_balance,2),round(desired_balance,2),left(coalesce(adjustment_notes,''),500)),target_card,target_month,true,null,null)
 returning id into result;
 return result;
end $$;
revoke all on function public.adjust_personal_card_invoice(uuid,text,numeric,numeric,text) from public,anon;
grant execute on function public.adjust_personal_card_invoice(uuid,text,numeric,numeric,text) to authenticated;


commit;
