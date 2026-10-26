import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight, CreditCard, Landmark, Search, X } from "lucide-react";
import { entryValue, reportingDate } from "../lib/finance";
import { fmt } from "./shared";
import BankLogo, { bankBrand } from "./BankLogo";

type Named = { id: string; name: string };
type Props = {
  entries: any[];
  categories: any[];
  banks: Named[];
  cards: Named[];
  onOpen?: (entry: any) => void;
  /** Inside a dialog: no outer card, tighter spacing. */
  embedded?: boolean;
  title?: string;
  subtitle?: string;
  initialSource?: string;
};

// Where the money moved: a credit card, a bank account or no account at all.
const sourceKey = (entry: any) => entry.creditCardId ? `card:${entry.creditCardId}` : entry.bankId ? `bank:${entry.bankId}` : "none";
const weekday = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

function Ledger({ entries, categories, banks, cards, onOpen, embedded = false, title = "Diário do mês", subtitle, initialSource = "all" }: Props) {
  const [source, setSource] = useState(initialSource), [kind, setKind] = useState("todos"), [category, setCategory] = useState("all"), [search, setSearch] = useState("");
  const sourceName = (key: string) => {
    if (key === "none") return "Sem conta definida";
    const [type, id] = key.split(":");
    return (type === "card" ? cards : banks).find((item) => item.id === id)?.name || (type === "card" ? "Cartão" : "Conta");
  };
  const sources = useMemo(() => {
    const map = new Map<string, { key: string; out: number; in: number; count: number }>();
    entries.forEach((entry) => {
      const key = sourceKey(entry);
      const row = map.get(key) || { key, out: 0, in: 0, count: 0 };
      if (entry.kind === "despesa") row.out += entryValue(entry); else row.in += entryValue(entry);
      row.count += 1;
      map.set(key, row);
    });
    return [...map.values()].sort((a, b) => b.out + b.in - (a.out + a.in));
  }, [entries]);
  const categoryNames = [...new Set(entries.map((entry) => entry.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const term = search.trim().toLowerCase();
  const filtered = entries.filter((entry) =>
    (source === "all" || sourceKey(entry) === source) &&
    (kind === "todos" || entry.kind === kind) &&
    (category === "all" || entry.category === category) &&
    (!term || `${entry.description} ${entry.beneficiary || ""} ${entry.category}`.toLowerCase().includes(term)));
  const days = new Map<string, any[]>();
  [...filtered].sort((a, b) => reportingDate(b).localeCompare(reportingDate(a))).forEach((entry) => {
    const day = reportingDate(entry);
    days.set(day, [...(days.get(day) || []), entry]);
  });
  const totalOut = filtered.filter((e) => e.kind === "despesa").reduce((s, e) => s + entryValue(e), 0);
  const totalIn = filtered.filter((e) => e.kind === "receita").reduce((s, e) => s + entryValue(e), 0);
  const filtering = source !== "all" || kind !== "todos" || category !== "all" || !!term;
  const logo = (key: string, size = "h-8 w-8 text-[11px]") => key.startsWith("card:") && bankBrand(sourceName(key))
    ? <BankLogo name={sourceName(key)} className={`${size} rounded-lg`} />
    : key.startsWith("card:")
    ? <span className={`flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-violet-800 text-white shadow-[0_6px_14px_-8px_rgba(109,40,217,0.9)] ${size}`}><CreditCard className="h-[50%] w-[50%]" /></span>
    : key.startsWith("bank:") ? <BankLogo name={sourceName(key)} className={`${size} rounded-lg`} />
    : <span className={`flex shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 ${size}`}><Landmark className="h-[45%] w-[45%]" /></span>;
  const field = "rounded-full border-0 bg-transparent px-3 py-1.5 text-xs text-zinc-600 hover:bg-white hover:text-[#831843]";

  return (
    <section className={embedded ? "" : "fc-card p-6"}>
      {!embedded && (
        <div className="mb-4">
          <h2 className="fc-h">{title}</h2>
          <p className="fc-sub mt-1">{subtitle ?? "Tudo o que entrou e saiu, dia a dia, separado por cartão e conta. Compras no cartão aparecem pela data da compra."}</p>
        </div>
      )}
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sources.map((row) => {
            const active = source === row.key;
            return (
              <button
                key={row.key}
                type="button"
                aria-pressed={active}
                onClick={() => setSource(active ? "all" : row.key)}
                className={`flex min-w-[190px] shrink-0 items-center gap-3 rounded-2xl p-3 text-left transition ${active ? "bg-[#831843] text-white shadow-[0_12px_28px_-14px_rgba(24,24,27,0.9)]" : "bg-zinc-50 ring-1 ring-zinc-100 hover:bg-white hover:shadow-md"}`}
              >
                {logo(row.key, "h-9 w-9 text-xs")}
                <span className="min-w-0">
                  <span className={`block truncate text-xs font-medium ${active ? "text-white" : "text-[#831843]"}`}>{sourceName(row.key)}</span>
                  {row.out > 0 && <span className={`block text-sm font-semibold tracking-[-0.02em] ${active ? "text-red-300" : "text-red-600"}`}>−{fmt(row.out)}</span>}
                  {row.in > 0 && <span className={`block text-[11px] font-medium ${active ? "text-emerald-300" : "text-emerald-600"}`}>+{fmt(row.in)}</span>}
                  <span className={`block text-[10.5px] ${active ? "text-white/50" : "text-zinc-400"}`}>{row.count} lançamento(s)</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1 rounded-[1.25rem] bg-zinc-100/80 p-1.5 sm:rounded-full">
        <select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)} className={`${field} font-medium`}>
          <option value="todos">Entradas e saídas</option>
          <option value="despesa">Só despesas</option>
          <option value="receita">Só receitas</option>
        </select>
        <select aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} className={`${field} max-w-48`}>
          <option value="all">Todas as categorias</option>
          {categoryNames.map((name) => <option key={name}>{name}</option>)}
        </select>
        <label className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input aria-label="Buscar no diário" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded-full border-0 bg-white py-1.5 pl-8 pr-3 text-xs shadow-sm" />
        </label>
        {filtering && <button type="button" onClick={() => { setSource("all"); setKind("todos"); setCategory("all"); setSearch(""); }} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-zinc-500 hover:bg-white hover:text-[#831843]"><X className="h-3 w-3" />Limpar</button>}
      </div>
      <div className="mt-4">
        {[...days].map(([day, rows]) => {
          const out = rows.filter((e) => e.kind === "despesa").reduce((s, e) => s + entryValue(e), 0);
          const inc = rows.filter((e) => e.kind === "receita").reduce((s, e) => s + entryValue(e), 0);
          return (
            <div key={day} className="mb-2">
              <div className="sticky top-0 z-[1] flex items-center justify-between gap-3 bg-white/90 py-2 backdrop-blur-sm">
                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 first-letter:uppercase">{weekday(day)}</span>
                <span className="text-[11px] text-zinc-500">
                  {inc > 0 && <b className="mr-2 font-medium text-emerald-600">+{fmt(inc)}</b>}
                  {out > 0 && <b className="font-medium text-red-600">−{fmt(out)}</b>}
                </span>
              </div>
              <div className="fc-rows">
                {rows.map((entry) => {
                  const cat = categories.find((c) => c.name === entry.category && c.unit === entry.unit && c.kind === entry.kind);
                  const key = sourceKey(entry);
                  return (
                    <button key={entry.id} type="button" disabled={!onOpen} onClick={() => onOpen?.(entry)} title={onOpen ? "Clique para abrir" : undefined} className="group flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left enabled:hover:bg-zinc-50">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl text-base ring-1 ring-black/5" style={{ backgroundColor: cat?.color || "#f4f4f5" }}>
                        {cat?.icon?.startsWith("data:") ? <img src={cat.icon} alt="" className="h-full w-full object-cover" /> : cat?.icon || "🏷️"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-[#831843]"><span className="truncate">{entry.description}</span>{entry.installment && <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-normal text-zinc-500">{entry.installment}</span>}</span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">{logo(key, "h-4 w-4 rounded-[5px] text-[7px]")}<span className="truncate">{sourceName(key)} · {entry.category}{entry.beneficiary?.trim() ? ` · ${entry.beneficiary.trim()}` : ""}</span></span>
                      </span>
                      <span className="shrink-0 text-right">
                        <b className={`block text-[13px] font-semibold ${entry.kind === "receita" ? "text-emerald-600" : "text-[#831843]"}`}>{entry.kind === "receita" ? "+" : "−"}{fmt(entryValue(entry))}</b>
                        <span className="text-[10.5px] text-zinc-400">{entry.status === "realizado" ? (entry.kind === "despesa" ? "Pago" : "Recebido") : entry.creditCardId ? "No cartão" : "Previsto"}</span>
                      </span>
                      {onOpen && <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#831843]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!filtered.length && <p className="py-10 text-center text-sm text-zinc-500">Nada encontrado com esses filtros.</p>}
      </div>
      <div className={`mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 text-xs text-zinc-500 ${embedded ? "hidden" : ""}`}>
        <span>{filtered.length} lançamento(s){filtering ? " filtrados" : ""}</span>
        <span className="flex gap-4">{totalIn > 0 && <span>Entradas <b className="font-semibold text-emerald-600">{fmt(totalIn)}</b></span>}<span>Saídas <b className="font-semibold text-red-600">{fmt(totalOut)}</b></span></span>
      </div>
    </section>
  );
}

type Source = { key: string; out: number; in: number; count: number };
const sourceTotals = (entries: any[]) => {
  const map = new Map<string, Source>();
  entries.forEach((entry) => {
    const key = sourceKey(entry);
    const row = map.get(key) || { key, out: 0, in: 0, count: 0 };
    if (entry.kind === "despesa") row.out += entryValue(entry); else row.in += entryValue(entry);
    row.count += 1;
    map.set(key, row);
  });
  return [...map.values()].sort((a, b) => b.out + b.in - (a.out + a.in));
};

/**
 * On a page the diary shows only its per-source summary, with no inner scroll
 * that would capture the mouse wheel; the full day-by-day list opens in a dialog.
 */
export default function DailyLedger(props: Props) {
  const [openSource, setOpenSource] = useState<string | null>(null);
  useEffect(() => {
    if (openSource === null) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenSource(null); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [openSource]);
  if (props.embedded) return <Ledger {...props} />;
  const { entries, banks, cards, title = "Diário do mês", subtitle } = props;
  const sources = sourceTotals(entries);
  const name = (key: string) => {
    if (key === "none") return "Sem conta definida";
    const [type, id] = key.split(":");
    return (type === "card" ? cards : banks).find((item) => item.id === id)?.name || (type === "card" ? "Cartão" : "Conta");
  };
  const out = entries.filter((e) => e.kind === "despesa").reduce((s, e) => s + entryValue(e), 0);
  const inc = entries.filter((e) => e.kind === "receita").reduce((s, e) => s + entryValue(e), 0);
  return (
    <section className="fc-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="fc-h">{title}</h2>
          <p className="fc-sub mt-1">{subtitle ?? "Para onde foi o dinheiro: cartão de crédito e cada conta. Clique para ver tudo dia a dia."}</p>
        </div>
        <button type="button" onClick={() => setOpenSource("all")} className="group flex shrink-0 items-center gap-2 rounded-full bg-[#831843] py-1.5 pl-1.5 pr-4 text-xs font-medium text-white shadow-[0_10px_24px_-12px_rgba(24,24,27,0.9)] hover:bg-pink-950">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15"><CalendarDays className="h-3.5 w-3.5" /></span>
          Abrir diário completo
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {sources.map((row) => (
          <button key={row.key} type="button" onClick={() => setOpenSource(row.key)} className="fc-lift group flex items-center gap-3 rounded-2xl bg-zinc-50 p-3 text-left ring-1 ring-zinc-100 hover:bg-white hover:shadow-md">
            {row.key.startsWith("card:") && bankBrand(name(row.key))
              ? <BankLogo name={name(row.key)} className="h-10 w-10 text-sm" />
              : row.key.startsWith("card:")
              ? <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-800 text-white shadow-[0_6px_14px_-8px_rgba(109,40,217,0.9)]"><CreditCard className="h-5 w-5" /></span>
              : row.key.startsWith("bank:") ? <BankLogo name={name(row.key)} className="h-10 w-10 text-sm" />
              : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400"><Landmark className="h-5 w-5" /></span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-[#831843]">{name(row.key)}</span>
              <span className="block text-[10.5px] text-zinc-400">{row.key.startsWith("card:") ? "Cartão de crédito" : row.key.startsWith("bank:") ? "Conta bancária" : "Sem conta"} · {row.count} lançamento(s)</span>
              {row.out > 0 && <span className="block text-sm font-semibold tracking-[-0.02em] text-red-600">−{fmt(row.out)}</span>}
              {row.in > 0 && <span className="block text-[11px] font-medium text-emerald-600">+{fmt(row.in)}</span>}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#831843]" />
          </button>
        ))}
        {!sources.length && <p className="text-sm text-zinc-500">Sem lançamentos no período.</p>}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-4 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
        {inc > 0 && <span>Entradas <b className="font-semibold text-emerald-600">{fmt(inc)}</b></span>}
        <span>Saídas <b className="font-semibold text-red-600">{fmt(out)}</b></span>
      </div>
      {openSource !== null && (
        <div className="fc-overlay fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/40 backdrop-blur-[2px] sm:items-center sm:p-4" role="presentation" onClick={() => setOpenSource(null)}>
          <section role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[1.5rem] bg-white shadow-2xl sm:rounded-[1.5rem]">
            <header className="flex items-start gap-3 border-b border-zinc-100 px-6 py-5">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-[#831843]">{title}</h2>
                <p className="mt-0.5 text-xs text-zinc-500">Clique numa origem para filtrar. Compras no cartão aparecem pela data da compra.</p>
              </div>
              <button type="button" onClick={() => setOpenSource(null)} aria-label="Fechar" className="rounded-full p-2 text-zinc-500 hover:rotate-90 hover:bg-zinc-100 hover:text-[#831843]"><X className="h-5 w-5" /></button>
            </header>
            <div className="overflow-y-auto overscroll-contain px-5 py-4">
              <Ledger {...props} embedded initialSource={openSource} />
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
