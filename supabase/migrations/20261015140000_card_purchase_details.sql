begin;
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
commit;
