import type { EffortScale, PlannedItem, TrackingType, WeightUnit, WorkoutSet } from '../domain/types';
import { formatDuration, formatNumber, formatWeight, round, toDisplayWeight } from '../domain/units';
import { rpeFromRir } from '../domain/formulas';

/** Короткая запись подхода: «80×8», «+10×6», «1:30», «20 кг × 0:45». */
export function formatSet(s: Pick<WorkoutSet, 'weightKg' | 'addedWeightKg' | 'reps' | 'durationSec'>, t: TrackingType, unit: WeightUnit): string {
  const w = (kg: number | null | undefined) => (kg == null ? '—' : formatNumber(round(toDisplayWeight(kg, unit), 2), 2));
  switch (t) {
    case 'weight_reps':
      return `${w(s.weightKg)}×${s.reps ?? '—'}`;
    case 'bodyweight_reps': {
      const a = s.addedWeightKg ?? 0;
      const prefix = a === 0 ? 'СВ' : a > 0 ? `+${w(a)}` : `−${w(-a)}`;
      return `${prefix}×${s.reps ?? '—'}`;
    }
    case 'reps':
      return `${s.reps ?? '—'} повт.`;
    case 'time':
      return formatDuration(s.durationSec ?? 0);
    case 'weight_time':
      return `${w(s.weightKg)} × ${formatDuration(s.durationSec ?? 0)}`;
  }
}

export function effortLabel(rir: number | null | undefined, scale: EffortScale): string {
  if (rir == null) return '';
  return scale === 'rir' ? `RIR ${formatNumber(rir)}` : `RPE ${formatNumber(rpeFromRir(rir))}`;
}

/** «3×6–8 @RIR 2 · 82,5 кг»; для упражнений на время — «3 подхода». */
export function planLine(p: PlannedItem, unit: WeightUnit, scale: EffortScale, tracking: TrackingType = 'weight_reps'): string {
  const timed = tracking === 'time' || tracking === 'weight_time';
  const reps = p.repMin === p.repMax ? `${p.repMin}` : `${p.repMin}–${p.repMax}`;
  const parts = [timed ? `${p.sets} подх.` : `${p.sets}×${reps}`];
  if (!timed && p.targetRir != null) parts[0] += ` @${effortLabel(p.targetRir, scale)}`;
  if (p.suggestedWeightKg != null) parts.push(formatWeight(p.suggestedWeightKg, unit));
  return parts.join(' · ');
}

export const SET_TYPE_LABEL = { warmup: 'Разминочный', working: 'Рабочий', dropset: 'Дроп-сет', failure: 'До отказа' } as const;
export const SET_TYPE_SHORT = { warmup: 'Р', dropset: 'Д', failure: 'О' } as const;

export const STATUS_LABEL = {
  planned: 'запланирована',
  done: 'выполнена',
  partial: 'частично',
  skipped: 'пропущена',
  moved: 'перенесена',
} as const;

export const STATUS_CLASS = { planned: '', done: 'ok', partial: 'warn', skipped: 'bad', moved: '' } as const;

/** Варианты RIR (0–10, шаг 0,5) и соответствующие RPE. */
export const EFFORT_VALUES: number[] = Array.from({ length: 21 }, (_, i) => i / 2);
