-- Partial (advance) payments of a credit card invoice.
-- A partial payment leaves the bank on its own date while the invoice stays open.
-- When the invoice is finally paid, its purchases are settled in full and every
-- open partial payment is settled too (settled_bank/settled_date), crediting that
-- amount back to the paying account so the bank is charged only what remained.
begin;
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
commit;
