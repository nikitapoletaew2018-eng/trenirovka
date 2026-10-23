import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { buildSessions } from '../domain/analysis';
import { addDays, weekStart } from '../domain/dates';
import { suggestionCandidates } from '../domain/progression';
import { weeklyReport } from '../domain/report';
import { AppDB } from './db';
import { DEMO_DB_NAME, REAL_DB_NAME, deleteDemo, fillDemo, isDemoMode } from './demo';
import { DEFAULT_SETTINGS } from './settings';

const TODAY = '2026-10-23';

describe('демо-режим', () => {
  it('без флага режима — реальная база', () => {
    expect(isDemoMode()).toBe(false);
  });

  it('генератор отказывается писать в реальную базу', async () => {
    const real = new AppDB(REAL_DB_NAME);
    await expect(fillDemo(real, TODAY)).rejects.toThrow(/только в демо-базу/);
    expect(await real.workouts.count()).toBe(0);
    real.close();
  });

  it('демо-данные пишутся только в демо-базу; реальная база не меняется; «Удалить демо» стирает только демо', async () => {
    const real = new AppDB(REAL_DB_NAME);
    await real.workouts.put({ id: 'mine', name: 'Моя', startedAt: '2026-10-01T10:00:00Z', finishedAt: '2026-10-01T11:00:00Z', timeZone: 'UTC', isLightVersion: false, createdAt: 'x', updatedAt: 'x' });

    const demo = new AppDB(DEMO_DB_NAME);
    await fillDemo(demo, TODAY);
    expect(await demo.workouts.count()).toBeGreaterThan(15);
    expect(await demo.workouts.get('mine')).toBeUndefined();
    // реальная база: только моя тренировка, ни одной демо-записи
    expect((await real.workouts.toArray()).map((w) => w.id)).toEqual(['mine']);
    expect(await real.templates.count()).toBe(0);

    await deleteDemo(demo);
    expect(await Dexie.exists(DEMO_DB_NAME)).toBe(false);
    expect(await real.workouts.get('mine')).toBeTruthy();
    real.close();
  });

  it('на демо-данных строятся отчёт и предложения по чередованию A/B', async () => {
    const demo = new AppDB(DEMO_DB_NAME);
    await fillDemo(demo, TODAY);
    const [workouts, wes, sets, exercises, planned] = await Promise.all([demo.workouts.toArray(), demo.workoutExercises.toArray(), demo.sets.toArray(), demo.exercises.toArray(), demo.plannedWorkouts.toArray()]);
    const sessions = buildSessions(workouts, wes, sets, exercises);
    const lastWeek = addDays(weekStart(TODAY), -7);
    const r = weeklyReport({ week: lastWeek, sessions, planned, exercises, settings: DEFAULT_SETTINGS, unit: 'kg' });
    expect(r.isEmpty).toBe(false);
    expect(r.planFact.sessions).toBe(3);
    expect(r.e1rm.length).toBeGreaterThan(0);
    // на этой неделе A и B, на следующей — тоже: кандидаты из обеих тренировок
    const cands = suggestionCandidates(planned, weekStart(TODAY));
    expect(cands.length).toBe(8);
    // тренировки этой недели после «сегодня» — только в плане
    expect(workouts.every((w) => w.startedAt.slice(0, 10) <= TODAY)).toBe(true);
    await deleteDemo(demo);
  });
});
