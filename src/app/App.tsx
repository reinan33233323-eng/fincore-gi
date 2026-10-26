import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  readAuthenticatedRows,
  supabase,
  supabasePublishableKey,
  supabaseUrl,
} from "../lib/supabase";
import {
  Bank,
  createRemoteCostCenter,
  deleteBank,
  saveBank,
  saveCardPurchases,
  updateRemoteCostCenter,
  deleteRemoteCostCenter,
  uploadEntryAttachment,
  signedAttachmentUrl,
  removeEntryAttachments,
  deleteRemoteCategory,
  deleteRemoteEntries,
  deleteRemoteEntrySeries,
  deleteCardPartialPayment,
  saveRemoteCategory,
  saveRemoteCounterparty,
  saveRemoteEntries,
  setRemoteCounterpartyArchived,
} from "../lib/bridge";
import { addMonthsClamped, changedSeriesFields, seriesDueDate } from "../lib/seriesDates";
import { CurrencyInput, Money, Month, fmt, labelMonth, moneyInput, parseMoney, spot } from "./shared";
import { motion } from "motion/react";
import BankLogo from "./BankLogo";
import DailyLedger from "./DailyLedger";
import BanksSection from "./Banks";
import CashFlow from "./CashFlow";
import Transactions from "./Transactions";
import { buildCashFlow } from "../lib/cashFlow";
import { cardInvoices, cardSchedule, extendCardRecurrences } from "../lib/cardLedger";
import { addDays, nextWeeklyDates, shiftWeeklyDate, defaultBankId } from "../lib/recurrence";
import { renamedCategoryEntries, categorySelection } from "../lib/categories";
import { sameMonthParts, monthlyParts } from "../lib/installments";
import CreditCards from "./CreditCards";
import { adjustmentEntry, cardPaymentEntries, invoiceDate, invoiceCycle, type BalanceAdjustment, type CardPayment, type CreditCard as PersonalCreditCard } from "../lib/credit";
import { reportingDate, reportingPeriod, cashDate, cashPosition } from "../lib/finance";
import { entryValue, summarizeFinancialEntries, summarizeBank, localDateKey, localMonthKey } from "../lib/finance";
import { snapshotFile, unreadableFileMessage } from "../lib/files";
import { ICON_ACCEPT, imageToIcon } from "../lib/iconImage";
import {
  AlertTriangle,
  Bell,
  BarChart3,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  Menu,
  Paperclip,
  Pencil,
  Plus,
  ReceiptText,
  Repeat2,
  Search,
  Tag,
  TrendingDown,
  TrendingUp,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Kind = "receita" | "despesa";
type Unit = string;
type CostCenter = {
  name: Unit;
  initials: string;
  colorKey: string;
  color: string;
  tint: string;
};
type CostCenterRow = { name: Unit; initials: string; color?: string };
type Entry = {
  id: string;
  seriesId?: string;
  kind: Kind;
  unit: Unit;
  account: string;
  category: string;
  description: string;
  beneficiary: string;
  counterpartyId?: string | null;
  pix: string;
  amount: number;
  date: string;
  status: "previsto" | "realizado";
  recurrence: "nenhuma" | "mensal" | "semanal";
  installments: number;
  installment?: string;
  notes?: string;
  attachments?: string[];
  juros?: number;
  paidDate?: string | null;
  discount?: number;
  bankId?: string | null;
  creditCardId?: string | null;
  cardPurchaseDate?: string | null;
  cardInstallmentOffset?: number;
  invoiceSummary?: boolean;
  invoicePaidAmount?: number;
  invoicePendingAmount?: number;
  invoiceUnits?: string[];
  invoiceMonth?: string | null;
  balanceAdjustment?: boolean;
  /** Partial invoice payment rows (see cardPaymentEntries). */
  cardPayment?: boolean;
  invoiceAdjustment?: boolean;
  cardPaymentId?: string;
  paysCardId?: string;
  paysInvoiceMonth?: string;
};
// Busca sem diferenciar acentos nem maiúsculas ("divida" acha "Dívida").
// Partial invoice payments; an older database without the table simply has none.
const readCardPayments = () =>
  readAuthenticatedRows<CardPayment>("card_invoice_payments", "paid_date.asc").catch(() => [] as CardPayment[]);
const normalizeSearch = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
// Valor que efetivamente saiu/entrou: numa despesa já paga, soma os juros e
// abate o desconto.
// Dias de atraso de uma despesa paga: diferença entre pagamento e vencimento.
const lateDays = (entry: Entry) =>
  entry.paidDate && entry.paidDate > entry.date
    ? Math.round((Date.parse(`${entry.paidDate}T12:00:00`) - Date.parse(`${entry.date}T12:00:00`)) / 86400000)
    : 0;
type Category = {
  id: string;
  name: string;
  kind: Kind;
  unit: Unit;
  icon?: string;
  color?: string;
};
type Counterparty = {
  id: string;
  kind: Kind;
  unit: Unit;
  name: string;
  provides: string;
  archived?: boolean;
};
type User = {
  id: string;
  name: string;
  email: string;
  role: "master" | "operador";
  units: Unit[];
  canViewReports: boolean;
  canCreatePlans: boolean;
  hiddenScreens: string[];
};
// Abas que o Master pode ocultar por usuário (a aba "Usuários" é sempre
// exclusiva do Master, então não entra aqui).
const toggleableScreens: { id: string; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "lancamentos", label: "Lançamentos" },
  { id: "contas", label: "Contas" },
  { id: "categorias", label: "Plano de contas" },
  { id: "contatos", label: "Fornecedores/clientes" },
  { id: "relatorios", label: "Relatórios" },
];
// Paleta fixa de cores para os centros de custo. As classes Tailwind ficam
// escritas por extenso aqui para que o build as inclua no CSS final.
type CostCenterColor = { key: string; label: string; swatch: string; color: string; tint: string };
const costCenterColors: CostCenterColor[] = [
  { key: "indigo", label: "Índigo", swatch: "#4f46e5", color: "bg-indigo-600", tint: "border-indigo-100 bg-indigo-50" },
  { key: "blue", label: "Azul", swatch: "#2563eb", color: "bg-blue-600", tint: "border-blue-100 bg-blue-50" },
  { key: "emerald", label: "Verde", swatch: "#059669", color: "bg-emerald-600", tint: "border-emerald-100 bg-emerald-50" },
  { key: "teal", label: "Turquesa", swatch: "#0d9488", color: "bg-teal-600", tint: "border-teal-100 bg-teal-50" },
  { key: "amber", label: "Âmbar", swatch: "#f59e0b", color: "bg-amber-500", tint: "border-amber-100 bg-amber-50" },
  { key: "orange", label: "Laranja", swatch: "#f97316", color: "bg-orange-500", tint: "border-orange-100 bg-orange-50" },
  { key: "rose", label: "Rosa", swatch: "#e11d48", color: "bg-rose-600", tint: "border-rose-100 bg-rose-50" },
  { key: "fuchsia", label: "Magenta", swatch: "#c026d3", color: "bg-fuchsia-600", tint: "border-fuchsia-100 bg-fuchsia-50" },
  { key: "violet", label: "Violeta", swatch: "#7c3aed", color: "bg-violet-600", tint: "border-violet-100 bg-violet-50" },
  { key: "slate", label: "Grafite", swatch: "#475569", color: "bg-zinc-600", tint: "border-zinc-100 bg-zinc-50" },
];
const costCenterColorByKey = new Map(costCenterColors.map((item) => [item.key, item]));
const resolveCostCenterColor = (key: string | undefined) =>
  costCenterColorByKey.get(key || "") ?? costCenterColors[0];
const makeCostCenter = (name: Unit, initials: string, colorKey: string): CostCenter => {
  const palette = resolveCostCenterColor(colorKey);
  return { name, initials, colorKey: palette.key, color: palette.color, tint: palette.tint };
};
const units: CostCenter[] = [
  makeCostCenter("Marketing", "MK", "fuchsia"),
  makeCostCenter("Sítio", "SI", "emerald"),
  makeCostCenter("Consultoria", "CO", "blue"),
  makeCostCenter("Pessoa Física", "PF", "amber"),
];
const reportsAccessFlag = "__reports__";
const createPlansAccessFlag = "__create_plans__";
// Filtra a flag legada para que ela não apareça como centro de custo.
const teamNotesAccessFlag = "__team_notes__";
const profileAccess = (values: string[] | null | undefined) => {
  const raw = values || [];
  return {
    units: raw.filter((value) => value !== reportsAccessFlag && value !== teamNotesAccessFlag && value !== createPlansAccessFlag),
    canViewReports: raw.includes(reportsAccessFlag),
    canCreatePlans: raw.includes(createPlansAccessFlag),
  };
};
const costCenterVisual = (row: CostCenterRow): CostCenter => {
  const existing = units.find((unit) => unit.name === row.name);
  const colorKey = row.color || existing?.colorKey || "indigo";
  return makeCostCenter(
    row.name,
    row.initials || row.name.slice(0, 2).toLocaleUpperCase("pt-BR"),
    colorKey,
  );
};
const defaults: Category[] = [
  {
    id: "hon",
    name: "Honorários",
    kind: "receita",
    unit: "Consultoria",
    icon: "💼",
  },
  { id: "ven", name: "Vendas", kind: "receita", unit: "Marketing", icon: "📈" },
  { id: "prod", name: "Produção", kind: "receita", unit: "Sítio", icon: "🌱" },
  {
    id: "sal",
    name: "Salário",
    kind: "receita",
    unit: "Pessoa Física",
    icon: "💰",
  },
  {
    id: "for",
    name: "Fornecedores",
    kind: "despesa",
    unit: "Consultoria",
    icon: "🏭",
  },
  {
    id: "tra",
    name: "Tráfego pago",
    kind: "despesa",
    unit: "Marketing",
    icon: "📣",
  },
  { id: "ins", name: "Insumos", kind: "despesa", unit: "Sítio", icon: "🚜" },
  {
    id: "mor",
    name: "Moradia",
    kind: "despesa",
    unit: "Pessoa Física",
    icon: "🏠",
  },
];
const icons = [
    "🏷️",
    "💼",
    "📈",
    "🌱",
    "💰",
    "🏭",
    "📣",
    "🚜",
    "🏠",
    "🧾",
    "⚙️",
    "👤",
    "🍽️",
    "🚙",
    "💳",
  ];
const id = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const entryScheduleLabel = (entry: Entry) =>
  entry.recurrence !== "nenhuma"
    ? entry.installment
      ? `Recorrente ${entry.recurrence} · Parcela ${entry.installment}`
      : `Recorrente ${entry.recurrence}`
    : entry.installment
      ? `Parcela ${entry.installment}`
      : "Lançamento único";
const recurringOccurrenceId = (seriesId: string, date: string, slot = "") => {
  const source = slot ? `${seriesId}:${date}:${slot}` : `${seriesId}:${date}`;
  let a = 0x811c9dc5,
    b = 0x9e3779b9,
    c = 0x85ebca6b,
    d = 0xc2b2ae35;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
    c = Math.imul(c ^ code, 0xc2b2ae35);
    d = Math.imul(d ^ code, 0x27d4eb2f);
  }
  const raw = [a, b, c, d]
    .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
    .join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-8${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
};
const counterpartyKey = (kind: Kind, name: string) =>
  JSON.stringify([
    kind,
    name.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR"),
  ]);
const contactIdentity = (kind: Kind, unit: Unit, name: string) =>
  `${unit}:${counterpartyKey(kind, name)}`;
const contactsWithLegacyEntries = (saved: Counterparty[], entries: Entry[]) => {
  const byIdentity = new Map<string, Counterparty>();
  saved.forEach((contact) =>
    byIdentity.set(contactIdentity(contact.kind, contact.unit, contact.name), contact),
  );
  entries.forEach((entry) => {
    if (!entry.beneficiary?.trim()) return;
    const key = contactIdentity(entry.kind, entry.unit, entry.beneficiary);
    if (!byIdentity.has(key))
      byIdentity.set(key, {
        id: `legacy:${key}`,
        kind: entry.kind,
        unit: entry.unit,
        name: entry.beneficiary.trim(),
        provides: "",
      });
  });
  return [...byIdentity.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
};
type SameMonthPart = { date: string; amount: string };


function nextRecurringEntries(entries: Entry[], cards: PersonalCreditCard[]) {
  const startOfCurrentMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );
  const endOfWindow = new Date(
    new Date().getFullYear(),
    new Date().getMonth() + 36,
    0,
  );
  const generated: Entry[] = extendCardRecurrences(entries,cards,localDateKey(startOfCurrentMonth),localDateKey(endOfWindow),recurringOccurrenceId);
  const series = new Map<string, Entry[]>();

  entries
    .filter((entry) => !entry.creditCardId && entry.recurrence !== "nenhuma" && entry.seriesId)
    .forEach((entry) => {
      const group = series.get(entry.seriesId!) || [];
      group.push(entry);
      series.set(entry.seriesId!, group);
    });

  series.forEach((occurrences) => {
    if (occurrences[0].recurrence === "semanal") {
      const latest = [...occurrences].sort((a,b)=>b.date.localeCompare(a.date))[0];
      for (const date of nextWeeklyDates(latest.date, localDateKey(startOfCurrentMonth), localDateKey(endOfWindow))) {
        generated.push({...latest, id:recurringOccurrenceId(latest.seriesId!,date,""), date, status:"previsto", paidDate:null, juros:0, discount:0});
      }
      return;
    }
    const latestMonth = [...occurrences]
      .map((entry) => entry.date.slice(0, 7))
      .sort()
      .at(-1);
    if (!latestMonth) return;
    // The last month in a series is its template. A normal recurring entry
    // has one template; an adiantamento + saldo series has two or more, each
    // retaining its own date, amount, PIX and other details every month.
    const templates = occurrences
      .filter((entry) => entry.date.startsWith(latestMonth))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!templates.length) return;
    const nextMonth = new Date(`${latestMonth}-01T12:00:00`);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    // A gap can happen when nobody opens the system for a long time. Do not
    // invent old financial commitments in that case: preserve real history
    // and resume the forecast from the current month onward.
    if (nextMonth < startOfCurrentMonth)
      nextMonth.setTime(startOfCurrentMonth.getTime());
    while (nextMonth <= endOfWindow) {
      const lastDay = new Date(
        nextMonth.getFullYear(),
        nextMonth.getMonth() + 1,
        0,
      ).getDate();
      templates.forEach((template, index) => {
        const sourceDate = new Date(`${template.date}T12:00:00`);
        const dueDate = new Date(
          nextMonth.getFullYear(),
          nextMonth.getMonth(),
          Math.min(sourceDate.getDate(), lastDay),
        )
          .toISOString()
          .slice(0, 10);
        generated.push({
          ...template,
          // Deterministic IDs make concurrent projections from Master and
          // operators safe. Multi-part monthly series include their position
          // so two payments on the same day never collide.
          id: recurringOccurrenceId(
            template.seriesId!,
            dueDate,
            templates.length > 1 ? template.installment || String(index) : "",
          ),
          date: dueDate,
          status: "previsto",
        });
      });
      nextMonth.setMonth(nextMonth.getMonth() + 1);
    }
  });
  return generated;
}
function Icon({
  category,
  small = false,
}: {
  category?: Category;
  small?: boolean;
}) {
  return category?.icon?.startsWith("data:") ? (
    <img
      src={category.icon}
      alt=""
      className={`${small ? "h-5 w-5" : "h-8 w-8"} rounded-full object-cover`}
    />
  ) : (
    <span
      style={{ backgroundColor: category?.color || "#e2e8f0" }}
      className={`flex ${small ? "h-5 w-5 text-xs" : "h-8 w-8"} items-center justify-center rounded-full`}
    >
      {category?.icon || "🏷️"}
    </span>
  );
}
function ScopeDialog({
  action,
  close,
  one,
  series,
}: {
  action: "editar" | "excluir";
  close: () => void;
  one: () => void;
  series: () => void;
}) {
  const verb = action === "editar" ? "alterar" : "excluir";
  return (
    <div className="fc-overlay fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[1.5rem] bg-white p-6 shadow-2xl">
        <div
          className={`mb-4 flex h-11 w-11 items-center justify-center rounded-full ${action === "excluir" ? "bg-red-100 text-red-600" : "bg-brand-100 text-brand-600"}`}
        >
          {action === "excluir" ? "−" : "✎"}
        </div>
        <h2 className="text-lg font-extrabold text-[#831843]">
          {action === "editar"
            ? "Alterar lançamento recorrente"
            : "Excluir lançamento recorrente"}
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          Você quer {verb} somente este lançamento ou todos os lançamentos desta
          série?
        </p>
        <div className="mt-6 grid gap-3">
          <button
            onClick={one}
            className="rounded-xl border border-zinc-200 px-4 py-3 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
          >
            Somente este lançamento
          </button>
          <button
            onClick={series}
            className={`rounded-xl px-4 py-3 text-sm font-bold text-white ${action === "excluir" ? "bg-red-600" : "bg-brand-700"}`}
          >
            {action === "editar"
              ? "Alterar toda a série"
              : "Excluir toda a série"}
          </button>
          <button
            onClick={close}
            className="py-1 text-sm font-bold text-zinc-400"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
function DeleteCategoryDialog({
  category,
  close,
  remove,
}: {
  category: Category;
  close: () => void;
  remove: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="fc-overlay fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[1.5rem] bg-white p-6 shadow-2xl">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-xl font-bold text-red-600">
          −
        </div>
        <h2 className="text-lg font-extrabold text-[#831843]">
          Excluir categoria
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          Excluir <strong>{category.name}</strong> do centro de custo{" "}
          <strong>{category.unit}</strong>?
        </p>
        <p className="mt-2 text-xs leading-5 text-zinc-400">
          Os lançamentos já cadastrados serão preservados. Esta categoria apenas
          deixará de aparecer em novos lançamentos.
        </p>
        {error && (
          <p className="mt-4 text-sm font-bold text-red-600">{error}</p>
        )}
        <div className="mt-6 flex gap-3">
          <button
            onClick={close}
            disabled={busy}
            className="flex-1 rounded-xl border border-zinc-200 px-4 py-3 text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await remove();
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Não foi possível excluir a categoria.",
                );
                setBusy(false);
              }
            }}
            disabled={busy}
            className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? "Excluindo..." : "Excluir categoria"}
          </button>
        </div>
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (authError || !data.user) {
      setError(
        authError?.message.toLowerCase().includes("email not confirmed")
          ? "Este acesso ainda precisa ser ativado pelo link enviado ao e-mail cadastrado."
          : "E-mail ou senha inválidos.",
      );
      setBusy(false);
      return;
    }
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, role, allowed_units, hidden_screens")
      .eq("id", data.user.id)
      .single();
    if (profileError || !profile || profile.role !== "master" || data.user.email?.toLowerCase() !== "master@financeiro.com") {
      await supabase.auth.signOut();
      setError(
        "Seu perfil de acesso não está configurado. Fale com o administrador.",
      );
      setBusy(false);
      return;
    }
    const access = profileAccess(profile.allowed_units);
    const user = {
      id: data.user.id,
      name: profile.full_name,
      email: data.user.email || email,
      role: profile.role as User["role"],
      units: access.units,
      canViewReports: access.canViewReports,
      canCreatePlans: access.canCreatePlans,
      hiddenScreens: profile.hidden_screens ?? [],
    };
    localStorage.setItem("fincore-gi.user", JSON.stringify(user));
    onLogin(user);
  };
  return (
    <main className="min-h-screen bg-[#9d174d] p-3 text-[#831843] sm:p-5">
      <div className="mx-auto grid min-h-[calc(100vh-24px)] max-w-[1500px] overflow-hidden rounded-[2rem] bg-white shadow-2xl lg:grid-cols-[1.15fr_.85fr]">
        <section className="relative flex flex-col justify-between overflow-hidden bg-[#831843] p-9 text-white sm:p-14">
          <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-500/25 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" />
          <div className="relative">
            <p className="text-2xl font-extrabold tracking-tight text-[#e4e4e7]">fincore<span className="ml-2 text-xs font-semibold uppercase tracking-[.25em]">Gi</span></p>
          </div>
          <div className="relative max-w-xl py-12">
            <p className="mb-5 text-xs font-extrabold tracking-[.2em] text-brand-200">
              GESTÃO FINANCEIRA · GI
            </p>
            <h1 className="text-5xl font-extrabold leading-[1.04] sm:text-6xl">
              Clareza para decidir. Controle para crescer.
            </h1>
            <p className="mt-7 max-w-lg text-lg leading-relaxed text-brand-100">
              Organize receitas, despesas, contas e operações com uma visão
              financeira construída para o seu dia a dia.
            </p>
          </div>
          <p className="relative text-sm text-brand-200">
            FinCore Gi · gestão que acompanha suas decisões
          </p>
        </section>
        <section className="flex items-center justify-center bg-[#fafafa] p-8 sm:p-14">
          <form onSubmit={submit} className="w-full max-w-md">
            <img
              src={`${import.meta.env.BASE_URL}fincore-gi-logo.svg`}
              alt="FinCore Gi"
              className="mb-12 w-64 max-w-full"
            />
            <p className="text-xs font-extrabold tracking-widest text-brand-700">
              BEM-VINDO
            </p>
            <h2 className="mt-2 text-3xl font-extrabold">
              Acesse sua operação
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              Entre para acompanhar o que importa no seu negócio.
            </p>
            <label className="mt-8 block text-xs font-bold text-zinc-600">
              E-mail
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 text-sm font-normal outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <label className="mt-4 block text-xs font-bold text-zinc-600">
              Senha
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 text-sm font-normal outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            {error && (
              <p className="mt-3 text-sm font-bold text-red-600">{error}</p>
            )}
            <button
              disabled={busy}
              className="mt-6 w-full rounded-xl bg-[#831843] py-3.5 text-sm font-semibold text-white shadow-[0_10px_24px_-10px_rgba(24,24,27,0.7)] transition hover:bg-pink-950 hover:shadow-[0_14px_28px_-10px_rgba(24,24,27,0.8)] disabled:cursor-wait disabled:opacity-70"
            >
              {busy ? "Entrando..." : "Entrar no Fincore"}
            </button>
            <p className="mt-6 text-center text-xs text-zinc-400">
              Acesso protegido e gerenciado pelo administrador.
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}

