import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Exercise } from '../domain/types';
import { clearAllData, exportData, importData, parseExport, ImportError } from './backup';
import { AppDB, db, useDatabase } from './db';
import { uuid } from './ids';
import { getSettings, updateSettings } from './settings';
import { clearUndo, undoLast } from './undo';
import {
  addSet,
  exerciseSets,
  finishWorkout,
  getActiveWorkout,
  lastTimeSets,
  replaceExercise,
  startWorkout,
  toggleSetCompleted,
  updateSet,
  workoutExercises,
} from './workoutRepo';

function exercise(id: string, nameRu: string): Exercise {
  const t = '2026-01-01T00:00:00.000Z';
  return {
    id,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    nameRu,
    nameEn: nameRu,
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'front_delts'],
    equipment: ['barbell'],
    trackingType: 'weight_reps',
    isUnilateral: false,
    category: 'core',
    isStructural: false,
    equipmentType: 'free_weight',
    movementPattern: 'horizontal_push',
    lighterAlternatives: [],
    instructions: [],
    commonMistakes: [],
    defaultRestSec: 150,
    weightStepKg: 2.5,
    source: 'test',
    isCustom: false,
  };
}

const BENCH = 'ex-bench';
const PRESS = 'ex-press';

beforeEach(async () => {
  const fresh = new AppDB(`test-${uuid()}`);
  useDatabase(fresh);
  await fresh.exercises.bulkPut([exercise(BENCH, 'Жим лёжа'), exercise(PRESS, 'Жим гантелей')]);
  clearUndo();
});

async function doWorkout(weights: number[], reps: number) {
  const w = await startWorkout({ name: 'T', exerciseIds: [BENCH] });
  const [we] = await workoutExercises(w.id);
  if (!we) throw new Error('no we');
  for (let i = 1; i < weights.length; i++) await addSet(we.id);
  const sets = await exerciseSets(we.id);
  for (const [i, s] of sets.entries()) {
    await updateSet(s.id, { weightKg: weights[i] ?? 0, reps });
    await toggleSetCompleted(s.id);
  }
  await finishWorkout(w.id, { unfinished: 'delete' });
  return w;
}

