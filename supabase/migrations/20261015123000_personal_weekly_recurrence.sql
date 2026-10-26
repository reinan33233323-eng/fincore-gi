begin;
alter table public.entries drop constraint if exists entries_recurrence_check;
alter table public.entries add constraint entries_recurrence_check check(recurrence in ('nenhuma','mensal','semanal'));
commit;
