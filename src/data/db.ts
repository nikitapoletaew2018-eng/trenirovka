import Dexie, { type Table } from 'dexie';
import type {
  Exercise,
  PlannedWorkout,
  RestTimer,
  Settings,
  WeekPlan,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  WorkoutTemplate,
} from '../domain/types';

/**
 * Версия схемы данных. Увеличивается при любом изменении структуры;
 * для каждой версии — шаг миграции Dexie (ниже) и шаг миграции экспорта (backup.ts).
 */
export const SCHEMA_VERSION = 1;

export interface MetaRow {
  key: string;
  value: string | number | boolean | null;
}

export class AppDB extends Dexie {
  exercises!: Table<Exercise, string>;
  templates!: Table<WorkoutTemplate, string>;
  weekPlans!: Table<WeekPlan, string>;
  plannedWorkouts!: Table<PlannedWorkout, string>;
  workouts!: Table<Workout, string>;
  workoutExercises!: Table<WorkoutExercise, string>;
  sets!: Table<WorkoutSet, string>;
  restTimer!: Table<RestTimer, string>;
  settings!: Table<Settings, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'trenirovka') {
    super(name);
    // v1 — исходная схема. Булевы поля в IndexedDB не индексируются, фильтруем в памяти.
    this.version(1).stores({
      exercises: 'id, updatedAt',
      templates: 'id, updatedAt',
      weekPlans: 'id, weekStart',
      plannedWorkouts: 'id, date, workoutId, templateId',
      workouts: 'id, startedAt, plannedWorkoutId',
      workoutExercises: 'id, workoutId, exerciseId',
      sets: 'id, workoutExerciseId, workoutId',
      restTimer: 'id',
      settings: 'id',
      meta: 'key',
    });
    // Пример будущей миграции:
    // this.version(2).stores({...}).upgrade(async (tx) => { ... });
  }
}

/** Таблицы с пользовательскими данными (входят в экспорт). */
export const DATA_TABLES = [
  'exercises',
  'templates',
  'weekPlans',
  'plannedWorkouts',
  'workouts',
  'workoutExercises',
  'sets',
  'settings',
] as const;

export type DataTable = (typeof DATA_TABLES)[number];

export let db = new AppDB();

/** Для тестов: отдельная база. */
export function useDatabase(next: AppDB): void {
  db = next;
}