describe('тренировка', () => {
  it('незавершённая тренировка восстанавливается после «перезапуска»', async () => {
    const w = await startWorkout({ name: 'Верх', exerciseIds: [BENCH] });
    const [we] = await workoutExercises(w.id);
    const [s] = await exerciseSets(we!.id);
    await updateSet(s!.id, { weightKg: 80, reps: 8 });
    await toggleSetCompleted(s!.id);

    // новое подключение к той же базе — как после закрытия приложения
    const reopened = new AppDB(db.name);
    useDatabase(reopened);
    const active = await getActiveWorkout();
    expect(active?.id).toBe(w.id);
    const [restored] = await exerciseSets(we!.id);
    expect(restored).toMatchObject({ weightKg: 80, reps: 8, completed: true });
    expect(await reopened.restTimer.get('current')).toBeTruthy();
  });

  it('«прошлый раз» и автозаполнение первого подхода', async () => {
    await doWorkout([80, 80, 80], 8);
    const last = await lastTimeSets(BENCH);
    expect(last?.sets.map((s) => s.weightKg)).toEqual([80, 80, 80]);

    const w2 = await startWorkout({ name: 'T2', exerciseIds: [BENCH] });
    const [we] = await workoutExercises(w2.id);
    const sets = await exerciseSets(we!.id);
    expect(sets).toHaveLength(3); // по числу рабочих подходов прошлого раза
    expect(sets.every((s) => s.weightKg === 80 && s.reps === 8 && s.autofilled)).toBe(true);
  });

  it('план на сегодня приоритетнее прошлого раза', async () => {
    await doWorkout([80], 8);
    const w = await startWorkout({
      name: 'План',
      items: [{ exerciseId: BENCH, sets: 2, repMin: 6, repMax: 8, targetRir: 2, suggestedWeightKg: 85 }],
    });
    const [we] = await workoutExercises(w.id);
    const sets = await exerciseSets(we!.id);
    expect(sets.map((s) => [s.weightKg, s.reps, s.rir])).toEqual([
      [85, 6, 2],
      [85, 6, 2],
    ]);
  });

  it('отметка подхода переносит значения в нетронутые следующие подходы', async () => {
    const w = await startWorkout({
      name: 'План',
      items: [{ exerciseId: BENCH, sets: 3, repMin: 6, repMax: 8, suggestedWeightKg: 80 }],
    });
    const [we] = await workoutExercises(w.id);
    const [a, b, c] = await exerciseSets(we!.id);
    await updateSet(c!.id, { weightKg: 70 }); // третий правили вручную
    await updateSet(a!.id, { weightKg: 82.5, reps: 7 });
    const rest = await toggleSetCompleted(a!.id);
    expect(rest).toBe(150); // отдых упражнения по умолчанию
    const after = await exerciseSets(we!.id);
    expect(after.find((s) => s.id === b!.id)).toMatchObject({ weightKg: 82.5, reps: 7 });
    expect(after.find((s) => s.id === c!.id)?.weightKg).toBe(70);
  });

  it('«отменить» возвращает подход в прежнее состояние', async () => {
    const w = await startWorkout({ name: 'T', exerciseIds: [BENCH] });
    const [we] = await workoutExercises(w.id);
    const [s] = await exerciseSets(we!.id);
    await updateSet(s!.id, { weightKg: 100, reps: 5 });
    await toggleSetCompleted(s!.id);
    await undoLast();
    expect((await db.sets.get(s!.id))?.completed).toBe(false);
    expect(await db.restTimer.get('current')).toBeUndefined();
    await undoLast();
    expect((await db.sets.get(s!.id))?.weightKg ?? null).toBeNull();
  });

  it('завершение: невыполненные удаляются, статус плана partial, связь с тренировкой', async () => {
    const pwId = uuid();
    const t = '2026-10-23T00:00:00.000Z';
    await db.plannedWorkouts.put({
      id: pwId,
      createdAt: t,
      updatedAt: t,
      date: '2026-10-23',
      name: 'Верх',
      plannedItems: [{ exerciseId: BENCH, sets: 3, repMin: 6, repMax: 8 }],
      status: 'planned',
    });
    const w = await startWorkout({
      name: 'Верх',
      plannedWorkoutId: pwId,
      items: [{ exerciseId: BENCH, sets: 3, repMin: 6, repMax: 8, suggestedWeightKg: 80 }],
    });
    const [we] = await workoutExercises(w.id);
    const [s] = await exerciseSets(we!.id);
    await toggleSetCompleted(s!.id);
    await finishWorkout(w.id, { unfinished: 'delete', wellbeing: 4 });
    expect(await exerciseSets(we!.id)).toHaveLength(1);
    const pw = await db.plannedWorkouts.get(pwId);
    expect(pw).toMatchObject({ status: 'partial', workoutId: w.id });
    expect((await db.workouts.get(w.id))?.wellbeing).toBe(4);
    expect(await getActiveWorkout()).toBeNull();
  });

  it('замена упражнения сохраняет выполненные подходы и запоминает исходное', async () => {
    const w = await startWorkout({ name: 'T', exerciseIds: [BENCH] });
    const [we] = await workoutExercises(w.id);
    const [s] = await exerciseSets(we!.id);
    await updateSet(s!.id, { weightKg: 60, reps: 10 });
    await toggleSetCompleted(s!.id);
    await addSet(we!.id);
    await replaceExercise(we!.id, PRESS);
    const after = await db.workoutExercises.get(we!.id);
    expect(after).toMatchObject({ exerciseId: PRESS, replacedFromExerciseId: BENCH });
    const sets = await exerciseSets(we!.id);
    expect(sets[0]).toMatchObject({ weightKg: 60, completed: true });
  });
});

describe('экспорт / импорт', () => {
  it('экспорт → очистка → импорт дают идентичные данные', async () => {
    await doWorkout([100, 100], 5);
    await updateSettings({ unit: 'lb' });
    const w = await startWorkout({ name: 'Удалю', exerciseIds: [BENCH] });
    const [we] = await workoutExercises(w.id);
    const [s] = await exerciseSets(we!.id);
    await updateSet(s!.id, { weightKg: 50 });
    await db.sets.update(s!.id, { deletedAt: '2026-10-23T00:00:00.000Z' }); // мягко удалённый тоже сохраняется

    const before = await exportData();
    const json = JSON.parse(JSON.stringify(before)) as unknown;
    await clearAllData();
    expect(await db.workouts.count()).toBe(0);
    await importData(parseExport(json));
    const after = await exportData();
    expect(after.tables).toEqual(before.tables);
  });

  it('смена единиц не меняет сохранённые значения', async () => {
    await doWorkout([82.5], 5);
    const snapshot = await db.sets.toArray();
    await updateSettings({ unit: 'lb' });
    await updateSettings({ unit: 'kg' });
    expect(await db.sets.toArray()).toEqual(snapshot);
    expect((await getSettings()).unit).toBe('kg');
  });

  it('отклоняет чужой или повреждённый файл', () => {
    expect(() => parseExport({ foo: 1 })).toThrow(ImportError);
    expect(() => parseExport({ app: 'trenirovka', schemaVersion: 99, tables: {} })).toThrow(/новой версией/);
    expect(() => parseExport({ app: 'trenirovka', schemaVersion: 1, tables: { sets: [{ x: 1 }] } })).toThrow(/без id/);
  });
});
