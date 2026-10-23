// Снимок данных для отчётов, сигналов, рекордов и графиков. Ничего не кэшируется:
// при правке прошлой тренировки отчёт пересчитывается при следующем чтении.

import { buildSessions, type Session } from '../domain/analysis';
import type { Exercise, PlannedWorkout } from '../domain/types';
import { db } from './db';

export interface Snapshot {
  sessions: Session[];
  planned: PlannedWorkout[];
  exercises: Exercise[];
}

export async function loadSnapshot(): Promise<Snapshot> {
  const [workouts, wes, sets, exercises, planned] = await Promise.all([
    db.workouts.toArray(),
    db.workoutExercises.toArray(),
    db.sets.toArray(),
    db.exercises.toArray(),
    db.plannedWorkouts.toArray(),
  ]);
  return { sessions: buildSessions(workouts, wes, sets, exercises), planned: planned.filter((p) => !p.deletedAt), exercises };
}
