// Выгрузка CSV для таблиц (Excel / Numbers / Google Таблицы).
// Разделитель «;» и десятичная запятая — так русская локаль Excel открывает файл без мастера импорта.
// В начале — BOM UTF-8, чтобы Excel распознал кириллицу. Данные модуля «Цикл» в CSV не выгружаются.

import type { Session } from './analysis';
import { MEASUREMENT_LABEL } from './body';
import type { BodyMeasurement } from './types';

const BOM = '﻿';

export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 1000) / 1000).replace('.', ',') : v;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return BOM + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

const SET_TYPE: Record<string, string> = { warmup: 'разминочный', working: 'рабочий', dropset: 'дроп-сет', failure: 'до отказа' };

/** Одна строка — один подход. Вес — кг (хранимые значения), время — секунды. */
export function setsCsv(sessions: Session[]): string {
  const rows: (string | number | null)[][] = [];
  for (const s of sessions) {
    for (const se of s.exercises) {
      se.sets.forEach((set, i) =>
        rows.push([
          s.date,
          s.workout.name,
          se.ex.nameRu,
          i + 1,
          SET_TYPE[set.setType] ?? set.setType,
          set.weightKg ?? null,
          set.addedWeightKg ?? null,
          set.reps ?? null,
          set.durationSec ?? null,
          set.rir ?? null,
          set.rpe ?? null,
          set.completed ? 'да' : 'нет',
        ]),
      );
    }
  }
  return toCsv(['Дата', 'Тренировка', 'Упражнение', 'Подход', 'Тип', 'Вес, кг', 'Доп./асс., кг', 'Повторы', 'Время, с', 'RIR', 'RPE', 'Выполнен'], rows);
}

export function measurementsCsv(ms: BodyMeasurement[]): string {
  const rows = ms
    .filter((m) => !m.deletedAt)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => [m.date, MEASUREMENT_LABEL[m.type], m.value, m.type === 'weight' ? 'кг' : 'см']);
  return toCsv(['Дата', 'Замер', 'Значение', 'Единица'], rows);
}
