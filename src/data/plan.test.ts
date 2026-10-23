import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB, db, useDatabase } from './db';
import { uuid } from './ids';
import { copyWeek, mergeWithNext, movePlannedDate, newTemplate, planWorkout, plannedForWeek, reschedule, saveTemplate, skipPlanned } from './planRepo';
import { SEED_EXERCISES, ensureSeed } from './seed';
import { clearUndo, undoLast } from './undo';

beforeEach(() => {
  useDatabase(new AppDB(`plan-${uuid()}`));
  clearUndo();
});

describe('начальная база упражнений', () => {
  it('валидна, id уникальны, альтернативы ссылаются на существующие', () => {
    const ids = new Set(SEED_EXERCISES.map((e) => e.id));
    expect(ids.size).toBe(SEED_EXERCISES.length);
    expect(SEED_EXERCISES.length).toBeGreaterThanOrEqual(50);
    for (const e of SEED_EXERCISES) for (const a of e.lighterAlternatives) expect(ids.has(a)).toBe(true);
    // частые ошибки без проверки не помечены как проверенные
    expect(SEED_EXERCISES.every((e) => e.commonMistakes.every((m) => !m.verified))).toBe(true);
  });
  it('загружается один раз и не перезаписывает правки пользователя', async () => {
    await ensureSeed();
    const first = SEED_EXERCISES[0]!;
    await db.exercises.update(first.id, { defaultRestSec: 999 });
    await db.meta.delete('seedVersion');
    await ensureSeed();
    expect((await db.exercises.get(first.id))?.defaultRestSec).toBe(999);
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length);
  });
});

describe('план недели', () => {
  const MON = '2026-10-19';
  const NEXT = '2026-10-26';

  async function tpl() {
    const t = newTemplate('Верх');
    t.items = [{ exerciseId: 'x', order: 0, targetSets: 3, repMin: 6, repMax: 8, targetRir: 2 }];
    await saveTemplate(t);
    return t;
  }

  it('копирование недели меньше чем за минуту: одна операция', async () => {
    const t = await tpl();
    await planWorkout('2026-10-19', t);
    await planWorkout('2026-10-22', t);
    const n = await copyWeek(MON, NEXT);
    expect(n).toBe(2);
    const next = await plannedForWeek(NEXT);
    expect(next.map((p) => p.date)).toEqual(['2026-10-26', '2026-10-29']);
    expect(next.every((p) => p.status === 'planned' && p.plannedItems.length === 1)).toBe(true);
    await undoLast();
    expect(await plannedForWeek(NEXT)).toHaveLength(0);
  });

  it('перетаскивание меняет дату только у не начатой тренировки', async () => {
    const pw = await planWorkout('2026-10-20', null, 'Ноги');
    await movePlannedDate(pw.id, '2026-10-21');
    expect((await db.plannedWorkouts.get(pw.id))?.date).toBe('2026-10-21');
    await skipPlanned(pw.id);
    await movePlannedDate(pw.id, '2026-10-23');
    expect((await db.plannedWorkouts.get(pw.id))?.date).toBe('2026-10-21');
  });

  it('пропущенная: перенести — исходная «перенесена», копия на новой дате', async () => {
    const pw = await planWorkout('2026-10-20', null, 'Ноги');
    await reschedule(pw.id, '2026-10-24');
    const week = await plannedForWeek(MON);
    expect(week.find((p) => p.id === pw.id)).toMatchObject({ status: 'moved', movedTo: '2026-10-24' });
    expect(week.find((p) => p.date === '2026-10-24')).toMatchObject({ status: 'planned', name: 'Ноги' });
  });

  it('пропущенная: объединить со следующей', async () => {
    const t = await tpl();
    const a = await planWorkout('2026-10-20', t);
    const b = await planWorkout('2026-10-22', t);
    await mergeWithNext(a.id);
    expect((await db.plannedWorkouts.get(b.id))?.plannedItems).toHaveLength(2);
    expect((await db.plannedWorkouts.get(a.id))?.status).toBe('moved');
  });
});
