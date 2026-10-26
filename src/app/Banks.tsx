import { FormEvent, useState } from "react";
import { Plus } from "lucide-react";
import { Bank, deleteBank, saveBank, setBankBalance } from "../lib/bridge";
import { summarizeBank, cashDate, localDateKey, type FinancialEntry } from "../lib/finance";
import { Money, fmt, spot } from "./shared";
import BankLogo, { BankPicker } from "./BankLogo";

const normalize = (name: string) => name.trim().replace(/\s+/g, " ");
const sameName = (a: string, b: string) =>
  normalize(a).toLocaleLowerCase("pt-BR") === normalize(b).toLocaleLowerCase("pt-BR");
const sortBanks = (list: Bank[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

/** Cadastro de bancos (aba Contas). Todos veem; só o Master cadastra/edita. */
export default function BanksSection({
  banks,
  ready,
  canManage,
  entries,
  setBanks,
  onRefresh,
}: {
  onRefresh: () => Promise<void>;
  banks: Bank[];
  ready: boolean;
  canManage: boolean;
  entries: FinancialEntry[];
  setBanks: (update: (old: Bank[]) => Bank[]) => void;
}) {
  const today = localDateKey(new Date());
  const [balanceId,setBalanceId] = useState<string|null>(null);
  const [balance,setBalance] = useState('');
  const [balanceDate,setBalanceDate] = useState(today);
  const adjust = async () => {
    if(!balanceId || !balanceDate || !Number.isFinite(Number(balance)) || balance.trim()==='') {setError('Informe saldo e data válidos.');return;}
    setBusy(true);setError('');
    try { await setBankBalance(balanceId,Number(balance),balanceDate); await onRefresh(); setBalanceId(null); }
    catch(e) {setError(e instanceof Error?e.message:'Não foi possível ajustar o saldo.');}
    finally {setBusy(false);}
  };
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const validate = (value: string, ignoreId?: string) => {
    const clean = normalize(value);
    if (clean.length < 2 || clean.length > 80) return "Informe um nome entre 2 e 80 caracteres.";
    if (banks.some((bank) => bank.id !== ignoreId && sameName(bank.name, clean)))
      return "Já existe uma conta bancária com esse nome.";
    return "";
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validate(name);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await saveBank({ id: crypto.randomUUID(), name: normalize(name) });
      setBanks((old) => sortBanks([...old, saved]));
      setName("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível cadastrar a conta bancária.");
    } finally {
      setBusy(false);
    }
  };

  const rename = async (bank: Bank) => {
    const problem = validate(editName, bank.id);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await saveBank({ id: bank.id, name: normalize(editName) });
      setBanks((old) => sortBanks(old.map((item) => (item.id === bank.id ? saved : item))));
      setEditingId(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível renomear a conta bancária.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (bank: Bank) => {
    const count = entries.filter(entry => entry.bankId === bank.id).length;
    const warning = count
      ? `\n\n${count} lançamento(s) estão vinculados a esta conta e ficarão sem conta bancária (nada é apagado).`
      : "";
    if (!window.confirm(`Excluir a conta bancária "${bank.name}"?${warning}`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteBank(bank.id);
      setBanks((old) => old.filter((item) => item.id !== bank.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir a conta bancária.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[1.65rem] font-semibold leading-tight tracking-[-0.035em] text-[#831843]">Contas bancárias</h2>
          <p className="fc-sub mt-1">
            Cadastre as contas usadas para pagar e receber. Centros de custo e planos de contas ficam separados.
          </p>
        </div>
        {canManage && ready && (
          <div className="flex max-w-xl flex-col items-end gap-3"><form onSubmit={add} className="flex flex-wrap justify-end gap-2">
            <input
              aria-label="Nome da conta bancária"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Itaú PJ • conta 12345-6"
              maxLength={80}
              className="w-64 rounded-full border bg-white px-4 py-2.5 text-sm shadow-sm"
            />
            <button
              disabled={busy}
              className="flex items-center gap-1 rounded-full bg-[#831843] px-3 py-2 hover:bg-pink-950 shadow-[0_8px_20px_-10px_rgba(24,24,27,0.8)] text-xs font-bold text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Cadastrar conta bancária
            </button>
          </form><div className="w-full rounded-2xl bg-white/70 p-3 ring-1 ring-zinc-200/70"><BankPicker name={name} onChange={setName} label="Escolha o banco" /></div></div>
        )}
      </div>
      {!ready && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
          O cadastro de contas bancárias está temporariamente indisponível. Atualize a página ou contate o responsável.
        </p>
      )}
      {canManage && <p className="mb-4 flex gap-2 rounded-2xl bg-white/70 px-4 py-3 text-xs text-zinc-600 ring-1 ring-zinc-200/70">O saldo inclui ajustes, receitas e despesas realizadas até hoje. Editar saldo registra a diferença na data escolhida; ela entra no mês e nos saldos seguintes. Valores negativos são permitidos.</p>}
      {balanceId && <form onSubmit={e=>{e.preventDefault();void adjust();}} className="fc-card fc-menu mb-5 flex flex-wrap items-end gap-3 p-5">
        <label className="text-xs font-bold">Saldo da conta em reais (aceita negativo)<input autoFocus required type="number" step="0.01" value={balance} onChange={e=>setBalance(e.target.value)} className="mt-1 block rounded-xl border p-2"/></label>
        <label className="text-xs font-bold">Data do saldo<input required type="date" max={today} value={balanceDate} onChange={e=>{setBalanceDate(e.target.value);setBalance(String(summarizeBank(entries.filter(x=>cashDate(x)<=e.target.value),balanceId).balance));}} className="mt-1 block rounded-xl border p-2"/></label>
        <button disabled={busy} className="rounded-full bg-[#831843] px-4 py-2 hover:bg-pink-950 shadow-[0_8px_20px_-10px_rgba(24,24,27,0.8)] text-sm font-bold text-white disabled:opacity-50">Salvar saldo</button><button type="button" disabled={busy} onClick={()=>setBalanceId(null)} className="p-2 text-sm">Cancelar</button>
        <p className="w-full text-xs text-zinc-500">Informe o saldo total correto da conta ao final desta data. O sistema registra somente a diferença, preservando seus lançamentos.</p>
      </form>}
      {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
      {ready && (
        <div className="fc-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {banks.map((bank) => { const summary = summarizeBank(entries.filter(e=>cashDate(e)<=today), bank.id); return (
            <article key={bank.id} onPointerMove={spot} className="fc-card fc-spot fc-lift group flex flex-wrap items-start gap-4 p-5 hover:shadow-lg">
              <BankLogo name={editingId === bank.id ? editName : bank.name} className="h-12 w-12 text-lg transition-transform duration-300 group-hover:-rotate-6" />
              <div className="min-w-0 flex-1">
                {editingId === bank.id ? (
                  <>
                  <input
                    autoFocus
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void rename(bank);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                    maxLength={80}
                    className="w-full rounded-lg border bg-zinc-50 px-2 py-1 text-sm"
                  />
                  <div className="mt-3"><BankPicker name={editName} onChange={setEditName} /></div>
                  </>
                ) : (
                  <p className="truncate font-semibold text-[#831843]">{bank.name}</p>
                )}
                <p className="text-[11px] text-zinc-400">{summary.count} lançamento(s) vinculado(s)</p>
                {canManage && <div className="mt-4 space-y-1 text-xs"><p className="text-zinc-500">Saldo atual da conta</p><b className={`block text-2xl font-semibold tracking-[-0.03em] ${summary.balance < 0 ? "text-red-600" : "text-[#831843]"}`}><Money value={summary.balance} /></b><div className="mt-3 grid grid-cols-2 gap-2"><p className="rounded-xl bg-white px-3 py-2 ring-1 ring-zinc-100"><span className="block text-[11px] text-zinc-500">Recebido</span><b className="font-medium text-emerald-600">{fmt(summary.income)}</b></p><p className="rounded-xl bg-white px-3 py-2 ring-1 ring-zinc-100"><span className="block text-[11px] text-zinc-500">Pago</span><b className="font-medium text-red-600">{fmt(summary.expense)}</b></p></div><p className="pt-1 text-zinc-500">A receber {fmt(summary.receive)} · A pagar {fmt(summary.pay)}</p></div>}
              </div>
              {canManage && (
                <div className="flex w-full justify-end gap-1 border-t border-zinc-200/60 pt-3 text-xs font-medium">
                  {editingId === bank.id ? (
                    <>
                      <button type="button" disabled={busy} onClick={() => void rename(bank)} className="rounded-full px-3 py-1.5 text-[#831843] hover:bg-zinc-100">Salvar</button>
                      <button type="button" onClick={() => setEditingId(null)} className="rounded-full px-3 py-1.5 text-zinc-500 hover:bg-zinc-50">Cancelar</button>
                    </>
                  ) : (
                    <>
                      <button type="button" disabled={busy} onClick={()=>{setBalanceId(bank.id);setBalance(String(summary.balance));setBalanceDate(today);setError('');}} className="rounded-full px-3 py-1.5 text-[#831843] hover:bg-zinc-100">Editar saldo</button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(bank.id);
                          setEditName(bank.name);
                          setError("");
                        }}
                        className="rounded-full px-3 py-1.5 text-[#831843] hover:bg-zinc-100"
                      >
                        Editar
                      </button>
                      <button type="button" disabled={busy} onClick={() => void remove(bank)} className="rounded-full px-3 py-1.5 text-red-600 hover:bg-red-50">Excluir</button>
                    </>
                  )}
                </div>
              )}
            </article>
          ); })}
          {!banks.length && (
            <p className="text-sm text-zinc-400">
              {canManage ? "Nenhuma conta bancária cadastrada. Use o campo acima para cadastrar." : "Nenhuma conta bancária cadastrada ainda."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
