import { Landmark } from "lucide-react";

// Brand marks for the most common Brazilian banks, recognized by account name.
type Brand = { bg: string; fg: string; mark: string; size?: string; weight?: number };
const brands: [RegExp, Brand][] = [
  [/nu ?bank|^nu\b|roxinho/i, { bg: "#820AD1", fg: "#fff", mark: "nu", size: "0.95em", weight: 700 }],
  [/itau/i, { bg: "#EC7000", fg: "#fff", mark: "itaú", size: "0.8em", weight: 800 }],
  [/bradesco/i, { bg: "#CC092F", fg: "#fff", mark: "b", size: "1em", weight: 800 }],
  [/santander/i, { bg: "#EC0000", fg: "#fff", mark: "S", size: "0.95em", weight: 800 }],
  [/banco do brasil|^bb\b/i, { bg: "#FCF900", fg: "#0038A8", mark: "BB", size: "0.7em", weight: 800 }],
  [/caixa|cef\b/i, { bg: "#005CA9", fg: "#F39200", mark: "X", size: "1em", weight: 800 }],
  [/inter\b|banco inter/i, { bg: "#FF7A00", fg: "#fff", mark: "inter", size: "0.55em", weight: 800 }],
  [/c6/i, { bg: "#1C1C1C", fg: "#fff", mark: "C6", size: "0.7em", weight: 800 }],
  [/btg/i, { bg: "#0B2A4A", fg: "#fff", mark: "btg", size: "0.6em", weight: 800 }],
  [/picpay/i, { bg: "#11C76F", fg: "#fff", mark: "pic", size: "0.6em", weight: 800 }],
  [/mercado ?pago/i, { bg: "#00B1EA", fg: "#fff", mark: "mp", size: "0.75em", weight: 800 }],
  [/\bxp\b/i, { bg: "#111", fg: "#FFD400", mark: "xp", size: "0.8em", weight: 800 }],
  [/sicoob/i, { bg: "#003641", fg: "#C9D200", mark: "S", size: "0.95em", weight: 800 }],
  [/sicredi/i, { bg: "#3FA110", fg: "#fff", mark: "S", size: "0.95em", weight: 800 }],
  [/neon/i, { bg: "#00E5FF", fg: "#0A1E3C", mark: "neon", size: "0.55em", weight: 800 }],
  [/pagbank|pagseguro/i, { bg: "#1BB99A", fg: "#fff", mark: "pag", size: "0.6em", weight: 800 }],
  [/safra/i, { bg: "#0F2B5B", fg: "#C8A04A", mark: "S", size: "0.95em", weight: 800 }],
];
// Accents and case are ignored, so "Itáu", "ITAU" and "Itaú" all match.
const plain = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export const bankBrand = (name = "") => brands.find(([pattern]) => pattern.test(plain(name)))?.[1];

// Quick picks shown in the account and card forms.
export const BANK_CHOICES = ["Nubank", "Itaú", "Bradesco", "Santander", "Banco do Brasil", "Caixa", "Inter", "C6", "BTG", "PicPay", "Mercado Pago", "XP"];
/** Puts the chosen bank at the start of the name, replacing a previously chosen one. */
export const withBank = (name: string, bank: string) => {
  const current = name.trim();
  const previous = BANK_CHOICES.find((label) => plain(current).startsWith(plain(label)));
  const rest = previous ? current.slice(previous.length).trim() : current;
  return rest ? `${bank} ${rest}` : bank;
};

export function BankPicker({ name, onChange, label = "Banco" }: { name: string; onChange: (name: string) => void; label?: string }) {
  const chosen = bankBrand(name);
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-zinc-600">{label} <span className="font-normal text-zinc-400">· toque para usar o logo</span></p>
      <div className="flex flex-wrap gap-1.5">
        {BANK_CHOICES.map((bank) => {
          const active = chosen === bankBrand(bank);
          return (
            <button
              key={bank}
              type="button"
              title={bank}
              aria-pressed={active}
              onClick={() => onChange(withBank(name, bank))}
              className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[11px] transition ${active ? "bg-[#831843] text-white" : "bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200 hover:bg-white hover:text-[#831843] hover:shadow-sm"}`}
            >
              <BankLogo name={bank} className="h-5 w-5 rounded-full text-[8px]" />
              {bank}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function BankLogo({ name, className = "h-10 w-10 text-base" }: { name?: string; className?: string }) {
  const brand = bankBrand(name);
  if (!brand)
    return (
      <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-xl bg-[#831843] text-white shadow-[0_8px_18px_-8px_rgba(24,24,27,0.9)] ${className}`}>
        <Landmark className="h-[45%] w-[45%]" />
      </span>
    );
  return (
    <span
      aria-hidden
      className={`flex shrink-0 select-none items-center justify-center rounded-xl leading-none tracking-[-0.04em] ring-1 ring-black/5 ${className}`}
      style={{ backgroundColor: brand.bg, color: brand.fg, boxShadow: `0 8px 18px -8px ${brand.bg}` }}
    >
      <span style={{ fontSize: brand.size, fontWeight: brand.weight }}>{brand.mark}</span>
    </span>
  );
}
