// Напоминания через календарь телефона: файл iCalendar (RFC 5545) с событиями плана и сигналом (VALARM).
// Веб-приложение без сервера не может надёжно присылать уведомления по расписанию, а календарь телефона — может.

import type { ISODate, PlannedWorkout } from './types';

/** Экранирование текста по RFC 5545, 3.3.11. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Перенос длинных строк: не длиннее 75 октетов, продолжение начинается с пробела (RFC 5545, 3.1). */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    const limit = out.length === 0 ? 75 : 74;
    if (enc.encode(cur + ch).length > limit) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** «Плавающее» локальное время (без часового пояса): календарь покажет его в поясе устройства. */
function localStamp(date: ISODate, time: string): string {
  const [h = '18', m = '00'] = time.split(':');
  return `${date.replace(/-/g, '')}T${pad(Number(h))}${pad(Number(m))}00`;
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export interface IcsOptions {
  /** Время начала «ЧЧ:ММ» */
  time: string;
  durationMin: number;
  minutesBefore: number;
  /** Названия упражнений по id — для описания */
  exerciseName: (id: string) => string;
  now?: Date;
}

export function buildIcs(planned: PlannedWorkout[], o: IcsOptions): string {
  const stamp = utcStamp(o.now ?? new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Trenirovka//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const [h = '18', m = '00'] = o.time.split(':');
  const endMin = Number(h) * 60 + Number(m) + o.durationMin;
  for (const p of planned.filter((x) => !x.deletedAt && x.status === 'planned')) {
    const desc = p.plannedItems.map((it) => `${o.exerciseName(it.exerciseId)}: ${it.sets}×${it.repMin === it.repMax ? it.repMin : `${it.repMin}–${it.repMax}`}`).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${p.id}@trenirovka`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${localStamp(p.date, o.time)}`,
      `DTEND:${localStamp(p.date, `${Math.floor(endMin / 60) % 24}:${endMin % 60}`)}`,
      `SUMMARY:${icsEscape(`Тренировка: ${p.name}`)}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(`Тренировка: ${p.name}`)}`,
      `TRIGGER:-PT${Math.max(0, Math.round(o.minutesBefore))}M`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
