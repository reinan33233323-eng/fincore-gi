-- Centros de custo classificam lançamentos; contas bancárias são public.banks.
-- Mantém as contas legadas e os lançamentos para preservar todo o histórico.
alter table public.cost_centers disable trigger create_cost_center_account;
