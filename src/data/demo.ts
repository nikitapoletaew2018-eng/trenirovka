// Демо-режим: отдельная база IndexedDB «trenirovka-demo». С реальной базой «trenirovka» не пересекается:
// генератор пишет только в переданную ему демо-базу, режим выбирается один раз при запуске приложения.

import Dexie from 'dexie';
import { addDays, weekStart } from '../domain/dates';
import type { Exercise, PlannedItem, PlannedWorkout, Workout, WorkoutExercise, WorkoutSet, WorkoutTemplate } from '../domain/types';
import { AppDB } from './db';
import { uuid } from './ids';
import { SEED_EXERCISES, ensureSeed } from './seed';
import { DEFAULT_SETTINGS } from './settings';
import { DEMO_DB_NAME, setDemoMode } from './mode';

export { DEMO_DB_NAME, REAL_DB_NAME, demoAvailable, isDemoMode } from './mode';

/** Создать (если ещё нет) демо-базу и переключиться на неё. Реальная база не открывается и не меняется. */
export async function enterDemo(today: string): Promise<void> {
  const demo = new AppDB(DEMO_DB_NAME);
  try {
    if ((await demo.workouts.count()) === 0) await fillDemo(demo, today);
  } finally {
    demo.close();
  }
  setDemoMode(true);
}

/** Выйти из демо, оставив демо-базу (можно вернуться). */
export function exitDemo(): void {
  setDemoMode(false);
}

/** Удалить демо-базу целиком и вернуться к реальным данным. */
export async function deleteDemo(current: Dexie | null): Promise<void> {
  if (current && current.name === DEMO_DB_NAME) current.close();
  await Dexie.delete(DEMO_DB_NAME);
  setDemoMode(false);
}

// ——— Генерация ———

const exBySource = (id: string): Exercise => {
  const e = SEED_EXERCISES.find((x) => x.sourceId === id);
  if (!e) throw new Error(`Нет упражнения ${id}`);
  return e;
};

interface Slot {
  ex: Exercise;
  sets: number;
  repMin: number;
  repMax: number;
  /** Стартовые значения прогрессии */
  weight: number;
  reps: number;
}

/**
 * Заполняет демо-базу: шаблоны A/B (фулбади), 6 прошлых недель Пн/Ср/Пт с чередованием A/B
 * и двойной прогрессией, тренировки этой недели до сегодняшнего дня и план на остаток этой и следующую неделю.
 * Цифры условные — только для знакомства с отчётами и графиками.
 */