function NewCategory({
  close,
  save,
  category,
  allowedUnits,
  allowIncome = true,
}: {
  close: () => void;
  save: (c: Category) => Promise<void>;
  category?: Category | null;
  allowedUnits: typeof units;
  /** Categorias de receita são exclusivas do Master. */
  allowIncome?: boolean;
}) {
  const [name, setName] = useState(category?.name ?? ""),
    [kind, setKind] = useState<Kind>(category?.kind ?? "despesa"),
    [unit, setUnit] = useState<Unit>(
      category?.unit ?? allowedUnits[0]?.name ?? "Consultoria",
    ),
    [icon, setIcon] = useState(category?.icon ?? "🏷️"),
    [color, setColor] = useState(category?.color ?? "#3b82f6"),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState("");
  const [converting, setConverting] = useState(false);
  // Any picture becomes a light square icon (see imageToIcon).
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setSaveError("");
    setConverting(true);
    try {
      setIcon(await imageToIcon(f));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível ler esta imagem.");
    } finally {
      setConverting(false);
    }
  };
  const photo = icon.startsWith("data:");
  return (
    <div className="fc-overlay fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-[2px] p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim()) {
            setSaving(true);
            setSaveError("");
            try {
              await save({
                id: category?.id ?? id(),
                name: name.trim(),
                kind,
                unit,
                icon,
                color,
              });
              close();
            } catch (error) {
              setSaveError(
                error instanceof Error
                  ? error.message
                  : "Não foi possível salvar no banco.",
              );
            } finally {
              setSaving(false);
            }
          }
        }}
        className="w-full max-w-lg overflow-hidden rounded-[1.5rem] bg-white shadow-2xl"
      >
        <header className="flex items-center gap-4 border-b border-zinc-100 px-6 py-5">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[18px] text-2xl shadow-md ring-1 ring-black/5"
            style={{ backgroundColor: color }}
          >
            {photo ? <img src={icon} alt="" className="h-full w-full object-cover" /> : icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-zinc-500">{category ? "Editar categoria" : "Nova categoria"}</p>
            <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-[#831843]">
              {name.trim() || "Nome da categoria"}
            </h2>
            <p className="text-[11px] text-zinc-400">{kind === "receita" ? "Receita" : "Despesa"} · {unit}</p>
          </div>
          <button type="button" aria-label="Fechar" onClick={close} className="rounded-full p-2 text-zinc-500 hover:rotate-90 hover:bg-zinc-100 hover:text-[#831843]">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-4 p-6">
          <label className="block text-xs font-bold text-zinc-600">
            Nome
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
              placeholder="Ex.: Manutenção de máquinas"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-bold">
              Tipo
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
              >
                {allowIncome && <option value="receita">Receita</option>}
                <option value="despesa">Despesa</option>
              </select>
            </label>
            <label className="text-xs font-bold">
              Centro de custo
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as Unit)}
                className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
              >
                {allowedUnits.map((u) => (
                  <option key={u.name}>{u.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <p className="mb-2 text-xs font-bold">Ícone</p>
            <label className="mb-3 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-3 transition hover:border-[#831843] hover:bg-white">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-zinc-500 ring-1 ring-zinc-200">
                {photo ? <img src={icon} alt="" className="h-full w-full object-cover" /> : <Paperclip className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[#831843]">{converting ? "Preparando imagem…" : photo ? "Trocar imagem" : "Usar uma foto ou logo como ícone"}</span>
                <span className="block text-[11px] font-normal text-zinc-500">PNG, JPG, WebP, SVG, GIF, AVIF ou HEIC. Logos transparentes ficam inteiros; fotos são recortadas em quadrado.</span>
              </span>
              <input type="file" accept={ICON_ACCEPT} onChange={(event) => void upload(event)} disabled={converting} className="hidden" />
            </label>
            <div className="flex flex-wrap gap-2">
              {icons.map((x) => (
                <button
                  type="button"
                  onClick={() => setIcon(x)}
                  className={`h-10 w-10 rounded-xl text-lg transition ${icon === x ? "bg-[#831843] shadow-md ring-2 ring-[#831843] ring-offset-2" : "bg-zinc-50 ring-1 ring-zinc-200 hover:scale-110 hover:bg-white"}`}
                  key={x}
                >
                  {x}
                </button>
              ))}

            </div>
          </div>
          <label className="block text-xs font-bold">
            Cor da categoria
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="ml-3 h-8 w-12 align-middle"
            />
          </label>
        </div>
        <footer className="relative flex gap-3 border-t border-zinc-100 bg-zinc-50/70 px-6 py-4">
          <button
            type="button"
            onClick={close}
            className="flex-1 rounded-full bg-white py-2.5 text-sm font-medium ring-1 ring-zinc-200 hover:bg-zinc-100"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            className="flex-1 rounded-full bg-[#831843] py-2.5 text-sm font-medium text-white shadow-[0_10px_24px_-12px_rgba(24,24,27,0.9)] hover:bg-pink-950 disabled:opacity-60"
          >
            {saving
              ? "Salvando no banco..."
              : category
                ? "Salvar alterações"
                : "Criar categoria"}
          </button>
          {saveError && (
            <p className="absolute -top-5 left-6 text-xs font-bold text-red-600">
              {saveError}
            </p>
          )}
        </footer>
      </form>
    </div>
  );
}
function CostCenterForm({
  editing,
  close,
  save,
}: {
  editing?: CostCenter | null;
  close: () => void;
  save: (name: string, initials: string, color: string) => Promise<void>;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [initials, setInitials] = useState(editing?.initials ?? "");
  const [color, setColor] = useState(editing?.colorKey ?? costCenterColors[0].key);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEdit = Boolean(editing);
  return (
    <div className="fc-overlay fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-[2px] p-4">
      <form onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError("");
        try {
          await save(name.trim().replace(/\s+/g, " "), initials.trim().toLocaleUpperCase("pt-BR"), color);
          close();
        } catch (saveError) {
          setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o centro de custo.");
        } finally {
          setSaving(false);
        }
      }} className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="fc-h">{isEdit ? "Editar plano de contas" : "Novo plano de contas"}</h2>
            <p className="mt-1 text-xs text-zinc-500">{isEdit ? "Ajuste a sigla e a cor deste centro de custo." : "Cria um centro de custo com categorias próprias."}</p>
          </div>
          <button type="button" onClick={close} aria-label="Fechar"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-4 p-6">
          <label className="block text-xs font-bold text-zinc-700">Nome do centro de custo
            <input required minLength={2} maxLength={80} value={name} disabled={isEdit} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Nova operação" className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal disabled:cursor-not-allowed disabled:text-zinc-400" />
            {isEdit && <span className="mt-1 block font-normal text-zinc-400">O nome não pode ser alterado.</span>}
          </label>
          <label className="block text-xs font-bold text-zinc-700">Sigla (opcional)
            <input maxLength={4} value={initials} onChange={(event) => setInitials(event.target.value)} placeholder="Ex.: NO" className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal" />
          </label>
          <div className="text-xs font-bold text-zinc-700">Cor do plano
            <div className="mt-2 flex flex-wrap gap-2">
              {costCenterColors.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setColor(item.key)}
                  aria-label={item.label}
                  aria-pressed={color === item.key}
                  title={item.label}
                  className={`h-8 w-8 rounded-full border-2 transition ${color === item.key ? "border-zinc-900 ring-2 ring-zinc-300" : "border-white"}`}
                  style={{ backgroundColor: item.swatch }}
                />
              ))}
            </div>
          </div>
          {!isEdit && <p className="text-xs text-zinc-500">Depois de criar, use “Nova categoria” para cadastrar as receitas e despesas deste plano.</p>}
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
        </div>
        <footer className="flex gap-3 border-t bg-zinc-50 px-6 py-4">
          <button type="button" onClick={close} className="flex-1 rounded-xl border py-2.5 text-sm font-bold">Cancelar</button>
          <button disabled={saving} className="flex-1 rounded-xl bg-brand-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? "Salvando…" : isEdit ? "Salvar alterações" : "Criar plano"}</button>
        </footer>
      </form>
    </div>
  );
}
function DeleteCostCenter({
  center,
  categoryCount,
  entryCount,
  close,
  confirm,
}: {
  center: CostCenter;
  categoryCount: number;
  entryCount: number;
  close: () => void;
  confirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = typed.trim() === center.name;
  return (
    <div className="fc-overlay fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-[2px] p-4">
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (!matches) return;
        setBusy(true);
        setError("");
        try {
          await confirm();
          close();
        } catch (deleteError) {
          setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir o plano.");
        } finally {
          setBusy(false);
        }
      }} className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="font-extrabold text-red-700">Excluir “{center.name}”</h2>
            <p className="mt-1 text-xs text-zinc-500">Esta ação não pode ser desfeita.</p>
          </div>
          <button type="button" onClick={close} aria-label="Fechar"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-4 p-6">
          <div className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">
            Ao excluir este plano, também serão apagados <b>permanentemente</b>:
            <ul className="mt-2 list-disc pl-4 font-normal">
              <li>{categoryCount} categoria(s)</li>
              <li>{entryCount} lançamento(s)</li>
              <li>as contas e os favorecidos deste centro</li>
            </ul>
          </div>
          <label className="block text-xs font-bold text-zinc-700">Para confirmar, digite o nome do plano: <span className="text-red-600">{center.name}</span>
            <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={center.name} className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal" />
          </label>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
        </div>
        <footer className="flex gap-3 border-t bg-zinc-50 px-6 py-4">
          <button type="button" onClick={close} className="flex-1 rounded-xl border py-2.5 text-sm font-bold">Cancelar</button>
          <button disabled={!matches || busy} className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? "Excluindo…" : "Excluir tudo"}</button>
        </footer>
      </form>
    </div>
  );
}

