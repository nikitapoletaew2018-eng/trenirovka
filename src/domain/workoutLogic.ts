// Логика записи тренировки: автозаполнение подходов, статус плана, итог.
// Чистые функции, тесты — workoutLogic.test.ts.

import { isWorkingSet, tonnage, type SetLike } from './formulas';
import type { PlannedItem, PlannedStatus, SetType, TrackingType } from './types';

export interface SetValues {
  setType: SetType;
  weightKg: number | null;
  addedWeightKg: number | null;
  reps: number | null;
  durationSec: number | null;
  rir: number | null;
}

export const EMPTY_SET_VALUES: SetValues = {
  setType: 'working',
  weightKg: null,
  addedWeightKg: null,
  reps: null,
  durationSec: null,
  rir: null,
};

type LastSet = Partial<SetValues> & { setType: SetType };

/**
 * Первый подход упражнения: план на сегодня → прошлая тренировка с этим упражнением → пусто.
 * Поля берутся по приоритету по отдельности: если в плане нет веса, вес берётся из прошлого раза.
 * Из прошлого раза берётся первый рабочий подход (разминку не копируем как цель).
 */
export function firstSetValues(plan: PlannedItem | null | undefined, lastTime: LastSet[]): SetValues {
  const last = lastTime.find((s) => s.setType !== 'warmup') ?? null;
  return {
    setType: 'working',
    weightKg: plan?.suggestedWeightKg ?? last?.weightKg ?? null,
    addedWeightKg: last?.addedWeightKg ?? null,
    // Цель по повторам из прогрессии («+1 повтор»), иначе нижняя граница диапазона
    reps: plan ? (plan.targetReps ?? plan.repMin) : (last?.reps ?? null),
    durationSec: last?.durationSec ?? null,
    rir: plan?.targetRir ?? last?.rir ?? null,
  };
}

/** Следующий подход — из предыдущего сегодняшнего. */
export function nextSetValues(prev: SetValues): SetValues {
  return { ...prev, setType: prev.setType === 'warmup' ? 'warmup' : 'working' };
}

/** Порядок переключения типа подхода тапом по номеру. */
export const SET_TYPE_CYCLE: SetType[] = ['working', 'warmup', 'dropset', 'failure'];

export function nextSetType(t: SetType): SetType {
  const i = SET_TYPE_CYCLE.indexOf(t);
  return SET_TYPE_CYCLE[(i + 1) % SET_TYPE_CYCLE.length] ?? 'working';
}

export interface PendingSet extends SetValues {
  id: string;
  completed: boolean;
  /** true, пока значения пришли из автозаполнения и пользователь их не трогал */
  autofilled: boolean;
}

/**
 * После отметки подхода значения переносятся в следующие невыполненные подходы,
 * которые пользователь ещё не правил (autofilled) и того же типа (рабочие ↔ рабочие).
 * Возвращает id → новые значения.
 */
export function propagateAfterComplete(sets: PendingSet[], completedId: string): Map<string, SetValues> {
  const out = new Map<string, SetValues>();
  const idx = sets.findIndex((s) => s.id === completedId);
  const done = sets[idx];
  if (!done) return out;
  const isWarm = done.setType === 'warmup';
  for (const s of sets.slice(idx + 1)) {
    if (s.completed || !s.autofilled) continue;
    if ((s.setType === 'warmup') !== isWarm) continue;
    out.set(s.id, {
      setType: s.setType,
      weightKg: done.weightKg,
      addedWeightKg: done.addedWeightKg,
      reps: done.reps,
      durationSec: done.durationSec,
      rir: done.rir,
    });
  }
  return out;
}

/**
 * Статус запланированной тренировки после завершения:
 * все запланированные рабочие подходы выполнены → done; часть → partial; ничего → planned.
 * Если в плане нет подходов, любая выполненная работа → done.
 */
export function plannedStatusAfterFinish(plannedSets: number, completedWorkingSets: number): PlannedStatus {
  if (completedWorkingSets <= 0) return 'planned';
  if (plannedSets <= 0) return 'done';
  return completedWorkingSets >= plannedSets ? 'done' : 'partial';
}

export interface ExerciseSets {
  trackingType: TrackingType;
  sets: SetLike[];
}

export interface WorkoutSummary {
  durationSec: number;
  workingSets: number;
  tonnageKg: number;
}

export function workoutSummary(
  startedAt: string,
  finishedAt: string,
  exercises: ExerciseSets[],
  opts: { includeBodyweight: boolean; bodyWeightKg?: number | null },
): WorkoutSummary {
  let workingSets = 0;
  let t = 0;
  for (const ex of exercises) {
    workingSets += ex.sets.filter(isWorkingSet).length;
    t += tonnage(ex.sets, ex.trackingType, opts);
  }
  return {
    durationSec: Math.max(0, (Date.parse(finishedAt) - Date.parse(startedAt)) / 1000),
    workingSets,
    tonnageKg: t,
  };
}
