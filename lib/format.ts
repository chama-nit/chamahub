// ---------------------------------------------------------------------------
// Utility di formattazione e manipolazione date.
// ---------------------------------------------------------------------------
// Le date "solo giorno" (calendario, campagne) viaggiano come stringhe
// `YYYY-MM-DD` e vengono sempre trattate come date locali, mai convertite in
// UTC: costruire `new Date("2026-08-19")` produrrebbe uno slittamento di fuso
// e la giornata sbagliata per chi si trova a est di Greenwich.
// ---------------------------------------------------------------------------

import { it } from "date-fns/locale";
import { format, parseISO } from "date-fns";

export const IT_LOCALE = it;

/** Converte `YYYY-MM-DD` in una Date locale a mezzanotte. */
export function parseDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

/** Converte una Date in `YYYY-MM-DD` usando il calendario locale. */
export function toDayString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function todayString(): string {
  return toDayString(new Date());
}

export function formatDay(value: string, pattern = "d MMMM yyyy"): string {
  return format(parseDay(value), pattern, { locale: it });
}

export function formatShortDay(value: string): string {
  return format(parseDay(value), "d MMM", { locale: it });
}

export function formatMonth(value: string): string {
  return format(parseDay(value), "LLLL yyyy", { locale: it });
}

export function formatDateTime(value: string): string {
  return format(parseISO(value), "d MMM yyyy, HH:mm", { locale: it });
}

export function formatRelativeDay(value: string): string {
  const today = todayString();
  if (value === today) return "Oggi";

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (value === toDayString(tomorrow)) return "Domani";

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (value === toDayString(yesterday)) return "Ieri";

  return formatDay(value);
}

/** Primo giorno del mese, come stringa. */
export function monthStart(date: Date): string {
  return toDayString(new Date(date.getFullYear(), date.getMonth(), 1));
}

/** Ultimo giorno del mese, come stringa. */
export function monthEnd(date: Date): string {
  return toDayString(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

export function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

/**
 * Griglia di 6 settimane che copre il mese indicato, con la settimana che
 * inizia di lunedi' come da consuetudine italiana.
 */
export function buildMonthGrid(reference: Date): Date[] {
  const first = new Date(reference.getFullYear(), reference.getMonth(), 1);
  // getDay(): 0 = domenica. Con settimana da lunedi' l'offset diventa 6.
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export const WEEKDAY_INITIALS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

/** Iniziali per l'avatar, es. "Mario Rossi" -> "MR". */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(1).replace(".", ",");
}

export function formatPercentage(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(0)}%`;
}