function ContactsScreen({
  contacts,
  allowedUnits,
  tableReady,
  allowClients = true,
  save,
  archive,
}: {
  contacts: Counterparty[];
  allowedUnits: typeof units;
  tableReady: boolean;
  /** Clientes/pagadores são exclusivos do Master; os demais só fornecedores. */
  allowClients?: boolean;
  save: (contact: Counterparty) => Promise<void>;
  archive: (contact: Counterparty, archived: boolean) => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>("despesa");
  const [editing, setEditing] = useState<Counterparty | null>(null);
  const [unit, setUnit] = useState<Unit>(allowedUnits[0]?.name ?? "Consultoria");
  const [name, setName] = useState("");
  const [provides, setProvides] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<Counterparty | null>(null);
  const [error, setError] = useState("");
  const relevant = contacts.filter(
    (contact) =>
      contact.kind === kind &&
      !contact.archived &&
      allowedUnits.some((allowed) => allowed.name === contact.unit),
  );
  const archivedContacts = contacts.filter(
    (contact) =>
      contact.kind === kind &&
      contact.archived &&
      allowedUnits.some((allowed) => allowed.name === contact.unit),
  );
  const title = kind === "despesa" ? "Fornecedores" : "Clientes / pagadores";
  const reset = () => {
    setEditing(null);
    setName("");
    setProvides("");
    setError("");
  };
  const selectKind = (nextKind: Kind) => {
    setKind(nextKind);
    reset();
    setUnit(allowedUnits[0]?.name ?? "Consultoria");
  };
  const changeArchive = async (contact: Counterparty, archived: boolean) => {
    setArchiveBusy(true);
    setError("");
    try {
      await archive(contact, archived);
      if (editing?.id === contact.id) reset();
      setConfirmArchive(null);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Não foi possível alterar o cadastro.");
      setConfirmArchive(null);
    } finally {
      setArchiveBusy(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!tableReady) return;
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (!cleanName) return setError("Informe um nome.");
    if (kind === "despesa" && !provides.trim())
      return setError("Informe o que este fornecedor fornece.");
    if (
      relevant.some(
        (contact) =>
          contact.id !== editing?.id &&
          contactIdentity(kind, contact.unit, contact.name) ===
            contactIdentity(kind, unit, cleanName),
      )
    )
      return setError("Este nome já está cadastrado neste centro de custo.");
    if (
      archivedContacts.some(
        (contact) =>
          contactIdentity(kind, contact.unit, contact.name) ===
          contactIdentity(kind, unit, cleanName),
      )
    )
      return setError("Este cadastro está arquivado. Restaure-o na lista abaixo.");
    setSaving(true);
    setError("");
    try {
      await save({
        id: editing?.id ?? id(),
        kind,
        unit,
        name: cleanName,
        provides: kind === "despesa" ? provides.trim() : "",
      });
      reset();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-[#831843]">
          {allowClients ? "Cadastro de fornecedores e clientes" : "Cadastro de fornecedores"}
        </h2>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tipo de cadastro">
        {(allowClients ? (["despesa", "receita"] as Kind[]) : (["despesa"] as Kind[])).map((tabKind) => (
          <button key={tabKind} type="button" role="tab" aria-selected={kind === tabKind} onClick={() => selectKind(tabKind)} className={`rounded-xl px-4 py-2 text-sm font-bold ${kind === tabKind ? "bg-brand-700 text-white" : "border bg-white text-zinc-600"}`}>
            {tabKind === "despesa" ? "Fornecedores" : "Clientes / pagadores"}
          </button>
        ))}
      </div>
      <div>
        <h3 className="fc-h">{title}</h3>
        <p className="text-xs text-zinc-500">
          {kind === "despesa"
            ? "Cadastre o fornecedor e o que ele fornece para selecioná-lo nas despesas."
            : "Cadastre quem paga para selecioná-lo nas receitas."}
        </p>
      </div>
      {!tableReady && (
        <p className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
          Prévia local: os nomes dos lançamentos antigos aparecem abaixo. Para criar ou alterar cadastros compartilhados, ainda é necessário aplicar a migração ao banco.
        </p>
      )}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
      <form onSubmit={submit} className="grid gap-3 fc-card p-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="text-xs font-bold text-zinc-700">
          Nome
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
            placeholder={kind === "despesa" ? "Nome do fornecedor" : "Nome do cliente / pagador"}
            disabled={!tableReady}
          />
        </label>
        <label className="text-xs font-bold text-zinc-700">
          Centro de custo
          <select
            value={unit}
            onChange={(event) => setUnit(event.target.value as Unit)}
            className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
            disabled={!tableReady || !!editing}
          >
            {allowedUnits.map((allowed) => <option key={allowed.name}>{allowed.name}</option>)}
          </select>
        </label>
        {kind === "despesa" && (
          <label className="text-xs font-bold text-zinc-700 md:col-span-2">
            O que fornece
            <input
              value={provides}
              onChange={(event) => setProvides(event.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
              placeholder="Ex.: serviços de limpeza, insumos, consultoria"
              disabled={!tableReady}
            />
          </label>
        )}
        <div className="flex gap-2 md:col-start-3">
          {editing && <button type="button" onClick={reset} className="rounded-xl border px-4 py-3 text-xs font-bold">Cancelar</button>}
          <button type="submit" disabled={!tableReady || saving || !allowedUnits.length} className="rounded-full bg-[#831843] px-4 py-3 hover:bg-pink-950 shadow-[0_8px_20px_-10px_rgba(24,24,27,0.8)] text-xs font-bold text-white disabled:opacity-50">
            {saving ? "Salvando…" : editing ? "Salvar" : "Cadastrar"}
          </button>
        </div>
      </form>
      <section className="fc-card p-5">
        <h3 className="mb-3 font-extrabold text-[#831843]">Cadastrados ({relevant.length})</h3>
        {relevant.length ? (
          <div className="divide-y">
            {relevant.map((contact) => (
              <div key={contact.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-bold text-zinc-800">{contact.name}</p>
                  <p className="text-xs text-zinc-500">
                    {contact.unit}
                    {kind === "despesa" && ` · ${contact.provides || "O que fornece não informado"}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {contact.id.startsWith("legacy:") && (
                    <span className="text-[11px] font-medium text-amber-700">Aguardando banco</span>
                  )}
                  <button type="button" disabled={!tableReady || contact.id.startsWith("legacy:")} title={!tableReady || contact.id.startsWith("legacy:") ? "Disponível após aplicar a migração do banco" : undefined} onClick={() => {
                    setEditing(contact);
                    setUnit(contact.unit);
                    setName(contact.name);
                    setProvides(contact.provides);
                    setError("");
                  }} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-brand-700 disabled:cursor-not-allowed disabled:opacity-40">
                    Editar
                  </button>
                  <button type="button" disabled={!tableReady || contact.id.startsWith("legacy:")} title={!tableReady || contact.id.startsWith("legacy:") ? "Disponível após aplicar a migração do banco" : undefined} onClick={() => {
                    setConfirmArchive(contact);
                    setError("");
                  }} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 disabled:cursor-not-allowed disabled:opacity-40">
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-5 text-center text-sm text-zinc-400">Nenhum nome informado nos lançamentos deste acesso.</p>
        )}
      </section>
      {archivedContacts.length > 0 && (
        <section className="fc-card p-5">
          <h3 className="mb-3 font-extrabold text-[#831843]">Arquivados ({archivedContacts.length})</h3>
          <div className="divide-y">
            {archivedContacts.map((contact) => (
              <div key={contact.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-bold text-zinc-600">{contact.name}</p>
                  <p className="text-xs text-zinc-400">{contact.unit}</p>
                </div>
                <button type="button" disabled={archiveBusy} onClick={() => void changeArchive(contact, false)} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-brand-700 disabled:opacity-50">
                  Restaurar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {confirmArchive && (
        <div className="fc-overlay fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4" role="presentation" onClick={() => setConfirmArchive(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="archive-contact-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h3 id="archive-contact-title" className="text-lg font-extrabold text-[#831843]">Excluir {confirmArchive.name}?</h3>
            <p className="mt-2 text-sm text-zinc-600">O cadastro será arquivado e sairá das opções de novos lançamentos. Os lançamentos antigos e seus valores serão preservados.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmArchive(null)} className="rounded-xl border px-4 py-2 text-xs font-bold">Cancelar</button>
              <button type="button" disabled={archiveBusy} onClick={() => void changeArchive(confirmArchive, true)} className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{archiveBusy ? "Arquivando…" : "Excluir cadastro"}</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export function EntryForm({
  kind: initial,
  cardMode,
  onNewCategory,
  onNewCenter,
  categories,
  contacts,
  contactsTableReady,
  allowedUnits,
  banks,
  allowIncome = true,
  editing,
  scope: initialScope,
  close,
  save,
  onDelete,
}: {
  /** Shown only when editing: deletes this entry (and offers the whole series). */
  onDelete?: () => void;
  cardMode?: PersonalCreditCard;
  onNewCategory?: () => void;
  onNewCenter?: () => void;
  kind: Kind;
  categories: Category[];
  contacts: Counterparty[];
  contactsTableReady: boolean;
  allowedUnits: typeof units;
  banks: Bank[];
  /** Só o Master pode lançar receitas; os demais só despesas. */
  allowIncome?: boolean;
  editing: Entry | null;
  scope?: "one" | "series";
  close: () => void;
  save: (
    x: Omit<Entry, "id">,
    scope: "one" | "series",
    sameMonthParts?: SameMonthPart[],
  ) => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>(editing?.kind ?? (allowIncome ? initial : "despesa")),
    [unit, setUnit] = useState<Unit>(editing?.unit ?? allowedUnits[0]?.name ?? "Consultoria"),
    [category, setCategory] = useState(editing?.category ?? ""),
    [description, setDescription] = useState(editing?.description ?? ""),
    [beneficiary, setBeneficiary] = useState(editing?.beneficiary ?? ""),
    [contactPickerOpen, setContactPickerOpen] = useState(false),
    [contactSearch, setContactSearch] = useState(""),
    [contactActiveIndex, setContactActiveIndex] = useState(-1),
    [counterpartyId, setCounterpartyId] = useState<string>(
      editing?.counterpartyId ??
        (editing
          ? contacts.find(
              (contact) =>
                contact.kind === editing.kind &&
                contact.unit === editing.unit &&
                counterpartyKey(contact.kind, contact.name) ===
                  counterpartyKey(editing.kind, editing.beneficiary || ""),
            )?.id
          : undefined) ??
        "",
    ),
    [pix, setPix] = useState(editing?.pix ?? ""),
    [notes, setNotes] = useState(editing?.notes ?? ""),
    // Valor efetivamente pago; juros e desconto são calculados a partir dele.
    [paidValue, setPaidValue] = useState(
      editing && ((editing.juros ?? 0) > 0 || (editing.discount ?? 0) > 0)
        ? String(Math.round((editing.amount + (editing.juros ?? 0) - (editing.discount ?? 0)) * 100) / 100)
        : "",
    ),
    [bankId, setBankId] = useState<string>(() => editing ? editing.bankId ?? "" : defaultBankId(banks)),
    [dragging, setDragging] = useState(false),
    [paidDate, setPaidDate] = useState(editing?.paidDate ?? ""),
    [amount, setAmount] = useState(editing ? String(editing.amount) : ""),
    [date, setDate] = useState(
      editing?.date ?? new Date().toISOString().slice(0, 10),
    ),
    [status, setStatus] = useState<Entry["status"]>(
      editing?.status ?? "previsto",
    ),
    [recurrence, setRecurrence] = useState(Boolean(editing && editing.recurrence !== "nenhuma")),
    [frequency, setFrequency] = useState<"mensal" | "semanal">(editing?.recurrence === "semanal" ? "semanal" : "mensal"),
    [installments, setInstallments] = useState(editing?.installments ?? 1),
    [sameMonthInstallments, setSameMonthInstallments] = useState(false),
    [sameMonthPartCount, setSameMonthPartCount] = useState(2),
    [sameMonthPartsState, setSameMonthPartsState] = useState<SameMonthPart[]>(
      [],
    ),
    [scope, setScope] = useState<"one" | "series">(initialScope ?? "one"),
    [existingAttachments, setExistingAttachments] = useState<string[]>(editing?.attachments ?? []),
    [newFiles, setNewFiles] = useState<File[]>([]),
    [removedAttachments, setRemovedAttachments] = useState<string[]>([]),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState("");
  const attachmentName = (path: string) => {
    const base = path.split("/").pop() || path;
    return base.replace(/^\d+-/, "");
  };
  const openAttachment = async (path: string) => {
    try {
      const url = await signedAttachmentUrl(path);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível abrir o arquivo.");
    }
  };
  // O valor pago vale para um único pagamento: aparece em despesas avulsas e
  // ao editar um só mês, mas não ao criar um parcelamento/recorrência nem ao
  // editar "Toda a série" (senão o valor de um mês seria copiado para todos).
  // Editar um lançamento avulso e escolher dividir, parcelar ou recorrente
  // transforma-o numa série nova que substitui o original ao salvar.
  const standaloneEdit = Boolean(editing && !editing.seriesId);
  const converting =
    standaloneEdit && (recurrence || installments > 1 || sameMonthInstallments);
  const showPaidValue =
    kind === "despesa" &&
    (editing && !converting
      ? scope !== "series"
      : !recurrence && installments <= 1 && !sameMonthInstallments);
  const paidNumber = parseMoney(paidValue);
  const amountNumber = parseMoney(amount);
  const paidDiff =
    showPaidValue && Number.isFinite(paidNumber) && Number.isFinite(amountNumber)
      ? Math.round((paidNumber - amountNumber) * 100) / 100
      : 0;
  const computedJuros = paidDiff > 0 ? paidDiff : 0;
  const computedDiscount = paidDiff < 0 ? -paidDiff : 0;
  // Com o campo oculto na edição, mantém os valores que o lançamento já tinha.
  const finalJuros = showPaidValue ? computedJuros : editing?.juros ?? 0;
  const finalDiscount = showPaidValue ? computedDiscount : editing?.discount ?? 0;
  const addFiles = async (picked: File[]) => {
    if (!picked.length) return;
    const invalid = picked.find(
      (file) =>
        !["application/pdf", "image/png", "image/jpeg"].includes(file.type) &&
        !/\.(pdf|png|jpe?g)$/i.test(file.name),
    );
    if (invalid) {
      setSaveError(`"${invalid.name}" não é aceito. Envie PDF, PNG ou JPG.`);
      return;
    }
    const tooBig = picked.find((file) => file.size > 10 * 1024 * 1024);
    if (tooBig) {
      setSaveError(`O arquivo "${tooBig.name}" passa de 10 MB. Reduza o tamanho e tente novamente.`);
      return;
    }
    // Lê o arquivo agora: o envio usa essa cópia e não depende do original.
    const copies: File[] = [];
    for (const file of picked) {
      try {
        copies.push(await snapshotFile(file));
      } catch {
        setSaveError(unreadableFileMessage(file.name));
        return;
      }
    }
    setNewFiles((old) => [...old, ...copies]);
    setSaveError("");
  };
  const available = categories.filter(
    (c) => c.unit === unit && c.kind === kind,
  );
  const selectableContacts = contacts.filter(
    (contact) =>
      contact.kind === kind &&
      allowedUnits.some((allowed) => allowed.name === contact.unit) &&
      !contact.archived,
  );
  const matchingContacts = selectableContacts
    .filter((contact) =>
      `${contact.name} ${contact.unit}`
        .toLocaleLowerCase("pt-BR")
        .includes(contactSearch.trim().toLocaleLowerCase("pt-BR")),
    )
    .sort((a, b) =>
      Number(b.unit === unit) - Number(a.unit === unit) ||
      a.name.localeCompare(b.name, "pt-BR"),
    );
  const chooseContact = (contact: Counterparty) => {
    setUnit(contact.unit);
    setBeneficiary(contact.name);
    setCounterpartyId(contact.id);
    setContactPickerOpen(false);
    setContactSearch("");
    setContactActiveIndex(-1);
  };
  useEffect(() => {
    setCategory(current => categorySelection(current, available,
      !!editing && editing.unit === unit && editing.kind === kind));
  }, [kind, unit, categories, editing?.id]);
  const monthlyPreview = !recurrence && !sameMonthInstallments && installments > 1 && date &&
    Number.isFinite(parseMoney(amount)) && Math.round(parseMoney(amount) * 100) >= installments
      ? (cardMode ? cardSchedule({amount:parseMoney(amount),date,recurrence:"nenhuma",installments},cardMode) : monthlyParts(installments, parseMoney(amount), date)) : [];
  const purchaseInvoiceDue = cardMode && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? (editing?.invoiceMonth && date === (editing.cardPurchaseDate || editing.date)
      ? invoiceCycle(editing.invoiceMonth,cardMode).due : invoiceDate(date, cardMode, editing?.cardInstallmentOffset || 0)) : "";
  const purchaseCycle = cardMode && purchaseInvoiceDue ? invoiceCycle(purchaseInvoiceDue.slice(0,7),cardMode) : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = parseMoney(amount);
    const contactName = beneficiary.trim().replace(/\s+/g, " ");
    if (!description.trim()) {
      setSaveError("Informe uma descrição para o lançamento.");
      return;
    }
    if (!Number.isFinite(v) || v <= 0) {
      setSaveError("Informe um valor válido, por exemplo 1.500,00.");
      return;
    }
    if (!recurrence && !sameMonthInstallments && Math.round(v * 100) < installments) {
      setSaveError("O valor total precisa permitir ao menos R$ 0,01 por parcela.");
      return;
    }
    if (!category) {
      setSaveError("Selecione uma categoria antes de salvar.");
      return;
    }
    if (
      contactName &&
      contacts.some(
        (contact) =>
          contact.archived &&
          contact.id !== editing?.counterpartyId &&
          contact.unit === unit &&
          contact.kind === kind &&
          counterpartyKey(kind, contact.name) === counterpartyKey(kind, contactName),
      )
    ) {
      setSaveError("Este contato está arquivado. Restaure-o na aba Fornecedores e clientes antes de usar.");
      return;
    }
    if (sameMonthInstallments) {
      const partsTotal = sameMonthPartsState.reduce(
        (sum, part) => sum + parseMoney(part.amount),
        0,
      );
      const validDates = sameMonthPartsState.every(
        (part) =>
          part.date &&
          part.date.slice(0, 7) === date.slice(0, 7) &&
          Number.isFinite(parseMoney(part.amount)) &&
          parseMoney(part.amount) > 0,
      );
      if (!validDates) {
        setSaveError(
          "Informe uma data e um valor válido para cada parcela deste mês.",
        );
        return;
      }
      if (Math.round(partsTotal * 100) !== Math.round(v * 100)) {
        setSaveError("A soma das parcelas precisa ser igual ao valor total.");
        return;
      }
    }
    setSaving(true);
    setSaveError("");
    try {
      const folder = editing?.id ?? (crypto.randomUUID?.() ?? `${Date.now()}`);
      const uploaded: string[] = [];
      for (const file of newFiles) {
        // A chave do Storage precisa ser ASCII: remove acentos e troca
        // qualquer caractere fora de [A-Za-z0-9._-] por "_".
        const safe = file.name
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^\w.\-]+/g, "_");
        const path = `${folder}/${Date.now()}-${safe}`;
        await uploadEntryAttachment(path, file);
        uploaded.push(path);
      }
      const attachments = [...existingAttachments, ...uploaded];
      await save(
        {
          kind,
          unit,
          // Campo legado para compatibilidade; a conta bancária é vinculada por bankId.
          account: unit,
          category,
          description,
          beneficiary: contactName,
          counterpartyId: contactsTableReady
            ? counterpartyId && !counterpartyId.startsWith("legacy:")
              ? counterpartyId
              : null
            : undefined,
          pix: kind === "despesa" ? pix : "",
          notes,
          amount: v,
          date,
          status: cardMode ? "previsto" : status,
          recurrence: recurrence ? frequency : "nenhuma",
          installments: sameMonthInstallments ? 1 : installments,
          attachments,
          juros: kind === "despesa" ? finalJuros : 0,
          paidDate: !cardMode && status === "realizado" ? paidDate || date : null,
          discount: kind === "despesa" ? finalDiscount : 0,
          bankId: cardMode ? null : bankId || null,
        },
        scope,
        sameMonthInstallments ? sameMonthPartsState : undefined,
      );
      if (removedAttachments.length) {
        try {
          await removeEntryAttachments(removedAttachments);
        } catch (cleanupError) {
          console.error("Fincore: falha ao remover arquivos antigos", cleanupError);
        }
      }
      close();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar no banco.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className="fc-overlay fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-[2px] p-4"
      // Soltar um arquivo em qualquer ponto do formulário anexa o arquivo, em
      // vez de o navegador sair da tela para abri-lo.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <form
        onSubmit={submit}
        className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="fc-h">
              {editing ? "Editar" : "Novo"} lançamento{cardMode ? ` no cartão ${cardMode.name}` : ""}
            </h2>
            <p className="text-xs text-zinc-400">
              A categoria é filtrada pelo plano de contas do centro escolhido.
            </p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        <div className="space-y-5 p-6">
          {allowIncome && (
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border text-sm font-bold">
            <button
              type="button"
              onClick={() => {
                setKind("despesa");
                setCounterpartyId("");
                setBeneficiary("");
              }}
              className={`p-3 ${kind === "despesa" ? "bg-red-600 text-white" : "text-zinc-500"}`}
            >
              Despesa
            </button>
            <button
              type="button"
              onClick={() => {
                setKind("receita");
                setCounterpartyId("");
                setBeneficiary("");
              }}
              className={`p-3 ${kind === "receita" ? "bg-emerald-600 text-white" : "text-zinc-500"}`}
            >
              Receita
            </button>
          </div>
          )}
          <div className="max-w-sm">
            <label className="text-xs font-bold">
              Centro de custo
              <select
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value as Unit);
                  setCounterpartyId("");
                  setBeneficiary("");
                }}
                className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
              >
                {allowedUnits.map((u) => (
                  <option key={u.name}>{u.name}</option>
                ))}
              </select>
            </label>
          </div>
          {cardMode && <div className="flex flex-wrap gap-3"><button type="button" onClick={onNewCenter} className="text-xs font-bold text-brand-700">+ Novo centro de custo</button><button type="button" onClick={onNewCategory} className="text-xs font-bold text-brand-700">+ Nova categoria / plano de contas</button></div>}
          <label className="block text-xs font-bold">
            {cardMode ? "Categoria / plano de contas" : "Categoria"}
            <select
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
            >
              <option value="" disabled>
                Selecione uma categoria
              </option>
              {category && !available.some(c => c.name === category) && (
                <option value={category}>{category} (categoria do lançamento)</option>
              )}
              {available.map((c) => (
                <option key={c.id}>{c.name}</option>
              ))}
            </select>
            {!available.length && (
              <span className="mt-1 block text-red-600">
                Cadastre uma categoria para este centro no Plano de contas.
              </span>
            )}
          </label>
          <label className="block text-xs font-bold">
            Descrição
            <input
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
            />
          </label>
          <div
            className={`grid gap-4 ${kind === "despesa" ? "sm:grid-cols-2" : "max-w-sm"}`}
          >
            <div className="relative text-xs font-bold" onBlur={(event) => {
              if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
                setContactPickerOpen(false);
                setContactActiveIndex(-1);
              }
            }}>
              <label htmlFor="entry-counterparty">
                {kind === "despesa"
                  ? "Fornecedor / favorecido (opcional)"
                  : "Cliente / pagador (opcional)"}
              </label>
              <div className="relative mt-1.5">
                <input
                  id="entry-counterparty"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={contactPickerOpen}
                  aria-controls="entry-counterparty-options"
                  value={beneficiary}
                  onFocus={() => {
                    setContactSearch("");
                    setContactPickerOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setContactPickerOpen(false);
                      setContactActiveIndex(-1);
                    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      setContactPickerOpen(true);
                      setContactActiveIndex((index) =>
                        event.key === "ArrowDown"
                          ? Math.min(index + 1, matchingContacts.length - 1)
                          : Math.max(index - 1, 0),
                      );
                    } else if (event.key === "Enter" && contactPickerOpen && contactActiveIndex >= 0 && matchingContacts[contactActiveIndex]) {
                      event.preventDefault();
                      chooseContact(matchingContacts[contactActiveIndex]);
                    }
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    const match = selectableContacts.find(
                      (contact) =>
                        contact.unit === unit &&
                        counterpartyKey(kind, contact.name) === counterpartyKey(kind, value),
                    );
                    setBeneficiary(value);
                    setCounterpartyId(match?.id ?? "");
                    setContactSearch(value);
                    setContactActiveIndex(-1);
                    setContactPickerOpen(true);
                  }}
                  placeholder={kind === "despesa" ? "Selecione ou digite o fornecedor" : "Selecione ou digite o cliente"}
                  className="w-full rounded-xl border bg-zinc-50 p-3 pr-10 text-sm font-normal focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
                <button type="button" aria-label="Mostrar contatos cadastrados" aria-expanded={contactPickerOpen} onClick={() => {
                  setContactSearch("");
                  setContactActiveIndex(-1);
                  setContactPickerOpen((open) => !open);
                }} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-500">
                  <ChevronRight className={`h-4 w-4 transition-transform ${contactPickerOpen ? "rotate-90" : "rotate-0"}`} />
                </button>
              {contactPickerOpen && (
                <div id="entry-counterparty-options" role="listbox" className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-52 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1.5 text-left shadow-xl">
                  {matchingContacts.length ? matchingContacts.map((contact, index) => (
                    <button key={contact.id} type="button" role="option" aria-selected={contactActiveIndex === index} onClick={() => chooseContact(contact)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold ${contactActiveIndex === index ? "bg-brand-50 text-brand-800" : "text-zinc-800 hover:bg-zinc-50"}`}>
                      <span className="truncate">{contact.name}</span>
                      <span className="shrink-0 text-[11px] font-normal text-zinc-500">{contact.unit}</span>
                    </button>
                  )) : (
                    <p className="px-3 py-2.5 text-xs font-normal text-zinc-500">{beneficiary.trim() ? "Nome novo: salve o lançamento para cadastrá-lo." : "Nenhum contato cadastrado."}</p>
                  )}
                </div>
              )}
              </div>
              <span className="mt-1 block text-[11px] font-normal text-zinc-500">
                Escolha um contato de qualquer centro permitido ou digite um nome novo. Ao escolher outro centro, o lançamento muda para ele.
              </span>
            </div>
            {kind === "despesa" && (
              <label className="text-xs font-bold">
                Chave PIX ou dados de pagamento
                <input
                  value={pix}
                  onChange={(e) => setPix(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
                />
              </label>
            )}
          </div>
          <label className="block text-xs font-bold">
            Observacoes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
            />
          </label>
          <div className="block text-xs font-bold">
            Anexos (boleto, comprovante, nota)
            <div className="mt-1.5 space-y-2">
              {existingAttachments.map((path) => (
                <div key={path} className="flex items-center gap-2 rounded-xl border bg-zinc-50 p-2 text-xs font-normal">
                  <Paperclip className="h-4 w-4 shrink-0 text-zinc-500" />
                  <button type="button" onClick={() => void openAttachment(path)} className="flex-1 truncate text-left text-brand-700 hover:underline">
                    {attachmentName(path)}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExistingAttachments((old) => old.filter((item) => item !== path));
                      setRemovedAttachments((old) => [...old, path]);
                    }}
                    className="rounded px-1.5 py-0.5 font-bold text-red-600 hover:bg-red-50"
                    aria-label={`Remover ${attachmentName(path)}`}
                  >
                    Remover
                  </button>
                </div>
              ))}
              {newFiles.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-xs font-normal">
                  <Paperclip className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="flex-1 truncate">{file.name} <span className="text-emerald-700">(novo)</span></span>
                  <button
                    type="button"
                    onClick={() => setNewFiles((old) => old.filter((_, i) => i !== index))}
                    className="rounded px-1.5 py-0.5 font-bold text-red-600 hover:bg-red-50"
                    aria-label={`Remover ${file.name}`}
                  >
                    Remover
                  </button>
                </div>
              ))}
              <label
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragging(false);
                  void addFiles(Array.from(event.dataTransfer.files));
                }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-5 text-xs font-bold transition ${dragging ? "border-brand-500 bg-brand-50 text-brand-700" : "border-zinc-300 bg-white text-zinc-600 hover:border-brand-300 hover:text-brand-700"}`}
              >
                <Plus className="h-5 w-5" />
                {dragging ? "Solte o arquivo para anexar" : "Arraste o arquivo aqui ou clique para escolher"}
                <span className="font-normal text-zinc-400">PDF, PNG ou JPG · até 10 MB</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void addFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-xs font-bold">
              Valor
              <CurrencyInput value={amount} onChange={setAmount} />
            </label>
            <label className="text-xs font-bold">
              {cardMode ? "Data da compra / início da assinatura" : "Data"}
              <input
                required
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
              />
            </label>
            {cardMode && purchaseCycle && <div className="rounded-xl bg-brand-50 p-3 text-sm" aria-live="polite">
              <span className="block text-xs font-bold">Fatura calculada automaticamente</span>
              <strong className="mt-1 block capitalize">{labelMonth(new Date(`${purchaseInvoiceDue.slice(0,7)}-01T12:00:00`))}</strong>
              <span className="block">Vencimento: {purchaseInvoiceDue.split('-').reverse().join('/')}</span>
              <span className="mt-1 block text-xs">Compras de {purchaseCycle.start.split('-').reverse().join('/')} até {addDays(purchaseCycle.closing,-1).split('-').reverse().join('/')}. No dia {cardMode.closing_day}, começa a próxima fatura.</span>
              {recurrence && <span className="mt-2 block text-xs">Cada cobrança da assinatura entra na fatura correspondente à sua própria data, com o valor fixo informado.</span>}
            </div>}
            {!cardMode && <label className="text-xs font-bold">
              Situação
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Entry["status"])}
                className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
              >
                <option value="previsto">Previsto</option>
                <option value="realizado">Realizado</option>
              </select>
            </label>}
          </div>
          {!cardMode && (kind === "despesa" || status === "realizado") && (
            <div className="grid gap-4 sm:grid-cols-2">
              {showPaidValue && (
                <label className="text-xs font-bold">
                  Valor pago (R$)
                  <CurrencyInput value={paidValue} onChange={setPaidValue} required={false} placeholder="Opcional" />
                  <span className="mt-1 block font-normal">
                    {computedJuros > 0 ? (
                      <span className="font-bold text-red-600">Juros: {fmt(computedJuros)}</span>
                    ) : computedDiscount > 0 ? (
                      <span className="font-bold text-emerald-700">Juros R$ 0,00 · Desconto: {fmt(computedDiscount)}</span>
                    ) : Number.isFinite(paidNumber) ? (
                      <span className="text-zinc-500">Pago sem juros nem desconto.</span>
                    ) : (
                      <span className="text-zinc-400">Informe quanto pagou de fato: o sistema calcula juros ou desconto.</span>
                    )}
                  </span>
                </label>
              )}
              <label className="text-xs font-bold">
                {kind === "receita" ? "Data do recebimento" : "Data do pagamento"}
                <input
                  type="date"
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal"
                />
                <span className="mt-1 block font-normal text-zinc-400">Mede o atraso em relação ao vencimento (campo Data).</span>
              </label>

            </div>
          )}
          {!cardMode && <label className="block text-xs font-bold">
            {kind === "receita" ? "Conta bancária de recebimento" : "Conta bancária de pagamento"}
            <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="mt-1.5 w-full rounded-xl border bg-zinc-50 p-3 text-sm font-normal">
              <option value="">Não informada</option>
              {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
            </select>
            <span className="mt-1 block font-normal text-zinc-400">{banks.length ? "Define a conta usada na movimentação. Centros de custo são escolhidos separadamente." : "Cadastre uma conta bancária na aba Contas."}</span>
          </label>}
          {cardMode && <p className="rounded-xl bg-brand-50 p-3 text-xs text-brand-800">Esta compra compõe a fatura do cartão. O vencimento segue o fechamento do cartão; a conta bancária será escolhida ao pagar a fatura. Assinaturas: marque Repetir valor fixo. Parcelamentos: informe a quantidade de meses.</p>}
          {converting && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
              Ao salvar, este lançamento será substituído pelas parcelas abaixo (os anexos são mantidos).
            </p>
          )}
          <div className="grid gap-3 rounded-xl border border-brand-100 bg-brand-50/60 p-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={recurrence}
                onChange={(e) => {
                  setRecurrence(e.target.checked);
                  if (e.target.checked) setInstallments(1);
                }}
              />
              <Repeat2 className="h-4 w-4 text-brand-600" />
              Repetir valor fixo
            </label>
            {recurrence && <label className="text-xs font-bold">Frequência da recorrência
              <select value={frequency} disabled={Boolean(editing?.seriesId)} onChange={e=>{setFrequency(e.target.value as "mensal" | "semanal");if(e.target.value === "semanal")setSameMonthInstallments(false);}} className="mt-1 block w-full rounded-xl border bg-white p-2.5 text-sm">
                <option value="mensal">Mensal — a cada mês</option><option value="semanal">Semanal — a cada 7 dias</option>
              </select>
              {editing?.seriesId && <span className="mt-1 block font-normal text-zinc-500">Para mudar a frequência, crie uma nova recorrência.</span>}
            </label>}
            {!recurrence && !sameMonthInstallments && (!editing || standaloneEdit) && (
              <label className="flex items-center gap-2 text-sm font-bold">
                <CalendarClock className="h-4 w-4 text-brand-600" />
                Parcelar: uma parcela por mês
                <input
                  min="1"
                  type="number"
                  value={installments}
                  onChange={(e) =>
                    setInstallments(Math.max(1, Math.floor(Number(e.target.value)) || 1))
                  }
                  className="w-16 rounded-lg border bg-white p-1.5 text-center font-normal"
                />
              </label>
            )}
            {editing?.seriesId && (
              <label className="col-span-full flex gap-3 text-xs font-bold text-brand-800">
                Alterar:{" "}
                <span>
                  <input
                    type="radio"
                    checked={scope === "one"}
                    onChange={() => setScope("one")}
                  />{" "}
                  {cardMode ? "Esta compra" : "Este mês"}
                </span>
                <span>
                  <input
                    type="radio"
                    checked={scope === "series"}
                    onChange={() => setScope("series")}
                  />{" "}
                  {cardMode ? "Em aberto da série" : "Toda a série"}
                </span>
              </label>
            )}
            {(!editing || standaloneEdit) && (!recurrence || frequency === "mensal") && (
              <div className="col-span-full border-t border-brand-100 pt-3">
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={sameMonthInstallments}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setSameMonthInstallments(enabled);
                      if (enabled) {
                        setInstallments(1);
                        setSameMonthPartsState(
                          sameMonthParts(
                            sameMonthPartCount,
                            parseMoney(amount) || 0,
                            date,
                          ),
                        );
                      }
                    }}
                  />
                  Dividir em dias do mesmo mês (avançado)
                </label>
                <p className="mt-1 text-xs text-brand-700">
                  Todas as parcelas abaixo vencem no mesmo mês. Para distribuir entre outubro, novembro, dezembro etc., use o parcelamento mensal.
                </p>
              </div>
            )}
            {sameMonthInstallments && (!editing || standaloneEdit) && (
              <div className="col-span-full space-y-3 rounded-xl bg-white p-3">
                <button type="button" onClick={() => { setInstallments(sameMonthPartCount); setRecurrence(false); setSameMonthInstallments(false); }} className="w-full rounded-xl bg-brand-700 p-3 text-sm font-bold text-white">
                  Quero uma parcela por mês ({sameMonthPartCount} meses)
                </button>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-zinc-700">
                    Quantidade de parcelas
                    <input
                      min="2"
                      type="number"
                      value={sameMonthPartCount}
                      onChange={(e) => {
                        const count = Math.max(
                          2,
                          Math.floor(Number(e.target.value)) || 2,
                        );
                        setSameMonthPartCount(count);
                        setSameMonthPartsState(
                          sameMonthParts(count, parseMoney(amount) || 0, date),
                        );
                      }}
                      className="w-16 rounded-lg border bg-zinc-50 p-1.5 text-center font-normal"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setSameMonthPartsState(
                        sameMonthParts(
                          sameMonthPartCount,
                          parseMoney(amount) || 0,
                          date,
                        ),
                      )
                    }
                    className="text-xs font-bold text-brand-700 hover:text-brand-900"
                  >
                    Dividir valor igualmente
                  </button>
                </div>
                {sameMonthPartsState.map((part, index) => (
                  <div
                    key={index}
                    className="grid gap-2 sm:grid-cols-[auto_1fr_1fr] sm:items-end"
                  >
                    <span className="pb-3 text-xs font-extrabold text-brand-700">
                      {index + 1}ª parcela
                    </span>
                    <label className="text-[11px] font-bold text-zinc-500">
                      Data
                      <input
                        type="date"
                        value={part.date}
                        onChange={(e) =>
                          setSameMonthPartsState((old) =>
                            old.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, date: e.target.value }
                                : item,
                            ),
                          )
                        }
                        className="mt-1 block w-full rounded-lg border bg-zinc-50 p-2 text-sm font-normal"
                      />
                    </label>
                    <label className="text-[11px] font-bold text-zinc-500">
                      Valor
                      <CurrencyInput
                        value={part.amount}
                        onChange={(value) =>
                          setSameMonthPartsState((old) =>
                            old.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, amount: value }
                                : item,
                            ),
                          )
                        }
                        className="mt-1 block rounded-lg p-2"
                      />
                    </label>
                  </div>
                ))}
                <p className="text-xs font-bold text-brand-800">
                  Total das parcelas:{" "}
                  {fmt(
                    sameMonthPartsState.reduce(
                      (sum, part) => sum + (parseMoney(part.amount) || 0),
                      0,
                    ),
                  )}{" "}
                  · Total do lançamento: {fmt(parseMoney(amount) || 0)}
                </p>
              </div>
            )}
            {recurrence && !sameMonthInstallments && (
              <p className="col-span-full text-xs text-brand-700">
                O valor será repetido {frequency === "semanal" ? "a cada 7 dias, no mesmo dia da semana" : "mensalmente"}, sem divisão.
                {frequency === "semanal" && date && <span className="mt-2 block">{cardMode ? "Próximas compras:" : "Próximos vencimentos:"} {[0,1,2,3].map(i=>addDays(date,i*7).split('-').reverse().join('/')).join(' · ')}. Cada ocorrência futura começa como prevista.</span>}
              </p>
            )}
            {recurrence && sameMonthInstallments && (
              <p className="col-span-full text-xs text-brand-700">
                Cada parcela será repetida todos os meses, nas datas e valores
                definidos acima.
              </p>
            )}
            {!recurrence && !sameMonthInstallments && installments > 1 && (
              <section className="col-span-full rounded-xl border bg-white p-3" aria-label="Prévia das parcelas mensais">
                <h3 className="text-sm font-extrabold">Uma parcela por mês · {installments} meses</h3>
                <p className="mt-1 text-xs text-zinc-500">O valor total será dividido entre os meses abaixo.{cardMode ? " No cartão, as datas abaixo já são os vencimentos de cada fatura." : " A primeira data é a do lançamento; cada parcela seguinte avança um mês."}</p>
                <div className="mt-3 max-h-72 overflow-y-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="p-2">Parcela</th><th>Vencimento</th><th className="text-right">Valor</th></tr></thead><tbody>
                  {monthlyPreview.map(part => <tr key={part.installment} className="border-b"><td className="p-2">{part.installment}</td><td>{part.date.split('-').reverse().join('/')}</td><td className="text-right">{fmt(part.amount)}</td></tr>)}
                </tbody></table></div>
                {!monthlyPreview.length && <p className="mt-2 text-xs text-amber-800">Informe valor e data válidos. Cada parcela deve ter pelo menos R$ 0,01.</p>}
              </section>
            )}
          </div>
        </div>
        <footer className="relative flex flex-wrap gap-3 border-t border-zinc-100 bg-zinc-50/70 px-6 py-4">
          {editing && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title={editing.seriesId ? "Excluir este lançamento ou a série inteira" : "Excluir lançamento"}
              className="flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-medium text-red-600 ring-1 ring-red-100 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              {editing.seriesId ? "Excluir…" : "Excluir"}
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className="flex-1 rounded-full bg-white py-2.5 text-sm font-medium ring-1 ring-zinc-200 hover:bg-zinc-100"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            className="flex-1 rounded-full bg-[#831843] py-2.5 text-sm font-medium text-white shadow-[0_10px_24px_-12px_rgba(24,24,27,0.9)] hover:bg-pink-950 disabled:opacity-60"
          >
            {saving ? "Salvando no banco..." : "Salvar"}
          </button>
          {saveError && (
            <p className="absolute -top-5 left-6 text-xs font-bold text-red-600">
              {saveError}
            </p>
          )}
        </footer>
      </form>
    </div>
  );
}
function Entries({
  entries,
  categories,
  banks = [],
  settle,
  edit,
  remove,
  open,
}: {
  entries: Entry[];
  categories: Category[];
  banks?: Bank[];
  settle: (x: Entry) => void;
  edit: (x: Entry) => void;
  remove: (x: Entry) => void;
  /** Clique na linha: abre direto a edição deste lançamento (só este mês). */
  open?: (x: Entry) => void;
}) {
  const bankName = (bankId?: string | null) =>
    bankId ? banks.find((bank) => bank.id === bankId)?.name : undefined;
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const attachmentLabel = (path: string) =>
    (path.split("/").pop() || path).replace(/^\d+-/, "");
  const openAttachment = async (path: string) => {
    try {
      const url = await signedAttachmentUrl(path);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Não foi possível abrir o arquivo.");
    }
  };
  if (!entries.length)
    return (
      <div className="rounded-2xl bg-zinc-50 p-10 text-center text-sm text-zinc-500">
        Nenhum lançamento neste mês.
      </div>
    );
  return (
    <div className="fc-rows divide-y divide-zinc-100">
      {[...entries]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((x) => {
          const c = categories.find(
            (v) =>
              v.name === x.category && v.unit === x.unit && v.kind === x.kind,
          );
          const late = x.status === "previsto" && x.date < todayKey;
          const bank = bankName(x.bankId);
          return (
            <div
              key={x.id}
              role={open ? "button" : undefined}
              tabIndex={open ? 0 : undefined}
              title={open ? "Clique para editar este lançamento" : undefined}
              onClick={(event) => {
                // Botões e anexos dentro da linha mantêm a própria ação.
                if (!open || (event.target as HTMLElement).closest("button, a, input, label")) return;
                open(x);
              }}
              onKeyDown={(event) => {
                if (open && event.key === "Enter" && event.target === event.currentTarget) open(x);
              }}
              className={`group flex items-center gap-3 py-3 ${open ? "-mx-3 cursor-pointer rounded-2xl px-3 transition hover:bg-zinc-50" : ""}`}
            >
              <span className="transition-transform duration-300 group-hover:scale-105"><Icon category={c} /></span>
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-[#831843]">
                  <span className="truncate">{x.description}</span>
                  {x.installment && <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-normal text-zinc-500">{x.installment}</span>}
                  {x.attachments && x.attachments.length > 0 && x.attachments.map((path) => (
                    <button key={path} type="button" onClick={() => void openAttachment(path)} title={attachmentLabel(path)} className="shrink-0 rounded-full p-1 text-zinc-400 hover:bg-zinc-200 hover:text-[#831843]"><Paperclip className="h-3 w-3" /></button>
                  ))}
                </p>
                <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-zinc-500">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${late ? "bg-red-50 text-red-700 ring-1 ring-red-100" : "bg-zinc-100 text-zinc-600"}`}
                    title={late ? "Vencido e ainda não pago" : "Data de vencimento"}
                  >
                    <CalendarClock className="h-3 w-3" />
                    {new Date(`${x.date}T12:00:00`).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="truncate">{x.category}</span>
                  {x.beneficiary?.trim() && <span className="truncate text-zinc-400">· {x.beneficiary.trim()}</span>}
                  {bank && <span className="inline-flex items-center gap-1 text-zinc-400">· <BankLogo name={bank} className="h-4 w-4 rounded-[5px] text-[7px]" />{bank}</span>}
                </p>
                {(x.pix || x.notes || (x.kind === "despesa" && ((x.juros ?? 0) > 0 || (x.discount ?? 0) > 0 || x.paidDate))) && (
                  <p className="mt-1 truncate text-[11px] text-zinc-400">
                    {x.kind === "despesa" && x.paidDate && <>Pago em {new Date(`${x.paidDate}T12:00:00`).toLocaleDateString("pt-BR")}{lateDays(x) > 0 ? <b className="font-medium text-orange-600"> · {lateDays(x)} dia(s) de atraso</b> : " · em dia"}</>}
                    {(x.juros ?? 0) > 0 && <> · Juros <b className="font-medium text-red-600">{fmt(x.juros ?? 0)}</b></>}
                    {(x.discount ?? 0) > 0 && <> · Desconto <b className="font-medium text-emerald-700">{fmt(x.discount ?? 0)}</b></>}
                    {x.pix && <> · PIX {x.pix}</>}
                    {x.notes && <> · {x.notes}</>}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-sm font-semibold tracking-[-0.01em] ${x.kind === "receita" ? "text-emerald-600" : "text-[#831843]"}`}>
                  {x.kind === "receita" ? "+" : "−"}
                  {fmt(entryValue(x))}
                </p>
                <p className={`mt-0.5 text-[10.5px] ${x.status === "realizado" ? "text-emerald-600" : late ? "text-red-600" : "text-zinc-400"}`}>
                  {x.invoiceSummary ? `Pago ${fmt(x.invoicePaidAmount||0)} · Aberto ${fmt(x.invoicePendingAmount||0)}` : x.status === "realizado" ? (x.kind === "despesa" ? "Pago" : "Recebido") : late ? "Vencido" : entryScheduleLabel(x)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  onClick={() => settle(x)}
                  title={x.balanceAdjustment ? "Editar saldo" : x.creditCardId ? "Ver fatura" : x.status === "realizado" ? "Realizado · clique para reverter" : x.kind === "despesa" ? "Dar baixa" : "Receber"}
                  aria-label={x.balanceAdjustment ? "Editar saldo" : x.creditCardId ? "Ver fatura" : x.status === "realizado" ? "Reverter baixa" : x.kind === "despesa" ? "Dar baixa" : "Receber"}
                  className={`rounded-full p-2 ${x.status === "realizado" ? "bg-emerald-500 text-white shadow-[0_6px_14px_-6px_rgba(16,185,129,0.9)] hover:bg-emerald-600" : "text-zinc-400 ring-1 ring-inset ring-zinc-200 hover:bg-emerald-50 hover:text-emerald-600 hover:ring-emerald-200"}`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                </button>
                <button onClick={() => edit(x)} title={x.creditCardId ? "Detalhar fatura" : "Editar"} aria-label={x.creditCardId ? "Detalhar fatura" : `Editar ${x.description}`} className="rounded-full p-2 text-zinc-400 hover:bg-white hover:text-[#831843] hover:shadow-sm md:opacity-0 md:group-hover:opacity-100">
                  <Pencil className="h-4 w-4" />
                </button>
                {!x.balanceAdjustment && !x.creditCardId && (
                  <button onClick={() => { if (x.seriesId || x.cardPayment || window.confirm(`Excluir o lançamento “${x.description}”?`)) remove(x); }} title="Excluir" aria-label={`Excluir ${x.description}`} className="rounded-full p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}
// Lists the entries behind a dashboard number so every value can be inspected.
type DrillState = { title: string; subtitle?: string; items: Entry[]; seeAll?: () => void };
function EntryDrill({
  drill, categories, banks, cards, close, open,
}: {
  drill: DrillState; categories: Category[]; banks: Bank[]; cards: { id: string; name: string }[]; close: () => void; open: (entry: Entry) => void;
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [close]);
  const items = [...drill.items].sort((a, b) => b.date.localeCompare(a.date));
  const income = items.filter((entry) => entry.kind === "receita").reduce((sum, entry) => sum + entryValue(entry), 0);
  const expense = items.filter((entry) => entry.kind === "despesa").reduce((sum, entry) => sum + entryValue(entry), 0);
  const todayKey = localDateKey(new Date());
  return (
    <div className="fc-overlay fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="presentation" onClick={close}>
      <section role="dialog" aria-modal="true" aria-label={drill.title} onClick={(event) => event.stopPropagation()} className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.5rem] bg-white shadow-2xl sm:rounded-[1.5rem]">
        <header className="flex items-start gap-3 border-b border-zinc-100 px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-[#831843]">{drill.title}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">{drill.subtitle ?? `${items.length} lançamento(s)`}</p>
          </div>
          <button type="button" onClick={close} aria-label="Fechar" className="rounded-full p-2 text-zinc-500 hover:rotate-90 hover:bg-zinc-100 hover:text-[#831843]"><X className="h-5 w-5" /></button>
        </header>
        <div className="overflow-y-auto px-5 py-4">
          {items.length ? <DailyLedger embedded entries={items} categories={categories} banks={banks} cards={cards} onOpen={open} /> : <p className="py-12 text-center text-sm text-zinc-500">Nenhum lançamento compõe este valor no período.</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/70 px-6 py-4 text-sm">
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {income > 0 && <span>Receitas <b className="font-semibold text-emerald-600">{fmt(income)}</b></span>}
            {expense > 0 && <span>Despesas <b className="font-semibold text-red-600">{fmt(expense)}</b></span>}
            {!income && !expense && <span>Total <b className="font-semibold text-[#831843]">{fmt(0)}</b></span>}
          </span>
          {drill.seeAll && <button type="button" onClick={() => { drill.seeAll?.(); close(); }} className="group flex items-center gap-1 rounded-full bg-[#831843] px-4 py-2 text-xs font-medium text-white hover:bg-pink-950">Ver em Lançamentos<ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></button>}
        </footer>
      </section>
    </div>
  );
}
function Breakdown({
  kind,
  entries,
  categories,
  onDrill,
}: {
  kind: Kind;
  entries: Entry[];
  categories: Category[];
  onDrill?: (title: string, items: Entry[]) => void;
}) {
  const rows = Object.entries(
    entries
      .filter((x) => x.kind === kind)
      .reduce<Record<string, number>>(
        (r, x) => ({ ...r, [x.category]: (r[x.category] || 0) + entryValue(x) }),
        {},
      ),
  ).sort((a, b) => b[1] - a[1]);
  const max = rows.reduce((s, [, v]) => s + v, 0);
  const income = kind === "receita";
  return (
    <section className="fc-card p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="fc-h">{income ? "Receitas" : "Despesas"} por categoria</h2>
          <p className="fc-sub mt-1">{rows.length} {rows.length === 1 ? "categoria" : "categorias"} no mês</p>
        </div>
        <b className={`text-lg font-semibold tracking-[-0.02em] ${income ? "text-emerald-600" : "text-red-600"}`}>{fmt(max)}</b>
      </div>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map(([name, value]) => {
            const c = categories.find(
              (x) => x.name === name && x.kind === kind,
            );
            const share = max ? (value / max) * 100 : 0;
            return (
              <button type="button" key={name} onClick={() => onDrill?.(name, entries.filter((x) => x.kind === kind && x.category === name))} className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-zinc-50">
                <span className="transition-transform duration-300 group-hover:scale-110"><Icon category={c} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-[#831843]">{name}</span>
                    <span className="shrink-0 text-zinc-500"><b className="font-semibold text-[#831843]">{fmt(value)}</b> · {Math.round(share)}%</span>
                  </div>
                  <div className="fc-meter mt-2">
                    <span
                      className={income ? "bg-gradient-to-r from-emerald-400 to-emerald-600" : "bg-gradient-to-r from-rose-400 to-red-600"}
                      style={{ width: `${share}%`, ...(c?.color && !c.color.startsWith("#fff") ? {} : {}) }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center py-8 text-center"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400"><Tag className="h-5 w-5" /></span><p className="text-sm text-zinc-500">Sem {income ? "receitas" : "despesas"} neste mês.</p></div>
      )}
    </section>
  );
}
type CounterpartySummary = {
  key: string;
  name: string;
  unit: Unit;
  kind: Kind;
  total: number;
  realized: number;
  pending: number;
  overdue: number;
  count: number;
};

function summarizeCounterparties(
  entries: Entry[],
  contacts: Counterparty[],
  kind: Kind,
  todayKey: string,
) {
  const matchingContacts = contacts.filter((contact) => contact.kind === kind);
  const byId = new Map(matchingContacts.map((contact) => [contact.id, contact]));
  const byName = new Map(
    matchingContacts.map((contact) => [contactIdentity(kind, contact.unit, contact.name), contact]),
  );
  const rows = new Map<string, CounterpartySummary>();
  const rowFor = (contact: Counterparty) => ({
    key: contact.id,
    name: contact.name,
    unit: contact.unit,
    kind,
    total: 0,
    realized: 0,
    pending: 0,
    overdue: 0,
    count: 0,
  });
  matchingContacts.filter((contact) => !contact.archived).forEach((contact) => {
    rows.set(contact.id, rowFor(contact));
  });
  entries.filter((entry) => entry.kind === kind).forEach((entry) => {
    const contact =
      (entry.counterpartyId && byId.get(entry.counterpartyId)) ||
      byName.get(contactIdentity(kind, entry.unit, entry.beneficiary || ""));
    const name = contact?.name || entry.beneficiary?.trim();
    if (!name) return;
    const key = contact?.id ?? contactIdentity(kind, entry.unit, name);
    const row = rows.get(key) ?? (contact ? rowFor(contact) : {
      key, name, unit: entry.unit, kind, total: 0, realized: 0,
      pending: 0, overdue: 0, count: 0,
    });
    row.total += entryValue(entry);
    row.count += 1;
    if (entry.status === "realizado") row.realized += entryValue(entry);
    else {
      row.pending += entry.amount;
      if (entry.date < todayKey) row.overdue += entry.amount;
    }
    rows.set(key, row);
  });
  return [...rows.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR"));
}

function CounterpartyOverview({
  kind, entries, contacts, todayKey, onDrill,
}: {
  kind: Kind; entries: Entry[]; contacts: Counterparty[]; todayKey: string;
  onDrill?: (title: string, items: Entry[]) => void;
}) {
  const rows = summarizeCounterparties(entries, contacts, kind, todayKey);
  const activeCount = contacts.filter((contact) => contact.kind === kind && !contact.archived).length;
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const pending = rows.reduce((sum, row) => sum + row.pending, 0);
  const unidentified = entries.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entryValue(entry), 0) - total;
  const expense = kind === "despesa";
  return (
    <section className="fc-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="fc-h">{expense ? "Fornecedores" : "Clientes / pagadores"}</h2>
          <p className="fc-sub mt-1">Movimentação identificada no mês selecionado.</p>
        </div>
        <span className="fc-pill">{activeCount} cadastrados</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="fc-card-soft px-4 py-3"><p className="text-[11px] text-zinc-500">{expense ? "Despesas identificadas" : "Receitas identificadas"}</p><b className={`mt-0.5 block text-base font-semibold tracking-[-0.02em] ${expense ? "text-red-600" : "text-emerald-600"}`}>{fmt(total)}</b></div>
        <div className="fc-card-soft px-4 py-3"><p className="text-[11px] text-zinc-500">{expense ? "A pagar" : "A receber"}</p><b className="mt-0.5 block text-base font-semibold tracking-[-0.02em] text-orange-600">{fmt(pending)}</b></div>
      </div>
      <div className="mt-3 divide-y divide-zinc-100">
        {rows.filter((row) => row.total > 0).slice(0, 4).map((row) => (
          <button type="button" key={row.key} onClick={() => onDrill?.(row.name, entries.filter((entry) => entry.kind === kind && entry.unit === row.unit && (entry.counterpartyId === row.key || normalizeSearch(entry.beneficiary || "") === normalizeSearch(row.name))))} className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2.5 text-left text-xs hover:bg-zinc-50">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-semibold text-zinc-600">{row.name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate font-medium text-[#831843]" title={`${row.name} · ${row.unit}`}>{row.name} <span className="font-normal text-zinc-400">· {row.unit}</span></span>
            <b className="shrink-0 font-semibold text-[#831843]">{fmt(row.total)}</b>
          </button>
        ))}
        {!rows.some((row) => row.total > 0) && <p className="py-5 text-center text-xs text-zinc-400">Sem movimentação identificada neste mês.</p>}
      </div>
      {unidentified > 0.001 && <p className="mt-2 text-[11px] text-zinc-500">Sem {expense ? "fornecedor" : "cliente"} informado: {fmt(unidentified)}</p>}
    </section>
  );
}

function CounterpartyReportPanel({
  kind, entries, contacts, todayKey, onDrill,
}: {
  kind: Kind; entries: Entry[]; contacts: Counterparty[]; todayKey: string;
  onDrill?: (title: string, items: Entry[]) => void;
}) {
  const rows = summarizeCounterparties(entries, contacts, kind, todayKey);
  const moved = rows.filter((row) => row.count > 0);
  const total = moved.reduce((sum, row) => sum + row.total, 0);
  const unidentified = entries.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entryValue(entry), 0) - total;
  const expense = kind === "despesa";
  // Resolve a qual fornecedor/cliente cada lançamento pertence, igual ao
  // agrupamento de summarizeCounterparties, para abrir os lançamentos reais.
  const matchingContacts = contacts.filter((contact) => contact.kind === kind);
  const byId = new Map(matchingContacts.map((contact) => [contact.id, contact]));
  const byName = new Map(matchingContacts.map((contact) => [contactIdentity(kind, contact.unit, contact.name), contact]));
  const keyForEntry = (entry: Entry) => {
    const contact = (entry.counterpartyId && byId.get(entry.counterpartyId)) || byName.get(contactIdentity(kind, entry.unit, entry.beneficiary || ""));
    const name = contact?.name || entry.beneficiary?.trim();
    if (!name) return null;
    return contact?.id ?? contactIdentity(kind, entry.unit, name);
  };
  const entriesFor = (rowKey: string) => entries.filter((entry) => entry.kind === kind && keyForEntry(entry) === rowKey);
  const unidentifiedEntries = entries.filter((entry) => entry.kind === kind && keyForEntry(entry) === null);
  const drill = (title: string, items: Entry[]) => { if (onDrill) onDrill(title, items); };
  return (
    <section className="fc-card p-5">
      <h2 className="fc-h">{expense ? "Relatório por fornecedor" : "Relatório por cliente / pagador"}</h2>
      <p className="fc-sub mt-1">Valores dos lançamentos no período e filtros selecionados.</p>
      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        <span className="rounded-lg bg-zinc-50 px-3 py-2">{moved.length} com movimentação</span>
        <span className="rounded-lg bg-zinc-50 px-3 py-2">Total identificado: <b>{fmt(total)}</b></span>
        {unidentified > 0.001 && (
          <button
            type="button"
            onClick={() => drill(`Sem ${expense ? "fornecedor" : "cliente"} informado`, unidentifiedEntries)}
            className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 hover:bg-amber-100"
          >
            Sem {expense ? "fornecedor" : "cliente"}: {fmt(unidentified)}
          </button>
        )}
      </div>
      {moved.length > 0 && (
        <div className="mt-5 h-64 overflow-x-auto">
          <div className="h-full" style={{ minWidth: 380 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={moved.slice(0, 8).map((row) => ({ ...row, label: `${row.name} · ${row.unit}` })).reverse()} layout="vertical" margin={{ left: 8, right: 12 }}>
                <CartesianGrid horizontal={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(value: number) => new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(value)} />
                <YAxis type="category" dataKey="label" width={145} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value, name) => [fmt(Number(value)), name === "realized" ? (expense ? "Pago" : "Recebido") : (expense ? "A pagar" : "A receber")]} contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0" }} />
                <Legend formatter={(value) => value === "realized" ? (expense ? "Pago" : "Recebido") : (expense ? "A pagar" : "A receber")} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="realized" stackId="total" fill={expense ? "#dc2626" : "#059669"} cursor="pointer" onClick={(data: any) => { const r = data?.payload ?? data; drill(`${r.name} · ${r.unit}`, entriesFor(r.key)); }} />
                <Bar dataKey="pending" stackId="total" fill={expense ? "#fdba74" : "#93c5fd"} cursor="pointer" onClick={(data: any) => { const r = data?.payload ?? data; drill(`${r.name} · ${r.unit}`, entriesFor(r.key)); }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="fc-table min-w-[650px] text-left text-xs">
          <thead>
            <tr><th className="p-3">{expense ? "Fornecedor" : "Cliente / pagador"}</th><th className="p-3">Centro</th><th className="p-3 text-right">{expense ? "Pago" : "Recebido"}</th><th className="p-3 text-right">Em aberto</th><th className="p-3 text-right">Vencido</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Lanç.</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row) => (
              <tr
                key={row.key}
                onClick={() => drill(`${row.name} · ${row.unit}`, entriesFor(row.key))}
                className={`${row.count > 0 ? "cursor-pointer" : ""} hover:bg-zinc-50`}
              >
                <td className="p-3 font-bold text-zinc-800">{row.name}</td><td className="p-3 text-zinc-600">{row.unit}</td><td className="p-3 text-right">{fmt(row.realized)}</td><td className="p-3 text-right">{fmt(row.pending)}</td><td className="p-3 text-right text-red-600">{fmt(row.overdue)}</td><td className="p-3 text-right font-extrabold">{fmt(row.total)}</td><td className="p-3 text-right">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="py-8 text-center text-sm text-zinc-400">Nenhum cadastro ou lançamento identificado para este filtro.</p>}
      </div>
    </section>
  );
}

function Reports({
  entries,
  banks,
  cards = [],
  allowedUnits,
  categories,
  contacts,
  incomeVisible = true,
}: {
  entries: Entry[];
  banks: Bank[];
  cards?: { id: string; name: string }[];
  allowedUnits: typeof units;
  categories: Category[];
  contacts: Counterparty[];
  /** Receitas, resultado e saldos só aparecem para o Master. */
  incomeVisible?: boolean;
}) {
  const today = new Date();
  const currentMonthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const currentMonthEnd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  const [from, setFrom] = useState(currentMonthStart);
  const [to, setTo] = useState(currentMonthEnd);
  const [unit, setUnit] = useState<Unit | "Todos">("Todos");
  const [account, setAccount] = useState("Todos");
  const [category, setCategory] = useState("Todos");
  const [kind, setKind] = useState<Kind | "todos">(incomeVisible ? "todos" : "despesa");
  const [counterparty, setCounterparty] = useState("Todos");
  const [drill, setDrill] = useState<{ title: string; items: Entry[] } | null>(null);
  useEffect(() => {
    if (!drill) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setDrill(null); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [drill]);
  const openDrill = (title: string, items: Entry[]) => {
    if (!items.length) return;
    setDrill({ title, items: [...items].sort((a, b) => reportingDate(b).localeCompare(reportingDate(a))) });
  };
  const counterpartyOptions = contacts
    .filter((contact) =>
      (unit === "Todos" || contact.unit === unit) &&
      (kind === "todos" || contact.kind === kind),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const cashEntries = entries;
  const filtered = reportingPeriod(entries, from, to).filter(
    (entry) =>
      (unit === "Todos" || entry.unit === unit) &&
      (account === "Todos" || (entry.bankId || "__unassigned__") === account) &&
      (category === "Todos" || entry.category === category) &&
      (kind === "todos" || entry.kind === kind) &&
      (counterparty === "Todos" ||
        contactIdentity(entry.kind, entry.unit, entry.beneficiary || "") === counterparty),
  );
  const total = (entryKind: Kind, status?: Entry["status"]) =>
    filtered
      .filter(
        (entry) =>
          entry.kind === entryKind && (!status || entry.status === status),
      )
      .reduce((sum, entry) => sum + entryValue(entry), 0);
  const reportPosition = cashPosition(cashEntries.filter(e => (unit === "Todos" || e.unit === unit) && (account === "Todos" || (e.bankId || "__unassigned__") === account) && (category === "Todos" || e.category === category) && (kind === "todos" || e.kind === kind) && (counterparty === "Todos" || contactIdentity(e.kind,e.unit,e.beneficiary||"") === counterparty)),from,to);
  const income = total("receita");
  const expense = total("despesa");
  const pendingPay = total("despesa", "previsto");
  const pendingReceive = total("receita", "previsto");
  const pick = (test: (entry: Entry) => boolean) => filtered.filter(test);
  const entriesByCategory = (item: { kind: Kind; unit: Unit; name: string }) =>
    pick(
      (entry) =>
        entry.kind === item.kind &&
        entry.unit === item.unit &&
        (entry.category || "Sem categoria") === item.name,
    );
  const dateLabel = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const realizedIncome = total("receita", "realizado");
  const realizedExpense = total("despesa", "realizado");
  const overduePay = filtered
    .filter((entry) => entry.kind === "despesa" && entry.status === "previsto" && entry.date < todayKey)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const overdueReceive = filtered
    .filter((entry) => entry.kind === "receita" && entry.status === "previsto" && entry.date < todayKey)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const categoryDetails = Array.from(
    filtered.reduce((map, entry) => {
      const key = `${entry.kind}|${entry.unit}|${entry.category}`;
      const existing = map.get(key) ?? {
        key,
        name: entry.category || "Sem categoria",
        unit: entry.unit,
        kind: entry.kind,
        total: 0,
        realized: 0,
        pending: 0,
        overdue: 0,
        count: 0,
        color: categories.find((item) => item.kind === entry.kind && item.unit === entry.unit && item.name === entry.category)?.color
          ?? (entry.kind === "receita" ? "#10b981" : "#ef4444"),
      };
      existing.total += entryValue(entry);
      existing.count += 1;
      if (entry.status === "realizado") existing.realized += entryValue(entry);
      else {
        existing.pending += entry.amount;
        if (entry.date < todayKey) existing.overdue += entry.amount;
      }
      map.set(key, existing);
      return map;
    }, new Map<string, {
      key: string; name: string; unit: Unit; kind: Kind; total: number;
      realized: number; pending: number; overdue: number; count: number; color: string;
    }>() ).values(),
  ).sort((a, b) => b.total - a.total);
  const expenseDetails = categoryDetails.filter((item) => item.kind === "despesa");
  const incomeDetails = categoryDetails.filter((item) => item.kind === "receita");
  const largestExpenses = filtered
    .filter((entry) => entry.kind === "despesa")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
  // Juros e atraso: só despesas já pagas.
  const paidExpenses = filtered.filter((entry) => entry.kind === "despesa" && entry.status === "realizado");
  const jurosEntries = paidExpenses.filter((entry) => (entry.juros || 0) > 0);
  const totalJuros = jurosEntries.reduce((sum, entry) => sum + (entry.juros || 0), 0);
  const lateExpenses = paidExpenses.filter((entry) => lateDays(entry) > 0);
  const totalLateDays = lateExpenses.reduce((sum, entry) => sum + lateDays(entry), 0);
  const avgLateDays = lateExpenses.length ? Math.round(totalLateDays / lateExpenses.length) : 0;
  const validPeriod = Boolean(from && to && from <= to);
  const periodStart = new Date(`${from}T12:00:00`);
  const periodEnd = new Date(`${to}T12:00:00`);
  const shortPeriod = validPeriod && (periodEnd.getTime() - periodStart.getTime()) / 86400000 <= 62;
  const longPeriod = validPeriod && (periodEnd.getTime() - periodStart.getTime()) / 86400000 > 3650;
  const periodBuckets: {
    label: string; start: string; end: string;
    "Receitas recebidas": number; "Receitas previstas": number;
    "Despesas pagas": number; "Despesas previstas": number;
  }[] = [];
  if (validPeriod) {
    const cursor = new Date(periodStart);
    while (cursor <= periodEnd) {
      const bucketStart = new Date(cursor);
      const next = shortPeriod
        ? new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7, 12)
        : longPeriod
          ? new Date(cursor.getFullYear() + 1, 0, 1, 12)
          : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12);
      const bucketEnd = new Date(Math.min(periodEnd.getTime(), next.getTime() - 86400000));
      const startKey = `${bucketStart.getFullYear()}-${String(bucketStart.getMonth() + 1).padStart(2, "0")}-${String(bucketStart.getDate()).padStart(2, "0")}`;
      const endKey = `${bucketEnd.getFullYear()}-${String(bucketEnd.getMonth() + 1).padStart(2, "0")}-${String(bucketEnd.getDate()).padStart(2, "0")}`;
      periodBuckets.push({
        label: shortPeriod ? `${dateLabel(startKey).slice(0, 5)}–${dateLabel(endKey).slice(0, 5)}` : longPeriod ? String(bucketStart.getFullYear()) : bucketStart.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
        start: startKey, end: endKey,
        "Receitas recebidas": 0, "Receitas previstas": 0,
        "Despesas pagas": 0, "Despesas previstas": 0,
      });
      cursor.setTime(next.getTime());
    }
    filtered.forEach((entry) => {
      const bucket = periodBuckets.find((item) => reportingDate(entry) >= item.start && reportingDate(entry) <= item.end);
      if (!bucket) return;
      const key = entry.kind === "receita"
        ? (entry.status === "realizado" ? "Receitas recebidas" : "Receitas previstas")
        : (entry.status === "realizado" ? "Despesas pagas" : "Despesas previstas");
      bucket[key] += entryValue(entry);
    });
  }
  const reportContacts = contacts.filter((contact) =>
    unit === "Todos" || contact.unit === unit,
  );
  const accountRows = [...banks.map(bank => ({ id: bank.id, name: bank.name })), { id: "__unassigned__", name: "Sem conta bancária informada" }]
    .filter(item => account === "Todos" || item.id === account)
    .map(item => ({ ...item, balance: cashPosition(cashEntries.filter(e => (e.bankId || "__unassigned__") === item.id && (unit === "Todos" || e.unit === unit) && (category === "Todos" || e.category === category) && (kind === "todos" || e.kind === kind) && (counterparty === "Todos" || contactIdentity(e.kind,e.unit,e.beneficiary||"") === counterparty)),from,to).closing }));
  return (
    <section className="space-y-4">
      <div><h2 className="text-[1.65rem] font-semibold leading-tight tracking-[-0.035em] text-[#831843]">Relatórios</h2><p className="fc-sub mt-1 max-w-3xl">Compras no cartão entram pela data da compra, mesmo quando a fatura vence depois. Compras parceladas entram uma parcela por mês, a partir da data da compra; assinaturas entram a cada cobrança. Saldos bancários e vencimentos seguem o fluxo de caixa.</p></div>
      <div className="fc-card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="fc-label">
            De
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1.5 block rounded-full border bg-zinc-50 px-3.5 py-2 text-sm font-normal"
            />
          </label>
          <label className="fc-label">
            Até
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1.5 block rounded-full border bg-zinc-50 px-3.5 py-2 text-sm font-normal"
            />
          </label>
          <label className="fc-label">
            Centro
            <select
              value={unit}
              onChange={(event) => {
                setUnit(event.target.value as Unit | "Todos");
                setAccount("Todos");
                setCategory("Todos");
                setCounterparty("Todos");
              }}
              className="mt-1.5 block rounded-full border bg-zinc-50 px-3.5 py-2 text-sm font-normal"
            >
              <option>Todos</option>
              {allowedUnits.map((item) => (
                <option key={item.name}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="fc-label">
            Conta bancária
            <select
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              className="mt-1.5 block rounded-full border bg-zinc-50 px-3.5 py-2 text-sm font-normal"
            >
              <option>Todos</option>
              <option value="__unassigned__">Sem conta bancária informada</option>
              {banks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="fc-label">
            Categoria
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-1.5 block rounded-full border bg-zinc-50 px-3.5 py-2 text-sm font-normal"
            >
              <option>Todos</option>
              {[
                ...new Set(
                  entries
                    .filter((item) => unit === "Todos" || item.unit === unit)
                    .map((item) => item.category),
                ),
              ]
                .sort()
                .map((item) => (
                  <option key={item}>{item}</option>
                ))}
            </select>
          </label>
          {incomeVisible && (
          <label className="fc-label">
            Tipo
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as Kind | "todos");
                setCounterparty("Todos");
              }}
              className="mt-1.5 block rounded-full border bg-zinc-50 px-3.5 py-2 text-sm font-normal"
            >
              <option value="todos">Todos</option>
              <option value="receita">Receitas</option>
              <option value="despesa">Despesas</option>
            </select>
          </label>
          )}
          <label className="fc-label">
            {incomeVisible ? "Fornecedor / cliente" : "Fornecedor"}
            <select
              value={counterparty}
              onChange={(event) => setCounterparty(event.target.value)}
              className="mt-1.5 block max-w-56 rounded-full border bg-zinc-50 px-3.5 py-2 text-sm font-normal"
            >
              <option value="Todos">Todos</option>
              {counterpartyOptions.map((contact) => (
                <option key={contact.id} value={contactIdentity(contact.kind, contact.unit, contact.name)}>
                  {contact.name} · {contact.unit} · {contact.kind === "despesa" ? "Fornecedor" : "Cliente"}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="fc-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ["Receitas no período", income, "text-emerald-600", pick((e) => e.kind === "receita")],
          ["Despesas no período", expense, "text-red-600", pick((e) => e.kind === "despesa")],
          [
            "Resultado projetado",
            income - expense,
            income - expense >= 0 ? "text-brand-700" : "text-red-600",
            filtered,
          ],
          ["Resultado realizado", realizedIncome - realizedExpense, realizedIncome >= realizedExpense ? "text-brand-700" : "text-red-600", pick((e) => e.status === "realizado")],
          ["A pagar", pendingPay, "text-orange-600", pick((e) => e.kind === "despesa" && e.status === "previsto")],
          ["A receber", pendingReceive, "text-brand-700", pick((e) => e.kind === "receita" && e.status === "previsto")],
          ["Pagar vencido", overduePay, "text-red-600", pick((e) => e.kind === "despesa" && e.status === "previsto" && e.date < todayKey)],
          ["Receber vencido", overdueReceive, "text-orange-600", pick((e) => e.kind === "receita" && e.status === "previsto" && e.date < todayKey)],
        ] as [string, number, string, Entry[]][])
          .filter(([label]) => incomeVisible || !["Receitas no período", "Resultado projetado", "Resultado realizado", "A receber", "Receber vencido"].includes(label))
          .map(([label, value, color, items]) => (
          <button
            key={label}
            type="button"
            onClick={() => openDrill(label, items)}
            onPointerMove={spot}
            className="fc-card fc-spot fc-lift group p-5 text-left hover:shadow-lg"
          >
            <p className="flex items-center gap-2 text-xs font-medium text-zinc-500"><span className={`h-2 w-2 rounded-full bg-current ${color}`} />{label}</p>
            <p className={`mt-2 text-2xl font-semibold tracking-[-0.03em] ${color}`}>
              <Money value={value} />
            </p>
            <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-zinc-400 group-hover:text-[#831843]">{items.length} lançamento(s)<ChevronRight className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-1" /></p>
          </button>
        ))}
      </div>
      <section className="fc-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="fc-h">Receitas e consumo no período</h2>
            <p className="mt-2 text-xs text-zinc-600">Caixa por vencimento/pagamento — Saldo anterior: {fmt(reportPosition.opening)} · Saldo final realizado: {fmt(reportPosition.closing)} · Saldo final previsto: {fmt(reportPosition.projectedClosing)}</p>
            <p className="fc-sub mt-1">
              {shortPeriod ? "Visão semanal" : "Visão mensal"} · Passe o mouse nas barras para ver os valores.
            </p>
          </div>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-600">
            {filtered.length} lançamentos
          </span>
        </div>
        {filtered.length && periodBuckets.length ? (
          <div className="mt-5 overflow-x-auto">
            <div style={{ minWidth: Math.max(600, periodBuckets.length * 105) }}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={periodBuckets} margin={{ top: 8, right: 8, left: 8, bottom: 4 }} barGap={4} maxBarSize={44}>
                  <CartesianGrid vertical={false} stroke="#ececee" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(value: number) => new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(value)} />
                  <Tooltip formatter={(value, name) => [fmt(Number(value)), String(name)]} contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 16px 36px -10px rgb(131 24 67 / 0.18)" }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                  {incomeVisible && <Bar dataKey="Receitas recebidas" stackId="receita" fill="#059669" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(data: any) => { const b = data?.payload ?? data; openDrill(`Receitas recebidas · ${b.label}`, pick((e) => e.kind === "receita" && e.status === "realizado" && reportingDate(e) >= b.start && reportingDate(e) <= b.end)); }} />}
                  {incomeVisible && <Bar dataKey="Receitas previstas" stackId="receita" fill="#6ee7b7" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(data: any) => { const b = data?.payload ?? data; openDrill(`Receitas previstas · ${b.label}`, pick((e) => e.kind === "receita" && e.status === "previsto" && reportingDate(e) >= b.start && reportingDate(e) <= b.end)); }} />}
                  <Bar dataKey="Despesas pagas" stackId="despesa" fill="#e11d48" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(data: any) => { const b = data?.payload ?? data; openDrill(`Despesas pagas · ${b.label}`, pick((e) => e.kind === "despesa" && e.status === "realizado" && reportingDate(e) >= b.start && reportingDate(e) <= b.end)); }} />
                  <Bar dataKey="Despesas previstas" stackId="despesa" fill="#fda4af" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(data: any) => { const b = data?.payload ?? data; openDrill(`Despesas previstas · ${b.label}`, pick((e) => e.kind === "despesa" && e.status === "previsto" && reportingDate(e) >= b.start && reportingDate(e) <= b.end)); }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : <p className="py-12 text-center text-sm text-zinc-400">Sem lançamentos no período selecionado.</p>}
      </section>
      <DailyLedger
        entries={filtered}
        categories={categories}
        banks={banks}
        cards={cards}
        title="Diário do período"
        subtitle={`Tudo de ${dateLabel(from)} a ${dateLabel(to)}, dia a dia, separado por cartão e conta. Use os filtros para destrinchar.`}
        onOpen={(entry) => openDrill(entry.description || "Lançamento", [entry])}
      />
      <div className="grid gap-5 xl:grid-cols-2">
        {([
          ["Despesas por categoria", expenseDetails, expense],
          ...(incomeVisible ? ([["Receitas por categoria", incomeDetails, income]] as const) : []),
        ] as const).map(([title, rows, totalValue]) => (
          <section key={title} className="fc-card p-6">
            <h2 className="fc-h">{title}</h2>
            <p className="fc-sub mt-1">Cor do plano de contas · Centro e percentual na legenda.</p>
            {rows.length ? (
              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative h-56 w-full shrink-0 sm:w-56">
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"><span className="text-[11px] text-zinc-500">Total</span><b className="text-base font-semibold tracking-[-0.02em] text-[#831843]">{fmt(totalValue)}</b></div>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={rows} dataKey="total" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2} stroke="none" cursor="pointer" onClick={(data: any) => { const it = data?.payload ?? data; openDrill(`${it.name} · ${it.unit}`, entriesByCategory(it)); }}>
                        {rows.map((item) => <Cell key={item.key} fill={item.color} />)}
                      </Pie>
                      <Tooltip formatter={(value, _name, item) => [fmt(Number(value)), `${item.payload.name} · ${item.payload.unit}`]} contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 16px 36px -10px rgb(131 24 67 / 0.18)" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {rows.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => openDrill(`${item.name} · ${item.unit}`, entriesByCategory(item))}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs hover:bg-zinc-50"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white" style={{ backgroundColor: item.color, boxShadow: `0 0 0 1px ${item.color}` }} />
                      <span className="min-w-0 flex-1 truncate text-zinc-700" title={`${item.name} · ${item.unit}`}>{item.name} <span className="text-zinc-400">· {item.unit}</span></span>
                      <b className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">{totalValue ? Math.round(item.total / totalValue * 100) : 0}%</b>
                      <span className="w-24 text-right font-semibold text-[#831843]">{fmt(item.total)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : <p className="py-12 text-center text-sm text-zinc-400">Sem dados no período selecionado.</p>}
          </section>
        ))}
      </div>
      <section className="fc-card p-5">
        <h2 className="fc-h">Detalhamento por categoria</h2>
        <p className="fc-sub mt-1">Total, situação, vencidos e quantidade de lançamentos no período.</p>
        {categoryDetails.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="fc-table min-w-[760px] text-left text-xs">
              <thead>
                <tr><th className="p-3">Categoria</th><th className="p-3">Centro</th><th className="p-3">Tipo</th><th className="p-3 text-right">Realizado</th><th className="p-3 text-right">Em aberto</th><th className="p-3 text-right">Vencido</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Lançamentos</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {categoryDetails.map((item) => (
                  <tr
                    key={item.key}
                    onClick={() => openDrill(`${item.name} · ${item.unit}`, entriesByCategory(item))}
                    className="cursor-pointer hover:bg-zinc-50"
                  >
                    <td className="p-3 font-medium text-zinc-800"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</td>
                    <td className="p-3 text-zinc-600">{item.unit}</td>
                    <td className="p-3 text-zinc-600">{item.kind === "despesa" ? "Despesa" : "Receita"}</td>
                    <td className="p-3 text-right">{fmt(item.realized)}</td>
                    <td className="p-3 text-right">{fmt(item.pending)}</td>
                    <td className="p-3 text-right font-bold text-red-600">{fmt(item.overdue)}</td>
                    <td className="p-3 text-right font-semibold text-zinc-900">{fmt(item.total)}</td>
                    <td className="p-3 text-right">{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="py-8 text-center text-sm text-zinc-400">Sem categorias com movimento no período.</p>}
      </section>
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="fc-card p-5">
          <h2 className="fc-h">Maiores categorias de despesa</h2>
          <p className="fc-sub mt-1">Comparação das categorias com maior peso no período.</p>
          {expenseDetails.length ? (
            <>
              <div className="mt-4 overflow-x-auto">
                <div style={{ minWidth: 400 }}>
                  <ResponsiveContainer width="100%" height={Math.max(240, Math.min(expenseDetails.length, 8) * 42 + 45)}>
                    <BarChart data={expenseDetails.slice(0, 8).reverse().map((item) => ({ ...item, label: `${item.name} · ${item.unit}` }))} layout="vertical" margin={{ left: 6, right: 20 }}>
                      <CartesianGrid horizontal={false} stroke="#ececee" strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(value: number) => new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(value)} />
                      <YAxis type="category" dataKey="label" width={155} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(value) => fmt(Number(value))} contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 16px 36px -10px rgb(131 24 67 / 0.18)" }} />
                      <Bar dataKey="total" name="Despesa" radius={[0, 5, 5, 0]} cursor="pointer" onClick={(data: any) => { const it = data?.payload ?? data; openDrill(`${it.name} · ${it.unit}`, entriesByCategory(it)); }}>
                        {expenseDetails.slice(0, 8).reverse().map((item) => <Cell key={item.key} fill={item.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="mt-5 divide-y divide-zinc-100 border-t border-zinc-100">
                {expenseDetails.slice(0, 8).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => openDrill(`${item.name} · ${item.unit}`, entriesByCategory(item))}
                    className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-xs hover:bg-zinc-50"
                  >
                    <span className="font-bold text-zinc-800"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.name} <span className="font-normal text-zinc-400">· {item.unit}</span></span>
                    <span className="text-zinc-500">{item.count} lançamentos · Pago {fmt(item.realized)} · A pagar {fmt(item.pending)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : <p className="py-10 text-center text-sm text-zinc-400">Sem despesas no período.</p>}
        </section>
        <section className="fc-card p-5">
          <h2 className="fc-h">Maiores despesas individuais</h2>
          <p className="fc-sub mt-1">Lançamentos de maior valor, inclusive parcelas e recorrências.</p>
          <div className="mt-4 divide-y divide-zinc-100">
            {largestExpenses.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => openDrill(entry.description || "Lançamento", [entry])}
                className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-zinc-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-zinc-800" title={entry.description}>{entry.description}</p>
                  <p className="truncate text-xs text-zinc-400">{entry.category} · {entry.unit} · {dateLabel(reportingDate(entry))}</p>
                  <p className="text-[11px] text-zinc-400">{entry.status === "realizado" ? "Pago" : entry.date < todayKey ? "Vencido" : "A pagar"}{entry.installment ? ` · Parcela ${entry.installment}` : entry.recurrence !== "nenhuma" ? ` · Recorrente ${entry.recurrence}` : ""}</p>
                </div>
                <b className="shrink-0 text-sm text-red-600">{fmt(entry.amount)}</b>
              </button>
            ))}
            {!largestExpenses.length && <p className="py-5 text-sm text-zinc-400">Sem despesas no período.</p>}
          </div>
        </section>
      </div>
      <div className={`grid gap-5 ${kind === "todos" ? "xl:grid-cols-2" : ""}`}>
        {kind !== "receita" && <CounterpartyReportPanel kind="despesa" entries={filtered} contacts={reportContacts} todayKey={todayKey} onDrill={openDrill} />}
        {kind !== "despesa" && <CounterpartyReportPanel kind="receita" entries={filtered} contacts={reportContacts} todayKey={todayKey} onDrill={openDrill} />}
      </div>
      {kind !== "receita" && (
        <section className="fc-card p-5">
          <h2 className="fc-h">Juros e atraso</h2>
          <p className="fc-sub mt-1">Despesas já pagas no período. Clique nos cards para ver o detalhamento.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => openDrill("Despesas com juros", jurosEntries)}
              className="fc-lift rounded-2xl bg-gradient-to-br from-red-50 to-white p-4 text-left ring-1 ring-red-100 hover:shadow-md"
            >
              <p className="text-xs font-bold text-zinc-500">Juros pagos</p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-red-600">{fmt(totalJuros)}</p>
              <p className="mt-1 text-[11px] font-semibold text-brand-700">{jurosEntries.length} despesa(s) · Ver →</p>
            </button>
            <button
              type="button"
              onClick={() => openDrill("Despesas pagas em atraso", lateExpenses)}
              className="fc-lift rounded-2xl bg-gradient-to-br from-orange-50 to-white p-4 text-left ring-1 ring-orange-100 hover:shadow-md"
            >
              <p className="text-xs font-bold text-zinc-500">Pagas em atraso</p>
              <p className="mt-2 text-2xl font-extrabold text-orange-600">{lateExpenses.length}</p>
              <p className="mt-1 text-[11px] font-semibold text-brand-700">Ver lançamentos →</p>
            </button>
            <div className="fc-card-soft p-4">
              <p className="text-xs font-bold text-zinc-500">Atraso médio</p>
              <p className="mt-2 text-2xl font-extrabold text-[#831843]">{avgLateDays} dia(s)</p>
              <p className="mt-1 text-[11px] text-zinc-400">{totalLateDays} dia(s) no total</p>
            </div>
          </div>
        </section>
      )}
      {incomeVisible && (
      <section className="fc-card p-5">
        <h2 className="fc-h">
          Saldo final por conta bancária no período
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {accountRows.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openDrill(item.name, pick((e) => (e.bankId || "__unassigned__") === item.id && e.status === "realizado"))}
              onPointerMove={spot}
              className="fc-spot fc-lift group flex flex-col rounded-2xl bg-zinc-50 p-4 text-left ring-1 ring-zinc-100 hover:bg-white hover:shadow-md"
            >
              <span className="mb-3"><BankLogo name={item.name} className="h-9 w-9 text-sm" /></span>
              <p className="font-medium text-[#831843]">{item.name}</p>
              <p className="text-xs text-zinc-400">Saldo anterior mais movimentações realizadas</p>
              <p
                className={`mt-3 text-xl font-semibold tracking-[-0.03em] ${item.balance >= 0 ? "text-[#831843]" : "text-red-600"}`}
              >
                {fmt(item.balance)}
              </p>
            </button>
          ))}
        </div>
      </section>
      )}
      {drill && (
        <div className="fc-overlay fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4" role="presentation" onClick={() => setDrill(null)}>
          <section
            role="dialog"
            aria-modal="true"
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between border-b px-6 py-4">
              <div className="min-w-0">
                <h2 className="truncate font-extrabold text-[#831843]">{drill.title}</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {drill.items.length} lançamento(s) · {dateLabel(from)} a {dateLabel(to)}
                </p>
              </div>
              <button type="button" onClick={() => setDrill(null)} aria-label="Fechar" className="rounded-full p-2 text-zinc-500 hover:rotate-90 hover:bg-zinc-100 hover:text-[#831843]"><X className="h-5 w-5" /></button>
            </header>
            <div className="divide-y divide-zinc-100 overflow-y-auto px-6">
              {drill.items.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-zinc-800">
                      {entry.description}
                      {entry.installment && <span className="font-normal text-zinc-400"> ({entry.installment})</span>}
                    </p>
                    <p className="truncate text-[11px] text-zinc-400">
                      <b className="text-xs font-extrabold text-zinc-800">{dateLabel(reportingDate(entry))}</b> · {entry.unit} · {entry.category}
                    </p>
                    {entry.beneficiary?.trim() && (
                      <p className="truncate text-[11px] text-zinc-500">
                        {entry.kind === "despesa" ? "Fornecedor" : "Cliente"}: {entry.beneficiary.trim()}
                      </p>
                    )}
                    {entry.kind === "despesa" && ((entry.juros || 0) > 0 || (entry.discount || 0) > 0 || entry.paidDate) && (
                      <p className="text-[11px] text-zinc-500">
                        {(entry.juros || 0) > 0 && <>Juros <b className="text-red-600">{fmt(entry.juros || 0)}</b> · </>}
                        {(entry.discount || 0) > 0 && <>Desconto <b className="text-emerald-700">{fmt(entry.discount || 0)}</b> · </>}
                        {entry.paidDate && (lateDays(entry) > 0
                          ? <>Pago em {new Date(`${entry.paidDate}T12:00:00`).toLocaleDateString("pt-BR")} · <b className="text-orange-600">{lateDays(entry)} dia(s) de atraso</b></>
                          : <>Pago em dia</>)}
                      </p>
                    )}
                    {entry.attachments && entry.attachments.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {entry.attachments.map((path) => (
                          <button
                            key={path}
                            type="button"
                            onClick={async () => {
                              try {
                                const url = await signedAttachmentUrl(path);
                                window.open(url, "_blank", "noopener");
                              } catch (error) {
                                window.alert(error instanceof Error ? error.message : "Não foi possível abrir o arquivo.");
                              }
                            }}
                            className="inline-flex max-w-[160px] items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700 hover:bg-brand-100"
                          >
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="truncate">{(path.split("/").pop() || path).replace(/^\d+-/, "")}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-extrabold ${entry.kind === "receita" ? "text-emerald-600" : "text-red-600"}`}>
                      {entry.kind === "receita" ? "+" : "-"}{fmt(entryValue(entry))}
                    </p>
                    <p className="text-[10px] font-bold uppercase text-zinc-400">
                      {entry.status === "realizado" ? (entry.kind === "despesa" ? "Pago" : "Recebido") : entry.date < todayKey ? "Vencido" : entry.kind === "despesa" ? "A pagar" : "A receber"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <footer className="flex items-center justify-between border-t bg-zinc-50 px-6 py-3 text-sm font-bold text-zinc-700">
              <span>Total</span>
              <span>{fmt(drill.items.reduce((sum, entry) => sum + entryValue(entry), 0))}</span>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
function App() {
  const [screen, setScreen] = useState("dashboard"),
    // The cached profile is only a convenience for the next paint. It can never
    // be the source of truth: a different Supabase session may be active in this
    // browser after a logout/login. Start empty and bootstrap from Supabase.
    [currentUser, setCurrentUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(false),
    [modal, setModal] = useState<Kind | null>(null),
    [categoryModal, setCategoryModal] = useState(false),
    [centerModal, setCenterModal] = useState(false),
    [editingCenter, setEditingCenter] = useState<CostCenter | null>(null),
    [deletingCenter, setDeletingCenter] = useState<CostCenter | null>(null),
    [editingCategory, setEditingCategory] = useState<Category | null>(null),
    [dashDrill, setDashDrill] = useState<DrillState | null>(null),
    [deletingCategory, setDeletingCategory] = useState<Category | null>(null),
    [editing, setEditing] = useState<Entry | null>(null),
    [scopeDialog, setScopeDialog] = useState<{
      entry: Entry;
      action: "editar" | "excluir";
    } | null>(null),
    [editScope, setEditScope] = useState<"one" | "series">("one"),
    [entries, setEntries] = useState<Entry[]>([]),
    [savedContacts, setSavedContacts] = useState<Counterparty[]>([]),
    [contactsTableReady, setContactsTableReady] = useState(false),
    [banks, setBanks] = useState<Bank[]>([]),
    [banksReady, setBanksReady] = useState(false),
    [cards, setCards] = useState<PersonalCreditCard[]>([]),
    [cardFocus, setCardFocus] = useState<{cardId:string;month:string}|null>(null),
    [adjustments, setAdjustments] = useState<BalanceAdjustment[]>([]),
    [cardPayments, setCardPayments] = useState<CardPayment[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [centers, setCenters] = useState<CostCenter[]>([]),
    [centerTableReady, setCenterTableReady] = useState(false),
    [filter, setFilter] = useState<Unit | "Todos">("Todos"),
    [entryFilter, setEntryFilter] = useState<
      "todos" | "pagar" | "receber" | "pagas" | "recebidas" | "atrasadas"
    >("todos"),
    [periodMode, setPeriodMode] = useState<"mes" | "hoje" | "semana" | "custom">("mes"),
    [periodFrom, setPeriodFrom] = useState(""),
    [periodTo, setPeriodTo] = useState(""),
    [counterpartyFilter, setCounterpartyFilter] = useState("todos"),
    [search, setSearch] = useState(""),
    [overdueKind, setOverdueKind] = useState<Kind | "todos">("todos"),
    [notificationsOpen, setNotificationsOpen] = useState(false),
    [menu, setMenu] = useState(false),
    [users, setUsers] = useState<User[]>([]),
    [dataReady, setDataReady] = useState(false),
    [dataError, setDataError] = useState(""),
    [syncVersion, setSyncVersion] = useState(0),
    [refreshing, setRefreshing] = useState(false),
    [syncError, setSyncError] = useState(false),
    [lastSync, setLastSync] = useState(""),
    [month, setMonth] = useState(
      () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    );
  const contacts = useMemo(
    () => contactsWithLegacyEntries(savedContacts, entries),
    [savedContacts, entries],
  );
  useEffect(() => {
    if (currentUser)
      localStorage.setItem("fincore-gi.user", JSON.stringify(currentUser));
    else localStorage.removeItem("fincore-gi.user");
  }, [currentUser]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !authUser) {
        setCurrentUser(null);
        setAuthReady(true);
        return;
      }
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, email, role, allowed_units, hidden_screens")
        .eq("id", authUser.id)
        .single();
      if (!active) return;
      if (profileError || !profile || profile.role !== "master" || authUser.email?.toLowerCase() !== "master@financeiro.com") {
        await supabase.auth.signOut();
        setCurrentUser(null);
        setAuthReady(true);
        return;
      }
      const access = profileAccess(profile.allowed_units);
      setCurrentUser({
        id: authUser.id,
        name: profile.full_name,
        email: profile.email || authUser.email || "",
        role: profile.role as User["role"],
        units: access.units,
        canViewReports: access.canViewReports,
      canCreatePlans: access.canCreatePlans,
        hiddenScreens: profile.hidden_screens ?? [],
      });
      setAuthReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!currentUser) {
      setDataReady(false);
      setSavedContacts([]);
      setContactsTableReady(false);
      setCenters([]);
      setCenterTableReady(false);
      setBanks([]);
      setBanksReady(false);
      return () => {
        active = false;
      };
    }
    setDataReady(false);
    setDataError("");
    void (async () => {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !user) {
        setCurrentUser(null);
        return;
      }
      try {
        // A restored browser tab can retain an old access token after another
        // user has signed in. Refresh it before every initial financial read so
        // the RLS rules use the current account and its permitted units.
        const {
          data: { session },
          error: refreshError,
        } = await supabase.auth.refreshSession();
        if (refreshError || !session)
          throw refreshError || new Error("Sessão expirada.");
        const [entryRows, categoryRows] = await Promise.all([
          readAuthenticatedRows<any>("entries", "date.desc"),
          readAuthenticatedRows<Category>("categories"),
        ]);
        if (!active) return;
        const loadedEntries = entryRows.map((row: any) => ({
          ...row,
          seriesId: row.series_id || undefined,
          counterpartyId: row.counterparty_id ?? undefined,
          amount: Number(row.amount),
          juros: row.juros != null ? Number(row.juros) : 0,
          paidDate: row.paid_date || undefined,
          discount: row.discount != null ? Number(row.discount) : undefined,
          bankId: row.bank_id === undefined ? undefined : row.bank_id,
          invoiceAdjustment: row.invoice_adjustment, creditCardId: row.credit_card_id, invoiceMonth: row.invoice_month, cardPurchaseDate:row.purchase_date, cardInstallmentOffset:row.card_installment_offset,
        })) as Entry[];
        // The new registry has its own migration. Until it is applied, the
        // old production database and existing launches must remain readable.
        let contactRows: Counterparty[] = [];
        let contactTableAvailable = false;
        try {
          contactRows = await readAuthenticatedRows<Counterparty>("counterparties");
          contactTableAvailable = true;
        } catch (contactError) {
          console.info("Fincore: cadastro de contatos ainda indisponível", contactError);
        }
        let centerRows: CostCenterRow[] = [];
        let centerTableAvailable = false;
        try {
          centerRows = await readAuthenticatedRows<CostCenterRow>("cost_centers");
          centerTableAvailable = true;
        } catch (centerError) {
          console.info("Fincore: cadastro de centros ainda indisponível", centerError);
        }
        let bankRows: Bank[] = [];
        let bankTableAvailable = false;
        try {
          bankRows = await readAuthenticatedRows<Bank>("banks", "name.asc");
          bankTableAvailable = true;
        } catch (bankError) {
          console.info("Fincore: cadastro de bancos ainda indisponível", bankError);
        }
        // Keep recurring series alive without pre-creating decades of records.
        // Only missing months inside the rolling three-year window are written.
        const [cardRows, adjustmentRows] = await Promise.all([
          readAuthenticatedRows<PersonalCreditCard>("credit_cards", "name.asc"),
          readAuthenticatedRows<BalanceAdjustment>("bank_balance_adjustments", "date.asc"),
        ]);
        const projectedEntries = nextRecurringEntries(loadedEntries,cardRows);
        let entriesToShow = loadedEntries;
        if (projectedEntries.length) {
          try {
            const regular=projectedEntries.filter(e=>!e.creditCardId), purchases=projectedEntries.filter(e=>e.creditCardId);
            if(regular.length)await saveRemoteEntries(regular);
            if(purchases.length)await saveCardPurchases(purchases);
            entriesToShow = [...projectedEntries, ...loadedEntries];
          } catch (projectionError) {
            // Existing financial data remains available even if extending the
            // forecast fails; it will be retried the next time the app opens.
            console.error(
              "Fincore: falha ao estender recorrências",
              projectionError,
            );
          }
        }
        if (!active) return;
        setCards(cardRows); setAdjustments(adjustmentRows); setCardPayments(await readCardPayments());
        if (!active) return;
        setEntries(entriesToShow);
        setSavedContacts(contactRows);
        setContactsTableReady(contactTableAvailable);
        setCenters(centerTableAvailable ? centerRows.map(costCenterVisual) : []);
        setCenterTableReady(centerTableAvailable);
        setBanks(bankRows);
        setBanksReady(bankTableAvailable);
        setCategories(categoryRows);
        setDataReady(true);
      } catch (error) {
        if (!active) return;
        console.error("Fincore: falha ao carregar dados", error);
        setDataError(
          "Não foi possível carregar os dados do banco. Tente novamente.",
        );
        setDataReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [currentUser?.id]);
  useEffect(() => {
    if (!currentUser || !dataReady || dataError) return;
    let cancelled = false;
    let busy = false;
    const refreshFinancialData = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      setRefreshing(true);
      try {
        const [rows, categoryRows, centerRows, bankRows, contactRows, profileRows, cardRows, adjustmentRows] = await Promise.all([
          readAuthenticatedRows<any>("entries", "date.desc"),
          readAuthenticatedRows<Category>("categories"),
          centerTableReady ? readAuthenticatedRows<CostCenterRow>("cost_centers") : Promise.resolve(null),
          banksReady ? readAuthenticatedRows<Bank>("banks") : Promise.resolve(null),
          contactsTableReady ? readAuthenticatedRows<Counterparty>("counterparties") : Promise.resolve(null),
          readAuthenticatedRows<any>("profiles"),
          readAuthenticatedRows<PersonalCreditCard>("credit_cards", "name.asc"),
          readAuthenticatedRows<BalanceAdjustment>("bank_balance_adjustments", "date.asc"),
        ]);
        if (cancelled) return;
        setEntries(rows.map((row: any) => ({
          ...row, seriesId: row.series_id || undefined, counterpartyId: row.counterparty_id ?? undefined,
          amount: Number(row.amount), juros: Number(row.juros || 0), paidDate: row.paid_date || undefined,
          discount: Number(row.discount || 0), bankId: row.bank_id ?? null,
          invoiceAdjustment: row.invoice_adjustment, creditCardId: row.credit_card_id, invoiceMonth: row.invoice_month, cardPurchaseDate:row.purchase_date, cardInstallmentOffset:row.card_installment_offset,
        })) as Entry[]);
        setCards(cardRows); setAdjustments(adjustmentRows);
        const paymentRows = await readCardPayments();
        if (!cancelled) setCardPayments(paymentRows);
        setCategories(categoryRows);
        if (centerRows) setCenters(centerRows.map(costCenterVisual));
        if (bankRows) setBanks(bankRows);
        if (contactRows) setSavedContacts(contactRows);
        const profile = profileRows.find((row: any) => row.id === currentUser.id);
        if (profile) {
          const access = profileAccess(profile.allowed_units);
          setCurrentUser(user => user && user.id === profile.id ? {
            ...user, role: profile.role, name: profile.full_name, units: access.units,
            canViewReports: access.canViewReports, canCreatePlans: access.canCreatePlans,
            hiddenScreens: profile.hidden_screens ?? [],
          } : user);
        }
        setLastSync(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
        setSyncError(false);
      } catch (error) {
        if (!cancelled) setSyncError(true);
        console.error("Fincore: falha ao atualizar dados financeiros", error);
      } finally {
        busy = false;
        if (!cancelled) setRefreshing(false);
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refreshFinancialData(); };
    void refreshFinancialData();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => void refreshFinancialData(), 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [currentUser?.id, dataReady, dataError, centerTableReady, banksReady, contactsTableReady, screen, syncVersion]);
  const screenAllowed = (id: string) => {
    if (!currentUser) return true;
    if (currentUser.role === "master") return true;
    if (id === "usuarios") return false;
    if (id === "relatorios" && !currentUser.canViewReports) return false;
    return !(currentUser.hiddenScreens ?? []).includes(id);
  };
  // Se o usuário estiver numa aba que foi removida dele, leva para a
  // primeira aba liberada.
  useEffect(() => {
    if (!currentUser || currentUser.role === "master") return;
    if (screenAllowed(screen)) return;
    const fallback = ["dashboard", "lancamentos", "contas", "categorias", "contatos", "relatorios"].find(screenAllowed);
    if (fallback && fallback !== screen) setScreen(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.hiddenScreens, currentUser?.canViewReports, screen]);
  const loadUsers = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, allowed_units, hidden_screens")
      .order("created_at");
    if (!data) return;
    setUsers(
      data.map((profile) => {
        const access = profileAccess(profile.allowed_units);
        return {
          id: profile.id,
          name: profile.full_name,
          email:
            profile.email ||
            (profile.id === currentUser?.id ? currentUser?.email ?? "" : ""),
          role: profile.role as User["role"],
          units: access.units,
          canViewReports: access.canViewReports,
      canCreatePlans: access.canCreatePlans,
          hiddenScreens: profile.hidden_screens ?? [],
        };
      }),
    );
  };
  const removeCategory = async (category: Category) => {
    await deleteRemoteCategory(category.id);
    setCategories((old) => old.filter((item) => item.id !== category.id));
    setDeletingCategory(null);
  };
  const createCenter = async (name: string, initials: string, color: string) => {
    if (!currentUser || (currentUser.role !== "master" && !currentUser.canCreatePlans)) throw new Error("Seu acesso não permite criar planos de contas.");
    if (!centerTableReady) throw new Error("A configuração do banco para novos centros ainda não está disponível.");
    if (name.length < 2 || name.length > 80 || name === "Todos" || name === reportsAccessFlag || name === teamNotesAccessFlag || name === createPlansAccessFlag)
      throw new Error("Informe um nome válido entre 2 e 80 caracteres.");
    if (centers.some((center) => center.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")))
      throw new Error("Já existe um centro de custo com esse nome.");
    const saved = await createRemoteCostCenter(name, initials || name.slice(0, 2).toLocaleUpperCase("pt-BR"), color);
    const center = costCenterVisual(saved as CostCenterRow);
    setCenters((old) => [...old, center]);
    setCurrentUser((user) => user && user.role !== "master"
      ? { ...user, units: [...new Set([...user.units, center.name])] }
      : user);

  };
  const updateCenter = async (name: string, initials: string, color: string) => {
    if (currentUser?.role !== "master") throw new Error("Apenas o Master pode editar planos de contas.");
    const saved = await updateRemoteCostCenter(name, {
      initials: initials || name.slice(0, 2).toLocaleUpperCase("pt-BR"),
      color,
    });
    const center = costCenterVisual(saved as CostCenterRow);
    setCenters((old) => old.map((item) => (item.name === name ? center : item)));
  };
  const deleteCenter = async (name: string) => {
    if (currentUser?.role !== "master") throw new Error("Apenas o Master pode excluir planos de contas.");
    // withFreshSession já lança o erro se a exclusão falhar.
    await deleteRemoteCostCenter(name);
    // O banco apaga em cascata; aqui só mantemos a tela em sincronia.
    setCenters((old) => old.filter((item) => item.name !== name));
    setCategories((old) => old.filter((item) => item.unit !== name));
    setEntries((old) => old.filter((item) => item.unit !== name));
    setSavedContacts((old) => old.filter((item) => item.unit !== name));
    setFilter((current) => (current === name ? "Todos" : current));
  };
  useEffect(() => {
    if (currentUser?.role === "master") void loadUsers();
  }, [currentUser?.id, currentUser?.role]);
  const logout = () => {
    // The interface must release the current operation immediately. The remote
    // sign-out can finish in the background and must not leave the user stuck
    // on a protected screen when the network is slow.
    setCurrentUser(null);
    setDataReady(false);
    void supabase.auth
      .signOut()
      .catch((error) =>
        console.error("Fincore: falha ao encerrar sessão", error),
      );
  };
  if (!authReady)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f4f5] p-6 text-center">
        <div className="rounded-2xl bg-white px-8 py-7 shadow-sm">
          <img
            src={`${import.meta.env.BASE_URL}fincore-gi-logo.svg`}
            alt="FinCore Gi"
            className="mx-auto w-36"
          />
          <div
            className="mx-auto mt-6 h-7 w-7 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-700"
            aria-label="Carregando"
          />
        </div>
      </main>
    );
  if (!currentUser) return <Login onLogin={setCurrentUser} />;
  if (!dataReady || dataError)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f4f5] p-6 text-center">
        <div className="rounded-2xl bg-white px-8 py-7 shadow-sm">
          <img
            src={`${import.meta.env.BASE_URL}fincore-gi-logo.svg`}
            alt="FinCore Gi"
            className="mx-auto w-36"
          />
          {dataError ? (
            <p className="mt-5 text-sm font-bold text-red-600">
              Não foi possível carregar. Atualize a página.
            </p>
          ) : (
            <div
              className="mx-auto mt-6 h-7 w-7 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-700"
              aria-label="Carregando"
            />
          )}
        </div>
      </main>
    );
  // Receitas, clientes/pagadores, saldos e resultado são exclusivos do Master
  // (o banco também bloqueia; aqui só deixamos a tela coerente).
  const isMaster = currentUser.role === "master";
  const canCreatePlans = isMaster || currentUser.canCreatePlans;
  const allowedUnits =
    currentUser.role === "master"
      ? centers
      : centers.filter((unit) => currentUser.units.includes(unit.name));
  const key = localMonthKey(month),
    today = localDateKey(new Date()),
    visible: Entry[] = [...entries, ...adjustments.map(adjustmentEntry), ...cardPaymentEntries(cardPayments, cards)].filter(
      (x) =>
        currentUser.role === "master" || currentUser.units.includes(x.unit),
    ),
    invoiceDisplay = cardInvoices(visible,cards),
    monthCashForecast = buildCashFlow(visible,banks.map(bank=>bank.id),cards,key,1,today),
    monthCashClosing = monthCashForecast.months[0].closing,
    pending = cardInvoices(visible.filter(x=>x.status === "previsto" && x.date <= today),cards),
    overdue = cardInvoices(visible.filter(x=>x.status === "previsto" && x.date < today),cards),
    overduePay = overdue.filter((x) => x.kind === "despesa"),
    overdueReceive = overdue.filter((x) => x.kind === "receita"),
    cashCurrent = visible.filter((x) => cashDate(x).startsWith(key)),
    // Partial invoice payments are transfers to the card, not spending.
    current = reportingPeriod(visible.filter((x) => !x.cardPayment && !x.invoiceAdjustment), `${key}-01`, localDateKey(new Date(month.getFullYear(), month.getMonth()+1, 0))),
    currentDisplay = cardInvoices(cashCurrent,cards),
    localDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    todayStr = localDate(new Date()),
    // Intervalo de datas da lista de Lançamentos conforme o período escolhido.
    period = (() => {
      if (periodMode === "hoje") return { start: todayStr, end: todayStr, label: "Hoje" };
      if (periodMode === "semana") {
        const now = new Date();
        const offset = (now.getDay() + 6) % 7; // 0 = segunda … 6 = domingo
        const monday = new Date(now);
        monday.setDate(now.getDate() - offset);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return { start: localDate(monday), end: localDate(sunday), label: "Esta semana" };
      }
      if (periodMode === "custom") {
        const start = periodFrom || todayStr;
        const end = periodTo || todayStr;
        return { start, end, label: "Período personalizado" };
      }
      const first = new Date(month.getFullYear(), month.getMonth(), 1);
      const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      return { start: localDate(first), end: localDate(last), label: labelMonth(month) };
    })(),
    listCurrent = invoiceDisplay.filter((x) => cashDate(x) >= period.start && cashDate(x) <= period.end),
    payToday = cardInvoices(visible.filter(x=>x.kind === "despesa" && x.status === "previsto" && x.date === todayStr),cards),
    payTodayTotal = payToday.reduce((s, x) => s + x.amount, 0),
    totals = summarizeFinancialEntries(current),
    cashTotals = summarizeFinancialEntries(cashCurrent),
    position = cashPosition(visible, `${key}-01`, localDateKey(new Date(month.getFullYear(), month.getMonth()+1, 0))),
    move = (n: number) =>
      setMonth((v) => new Date(v.getFullYear(), v.getMonth() + n, 1)),
    openOverdue = (kind: Kind | "todos" = "todos") => {
      setFilter("Todos");
      setCounterpartyFilter("todos");
      setSearch("");
      setOverdueKind(kind);
      setEntryFilter("atrasadas");
      setNotificationsOpen(false);
      setScreen("lancamentos");
    },
    openPayToday = () => {
      setFilter("Todos");
      setCounterpartyFilter("todos");
      setSearch("");
      setOverdueKind("todos");
      setPeriodMode("hoje");
      setEntryFilter("pagar");
      setScreen("lancamentos");
    },
    openNotification = (entry: Entry) => {
      if (entry.date < today) {
        openOverdue(entry.kind);
        return;
      }
      setFilter("Todos");
      setCounterpartyFilter("todos");
      setSearch("");
      setEntryFilter(entry.kind === "despesa" ? "pagar" : "receber");
      setPeriodMode("mes");
      setMonth(new Date(`${entry.date}T12:00:00`));
      setNotificationsOpen(false);
      setScreen("lancamentos");
    };
  const openFinancialEntry = (entry:Entry) => {
    if(entry.cardPayment){setCardFocus({cardId:entry.paysCardId||"",month:entry.paysInvoiceMonth||entry.date.slice(0,7)});setScreen("cartoes");}
    else if(entry.creditCardId){setCardFocus({cardId:entry.creditCardId,month:entry.invoiceMonth||entry.date.slice(0,7)});setScreen("cartoes");}
    else if(entry.balanceAdjustment)setScreen("contas");
  };
  const removeCardPayment = async (x: Entry) => {
    if (!x.cardPaymentId || !window.confirm(`Excluir “${x.description}”? O valor volta para o saldo da conta.`)) return;
    await deleteCardPartialPayment(x.cardPaymentId);
    await refreshPersonal();
  };
  const quickEdit = (x: Entry) => {
    setDashDrill(null);
    if (x.balanceAdjustment || x.creditCardId || x.cardPayment) { openFinancialEntry(x); return; }
    setEditScope("one");
    setEditing(x);
    setModal(x.kind);
  };
  const showEntries = (kind: string) => () => {
    setFilter("Todos"); setCounterpartyFilter("todos"); setSearch(""); setOverdueKind("todos"); setPeriodMode("mes"); setEntryFilter(kind); setScreen("lancamentos");
  };
  const drillTo = (title: string, items: Entry[], seeAll?: () => void, subtitle?: string) => setDashDrill({ title, items, seeAll, subtitle });
  const refreshPersonal = async () => {
    const [rows, adjustmentRows, bankRows, cardRows] = await Promise.all([
      readAuthenticatedRows<any>("entries", "date.desc"),
      readAuthenticatedRows<BalanceAdjustment>("bank_balance_adjustments", "date.asc"),
      readAuthenticatedRows<Bank>("banks", "name.asc"),
      readAuthenticatedRows<PersonalCreditCard>("credit_cards", "name.asc"),
    ]);
    setEntries(rows.map(row => ({...row, amount:Number(row.amount), juros:Number(row.juros||0), discount:Number(row.discount||0),
      paidDate:row.paid_date, bankId:row.bank_id, seriesId:row.series_id, invoiceAdjustment:row.invoice_adjustment, creditCardId:row.credit_card_id, invoiceMonth:row.invoice_month, cardPurchaseDate:row.purchase_date, cardInstallmentOffset:row.card_installment_offset})));
    setAdjustments(adjustmentRows); setBanks(bankRows); setCards(cardRows);
    setCardPayments(await readCardPayments());
    setSyncVersion(v=>v+1);
  };
  const refreshContacts = async () => {
    if (!contactsTableReady) return;
    try {
      setSavedContacts(await readAuthenticatedRows<Counterparty>("counterparties"));
    } catch (error) {
      // A successful entry remains saved even if refreshing the separate
      // contact list fails; its name is still visible through the entry.
      console.error("Fincore: falha ao atualizar contatos", error);
    }
  };
  const save = async (
      data: Omit<Entry, "id">,
      scope: "one" | "series",
      monthParts?: SameMonthPart[],
    ) => {
      // Lançamento avulso editado para dividir/parcelar/recorrente: cria a
      // série nova e só depois apaga o original (se algo falhar, ele fica).
      const replaced =
        editing &&
        !editing.seriesId &&
        (Boolean(monthParts?.length) || data.recurrence !== "nenhuma" || data.installments > 1)
          ? editing
          : null;
      const finishReplacing = async () => {
        if (!replaced) return;
        await deleteRemoteEntries([replaced.id]);
        setEntries((old) => old.filter((entry) => entry.id !== replaced.id));
        setEditing(null);
      };
      if (editing && !replaced) {
        const isWholeSeries = scope === "series" && Boolean(editing.seriesId);
        const occurrences = isWholeSeries
          ? entries.filter((entry) => entry.seriesId === editing.seriesId)
          : [];
        // A series may contain paid and pending months, or two installments
        // with different amounts. Only propagate fields actually changed in
        // the form; otherwise a due-date correction would overwrite them.
        const seriesChanges = changedSeriesFields<Entry>(editing, data, [
          "date",
          "installment",
        ]);
        const updated = entries.map((x) =>
          (
            isWholeSeries
              ? x.seriesId === editing.seriesId
              : x.id === editing.id
          )
            ? {
                ...x,
                ...(isWholeSeries ? seriesChanges : data),
                id: x.id,
                seriesId: x.seriesId,
                date: isWholeSeries
                  ? (x.recurrence === "semanal" ? shiftWeeklyDate(x.date, editing.date, data.date) : seriesDueDate(occurrences, editing, x, data.date))
                  : data.date,
                installment: x.installment,
              }
            : x,
        );
        const changed = updated.filter((x) =>
          isWholeSeries ? x.seriesId === editing.seriesId : x.id === editing.id,
        );
        await saveRemoteEntries(changed);
        setEntries(updated);
        void refreshContacts();
        setEditing(null);
        return;
      }
      if (monthParts?.length) {
        const seriesId = id();
        const start = new Date(`${data.date}T12:00:00`);
        // A recurring split is a single monthly series with multiple fixed
        // occurrences (for example, vale on the 15th and salary on the 30th).
        // Create the full rolling forecast immediately so September, October
        // and later months appear without needing a reload.
        const created = Array.from(
          { length: data.recurrence === "mensal" ? 36 : 1 },
          (_, monthIndex) => {
            const dueMonth = new Date(
              start.getFullYear(),
              start.getMonth() + monthIndex,
              1,
            );
            const lastDay = new Date(
              dueMonth.getFullYear(),
              dueMonth.getMonth() + 1,
              0,
            ).getDate();
            return monthParts.map((part, index) => {
              const sourceDate = new Date(`${part.date}T12:00:00`);
              const dueDate = new Date(
                dueMonth.getFullYear(),
                dueMonth.getMonth(),
                Math.min(sourceDate.getDate(), lastDay),
              )
                .toISOString()
                .slice(0, 10);
              return {
                ...data,
                id: id(),
                seriesId,
                amount: parseMoney(part.amount),
                date: dueDate,
                status: monthIndex === 0 ? data.status : "previsto",
                installments: 1,
                installment: `${index + 1}/${monthParts.length}`,
              };
            });
          },
        ).flat();
        await saveRemoteEntries(created);
        setEntries((old) => [...created, ...old]);
        await finishReplacing();
        void refreshContacts();
        return;
      }
      const seriesId =
          data.recurrence !== "nenhuma" || data.installments > 1
            ? id()
            : undefined,
        count = data.recurrence === "mensal" ? 36 : data.recurrence === "semanal" ? 156 : data.installments;
      const monthlySchedule = data.recurrence !== "nenhuma" ? null : monthlyParts(count, data.amount, data.date);
      const created = Array.from({ length: count }, (_, i) => {
        return {
          ...data,
          id: id(),
          seriesId,
          amount:
            data.recurrence !== "nenhuma"
              ? data.amount
              : monthlySchedule![i].amount,
          // Limita ao último dia do mês: 31/07 + 2 meses = 30/09 (não 01/10).
          date: data.recurrence === "semanal" ? addDays(data.date,i*7) : monthlySchedule?.[i].date ?? addMonthsClamped(data.date, i),
          status: i === 0 ? data.status : "previsto",
          paidDate: i === 0 ? data.paidDate : null,
          juros: i === 0 ? data.juros : 0,
          discount: i === 0 ? data.discount : 0,
          installments: 1,
          installment:
            data.installments > 1 ? monthlySchedule![i].installment : undefined,
        };
      });
      await saveRemoteEntries(created);
      setEntries((old) => [...created, ...old]);
      await finishReplacing();
      void refreshContacts();
    },
    settle = async (x: Entry) => {
      if (x.balanceAdjustment || x.creditCardId || x.cardPayment) { openFinancialEntry(x); return; }
      const becomingPaid = x.status !== "realizado";
      const updated = {
        ...x,
        status: becomingPaid ? "realizado" : "previsto",
        // Settlement is a new cash movement today; reversal clears its date.
        paidDate: becomingPaid ? todayStr : null,
      } as Entry;
      await saveRemoteEntries([updated]);
      setEntries((old) => old.map((v) => (v.id === x.id ? updated : v)));
    },
    remove = async (x: Entry, scope: "one" | "series" = "one") => {
      const removed = entries.filter((v) =>
        scope === "series" && x.seriesId
          ? v.seriesId === x.seriesId
          : v.id === x.id,
      );
      if (scope === "series" && x.seriesId)
        await deleteRemoteEntrySeries(x.seriesId);
      else await deleteRemoteEntries(removed.map((entry) => entry.id));
      setEntries((old) =>
        old.filter((v) => !removed.some((entry) => entry.id === v.id)),
      );
    },
    open = (kind: Kind) => {
      setFilter("Todos");
      setCounterpartyFilter("todos");
      setSearch("");
      setEditing(null);
      setModal(kind);
      setScreen("lancamentos");
    },
    searchText = normalizeSearch(search),
    // Com texto na busca, procura em todos os meses (os outros filtros valem).
    list = (entryFilter === "atrasadas" ? overdue : searchText ? invoiceDisplay : listCurrent)
      .filter(
        (x) =>
          !searchText ||
          normalizeSearch(`${x.description} ${x.beneficiary || ""}`).includes(searchText),
      )
      .filter((x) => filter === "Todos" || x.unit === filter || x.invoiceUnits?.includes(filter))
      .filter(
        (x) =>
          entryFilter === "todos" ||
          (entryFilter === "pagar" &&
            x.kind === "despesa" &&
            x.status === "previsto") ||
          (entryFilter === "receber" &&
            x.kind === "receita" &&
            x.status === "previsto") ||
          (entryFilter === "pagas" &&
            x.kind === "despesa" &&
            (x.status === "realizado" || (x.invoicePaidAmount || 0)>0)) ||
          (entryFilter === "recebidas" &&
            x.kind === "receita" &&
            x.status === "realizado") ||
          (entryFilter === "atrasadas" &&
            (overdueKind === "todos" || x.kind === overdueKind)),
      )
      .filter(
        (x) =>
          counterpartyFilter === "todos" ||
          counterpartyKey(x.kind, x.beneficiary || "") === counterpartyFilter,
      ),
    counterparties = Array.from(
      new Map<string, { key: string; kind: Kind; name: string }>(
        contacts
          .filter((contact) => allowedUnits.some((unit) => unit.name === contact.unit))
          .map((contact): [string, { key: string; kind: Kind; name: string }] => [
            counterpartyKey(contact.kind, contact.name),
            {
              key: counterpartyKey(contact.kind, contact.name),
              kind: contact.kind,
              name: contact.name,
            },
          ]),
      ).values(),
    ).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    byUnit = allowedUnits.map((u) => ({
      ...u,
      categories: categories.filter((c) => c.unit === u.name),
    })),
    nav = [
      { id: "dashboard", text: "Dashboard", Icon: LayoutDashboard },
      { id: "lancamentos", text: "Lançamentos", Icon: ReceiptText },
      { id: "contas", text: "Contas", Icon: Wallet },
      ...(isMaster ? [{ id: "fluxo", text: "Fluxo de caixa", Icon: TrendingUp }] : []),
      { id: "cartoes", text: "Cartões de crédito", Icon: CreditCard },
      { id: "categorias", text: "Plano de contas", Icon: Tag },
      { id: "contatos", text: "Fornecedores/clientes", Icon: Building2 },
      { id: "relatorios", text: "Relatórios", Icon: BarChart3 },
    ];
  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f4f5]">
      <aside
        className={`fixed z-30 fc-grain flex h-full w-64 shrink-0 flex-col bg-[radial-gradient(120%_60%_at_0%_0%,#db2777_0%,#9d174d_55%,#500724_100%)] text-white shadow-[inset_-1px_0_0_rgba(255,255,255,0.06)] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] lg:relative ${menu ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="relative z-[1] flex items-center justify-between border-b border-white/[0.07] px-4 py-6">
          <div className="min-w-0 flex-1 text-center">
            <img
              src={`${import.meta.env.BASE_URL}fincore-gi-logo.svg`}
              alt="FinCore Gi"
              className="mx-auto h-14 w-40 object-contain"
            />
            <p className="mt-1.5 text-[11px] font-medium text-white/40">
              Gestão financeira pessoal
            </p>
          </div>
          <button className="lg:hidden" onClick={() => setMenu(false)}>
            <X />
          </button>
        </div>
        <nav className="relative z-[1] flex-1 space-y-0.5 p-3">
          {nav
            .filter((x) => screenAllowed(x.id))
            .map((x) => (
              <button
                key={x.id}
                onClick={() => {
                  setScreen(x.id);
                  if (x.id === "lancamentos") {
                    setFilter("Todos");
                    setCounterpartyFilter("todos");
                    setSearch("");
                    setEntryFilter("todos");
                    setOverdueKind("todos");
                    setPeriodMode("mes");
                  }
                  setMenu(false);
                }}
                className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium tracking-[-0.01em] ${screen === x.id ? "text-[#831843]" : "text-white/55 hover:bg-white/[0.05] hover:text-white"}`}
              >
                {screen === x.id && (
                  <motion.span
                    layoutId="fc-nav-active"
                    transition={{ type: "spring", duration: 0.45, bounce: 0.18 }}
                    className="absolute inset-0 rounded-xl bg-white shadow-[0_10px_28px_-10px_rgba(255,255,255,0.45)]"
                  />
                )}
                <x.Icon className={`relative h-[18px] w-[18px] shrink-0 transition-transform duration-200 ${screen === x.id ? "" : "group-hover:scale-110"}`} />
                <span className="relative truncate whitespace-nowrap text-left">{x.text}</span>
              </button>
            ))}
        </nav>
        <div className="relative z-[1] border-t border-white/[0.07] p-4">
          <div className="mb-3 flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white/20 to-white/5 text-xs font-semibold text-white ring-1 ring-white/10">{currentUser.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">
            {currentUser.name}
          </p>
          <p className="truncate text-[11px] text-white/45">
            {currentUser.email}
          </p></div></div>
          <button
            onClick={logout}
            className="w-full rounded-lg border border-white/10 px-2.5 py-2 text-xs font-medium text-white/70 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
          >
            Sair da conta
          </button>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative z-20 flex items-center justify-between border-b border-black/[0.06] bg-white/80 px-5 py-3.5 backdrop-blur-xl">
          <div className="flex gap-3">
            <button aria-label="Abrir menu" className="rounded-xl p-2 hover:bg-zinc-100 lg:hidden" onClick={() => setMenu(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-[15px] font-semibold tracking-[-0.02em] text-[#831843]">
                {screen === "dashboard"
                  ? "Dashboard Financeiro"
                  : screen === "fluxo"
                    ? "Fluxo de caixa"
                  : screen === "cartoes"
                    ? "Cartões de crédito"
                  : screen === "contas"
                    ? "Contas"
                    : screen === "categorias"
                      ? "Plano de contas"
                      : screen === "contatos"
                        ? "Fornecedores/clientes"
                      : screen === "usuarios"
                        ? "Usuários e acessos"
                        : screen === "relatorios"
                          ? "Relatórios financeiros"
                          : "Lançamentos"}
              </h1>
              <p className="text-xs text-zinc-500">
                {screen === "contas" ? "Cadastre e acompanhe suas contas bancárias" : allowedUnits.map((unit) => unit.name).join(", ") || "Centros de custo"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {screen !== "lancamentos" && screen !== "cartoes" && (
              <div className="hidden items-center gap-2 sm:flex">
                <button
                  onClick={() => open("despesa")}
                  className="rounded-lg bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-600 ring-1 ring-red-600/10 hover:bg-red-100"
                >
                  − Despesa
                </button>
                {isMaster && (
                  <button
                    onClick={() => open("receita")}
                    className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-[0_6px_16px_-6px_rgba(5,150,105,0.6)] hover:bg-emerald-700"
                  >
                    + Receita
                  </button>
                )}
              </div>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen((open) => !open)}
                aria-label={`Notificações${pending.length ? `: ${pending.length} pendências` : ""}`}
                aria-expanded={notificationsOpen}
                className={`relative rounded-full p-2.5 transition ${notificationsOpen ? "bg-[#831843] text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-[#831843]"}`}
              >
                <Bell className="h-5 w-5" />
              </button>
              {pending.length > 0 && (
                <span className="fc-ping pointer-events-none absolute right-0.5 top-0.5 isolate flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white ring-2 ring-white">
                  {pending.length}
                </span>
              )}
              {notificationsOpen && (
                <section className="fc-menu fc-menu-right absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl bg-white text-left shadow-2xl">
                  <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
                    <div>
                      <h2 className="text-sm font-extrabold text-[#831843]">
                        Pendências financeiras
                      </h2>
                      <p className="text-[11px] text-zinc-400">
                        Vencidas e com vencimento hoje
                      </p>
                    </div>
                    {overdue.length > 0 && (
                      <button
                        type="button"
                        onClick={() => openOverdue("todos")}
                        className="text-xs font-bold text-brand-700 hover:text-brand-900"
                      >
                        Ver atrasadas
                      </button>
                    )}
                  </div>
                  {pending.length ? (
                    <div className="max-h-80 overflow-y-auto p-2">
                      {pending
                        .slice()
                        .sort((a, b) => a.date.localeCompare(b.date))
                        .slice(0, 8)
                        .map((entry) => {
                          const isOverdue = entry.date < today;
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => openNotification(entry)}
                              className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-zinc-50"
                            >
                              <span
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isOverdue ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}
                              >
                                <AlertTriangle className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <b className="block truncate text-xs text-zinc-800">
                                  {entry.description}
                                </b>
                                <span className="text-[11px] text-zinc-400">
                                  {isOverdue
                                    ? `Vencida em ${new Date(`${entry.date}T12:00:00`).toLocaleDateString("pt-BR")}`
                                    : "Vence hoje"}
                                  {" · "}
                                  {entry.kind === "despesa"
                                    ? "Conta a pagar"
                                    : "Conta a receber"}
                                </span>
                              </span>
                              <b
                                className={`text-xs ${entry.kind === "despesa" ? "text-red-600" : "text-emerald-600"}`}
                              >
                                {fmt(entry.amount)}
                              </b>
                            </button>
                          );
                        })}
                    </div>
                  ) : (
                    <p className="p-5 text-center text-xs font-medium text-zinc-400">
                      Nenhuma pendência para hoje.
                    </p>
                  )}
                </section>
              )}
            </div>
          </div>
        </header>
        <div key={screen} className={screen === "lancamentos" ? "min-h-0 flex-1 overflow-hidden p-3 sm:p-5" : screen === "cartoes" ? "fc-screen flex-1 overflow-y-auto p-3 sm:p-5" : "fc-screen flex-1 overflow-y-auto p-4 sm:p-6"}>
          {screen === "dashboard" ? (
            <>
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-[1.65rem] font-semibold leading-tight tracking-[-0.035em] text-[#831843]">
                    Visão mensal
                  </h2>
                  <p className="mt-1 flex items-start gap-2 text-xs text-zinc-500">
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${syncError ? "bg-red-500" : refreshing ? "animate-pulse bg-amber-500" : "bg-emerald-500"}`} />
                    <span className={syncError ? "font-medium text-red-600" : ""}>{syncError ? "Não foi possível atualizar os dados. Clique em Atualizar dados para tentar novamente." : lastSync ? `Dados atualizados às ${lastSync}.` : "Carregando atualização dos dados…"}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2"><Month value={month} move={move} /><button type="button" disabled={refreshing} onClick={() => setSyncVersion(value => value + 1)} className="group flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-xs font-medium text-[#831843] shadow-sm hover:shadow-md disabled:opacity-60"><Repeat2 className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : "transition-transform duration-500 group-hover:rotate-180"}`} />{refreshing ? "Atualizando…" : "Atualizar dados"}</button></div>
              </div>
              {pending.length > 0 && (
                <button type="button" onClick={() => openOverdue("todos")} className="group mb-5 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-100/80 via-amber-50 to-white p-2.5 pr-4 text-left text-sm text-amber-900 ring-1 ring-amber-200/70 hover:ring-amber-300">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-[0_6px_14px_-6px_rgba(245,158,11,0.9)]"><AlertTriangle className="h-4 w-4" /></span>
                  <b className="shrink-0 font-semibold">{pending.length} {pending.length === 1 ? "pendência" : "pendências"} de vencimento</b>
                  <span className="min-w-0 flex-1 truncate text-amber-800/75">
                    {pending
                      .slice(0, 3)
                      .map((x) => x.description)
                      .join(", ")}
                    {pending.length > 3 ? "…" : ""}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-amber-700 transition-transform duration-300 group-hover:translate-x-1" />
                </button>
              )}
              <section className={`grid gap-4 ${isMaster ? "lg:grid-cols-[1.55fr_1fr]" : ""}`}>
                {isMaster && (
                  <article className="fc-card-ink fc-grain relative overflow-hidden p-6" aria-label="Posição de caixa mensal">
                    <div className="relative z-[1] flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-medium text-white/55">Saldo final previsto do mês</p>
                        <button type="button" title="Ver movimentações do mês" onClick={() => drillTo("Movimentações de caixa do mês", currentDisplay, showEntries("todos"), `Saldo final previsto ${fmt(position.projectedClosing)}`)} className={`group mt-1 flex items-center gap-2 text-left text-[2.6rem] font-semibold leading-none tracking-[-0.045em] ${position.projectedClosing < 0 ? "text-red-400" : "text-white"}`}>
                          <Money value={position.projectedClosing} /><ChevronRight className="h-6 w-6 text-white/30 transition-all group-hover:translate-x-1 group-hover:text-white" />
                        </button>
                        <p className="mt-3 text-xs text-white/50">Resultado das movimentações de caixa do mês: <b className={`font-medium ${cashTotals.balance < 0 ? "text-red-300" : "text-emerald-300"}`}>{fmt(cashTotals.balance)}</b></p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <button type="button" title="Abrir fluxo de caixa" onClick={() => setScreen("fluxo")} className="rounded-2xl bg-white/[0.06] px-4 py-3 text-left ring-1 ring-white/10 hover:bg-white/[0.12]"><p className="text-white/50">Saldo anterior</p><b className="mt-1 block text-sm font-semibold"><Money value={position.opening} /></b></button>
                        <button type="button" title="Ver movimentações realizadas" onClick={() => drillTo("Realizado no mês", currentDisplay.filter((x) => x.status === "realizado"), showEntries("todos"), `Saldo realizado ${fmt(position.closing)}`)} className="rounded-2xl bg-white/[0.06] px-4 py-3 text-left ring-1 ring-white/10 hover:bg-white/[0.12]"><p className="text-white/50">Realizado no mês</p><b className="mt-1 block text-sm font-semibold"><Money value={position.closing} /></b></button>
                      </div>
                    </div>
                    <div className="relative z-[1] -mx-2 mt-5 h-36" role="img" aria-label="Saldo dia a dia no mês">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={monthCashForecast.months[0].days.map((d) => ({ dia: d.date.slice(8), date: d.date, saldo: d.closing }))} margin={{ top: 6, right: 8, left: 8, bottom: 0 }} className="cursor-pointer" onClick={(state: any) => { const date = state?.activePayload?.[0]?.payload?.date; if (date) drillTo(`Movimentações de ${new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR")}`, currentDisplay.filter((x) => cashDate(x) === date)); }}>
                          <defs>
                            <linearGradient id="fc-balance" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#34d399" stopOpacity={0.45} />
                              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} axisLine={false} tickLine={false} interval={4} />
                          <YAxis hide domain={["dataMin", "dataMax"]} />
                          <Tooltip cursor={{ stroke: "rgba(255,255,255,0.25)" }} formatter={(value: number) => [fmt(value), "Saldo"]} labelFormatter={(label) => `Dia ${label}`} />
                          <Area type="monotone" dataKey="saldo" stroke="#34d399" strokeWidth={2} fill="url(#fc-balance)" activeDot={{ r: 4, fill: "#fff", stroke: "#34d399", strokeWidth: 2 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="relative z-[1] mt-2 text-[11px] text-white/40">Saldo dia a dia, com ajustes de saldo. Clique num dia para ver as movimentações.</p>
                  </article>
                )}
                <article className="fc-card flex flex-col p-6">
                  <h2 className="fc-h">Receitas e consumo do mês</h2>
                  <p className="fc-sub mt-1">Cartão pela data da compra, parcelas mês a mês, assinaturas em cada cobrança.</p>
                  <div className="mt-4 space-y-2">
                    {isMaster && (
                      <button type="button" onClick={() => drillTo("Receitas do mês", current.filter((x) => x.kind === "receita"), showEntries("todos"), fmt(totals.totalIncome))} className="-mx-2 block w-[calc(100%+1rem)] rounded-xl px-2 py-1.5 text-left hover:bg-zinc-50">
                        <div className="flex items-baseline justify-between"><span className="flex items-center gap-2 text-xs text-zinc-500"><span className="h-2 w-2 rounded-full bg-emerald-500" />Receitas</span><b className="text-lg font-semibold tracking-[-0.02em] text-emerald-600"><Money value={totals.totalIncome} /></b></div>
                        <div className="fc-meter mt-2"><span className="bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${Math.max(totals.totalIncome, totals.totalExpense) ? (totals.totalIncome / Math.max(totals.totalIncome, totals.totalExpense)) * 100 : 0}%` }} /></div>
                      </button>
                    )}
                    <button type="button" onClick={() => drillTo("Despesas do mês", current.filter((x) => x.kind === "despesa"), showEntries("todos"), fmt(totals.totalExpense))} className="-mx-2 block w-[calc(100%+1rem)] rounded-xl px-2 py-1.5 text-left hover:bg-zinc-50">
                      <div className="flex items-baseline justify-between"><span className="flex items-center gap-2 text-xs text-zinc-500"><span className="h-2 w-2 rounded-full bg-red-500" />Despesas</span><b className="text-lg font-semibold tracking-[-0.02em] text-red-600"><Money value={totals.totalExpense} /></b></div>
                      <div className="fc-meter mt-2"><span className="bg-gradient-to-r from-rose-400 to-red-600" style={{ width: `${Math.max(totals.totalIncome, totals.totalExpense) ? (totals.totalExpense / Math.max(totals.totalIncome, totals.totalExpense)) * 100 : 0}%` }} /></div>
                    </button>
                  </div>
                  {isMaster && (
                    <div className="mt-auto pt-5">
                      <div className="fc-card-soft flex items-center justify-between px-4 py-3">
                        <span className="text-xs text-zinc-500">{totals.totalIncome ? `Você gastou ${Math.round((totals.totalExpense / totals.totalIncome) * 100)}% do que entrou` : "Saldo do mês"}</span>
                        <b className={`text-sm font-semibold ${totals.totalIncome - totals.totalExpense < 0 ? "text-red-600" : "text-[#831843]"}`}>{fmt(totals.totalIncome - totals.totalExpense)}</b>
                      </div>
                    </div>
                  )}
                </article>
              </section>
              <section className="fc-stagger mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {([
                  { title: "A pagar hoje", value: payTodayTotal, Icon: CalendarClock, style: "from-orange-400 to-orange-600 shadow-orange-500/40", glow: "rgb(249 115 22 / 0.10)", filter: "pagar", today: true },
                  { title: "Receitas recebidas", value: cashTotals.income, Icon: TrendingUp, style: "from-emerald-400 to-emerald-600 shadow-emerald-500/40", glow: "rgb(16 185 129 / 0.10)", filter: "recebidas", today: false },
                  { title: "Despesas pagas", value: cashTotals.expense, Icon: TrendingDown, style: "from-rose-400 to-red-600 shadow-red-500/40", glow: "rgb(239 68 68 / 0.10)", filter: "pagas", today: false },
                  { title: "A pagar", value: cashTotals.pay, Icon: CreditCard, style: "from-amber-400 to-amber-600 shadow-amber-500/40", glow: "rgb(245 158 11 / 0.10)", filter: "pagar", today: false },
                  { title: "A receber", value: cashTotals.receive, Icon: Wallet, style: "from-zinc-600 to-zinc-900 shadow-zinc-900/30", glow: "rgb(131 24 67 / 0.07)", filter: "receber", today: false },
                ] as const)
                  .filter((card) => isMaster || (card.filter !== "recebidas" && card.filter !== "receber"))
                  .map(({ title, value, Icon: CardIcon, style, glow, filter: targetFilter, today: isToday }) => {
                  return (
                    <button
                      key={title}
                      type="button"
                      onClick={() => drillTo(title, isToday ? payToday : currentDisplay.filter((x) => targetFilter === "pagar" ? x.kind === "despesa" && x.status === "previsto" : targetFilter === "receber" ? x.kind === "receita" && x.status === "previsto" : targetFilter === "pagas" ? x.kind === "despesa" && (x.status === "realizado" || (x.invoicePaidAmount || 0) > 0) : x.kind === "receita" && x.status === "realizado"), isToday ? openPayToday : showEntries(targetFilter), `${fmt(value)} · ${labelMonth(month)}`)}
                      aria-label={`${title}: ${fmt(value)}. Ver detalhes`}
                      onPointerMove={spot}
                      style={{ ["--spot" as string]: glow }}
                      className="fc-card fc-spot fc-lift group p-5 text-left hover:shadow-lg"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110 ${style}`}>
                          <CardIcon className="h-4 w-4" />
                        </span>
                        <ChevronRight className="h-4 w-4 text-zinc-300 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-[#831843]" />
                      </div>
                      <p className="mt-5 text-xs font-medium text-zinc-500">{title}</p>
                      <p className="mt-1 text-[1.45rem] font-semibold leading-tight tracking-[-0.035em] text-[#831843]">
                        <Money value={value} />
                      </p>
                      <p className="mt-2 text-[11px] text-zinc-400">
                        {isToday
                          ? payToday.length > 0
                            ? `${payToday.length} conta(s) para hoje`
                            : "Nada para hoje"
                          : "Ver detalhes"}
                      </p>
                    </button>
                  );
                })}
              </section>
              <div className="mt-4">
                <DailyLedger
                  entries={current}
                  categories={categories}
                  banks={banks}
                  cards={cards}
                  title={`Diário de ${labelMonth(month)}`}
                  onOpen={quickEdit}
                />
              </div>
              <section className={`mt-4 grid gap-4 ${isMaster ? "xl:grid-cols-2" : ""}`}>
                <article className="fc-card p-6">
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="fc-h">Contas em atraso</h2>
                      <p className="fc-sub mt-1">Lançamentos previstos cujo vencimento já passou.</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${overdue.length ? "bg-red-500 text-white shadow-[0_6px_14px_-6px_rgba(239,68,68,0.9)]" : "bg-emerald-50 text-emerald-700"}`}>
                      {overdue.length ? `${overdue.length} ${overdue.length === 1 ? "pendência" : "pendências"}` : "Tudo em dia"}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {([
                      { kind: "despesa", label: "A pagar atrasadas", items: overduePay, tone: "text-red-600", glow: "rgb(239 68 68 / 0.14)", tile: "from-red-50" },
                      ...(isMaster ? [{ kind: "receita", label: "A receber atrasadas", items: overdueReceive, tone: "text-orange-600", glow: "rgb(249 115 22 / 0.14)", tile: "from-orange-50" }] : []),
                    ] as const).map((group) => (
                      <button
                        key={group.kind}
                        type="button"
                        onClick={() => drillTo(`Contas ${group.label.toLowerCase()}`, group.items, () => openOverdue(group.kind))}
                        onPointerMove={spot}
                        style={{ ["--spot" as string]: group.glow }}
                        className={`fc-spot fc-lift group rounded-2xl bg-gradient-to-br ${group.tile} to-white p-4 text-left ring-1 ring-zinc-200/70 hover:shadow-md`}
                      >
                        <span className={`text-xs font-semibold ${group.tone}`}>{group.label}</span>
                        <b className="mt-1 block text-2xl font-semibold tracking-[-0.03em] text-[#831843]">
                          <Money value={group.items.reduce((sum, entry) => sum + entry.amount, 0)} />
                        </b>
                        <span className="mt-2 flex items-center gap-1 text-[11px] text-zinc-500 group-hover:text-[#831843]">
                          {group.items.length} {group.items.length === 1 ? "lançamento vencido" : "lançamentos vencidos"}
                          <ChevronRight className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-1" />
                        </span>
                      </button>
                    ))}
                  </div>
                </article>
                {isMaster && (
                  <article className="fc-card p-6">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="fc-h">Contas bancárias</h2>
                        <p className="fc-sub mt-1">Saldo atual com ajustes e faturas pagas. Previstos não alteram o saldo.</p>
                      </div>
                      <button onClick={() => setScreen("contas")} className="shrink-0 rounded-full px-3.5 py-2 text-xs font-medium ring-1 ring-zinc-200 hover:bg-[#831843] hover:text-white hover:ring-[#831843]">Gerenciar</button>
                    </div>
                    <div className="divide-y divide-zinc-100">
                      {banks.map(bank => { const data = summarizeBank(visible.filter(e => cashDate(e) <= today), bank.id); return (
                        <button type="button" key={bank.id} onClick={() => drillTo(`${bank.name} · ${labelMonth(month)}`, currentDisplay.filter((x) => x.bankId === bank.id), () => setScreen("contas"), `Saldo atual ${fmt(data.balance)}`)} className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-zinc-50">
                          <BankLogo name={bank.name} className="h-10 w-10 text-base transition-transform duration-300 group-hover:scale-105" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-[#831843]">{bank.name}</span>
                            <span className="block truncate text-[11px] text-zinc-500">Recebido {fmt(data.income)} · Pago {fmt(data.expense)}</span>
                          </span>
                          <b className={`text-sm font-semibold tracking-[-0.02em] ${data.balance < 0 ? "text-red-600" : "text-[#831843]"}`}><Money value={data.balance} /></b>
                        </button>
                      ); })}
                      {!banks.length && <p className="py-4 text-sm text-zinc-500">Nenhuma conta bancária cadastrada. Cadastre as contas que usa para pagar e receber.</p>}
                    </div>
                    {visible.some(entry => !entry.bankId && entry.status === "realizado") && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Há movimentações realizadas sem conta bancária informada. Elas aparecem nos totais financeiros, mas não são atribuídas ao saldo de nenhum banco.</p>}
                  </article>
                )}
              </section>
              <section className="fc-stagger mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {allowedUnits.map((u) => {
                  const d = current.filter((x) => x.unit === u.name),
                    income = d
                      .filter(
                        (x) => x.kind === "receita" && x.status === "realizado",
                      )
                      .reduce((s, x) => s + entryValue(x), 0),
                    expense = d
                      .filter(
                        (x) => x.kind === "despesa" && x.status === "realizado",
                      )
                      .reduce((s, x) => s + entryValue(x), 0),
                    toPay = d
                      .filter((x) => x.kind === "despesa" && x.status === "previsto")
                      .reduce((s, x) => s + x.amount, 0),
                    toReceive = d
                      .filter((x) => x.kind === "receita" && x.status === "previsto")
                      .reduce((s, x) => s + x.amount, 0);
                  return (
                    <article key={u.name} className="fc-card p-5">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-semibold text-white shadow-md ${u.color}`}>
                          {u.initials}
                        </div>
                        <div className="min-w-0">
                          <h3 className="fc-h truncate">{u.name}</h3>
                          <p className="text-[11px] text-zinc-500">Centro de custo</p>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                        {isMaster && <button type="button" onClick={() => drillTo(`Recebido · ${u.name}`, d.filter((x) => x.kind === "receita" && x.status === "realizado"))} className="fc-card-soft px-3 py-2 text-left hover:bg-white hover:shadow-sm"><span className="block text-zinc-500">Recebido</span><span className="block mt-0.5 text-sm font-semibold text-emerald-600">{fmt(income)}</span></button>}
                        <button type="button" onClick={() => drillTo(`Pago · ${u.name}`, d.filter((x) => x.kind === "despesa" && x.status === "realizado"))} className="fc-card-soft px-3 py-2 text-left hover:bg-white hover:shadow-sm"><span className="block text-zinc-500">Pago</span><span className="block mt-0.5 text-sm font-semibold text-red-600">{fmt(expense)}</span></button>
                        <button type="button" onClick={() => drillTo(`A pagar · ${u.name}`, d.filter((x) => x.kind === "despesa" && x.status === "previsto"))} className="fc-card-soft px-3 py-2 text-left hover:bg-white hover:shadow-sm"><span className="block text-zinc-500">A pagar</span><span className="block mt-0.5 text-sm font-semibold text-orange-600">{fmt(toPay)}</span></button>
                        {isMaster && <button type="button" onClick={() => drillTo(`A receber · ${u.name}`, d.filter((x) => x.kind === "receita" && x.status === "previsto"))} className="fc-card-soft px-3 py-2 text-left hover:bg-white hover:shadow-sm"><span className="block text-zinc-500">A receber</span><span className="block mt-0.5 text-sm font-semibold text-[#831843]">{fmt(toReceive)}</span></button>}
                      </div>
                    </article>
                  );
                })}
              </section>
              <section className="mt-4 grid gap-4 lg:grid-cols-2">
                {isMaster && (
                  <Breakdown
                    kind="receita"
                    entries={current}
                    categories={categories}
                    onDrill={(title, items) => drillTo(title, items, showEntries("todos"))}
                  />
                )}
                <Breakdown
                  kind="despesa"
                  entries={current}
                  categories={categories}
                  onDrill={(title, items) => drillTo(title, items, showEntries("todos"))}
                />
              </section>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <CounterpartyOverview kind="despesa" entries={current} contacts={contacts.filter((contact) => allowedUnits.some((allowed) => allowed.name === contact.unit))} todayKey={today} onDrill={(title, items) => drillTo(title, items)} />
                {isMaster && <CounterpartyOverview kind="receita" entries={current} contacts={contacts.filter((contact) => allowedUnits.some((allowed) => allowed.name === contact.unit))} todayKey={today} onDrill={(title, items) => drillTo(title, items)} />}
              </div>
              <section className="fc-card mt-4 p-6">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="fc-h">Lançamentos de {labelMonth(month)}</h2>
                    <p className="fc-sub mt-1">Os {Math.min(currentDisplay.length, 5)} mais recentes de {currentDisplay.length}. Clique para editar.</p>
                  </div>
                  <button type="button" onClick={() => { setFilter("Todos"); setCounterpartyFilter("todos"); setSearch(""); setEntryFilter("todos"); setPeriodMode("mes"); setScreen("lancamentos"); }} className="group flex items-center gap-1 rounded-full bg-[#831843] px-4 py-2 text-xs font-medium text-white hover:bg-pink-950">Ver todos<ChevronRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" /></button>
                </div>
                <Entries
                  entries={[...currentDisplay].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)}
                  categories={categories}
                  banks={banks}
                  settle={settle}
                  edit={(x) => (x.balanceAdjustment || x.creditCardId || x.cardPayment) ? openFinancialEntry(x) :
                    x.seriesId
                      ? setScopeDialog({ entry: x, action: "editar" })
                      : (setEditScope("one"), setEditing(x), setModal(x.kind))
                  }
                  open={(x) => {
                    if (x.balanceAdjustment || x.creditCardId || x.cardPayment) { openFinancialEntry(x); return; }
                    // Atalho: edita só este mês, sem perguntar "Este mês / Toda a série".
                    setEditScope("one");
                    setEditing(x);
                    setModal(x.kind);
                  }}
                  remove={(x) => x.cardPayment ? void removeCardPayment(x) : (x.balanceAdjustment || x.creditCardId || x.cardPayment) ? openFinancialEntry(x) :
                    x.seriesId
                      ? setScopeDialog({ entry: x, action: "excluir" })
                      : remove(x, "one")
                  }
                />
              </section>
            </>
          ) : screen === "contas" ? (
            <BanksSection banks={banks} ready={banksReady} canManage={isMaster} entries={visible} setBanks={setBanks} onRefresh={refreshPersonal} />
          ) : screen === "fluxo" && isMaster ? (
            <CashFlow entries={visible} banks={banks} cards={cards} onRefresh={refreshPersonal} onAccounts={()=>setScreen("contas")} />
          ) : screen === "cartoes" ? (
            <CreditCards categories={categories} key={`${cardFocus?.cardId||''}:${cardFocus?.month||''}`} cards={cards} setCards={setCards} banks={banks} entries={[...entries, ...cardPaymentEntries(cardPayments, cards)]} payments={cardPayments} onRefresh={refreshPersonal} focus={cardFocus} onPlans={()=>setScreen("categorias")} onEntries={(invoiceMonth)=>{setMonth(new Date(`${invoiceMonth}-01T12:00:00`));setSearch("");setFilter("Todos");setEntryFilter("todos");setPeriodMode("mes");setCounterpartyFilter("todos");setOverdueKind("todos");setScreen("lancamentos");}}
              renderForm={(purchase,savePurchase,close,card,onDelete)=><EntryForm onDelete={onDelete} kind="despesa" cardMode={card} onNewCategory={()=>setCategoryModal(true)} onNewCenter={()=>setCenterModal(true)} categories={categories} contacts={contacts} contactsTableReady={contactsTableReady} allowedUnits={allowedUnits} banks={banks} allowIncome={false} editing={purchase} close={close} save={savePurchase} />}
            />
          ) : screen === "contatos" ? (
            <ContactsScreen
              contacts={contacts}
              allowedUnits={allowedUnits}
              tableReady={contactsTableReady}
              allowClients={isMaster}
              save={async (contact) => {
                if (!allowedUnits.some((unit) => unit.name === contact.unit))
                  throw new Error("Este centro de custo não está disponível para seu acesso.");
                const saved = await saveRemoteCounterparty(contact);
                const savedContact = saved as Counterparty;
                setSavedContacts((old) => [
                  ...old.filter((item) => item.id !== savedContact.id),
                  savedContact,
                ]);
                setEntries((old) => old.map((entry) =>
                  entry.counterpartyId === savedContact.id
                    ? { ...entry, beneficiary: savedContact.name }
                    : entry,
                ));
              }}
              archive={async (contact, archived) => {
                if (!allowedUnits.some((unit) => unit.name === contact.unit))
                  throw new Error("Este centro de custo não está disponível para seu acesso.");
                const updated = await setRemoteCounterpartyArchived(contact.id, archived);
                setSavedContacts((old) =>
                  old.map((item) => item.id === contact.id ? updated as Counterparty : item),
                );
              }}
            />
          ) : screen === "relatorios" ? (
            <Reports
              entries={[...entries, ...adjustments.map(adjustmentEntry)].filter(
                (entry) =>
                  currentUser.role === "master" ||
                  currentUser.units.includes(entry.unit),
              )}
              banks={banks}
              cards={cards}
              allowedUnits={allowedUnits}
              categories={categories}
              contacts={contacts.filter((contact) => allowedUnits.some((allowed) => allowed.name === contact.unit))}
              incomeVisible={isMaster}
            />
          ) : screen === "categorias" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-[1.65rem] font-semibold leading-tight tracking-[-0.035em] text-[#831843]">Plano de contas</h2>
                  <p className="fc-sub mt-1">Cada categoria pertence a uma receita ou despesa e a um único centro de custo. Clique numa categoria para mudar nome, ícone, foto ou cor.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canCreatePlans && (
                    <button
                      onClick={() => setCenterModal(true)}
                      disabled={!centerTableReady}
                      title={!centerTableReady ? "Aplique a migração de centros de custo no banco" : undefined}
                      className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-xs font-medium text-[#831843] shadow-sm hover:shadow-md disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                      Novo plano / centro
                    </button>
                  )}
                  <button
                    onClick={() => setCategoryModal(true)}
                    className="group flex items-center gap-2 rounded-full bg-[#831843] py-1.5 pl-1.5 pr-4 text-xs font-medium text-white shadow-[0_10px_24px_-12px_rgba(24,24,27,0.9)] hover:bg-pink-950"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 transition-transform duration-300 group-hover:rotate-90"><Plus className="h-4 w-4" /></span>
                    Nova categoria
                  </button>
                </div>
              </div>
              <div className="fc-stagger grid gap-4 xl:grid-cols-2">
                {byUnit.map((u) => (
                  <article key={u.name} className="fc-card overflow-hidden">
                    <div className="flex items-center gap-3 border-b border-zinc-100 px-6 py-5">
                      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-semibold text-white shadow-md ${u.color}`}>
                        {u.initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="fc-h truncate">{u.name}</h3>
                        <p className="text-[11px] text-zinc-500">{u.categories.length} {u.categories.length === 1 ? "categoria" : "categorias"} · centro de custo</p>
                      </div>
                      {currentUser.role === "master" && (
                        <div className="flex shrink-0 gap-1 text-xs">
                          <button
                            onClick={() => setEditingCenter(u)}
                            className="flex items-center gap-1 rounded-full px-3 py-1.5 font-medium ring-1 ring-zinc-200 hover:bg-zinc-100"
                            aria-label={`Editar plano ${u.name}`}
                          >
                            <Pencil className="h-3 w-3" />Editar
                          </button>
                          <button
                            onClick={() => setDeletingCenter(u)}
                            className="rounded-full p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                            aria-label={`Excluir plano ${u.name}`}
                            title="Excluir plano"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="grid gap-5 p-6">
                      {((canCreatePlans ? ["receita", "despesa"] : ["despesa"]) as Kind[]).map((k) => {
                        const list = u.categories.filter((c) => c.kind === k);
                        return (
                          <div key={k}>
                            <p className="mb-3 flex items-center gap-2 text-xs font-medium text-zinc-500">
                              <span className={`h-2 w-2 rounded-full ${k === "receita" ? "bg-emerald-500" : "bg-red-500"}`} />
                              {k === "receita" ? "Receitas" : "Despesas"}
                              <span className="text-zinc-300">{list.length}</span>
                            </p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {list.map((c) => {
                                const spent = current.filter((x) => x.unit === c.unit && x.kind === c.kind && x.category === c.name).reduce((sum, x) => sum + entryValue(x), 0);
                                return (
                                  <div key={c.id} className="group relative">
                                    <button
                                      type="button"
                                      onClick={() => setEditingCategory(c)}
                                      title={`Editar ${c.name}`}
                                      className="flex w-full items-center gap-3 rounded-2xl bg-zinc-50 p-2.5 pr-8 text-left ring-1 ring-zinc-100 hover:bg-white hover:shadow-md hover:ring-zinc-200"
                                    >
                                      <span
                                        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-lg ring-1 ring-black/5 transition-transform duration-300 group-hover:scale-105"
                                        style={{ backgroundColor: c.color || "#e4e4e7" }}
                                      >
                                        {c.icon?.startsWith("data:") ? <img src={c.icon} alt="" className="h-full w-full object-cover" /> : c.icon || "🏷️"}
                                      </span>
                                      <span className="min-w-0">
                                        <span className="block truncate text-xs font-medium text-[#831843]">{c.name}</span>
                                        <span className={`block truncate text-[11px] ${spent ? (k === "receita" ? "text-emerald-600" : "text-red-600") : "text-zinc-400"}`}>{spent ? fmt(spent) : "Sem movimento"}</span>
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeletingCategory(c)}
                                      className="absolute right-1.5 top-1.5 rounded-full p-1.5 text-zinc-300 hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                                      aria-label={`Excluir categoria ${c.name}`}
                                      title="Excluir categoria"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                );
                              })}
                              <button
                                type="button"
                                onClick={() => setCategoryModal(true)}
                                className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-zinc-300 p-2.5 text-xs text-zinc-500 hover:border-[#831843] hover:bg-white hover:text-[#831843]"
                              >
                                <Plus className="h-3.5 w-3.5" />Nova
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
              <p className="fc-sub px-1">Valores de {labelMonth(month)}.</p>
            </div>
          ) : (
            <Transactions entries={list} categories={categories} banks={banks} month={month} move={move} isMaster={isMaster}
              actual={monthCashForecast.actual} projected={monthCashClosing}
              openNew={open} search={search} setSearch={setSearch} entryFilter={entryFilter} setEntryFilter={setEntryFilter}
              unit={filter} setUnit={setFilter} units={allowedUnits} contact={counterpartyFilter} setContact={setCounterpartyFilter} contacts={counterparties}
              periodMode={periodMode} setPeriodMode={setPeriodMode} periodFrom={periodFrom} setPeriodFrom={setPeriodFrom} periodTo={periodTo} setPeriodTo={setPeriodTo}
              overdueKind={overdueKind} setOverdueKind={setOverdueKind} settle={settle}
              edit={(x)=>(x.balanceAdjustment||x.creditCardId||x.cardPayment)?openFinancialEntry(x):x.seriesId?setScopeDialog({entry:x,action:"editar"}):(setEditScope("one"),setEditing(x),setModal(x.kind))}
              open={(x)=>{if(x.balanceAdjustment||x.creditCardId||x.cardPayment){openFinancialEntry(x);return;}setEditScope("one");setEditing(x);setModal(x.kind);}}
              editCategory={canCreatePlans?setEditingCategory:undefined}
              remove={(x)=>x.cardPayment?removeCardPayment(x):(x.balanceAdjustment||x.creditCardId||x.cardPayment)?openFinancialEntry(x):x.seriesId?setScopeDialog({entry:x,action:"excluir"}):remove(x,"one")}
            />
          )}
        </div>
      </main>
      {centerModal && <CostCenterForm close={() => setCenterModal(false)} save={createCenter} />}
      {editingCenter && (
        <CostCenterForm
          editing={editingCenter}
          close={() => setEditingCenter(null)}
          save={(_name, initials, color) => updateCenter(editingCenter.name, initials, color)}
        />
      )}
      {deletingCenter && (
        <DeleteCostCenter
          center={deletingCenter}
          categoryCount={categories.filter((item) => item.unit === deletingCenter.name).length}
          entryCount={entries.filter((item) => item.unit === deletingCenter.name).length}
          close={() => setDeletingCenter(null)}
          confirm={() => deleteCenter(deletingCenter.name)}
        />
      )}
      {modal && (
        <EntryForm
          kind={modal}
          categories={categories}
          contacts={contacts}
          contactsTableReady={contactsTableReady}
          allowedUnits={allowedUnits}
          banks={banks}
          allowIncome={isMaster}
          editing={editing}
          scope={editScope}
          close={() => {
            setModal(null);
            setEditing(null);
          }}
          save={save}
          onDelete={editing && !editing.balanceAdjustment && !editing.creditCardId ? () => {
            const target = editing;
            setModal(null);
            setEditing(null);
            if (target.seriesId) setScopeDialog({ entry: target, action: "excluir" });
            else if (window.confirm(`Excluir o lançamento “${target.description}”?`)) void remove(target, "one");
          } : undefined}
        />
      )}{" "}
      {scopeDialog && (
        <ScopeDialog
          action={scopeDialog.action}
          close={() => setScopeDialog(null)}
          one={() => {
            const d = scopeDialog;
            if (d.action === "excluir") remove(d.entry, "one");
            else {
              setEditScope("one");
              setEditing(d.entry);
              setModal(d.entry.kind);
            }
            setScopeDialog(null);
          }}
          series={() => {
            const d = scopeDialog;
            if (d.action === "excluir") remove(d.entry, "series");
            else {
              setEditScope("series");
              setEditing(d.entry);
              setModal(d.entry.kind);
            }
            setScopeDialog(null);
          }}
        />
      )}{" "}
      {categoryModal && (
        <NewCategory
          close={() => setCategoryModal(false)}
          allowedUnits={allowedUnits}
          allowIncome={canCreatePlans}
          save={async (c) => {
            await saveRemoteCategory(c);
            setCategories((x) => [...x, c]);
          }}
        />
      )}{" "}
      {dashDrill && <EntryDrill drill={dashDrill} categories={categories} banks={banks} cards={cards} close={() => setDashDrill(null)} open={quickEdit} />}
      {editingCategory && (
        <NewCategory
          category={editingCategory}
          allowedUnits={allowedUnits}
          allowIncome={canCreatePlans}
          close={() => setEditingCategory(null)}
          save={async (c) => {
            await saveRemoteCategory(c);
            // The database renames linked entries in the same transaction.
            // Apply the same change locally so every financial view updates now.
            setEntries(old => renamedCategoryEntries(old, editingCategory, c));
            setCategories((old) => old.map((x) => (x.id === c.id ? c : x)));
            setSyncVersion(value => value + 1);
          }}
        />
      )}
      {deletingCategory && (
        <DeleteCategoryDialog
          category={deletingCategory}
          close={() => setDeletingCategory(null)}
          remove={() => removeCategory(deletingCategory)}
        />
      )}
    </div>
  );
}
export default App;
