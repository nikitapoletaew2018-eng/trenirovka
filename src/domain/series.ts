// Ряды для графиков (ТЗ, раздел 7). Чистые функции.

import { aggregateWeek, bestE1rmInSession, loadOf, sessionExerciseTonnage, weeksBack, workingSetsOf, type AnalysisSettings, type Session } from './analysis';
import type { ISODate, MuscleId } from './types';

export interface ExercisePoint {
  /** Дата тренировки или понедельник недели */
  date: ISODate;
  e1rm: number | null;
  maxWeight: number | null;
  tonnage: number;
}

/** По тренировкам: лучший e1RM, максимальный вес рабочих подходов, тоннаж упражнения. */
export function exerciseSeries(sessions: Session[], exerciseId: string, s: AnalysisSettings): ExercisePoint[] {
  const out: ExercisePoint[] = [];
  for (const session of sessions) {
    const ses = session.exercises.filter((x) => x.ex.id === exerciseId && workingSetsOf(x).length > 0);
    if (!ses.length) continue;
    let e1rm: number | null = null;
    let maxWeight: number | null = null;
    let tonnage = 0;
    for (const se of ses) {
      const b = bestE1rmInSession(se, session, s);
      if (b && (e1rm == null || b.value > e1rm)) e1rm = b.value;
      for (const set of workingSetsOf(se)) {
        const kg = se.ex.trackingType === 'weight_time' ? set.weightKg ?? null : loadOf(set, se, session, s);
        if (kg != null && (maxWeight == null || kg > maxWeight)) maxWeight = kg;
      }
      tonnage += sessionExerciseTonnage(se, session, s);
    }
    out.push({ date: session.date, e1rm, maxWeight, tonnage });
  }
  return out;
}

/** По неделям: максимум e1RM и веса, сумма тоннажа. */
export function exerciseSeriesByWeek(sessions: Session[], exerciseId: string, s: AnalysisSettings): ExercisePoint[] {
  const byWeek = new Map<ISODate, ExercisePoint>();
  const weekOf = new Map(sessions.map((x) => [x.date, x.week]));
  for (const p of exerciseSeries(sessions, exerciseId, s)) {
    const w = weekOf.get(p.date)!;
    const cur = byWeek.get(w) ?? { date: w, e1rm: null, maxWeight: null, tonnage: 0 };
    byWeek.set(w, {
      date: w,
      e1rm: p.e1rm == null ? cur.e1rm : Math.max(cur.e1rm ?? 0, p.e1rm),
      maxWeight: p.maxWeight == null ? cur.maxWeight : Math.max(cur.maxWeight ?? 0, p.maxWeight),
      tonnage: cur.tonnage + p.tonnage,
    });
  }
  return [...byWeek.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Последние n недель (понедельники), заканчивая неделей end. */
export function lastWeeks(end: ISODate, n: number): ISODate[] {
  return Array.from({ length: n }, (_, i) => weeksBack(end, n - 1 - i));
}

/** Рабочие подходы на мышцу по неделям (основная = 1, вспомогательная = коэффициент). */
export function muscleSetsByWeek(sessions: Session[], muscle: MuscleId, weeks: ISODate[], s: AnalysisSettings): { week: ISODate; sets: number }[] {
  return weeks.map((w) => ({ week: w, sets: aggregateWeek(sessions, w, s).muscleSets.get(muscle) ?? 0 }));
}

/** Частота тренировок: завершённых тренировок за неделю. */
export function frequencyByWeek(sessions: Session[], weeks: ISODate[]): { week: ISODate; sessions: number }[] {
  return weeks.map((w) => ({ week: w, sessions: sessions.filter((x) => x.week === w).length }));
}
