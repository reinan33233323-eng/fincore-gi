import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Utilitários de dinheiro e mês compartilhados entre as telas.
export const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// Animates a money value from its previous number to the new one.
export function Money({ value, className = "" }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / 700);
      const eased = 1 - Math.pow(1 - t, 4);
      const next = start + (value - start) * eased;
      from.current = next;
      setShown(t === 1 ? value : next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className={className}>{fmt(shown)}</span>;
}
// Feeds the cursor position to a .fc-spot tile so its glow follows the pointer.
export const spot = (event: PointerEvent<HTMLElement>) => {
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mx", `${event.clientX - box.left}px`);
  event.currentTarget.style.setProperty("--my", `${event.clientY - box.top}px`);
};
export const parseMoney = (value: string) => {
  const raw = value.replace(/R\$\s?/gi, "").replace(/\s/g, "");
  if (!raw) return NaN;
  if (raw.includes(","))
    return Number(raw.replace(/\./g, "").replace(",", "."));
  const parts = raw.split(".");
  // In Brazilian notation, 1.500 means fifteen hundred. A dot followed by
  // one or two digits is still accepted as a decimal separator for convenience.
  if (parts.length > 1 && (parts.length > 2 || parts.at(-1)!.length === 3))
    return Number(parts.join(""));
  return Number(raw);
};
export const moneyInput = (value: number) =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function CurrencyInput({
  value,
  onChange,
  className = "",
  placeholder = "0,00",
  required = true,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const parsed = parseMoney(value);
  const display = value && Number.isFinite(parsed) ? moneyInput(parsed) : "";
  return (
    <div className="relative mt-1.5">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-bold text-zinc-400">
        R$
      </span>
      <input
        required={required}
        inputMode="numeric"
        value={display}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "");
          onChange(digits ? String(Number(digits) / 100) : "");
        }}
        className={`w-full rounded-xl border bg-zinc-50 p-3 pl-10 text-sm font-normal ${className}`}
        placeholder={placeholder}
      />
    </div>
  );
}
export const labelMonth = (d: Date) =>
  d
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace(/^./, (c) => c.toUpperCase());

export function Month({ value, move }: { value: Date; move: (n: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-full bg-white p-1 shadow-sm">
      <button
        onClick={() => move(-1)}
        className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-[#831843]"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span key={labelMonth(value)} className="fc-screen min-w-36 text-center text-sm font-semibold tracking-[-0.01em] text-[#831843]">
        {labelMonth(value)}
      </span>
      <button
        onClick={() => move(1)}
        className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-[#831843]"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
