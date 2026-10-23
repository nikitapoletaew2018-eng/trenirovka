import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseExport } from './backup';
import { AppDB, SCHEMA_VERSION, db, useDatabase } from './db';
import { uuid } from './ids';
import { newTemplate, plannedForWeek, planWorkout, saveTemplate } from './planRepo';
import {
  addBuiltInProgram,
  applyProgram,
  applySuggestions,
  deloadWeeks,
  isDeloadWeek,
  listPrograms,
  makeWeekDeload,
  newProgram,
  saveProgram,
} from './programRepo';
import { ensureSeed } from './seed';
import { clearUndo, undoLast } from './undo';
import { addWarmupSets, exerciseSets, startWorkout, workoutExercises } from './workoutRepo';

const DELOAD = { setsFactor: 0.5, weightFactor: 1, minRir: 3 };
const MON = '2026-10-26';

beforeEach(async () => {
  useDatabase(new AppDB(`s2-${uuid()}`));
  clearUndo();
  await ensureSeed();
});

async function template(name: string) {
  const t = newTemplate(name);
  t.items = [{ exerciseId: 'x', order: 0, targetSets: 4, repMin: 6, repMax: 8, targetRir: 2 }];
  await saveTemplate(t);
  return t;
}

describe('мезоцикл', () => {
  it('разгрузочные недели: по расписанию и последняя', () => {
    expect(deloadWeeks({ weeks: 6, deloadEveryNWeeks: null, lastWeekDeload: true })).toEqual([6]);
    expect(deloadWeeks({ weeks: 8, deloadEveryNWeeks: 4, lastWeekDeload: false })).toEqual([4, 8]);
    expect(deloadWeeks({ weeks: 5, deloadEveryNWeeks: null, lastWeekDeload: false })).toEqual([]);
  });

  it('«Спланировать на N недель»: все недели, последняя — облегчённая', async () => {
    const t = await template('Верх');
    const p = { ...newProgram('Тест'), weeks: 4, lastWeekDeload: true, days: [{ weekday: 0, templateId: t.id }, { weekday: 3, templateId: t.id }] };
    await saveProgram(p);
    const n = await applyProgram(p, MON, DELOAD);
    expect(n).toBe(8);
    const w1 = await plannedForWeek(MON);
    expect(w1.map((x) => x.date)).toEqual(['2026-10-26', '2026-10-29']);
    expect(w1[0]!.plannedItems[0]).toMatchObject({ sets: 4, targetRir: 2 });
    const w4 = await plannedForWeek('2026-11-16');
    expect(w4[0]!.plannedItems[0]).toMatchObject({ sets: 2, targetRir: 3 });
    expect(w4[0]!.name).toContain('разгрузка');
    expect(await isDeloadWeek('2026-11-16')).toBe(true);
    expect(await isDeloadWeek(MON)).toBe(false);
    await undoLast();
    expect(await plannedForWeek(MON)).toHaveLength(0);
  });

  it('разгрузка недели вручную меняет только незапущенные тренировки и отменяется', async () => {
    const t = await template('Ноги');
    await planWorkout(MON, t);
    await makeWeekDeload(MON, { ...DELOAD, weightFactor: 0.9 });
    const [pw] = await plannedForWeek(MON);
    expect(pw!.plannedItems[0]).toMatchObject({ sets: 2, targetRir: 3 });
    expect(await isDeloadWeek(MON)).toBe(true);
    await undoLast();
    expect((await plannedForWeek(MON))[0]!.plannedItems[0]!.sets).toBe(4);
  });
});

describe('план на следующую неделю', () => {
  it('принятые предложения меняют вес и цель, без подтверждения план не меняется', async () => {
    const t = await template('Верх');
    await planWorkout(MON, t);
    const before = (await plannedForWeek(MON))[0]!.plannedItems[0];
    // Ничего не принято — план тот же
    expect(await applySuggestions(MON, [])).toBe(0);
    expect((await plannedForWeek(MON))[0]!.plannedItems[0]).toEqual(before);
    const n = await applySuggestions(MON, [{ exerciseId: 'x', item: { ...before!, suggestedWeightKg: 82.5, targetReps: 6, reason: 'Двойная прогрессия' } }]);
    expect(n).toBe(1);
    expect((await plannedForWeek(MON))[0]!.plannedItems[0]).toMatchObject({ sets: 4, suggestedWeightKg: 82.5, targetReps: 6, reason: 'Двойная прогрессия' });
  });

  it('цель «+1 повтор» подставляется в первый подход тренировки', async () => {
    const ex = (await db.exercises.toArray())[0]!;
    const w = await startWorkout({ name: 'T', items: [{ exerciseId: ex.id, sets: 2, repMin: 8, repMax: 12, targetReps: 10, suggestedWeightKg: 50 }] });
    const [we] = await workoutExercises(w.id);
    expect((await exerciseSets(we!.id)).map((s) => s.reps)).toEqual([10, 10]);
  });
});

describe('готовые программы', () => {
  it('создают шаблоны из базы и программу с источником', async () => {
    const id = await addBuiltInProgram('upperlower4');
    const [p] = await listPrograms();
    expect(p?.id).toBe(id);
    expect(p?.days).toHaveLength(4);
    expect(p?.source).toContain('ACSM');
    const templates = (await db.templates.toArray()).filter((t) => !t.deletedAt);
    expect(templates).toHaveLength(2);
    expect(templates.every((t) => t.items.length >= 5)).toBe(true);
  });
});

describe('разминка в тренировке', () => {
  it('разминочные подходы добавляются перед рабочими', async () => {
    const ex = (await db.exercises.toArray())[0]!;
    const w = await startWorkout({ name: 'T', items: [{ exerciseId: ex.id, sets: 1, repMin: 5, repMax: 5, suggestedWeightKg: 100 }] });
    const [we] = await workoutExercises(w.id);
    await addWarmupSets(we!.id, [{ weightKg: 40, reps: 8 }, { weightKg: 60, reps: 5 }]);
    const sets = await exerciseSets(we!.id);
    expect(sets.map((s) => [s.setType, s.weightKg])).toEqual([
      ['warmup', 40],
      ['warmup', 60],
      ['working', 100],
    ]);
  });
});

describe('миграции схемы', () => {
  it('база версии 1 открывается как версия 2 без потери данных', async () => {
    const name = `mig-${uuid()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ exercises: 'id', templates: 'id', weekPlans: 'id, weekStart', plannedWorkouts: 'id, date', workouts: 'id, startedAt', workoutExercises: 'id, workoutId', sets: 'id, workoutId', restTimer: 'id', settings: 'id', meta: 'key' });
    await v1.table('workouts').put({ id: 'w1', startedAt: '2026-10-01T10:00:00Z' });
    v1.close();
    const v2 = new AppDB(name);
    expect(await v2.workouts.get('w1')).toBeTruthy();
    expect(await v2.programs.count()).toBe(0);
    expect(v2.verno).toBe(2);
  });

  it('файл экспорта версии 1 импортируется с миграцией', () => {
    const f = parseExport({ app: 'trenirovka', schemaVersion: 1, exportedAt: 'x', tables: { workouts: [{ id: 'w1' }] } });
    expect(f.schemaVersion).toBe(SCHEMA_VERSION);
    expect(f.tables.programs).toEqual([]);
    expect(f.tables.workouts).toEqual([{ id: 'w1' }]);
  });
});
