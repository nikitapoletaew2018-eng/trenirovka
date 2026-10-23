// Общие расчёты для отчёта, сигналов, рекордов и графиков. Чистые функции над снимком данных.
// Отчёты не кэшируются: всё считается из подходов, поэтому правка прошлой тренировки сразу меняет отчёт.

import { addDays, localDate, weekStart } from './dates';
import { e1rm, isWorkingSet, setLoadKg, tonnage } from './formulas';
import type { Exercise, ISODate, MovementPattern, MuscleId, Settings, Workout, WorkoutExercise, WorkoutSet } from './types';

export interface SessionExercise {
  we: WorkoutExercise;
  ex: Exercise;
  sets: WorkoutSet[];
}

export interface Session {
  workout: Workout;
  date: ISODate;
  week: ISODate;
  exercises: SessionExercise[];
}

export type AnalysisSettings = Pick<
  Settings,
  | 'e1rmFormula'
  | 'secondaryMuscleFactor'
  | 'includeBodyweightInTonnage'
  | 'bodyWeightKg'
  | 'stableThresholdPct'
  | 'stagnationWeeks'
  | 'volumeJumpPct'
  | 'rirTolerance'
  | 'fatigueWellbeing'
>;

const alive = <T extends { deletedAt?: string | null }>(x: T) => !x.deletedAt;

/**
 * Завершённые тренировки с упражнениями и подходами, по возрастанию даты.
 * Упражнение берётся то, что фактически выполнялось (после замены — новое).
 */
export function buildSessions(
  workouts: Workout[],
  workoutExercises: WorkoutExercise[],
  sets: WorkoutSet[],
  exercises: Exercise[],
): Session[] {
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const setsByWe = new Map<string, WorkoutSet[]>();
  for (const s of sets.filter(alive)) setsByWe.set(s.workoutExerciseId, [...(setsByWe.get(s.workoutExerciseId) ?? []), s]);
  const wesByW = new Map<string, WorkoutExercise[]>();
  for (const we of workoutExercises.filter(alive)) wesByW.set(we.workoutId, [...(wesByW.get(we.workoutId) ?? []), we]);
  return workouts
    .filter((w) => alive(w) && !!w.finishedAt)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((workout) => {
      const date = localDate(workout.startedAt, workout.timeZone);
      const exs = (wesByW.get(workout.id) ?? [])
        .sort((a, b) => a.order - b.order)
        .flatMap((we) => {
          const ex = exById.get(we.exerciseId);
          return ex ? [{ we, ex, sets: (setsByWe.get(we.id) ?? []).sort((a, b) => a.order - b.order) }] : [];
        });
      return { workout, date, week: weekStart(date), exercises: exs };
    });
}

export function workingSetsOf(se: SessionExercise): WorkoutSet[] {
  return se.sets.filter(isWorkingSet);
}

function bodyWeight(session: Session, s: AnalysisSettings): number | null {
  return session.workout.bodyWeightKg ?? s.bodyWeightKg ?? null;
}

/** Нагрузка подхода (кг) для e1RM: вес или эффективный вес с собственным весом. */
export function loadOf(set: WorkoutSet, se: SessionExercise, session: Session, s: AnalysisSettings): number | null {
  return setLoadKg(set, se.ex.trackingType, bodyWeight(session, s));
}

export interface E1rmPoint {
  value: number;
  weightKg: number;
  reps: number;
  date: ISODate;
  workoutId: string;
}

/** Лучший e1RM упражнения в тренировке (только рабочие подходы, r ≤ 10). Это оценка. */
export function bestE1rmInSession(se: SessionExercise, session: Session, s: AnalysisSettings): E1rmPoint | null {
  let best: E1rmPoint | null = null;
  for (const set of workingSetsOf(se)) {
    const load = loadOf(set, se, session, s);
    if (load == null || set.reps == null) continue;
    const v = e1rm(load, set.reps, s.e1rmFormula);
    if (v != null && (!best || v > best.value))
      best = { value: v, weightKg: load, reps: set.reps, date: session.date, workoutId: session.workout.id };
  }
  return best;
}

