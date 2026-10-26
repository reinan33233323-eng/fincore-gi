-- FinCore Pessoal only. A signed, pending invoice correction is not a payment.
begin;
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
