// Личные рекорды (ТЗ, раздел 7). Учитываются только рабочие подходы.
// Первое выполнение упражнения задаёт точку отсчёта и рекордом не считается.

import { bestE1rmInSession, loadOf, sessionExerciseTonnage, workingSetsOf, type AnalysisSettings, type Session } from './analysis';
import type { ISODate } from './types';

export type RecordKind = 'max_weight' | 'reps_at_weight' | 'e1rm' | 'volume' | 'max_reps' | 'max_duration';

export const RECORD_LABEL: Record<RecordKind, string> = {
  max_weight: 'Максимальный вес',
  reps_at_weight: 'Максимум повторов с весом',
  e1rm: 'Лучший e1RM (≈ оценка)',
  volume: 'Максимальный объём за тренировку',
  max_reps: 'Максимум повторов',
  max_duration: 'Максимальное время',
};

export interface RecordValue {
  value: number;
  /** Для reps_at_weight — вес, кг; для max_weight — повторы с этим весом */
  extra?: number | null;
  date: ISODate;
  workoutId: string;
}

export interface ExerciseRecords {
  maxWeight?: RecordValue;
  e1rm?: RecordValue;
  volume?: RecordValue;
  maxReps?: RecordValue;
  maxDuration?: RecordValue;
  /** вес (кг, округление до 0,01) → лучшие повторы */
  repsAtWeight: Map<number, RecordValue>;
}

export interface PrEvent {
  exerciseId: string;
  kind: RecordKind;
  value: number;
  previous: number;
  extra?: number | null;
  date: ISODate;
  workoutId: string;
}

const key = (kg: number) => Math.round(kg * 100) / 100;

export function computeRecords(sessions: Session[], s: AnalysisSettings): { records: Map<string, ExerciseRecords>; events: PrEvent[] } {
  const records = new Map<string, ExerciseRecords>();
  const events: PrEvent[] = [];
  const sorted = [...sessions].sort((a, b) => a.workout.startedAt.localeCompare(b.workout.startedAt));

  for (const session of sorted) {
    for (const se of session.exercises) {
      const ws = workingSetsOf(se);
      if (ws.length === 0) continue;
      const exId = se.ex.id;
      const rec: ExerciseRecords = records.get(exId) ?? { repsAtWeight: new Map<number, RecordValue>() };
      const first = !records.has(exId);
      const at = { date: session.date, workoutId: session.workout.id };
      const bump = (kind: RecordKind, cur: RecordValue | undefined, value: number, extra?: number | null): RecordValue | undefined => {
        if (cur && value <= cur.value) return cur;
        if (cur && !first) events.push({ exerciseId: exId, kind, value, previous: cur.value, extra: extra ?? null, ...at });
        return { value, extra: extra ?? null, ...at };
      };

      const t = se.ex.trackingType;
      if (t === 'weight_reps' || t === 'bodyweight_reps' || t === 'weight_time') {
        // Максимальный вес: для собственного веса — эффективный вес (если вес тела известен)
        let top: { kg: number; reps: number } | null = null;
        for (const set of ws) {
          const kg = t === 'weight_time' ? set.weightKg ?? null : loadOf(set, se, session, s);
          if (kg == null || kg <= 0) continue;
          if (t !== 'weight_time' && (set.reps ?? 0) < 1) continue;
          if (!top || kg > top.kg) top = { kg, reps: set.reps ?? 0 };
        }
        if (top) rec.maxWeight = bump('max_weight', rec.maxWeight, top.kg, top.reps);
      }
      if (t === 'weight_reps' || t === 'bodyweight_reps') {
        const best = bestE1rmInSession(se, session, s);
        if (best) rec.e1rm = bump('e1rm', rec.e1rm, best.value);
        const vol = sessionExerciseTonnage(se, session, s);
        if (vol > 0) rec.volume = bump('volume', rec.volume, vol);
        // Повторы с конкретным весом: лучший результат на каждом весе в этой тренировке
        const bestAt = new Map<number, number>();
        for (const set of ws) {
          const kg = loadOf(set, se, session, s);
          if (kg == null || set.reps == null || set.reps < 1) continue;
          bestAt.set(key(kg), Math.max(bestAt.get(key(kg)) ?? 0, set.reps));
        }
        for (const [kg, reps] of bestAt) {
          const cur = rec.repsAtWeight.get(kg);
          const next = bump('reps_at_weight', cur, reps, kg);
          if (next) rec.repsAtWeight.set(kg, next);
        }
      }
      if (t === 'reps' || t === 'bodyweight_reps') {
        const maxReps = Math.max(0, ...ws.map((x) => x.reps ?? 0));
        if (maxReps > 0) rec.maxReps = bump('max_reps', rec.maxReps, maxReps);
      }
      if (t === 'time' || t === 'weight_time') {
        const maxDur = Math.max(0, ...ws.map((x) => x.durationSec ?? 0));
        if (maxDur > 0) rec.maxDuration = bump('max_duration', rec.maxDuration, maxDur);
      }
      records.set(exId, rec);
    }
  }
  return { records, events };
}

/** Рекорды, установленные в конкретной тренировке (для итога «новые рекорды»). */
export function prsInWorkout(events: PrEvent[], workoutId: string): PrEvent[] {
  return events.filter((e) => e.workoutId === workoutId);
}
