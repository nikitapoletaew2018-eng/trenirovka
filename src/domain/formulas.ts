// Формулы — ровно те, что зафиксированы в ТЗ (раздел 8). У каждой — источник.
// Все функции чистые и покрыты тестами (formulas.test.ts).

import type { SetType, TrackingType } from './types';

export interface SetLike {
  setType: SetType;
  completed: boolean;
  weightKg?: number | null;
  addedWeightKg?: number | null;
  reps?: number | null;
  durationSec?: number | null;
}

/** Рабочий подход = выполненный и не разминочный (дроп-сет и «до отказа» — тоже рабочие). */
export function isWorkingSet(s: Pick<SetLike, 'setType' | 'completed'>): boolean {
  return s.completed && s.setType !== 'warmup';
}

/**
 * Эффективный вес для упражнений с собственным весом:
 * вес тела + доп. вес (или − ассистирование, если addedWeightKg < 0).
 * Если вес тела неизвестен — null. Определение из ТЗ, раздел 8.
 */
export function effectiveBodyweightLoad(
  bodyWeightKg: number | null | undefined,
  addedWeightKg: number | null | undefined,
): number | null {
  if (bodyWeightKg == null || bodyWeightKg <= 0) return null;
  return Math.max(0, bodyWeightKg + (addedWeightKg ?? 0));
}

/** Нагрузка подхода в кг для расчёта тоннажа / e1RM; null — если не определена. */
export function setLoadKg(
  s: SetLike,
  trackingType: TrackingType,
  bodyWeightKg?: number | null,
): number | null {
  switch (trackingType) {
    case 'weight_reps':
      return s.weightKg ?? null;
    case 'bodyweight_reps':
      return effectiveBodyweightLoad(bodyWeightKg, s.addedWeightKg);
    default:
      return null;
  }
}

export interface TonnageOptions {
  /** Включать упражнения с собственным весом (по умолчанию — нет, переключатель в настройках). */
  includeBodyweight: boolean;
  bodyWeightKg?: number | null;
}

/**
 * Тоннаж = Σ (вес × повторы) рабочих подходов. Разминочные не учитываются.
 * Определение — ТЗ, раздел 8 (стандартное понятие объёма нагрузки «volume load»,
 * NSCA, Essentials of Strength Training and Conditioning, гл. о программировании).
 * Упражнения на время и «только повторы» в тоннаж не входят.
 */
export function tonnage(sets: SetLike[], trackingType: TrackingType, opts: TonnageOptions): number {
  if (trackingType === 'bodyweight_reps' && !opts.includeBodyweight) return 0;
  if (trackingType !== 'weight_reps' && trackingType !== 'bodyweight_reps') return 0;
  let sum = 0;
  for (const s of sets) {
    if (!isWorkingSet(s)) continue;
    const load = setLoadKg(s, trackingType, opts.bodyWeightKg);
    const reps = s.reps ?? 0;
    if (load == null || reps <= 0) continue;
    sum += load * reps;
  }
  return sum;
}

/** Максимум повторов, при котором e1RM считается (ТЗ, раздел 8). */
export const E1RM_MAX_REPS = 10;

/**
 * e1RM по Epley (1985): w × (1 + r/30).
 * Источник: Epley B. Poundage Chart. Boyd Epley Workout. Lincoln, NE, 1985.
 * При r = 1 возвращает w; при r > 10 или r < 1 — null. Это ОЦЕНКА.
 */
export function e1rmEpley(weightKg: number, reps: number): number | null {
  if (!validE1rmInput(weightKg, reps)) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/**
 * e1RM по Brzycki (1993): w × 36 / (37 − r).
 * Источник: Brzycki M. Strength testing — predicting a one-rep max from reps-to-fatigue.
 * JOPERD, 1993, 64(1):88–90.
 * При r = 1 возвращает w; при r > 10 или r < 1 — null. Это ОЦЕНКА.
 */
export function e1rmBrzycki(weightKg: number, reps: number): number | null {
  if (!validE1rmInput(weightKg, reps)) return null;
  if (reps === 1) return weightKg;
  return (weightKg * 36) / (37 - reps);
}

function validE1rmInput(w: number, r: number): boolean {
  return Number.isFinite(w) && w > 0 && Number.isInteger(r) && r >= 1 && r <= E1RM_MAX_REPS;
}

export function e1rm(weightKg: number, reps: number, formula: 'epley' | 'brzycki'): number | null {
  return formula === 'epley' ? e1rmEpley(weightKg, reps) : e1rmBrzycki(weightKg, reps);
}

/**
 * RPE = 10 − RIR. Допускаются половинки.
 * Источник: Zourdos MC et al. Novel resistance training-specific RPE scale measuring
 * repetitions in reserve. J Strength Cond Res, 2016, 30(1):267–275.
 */
export function rpeFromRir(rir: number): number {
  return 10 - rir;
}

export function rirFromRpe(rpe: number): number {
  return 10 - rpe;
}

export type PercentChange = { kind: 'pct'; value: number } | { kind: 'new' } | null;

/**
 * Изменение к прошлой неделе, % = (текущая − прошлая) / прошлая × 100.
 * Если прошлая = 0 и текущая > 0 — «новое»; если обе 0 — null (нечего сравнивать). ТЗ, раздел 8.
 */
export function percentChange(current: number, previous: number): PercentChange {
  if (previous === 0) return current === 0 ? null : { kind: 'new' };
  return { kind: 'pct', value: ((current - previous) / previous) * 100 };
}

export interface DatedValue {
  date: string; // YYYY-MM-DD
  value: number;
}

/**
 * Скользящее среднее за 7 календарных дней (текущий день + 6 предыдущих).
 * ТЗ, раздел 8. Окно по датам, а не по числу записей: пропуски дней не растягивают окно.
 */
export function movingAverage7(points: DatedValue[]): DatedValue[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
  return sorted.map((p) => {
    const end = dayNum(p.date);
    const window = sorted.filter((q) => {
      const n = dayNum(q.date);
      return n <= end && n > end - 7;
    });
    const avg = window.reduce((s, q) => s + q.value, 0) / window.length;
    return { date: p.date, value: avg };
  });
}
