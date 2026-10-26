import { addMonthsClamped } from './seriesDates.ts';
import { installmentAmounts } from './credit.ts';

export const sameMonthParts = (count: number, total: number, baseDate: string) => {
  const safeCount = Math.max(2, Math.floor(count) || 2);
  const totalCents = Math.round(Math.max(0, total || 0) * 100);
  const baseCents = Math.floor(totalCents / safeCount);
  const remainder = totalCents - baseCents * safeCount;
  const base = new Date(`${baseDate}T12:00:00`);
  const lastDay = new Date(
    base.getFullYear(),
    base.getMonth() + 1,
    0,
  ).getDate();
  const firstDay = Math.min(base.getDate(), lastDay);
  return Array.from({ length: safeCount }, (_, index) => {
    const day =
      safeCount === 1
        ? firstDay
        : Math.round(
            firstDay + ((lastDay - firstDay) * index) / (safeCount - 1),
          );
    const date = new Date(base.getFullYear(), base.getMonth(), day)
      .toISOString()
      .slice(0, 10);
    return {
      date,
      amount: ((baseCents + (index < remainder ? 1 : 0)) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    };
  });
};

/** The same schedule is used by the preview and by persisted entries. */
export function monthlyParts(count: number, total: number, firstDate: string) {
  return installmentAmounts(total, count).map((amount, index) => ({
    date: addMonthsClamped(firstDate, index), amount, installment: `${index + 1}/${count}`,
  }));
}
