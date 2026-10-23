// Допустимые диапазоны ввода (ТЗ, раздел 11).
export const LIMITS = {
  weightKg: { min: 0, max: 1000 },
  /** Доп. вес / ассистирование для упражнений с собственным весом */
  addedWeightKg: { min: -1000, max: 1000 },
  reps: { min: 0, max: 999 },
  rir: { min: 0, max: 10 },
  rpe: { min: 0, max: 10 },
  durationSec: { min: 0, max: 24 * 3600 },
} as const;

export type LimitKey = keyof typeof LIMITS;

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function clampField(key: LimitKey, n: number): number {
  const { min, max } = LIMITS[key];
  return clamp(n, min, max);
}

export function isValidField(key: LimitKey, n: number): boolean {
  const { min, max } = LIMITS[key];
  return Number.isFinite(n) && n >= min && n <= max;
}

/** RIR/RPE: шаг 0,5 (Zourdos et al., 2016 допускают половинки). */
export function isHalfStep(n: number): boolean {
  return Number.isInteger(n * 2);
}

/** Разбор числа из поля ввода: принимает «82,5» и «82.5». */
export function parseDecimal(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
