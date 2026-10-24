// Замеры тела (ТЗ, раздел 7). Вес — кг, обхваты — см.

import { movingAverage7, type DatedValue } from './formulas';
import type { BodyMeasurement, MeasurementType } from './types';

export const MEASUREMENT_LABEL: Record<MeasurementType, string> = {
  weight: 'Вес тела',
  waist: 'Талия',
  hips: 'Бёдра (ягодицы)',
  chest: 'Грудь',
  arm: 'Плечо (бицепс)',
  thigh: 'Бедро',
  neck: 'Шея',
};

export const MEASUREMENT_TYPES = Object.keys(MEASUREMENT_LABEL) as MeasurementType[];

/** Допустимые значения: вес 20–400 кг, обхваты 10–250 см (валидация ввода). */
export const MEASUREMENT_LIMITS: Record<'weight' | 'girth', { min: number; max: number }> = { weight: { min: 20, max: 400 }, girth: { min: 10, max: 250 } };

export function measurementLimits(type: MeasurementType) {
  return MEASUREMENT_LIMITS[type === 'weight' ? 'weight' : 'girth'];
}

const alive = (m: BodyMeasurement) => !m.deletedAt;

/** Значения по дате для типа; несколько записей за день — берётся последняя. */
export function seriesOf(ms: BodyMeasurement[], type: MeasurementType): DatedValue[] {
  const byDate = new Map<string, BodyMeasurement>();
  for (const m of ms.filter(alive).filter((x) => x.type === type)) {
    const cur = byDate.get(m.date);
    if (!cur || m.createdAt > cur.createdAt) byDate.set(m.date, m);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((m) => ({ date: m.date, value: m.value }));
}

/** Вес тела и скользящее среднее за 7 дней (ТЗ, раздел 8). */
export function weightWithAverage(ms: BodyMeasurement[]): { date: string; weight: number; avg7: number }[] {
  const raw = seriesOf(ms, 'weight');
  const avg = movingAverage7(raw);
  return raw.map((p, i) => ({ date: p.date, weight: p.value, avg7: avg[i]!.value }));
}

/** Последнее значение каждого типа. */
export function latestByType(ms: BodyMeasurement[]): Partial<Record<MeasurementType, { date: string; value: number }>> {
  const out: Partial<Record<MeasurementType, { date: string; value: number }>> = {};
  for (const t of MEASUREMENT_TYPES) {
    const s = seriesOf(ms, t);
    const last = s[s.length - 1];
    if (last) out[t] = last;
  }
  return out;
}
