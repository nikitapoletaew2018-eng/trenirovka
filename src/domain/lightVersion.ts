// Облегчённые варианты тренировки по самочувствию (ТЗ, 6.3). Применяются только по выбору пользовательницы:
// после чек-ина или при явно включённом плановом облегчении. Это вариант для комфорта, не медицинская необходимость.

import type { Exercise, PlannedItem } from './types';

export const COMFORT_NOTE = 'вариант для комфорта по самочувствию, не медицинская необходимость';

export interface LightParams {
  /** Доля подходов: ТЗ — −30–50%, по умолчанию 0,6 (−40%) */
  setsFactor: number;
  rirPlus: number;
}

/** Облегчённая версия: меньше подходов, целевой RIR + rirPlus, без попыток рекордов (вес не выше плана). */
export function lightVersion(items: PlannedItem[], p: LightParams): PlannedItem[] {
  return items.map((it) => {
    const sets = Math.max(1, Math.round(it.sets * p.setsFactor));
    const rir = it.targetRir == null ? null : Math.min(10, it.targetRir + p.rirPlus);
    return {
      ...it,
      sets,
      targetRir: rir,
      targetReps: null,
      reason: `Облегчённая версия: подходов ${it.sets} → ${sets}${rir != null ? `, RIR ${it.targetRir} → ${rir}` : ''}, без попыток рекордов — ${COMFORT_NOTE}.`,
    };
  });
}

/** Облегчённые замены: базовые структурные упражнения → первая облегчённая альтернатива из карточки (раздел 2). */
export function lighterReplacements(items: PlannedItem[], exById: Map<string, Exercise>): { items: PlannedItem[]; replaced: { from: string; to: string }[] } {
  const replaced: { from: string; to: string }[] = [];
  const out = items.map((it) => {
    const ex = exById.get(it.exerciseId);
    if (!ex || !(ex.isStructural && ex.category === 'core')) return it;
    const alt = ex.lighterAlternatives.map((id) => exById.get(id)).find((a) => a && !a.deletedAt);
    if (!alt) return it;
    replaced.push({ from: ex.id, to: alt.id });
    return { ...it, exerciseId: alt.id, suggestedWeightKg: null, targetReps: null, reason: `Замена «${ex.nameRu}» → «${alt.nameRu}» — ${COMFORT_NOTE}.` };
  });
  return { items: out, replaced };
}

/** Убрать упражнения, которые пользовательница сама отметила как некомфортные в эти дни. */
export function withoutExcluded(items: PlannedItem[], excluded: string[]): PlannedItem[] {
  const set = new Set(excluded);
  return items.filter((it) => !set.has(it.exerciseId));
}