export async function fillDemo(target: AppDB, today: string): Promise<void> {
  if (target.name !== DEMO_DB_NAME) throw new Error('Демо-данные пишутся только в демо-базу');
  await ensureSeed(target);
  const T = new Date().toISOString();
  const ent = () => ({ id: uuid(), createdAt: T, updatedAt: T, deletedAt: null });

  const A: Slot[] = [
    { ex: exBySource('Barbell_Full_Squat'), sets: 3, repMin: 5, repMax: 8, weight: 80, reps: 6 },
    { ex: exBySource('Barbell_Bench_Press_-_Medium_Grip'), sets: 3, repMin: 6, repMax: 10, weight: 60, reps: 7 },
    { ex: exBySource('Bent_Over_Barbell_Row'), sets: 3, repMin: 8, repMax: 12, weight: 50, reps: 9 },
    { ex: exBySource('Plank'), sets: 2, repMin: 0, repMax: 0, weight: 0, reps: 40 },
  ];
  const B: Slot[] = [
    { ex: exBySource('Romanian_Deadlift'), sets: 3, repMin: 6, repMax: 10, weight: 70, reps: 7 },
    { ex: exBySource('Standing_Military_Press'), sets: 3, repMin: 6, repMax: 10, weight: 35, reps: 6 },
    { ex: exBySource('Pullups'), sets: 3, repMin: 5, repMax: 10, weight: 0, reps: 6 },
    { ex: exBySource('Dumbbell_Bicep_Curl'), sets: 2, repMin: 10, repMax: 15, weight: 10, reps: 11 },
  ];
  const item = (s: Slot): PlannedItem => ({
    exerciseId: s.ex.id,
    sets: s.sets,
    repMin: s.repMin,
    repMax: s.repMax,
    targetRir: s.ex.trackingType === 'time' ? null : 2,
    suggestedWeightKg: null,
  });
  const templates: WorkoutTemplate[] = [
    { ...ent(), name: 'Фулбади A (демо)', items: A.map((s, i) => ({ exerciseId: s.ex.id, order: i, targetSets: s.sets, repMin: s.repMin, repMax: s.repMax, targetRir: 2 })) },
    { ...ent(), name: 'Фулбади B (демо)', items: B.map((s, i) => ({ exerciseId: s.ex.id, order: i, targetSets: s.sets, repMin: s.repMin, repMax: s.repMax, targetRir: 2 })) },
  ];

  const workouts: Workout[] = [];
  const wes: WorkoutExercise[] = [];
  const sets: WorkoutSet[] = [];
  const planned: PlannedWorkout[] = [];
  const thisMonday = weekStart(today);
  const start = addDays(thisMonday, -42);
  let n = 0;

  for (let d = start; d <= addDays(thisMonday, 13); d = addDays(d, 1)) {
    const dow = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
    if (dow !== 0 && dow !== 2 && dow !== 4) continue;
    const useA = n % 2 === 0;
    n++;
    const slots = useA ? A : B;
    const tpl = useA ? templates[0]! : templates[1]!;
    const pw: PlannedWorkout = { ...ent(), date: d, name: tpl.name, templateId: tpl.id, plannedItems: slots.map(item), status: 'planned', workoutId: null, movedTo: null };
    planned.push(pw);
    if (d > today) continue;

    // Тренировка: двойная прогрессия; одна «тяжёлая» неделя с самочувствием 2 для сигналов
    const tired = d >= addDays(thisMonday, -7) && d < thisMonday && dow === 2;
    const w: Workout = {
      ...ent(),
      name: tpl.name,
      plannedWorkoutId: pw.id,
      startedAt: `${d}T15:00:00.000Z`,
      finishedAt: `${d}T16:05:00.000Z`,
      timeZone: 'UTC',
      wellbeing: tired ? 2 : 3 + (n % 3),
      bodyWeightKg: 80,
      isLightVersion: false,
      notes: '',
    };
    workouts.push(w);
    pw.status = 'done';
    pw.workoutId = w.id;
    slots.forEach((s, order) => {
      const we: WorkoutExercise = { ...ent(), workoutId: w.id, exerciseId: s.ex.id, order, plan: item(s) };
      wes.push(we);
      for (let k = 0; k < s.sets; k++) {
        const isTime = s.ex.trackingType === 'time';
        const reps = isTime ? null : Math.max(1, s.reps - (k === s.sets - 1 ? 1 : 0) - (tired ? 1 : 0));
        sets.push({
          ...ent(),
          workoutExerciseId: we.id,
          workoutId: w.id,
          order: k,
          setType: 'working',
          weightKg: s.ex.trackingType === 'weight_reps' ? s.weight : null,
          addedWeightKg: s.ex.trackingType === 'bodyweight_reps' ? 0 : null,
          reps,
          durationSec: isTime ? s.reps : null,
          rir: isTime ? null : k === s.sets - 1 ? 1 : 2,
          rpe: isTime ? null : k === s.sets - 1 ? 9 : 8,
          completed: true,
          completedAt: w.finishedAt,
        });
      }
      // прогрессия к следующей тренировке
      if (s.ex.trackingType === 'time') s.reps += 5;
      else if (s.reps >= s.repMax) {
        s.weight += s.ex.trackingType === 'weight_reps' ? s.ex.weightStepKg : 0;
        s.reps = s.repMin;
      } else s.reps += 1;
    });
  }

  await target.transaction('rw', [target.templates, target.workouts, target.workoutExercises, target.sets, target.plannedWorkouts, target.settings], async () => {
    await target.templates.bulkPut(templates);
    await target.workouts.bulkPut(workouts);
    await target.workoutExercises.bulkPut(wes);
    await target.sets.bulkPut(sets);
    await target.plannedWorkouts.bulkPut(planned);
    // В демо не напоминаем про бэкап и не показываем подсказку установки
    await target.settings.put({ ...DEFAULT_SETTINGS, bodyWeightKg: 80, lastBackupAt: T, installHintDismissed: true });
  });
}