export function sessionExerciseTonnage(se: SessionExercise, session: Session, s: AnalysisSettings): number {
  return tonnage(se.sets, se.ex.trackingType, { includeBodyweight: s.includeBodyweightInTonnage, bodyWeightKg: bodyWeight(session, s) });
}

export interface WeekAgg {
  week: ISODate;
  sessions: Session[];
  workingSets: number;
  tonnage: number;
  tonnageByExercise: Map<string, number>;
  bestE1rm: Map<string, E1rmPoint>;
  /** Рабочие подходы на мышцу: основная = 1, вспомогательная = коэффициент (условность). */
  muscleSets: Map<MuscleId, number>;
  patternSets: Map<MovementPattern, number>;
  /** RIR рабочих подходов, где он записан */
  rirValues: number[];
  /** RIR по упражнению — для сигнала усталости */
  rirByExercise: Map<string, number[]>;
  /** Подходы с целевым RIR из плана: сколько всего и сколько в допуске */
  targetRir: { total: number; inRange: number };
  wellbeing: number[];
  exercisesById: Map<string, Exercise>;
}

export function aggregateWeek(all: Session[], week: ISODate, s: AnalysisSettings): WeekAgg {
  const sessions = all.filter((x) => x.week === week);
  const agg: WeekAgg = {
    week,
    sessions,
    workingSets: 0,
    tonnage: 0,
    tonnageByExercise: new Map(),
    bestE1rm: new Map(),
    muscleSets: new Map(),
    patternSets: new Map(),
    rirValues: [],
    rirByExercise: new Map(),
    targetRir: { total: 0, inRange: 0 },
    wellbeing: [],
    exercisesById: new Map(),
  };
  const add = <K>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const session of sessions) {
    if (session.workout.wellbeing != null) agg.wellbeing.push(session.workout.wellbeing);
    for (const se of session.exercises) {
      agg.exercisesById.set(se.ex.id, se.ex);
      const ws = workingSetsOf(se);
      if (ws.length === 0) continue;
      agg.workingSets += ws.length;
      const t = sessionExerciseTonnage(se, session, s);
      agg.tonnage += t;
      add(agg.tonnageByExercise, se.ex.id, t);
      for (const m of se.ex.primaryMuscles) add(agg.muscleSets, m, ws.length);
      for (const m of se.ex.secondaryMuscles) add(agg.muscleSets, m, ws.length * s.secondaryMuscleFactor);
      add(agg.patternSets, se.ex.movementPattern, ws.length);
      const b = bestE1rmInSession(se, session, s);
      const prev = agg.bestE1rm.get(se.ex.id);
      if (b && (!prev || b.value > prev.value)) agg.bestE1rm.set(se.ex.id, b);
      const target = se.we.plan?.targetRir;
      for (const set of ws) {
        if (set.rir == null) continue;
        agg.rirValues.push(set.rir);
        agg.rirByExercise.set(se.ex.id, [...(agg.rirByExercise.get(se.ex.id) ?? []), set.rir]);
        if (target != null) {
          agg.targetRir.total++;
          if (Math.abs(set.rir - target) <= s.rirTolerance) agg.targetRir.inRange++;
        }
      }
    }
  }
  return agg;
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export type Trend = 'up' | 'flat' | 'down';

/** ↑ / → / ↓ относительно прошлого значения с порогом «стабильно» ±thr% (эвристика, настраивается). */
export function trend(current: number, previous: number | null | undefined, thresholdPct: number): Trend | null {
  if (previous == null || previous <= 0) return null;
  const pct = ((current - previous) / previous) * 100;
  if (pct > thresholdPct) return 'up';
  if (pct < -thresholdPct) return 'down';
  return 'flat';
}

export function weeksBack(week: ISODate, n: number): ISODate {
  return addDays(week, -7 * n);
}

export const UPPER: MuscleId[] = ['chest', 'front_delts', 'side_delts', 'rear_delts', 'lats', 'upper_traps', 'mid_back', 'biceps', 'triceps', 'forearms'];
export const LOWER: MuscleId[] = ['quads', 'hamstrings', 'glutes', 'abductors', 'adductors', 'calves'];
export const PUSH: MovementPattern[] = ['horizontal_push', 'vertical_push'];
export const PULL: MovementPattern[] = ['horizontal_pull', 'vertical_pull'];
