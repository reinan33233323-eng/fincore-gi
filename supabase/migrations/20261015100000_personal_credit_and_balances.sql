begin;
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
commit;
