import type { ISODate, ISODateTime } from './types';

export function userTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Локальная календарная дата момента времени в заданном часовом поясе. */
export function localDate(iso: ISODateTime, timeZone: string): ISODate {
  // en-CA форматирует как YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function toUtcNoon(d: ISODate): Date {
  return new Date(`${d}T12:00:00Z`);
}

function fmt(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  const x = toUtcNoon(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
}

/** 0 = понедельник … 6 = воскресенье */
export function weekdayIndex(d: ISODate): number {
  return (toUtcNoon(d).getUTCDay() + 6) % 7;
}

/** Понедельник недели, в которую входит дата. */
export function weekStart(d: ISODate): ISODate {
  return addDays(d, -weekdayIndex(d));
}

export function weekDays(monday: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUtcNoon(b).getTime() - toUtcNoon(a).getTime()) / 86_400_000);
}

export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayMonthYear = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatDayMonth(d: ISODate): string {
  return dayMonth.format(toUtcNoon(d));
}

export function formatLongDate(d: ISODate): string {
  return dayMonthYear.format(toUtcNoon(d));
}

export function formatTime(iso: ISODateTime, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}
