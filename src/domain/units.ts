import type { WeightUnit } from './types';

/**
 * 1 lb = 0,45359237 кг точно.
 * Источник: International Yard and Pound Agreement (1959); NIST Handbook 44, Appendix C.
 */
export const KG_PER_LB = 0.45359237;

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/** Значение для отображения в выбранных единицах (хранится всегда в кг). */
export function toDisplayWeight(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kgToLb(kg);
}

/** Введённое пользователем значение → кг для хранения. */
export function fromDisplayWeight(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : lbToKg(value);
}

const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/** Округление до 0,1 для отображения; 2,5 / 1,25 кг оставляем как есть. */
export function formatNumber(n: number, maxFractionDigits: 1 | 2 = 1): string {
  return (maxFractionDigits === 1 ? nf1 : nf2).format(n);
}

export function formatWeight(kg: number, unit: WeightUnit, withUnit = true): string {
  const v = toDisplayWeight(kg, unit);
  // Шаги 1,25 кг требуют двух знаков; фунты — одного.
  const s = unit === 'kg' ? formatNumber(round(v, 2), 2) : formatNumber(round(v, 1), 1);
  return withUnit ? `${s} ${unit === 'kg' ? 'кг' : 'lb'}` : s;
}

/** Оценки (e1RM): один знак после запятой. */
export function formatWeightApprox(kg: number, unit: WeightUnit, withUnit = true): string {
  const s = formatNumber(round(toDisplayWeight(kg, unit), 1), 1);
  return withUnit ? `${s} ${unit === 'kg' ? 'кг' : 'lb'}` : s;
}

export function unitLabel(unit: WeightUnit): string {
  return unit === 'kg' ? 'кг' : 'lb';
}

/**
 * Шаг кнопок ± в выбранных единицах.
 * В фунтах — ближайшее кратное 2,5 lb к шагу упражнения (2,5 кг → 5 lb). Эвристика интерфейса.
 */
export function displayStep(stepKg: number, unit: WeightUnit): number {
  if (unit === 'kg') return stepKg;
  return Math.max(2.5, Math.round(kgToLb(stepKg) / 2.5) * 2.5);
}

export function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(r).padStart(2, '0')}` : `${mm}:${String(r).padStart(2, '0')}`;
}
