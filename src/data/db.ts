import Dexie, { type Table } from 'dexie';
import { databaseName } from './mode';
import type {
  Exercise,
  BodyMeasurement,
  BodyPhoto,
  CycleData,
  PlannedWorkout,
  Program,
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
export const SCHEMA_VERSION = 3;

/** Документ данных цикла: либо открытый, либо зашифрованный (AES-GCM, ключ из PIN через PBKDF2). */
export interface CycleRow {
  id: 'data';
  plain?: CycleData | null;
  enc?: { salt: string; iv: string; ct: string; iterations: number } | null;
  updatedAt: string;
}

export interface MetaRow {
  key: string;
  value: string | number | boolean | null;
}

export class AppDB extends Dexie {
  exercises!: Table<Exercise, string>;
  templates!: Table<WorkoutTemplate, string>;
  programs!: Table<Program, string>;
  weekPlans!: Table<WeekPlan, string>;
  plannedWorkouts!: Table<PlannedWorkout, string>;
  workouts!: Table<Workout, string>;
  workoutExercises!: Table<WorkoutExercise, string>;
  sets!: Table<WorkoutSet, string>;
  restTimer!: Table<RestTimer, string>;
  settings!: Table<Settings, string>;
  meta!: Table<MetaRow, string>;
  /** Один документ «data»: данные цикла (открытые или зашифрованные). Не входит в экспорт по умолчанию */
  cycle!: Table<CycleRow, string>;
  measurements!: Table<BodyMeasurement, string>;
  photos!: Table<BodyPhoto, string>;

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
    // v2 — программы (мезоциклы). Существующие данные не меняются: новые поля необязательные.
    this.version(2).stores({ programs: 'id, updatedAt', weekPlans: 'id, weekStart, programId' });
    // v3 — модуль «Цикл», замеры тела и фото.
    this.version(3).stores({ cycle: 'id', measurements: 'id, date, type', photos: 'id, date' });
  }
}

/** Таблицы с пользовательскими данными (входят в экспорт). */
export const DATA_TABLES = [
  'exercises',
  'templates',
  'programs',
  'weekPlans',
  'plannedWorkouts',
  'workouts',
  'workoutExercises',
  'sets',
  'settings',
  'measurements',
] as const;

export type DataTable = (typeof DATA_TABLES)[number];

// Имя базы выбирается один раз при запуске: реальная «trenirovka» или отдельная демо-база.
export let db = new AppDB(databaseName());

/** Для тестов: отдельная база. */
export function useDatabase(next: AppDB): void {
  db = next;
}
