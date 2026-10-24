import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, exportData, importData, parseExport } from './backup';
import { decryptJson, deriveKey, encryptJson, randomBytes } from './crypto';
import {
  deleteAllCycleData,
  enableCycle,
  getCycleState,
  loadCycle,
  lockCycle,
  markPeriodEnd,
  markPeriodStart,
  removeCyclePin,
  resetCycleMemory,
  saveCheckIn,
  setCyclePin,
  unlockCycle,
  updateCycleSettings,
} from './cycleRepo';
import { AppDB, db, useDatabase } from './db';
import { uuid } from './ids';
import { getSettings } from './settings';
import { clearUndo, lastUndo, undoLast } from './undo';
import { startWorkout, workoutExercises, exerciseSets } from './workoutRepo';
import { ensureSeed } from './seed';

beforeEach(async () => {
  useDatabase(new AppDB(`cyc-${uuid()}`));
  resetCycleMemory();
  clearUndo();
  await ensureSeed();
});

const ready = () => {
  const s = getCycleState();
  if (s.status !== 'ready') throw new Error(`state ${s.status}`);
  return s.data;
};

describe('модуль «Цикл»: включение и учёт', () => {
  it('выключен по умолчанию', async () => {
    expect((await getSettings()).cycleEnabled).toBe(false);
    expect((await loadCycle()).status).toBe('disabled');
    expect(await db.cycle.count()).toBe(0);
  });

  it('включается только явно; отметки начала/конца, симптомы, отмена', async () => {
    await enableCycle();
    await markPeriodStart('2026-10-01');
    await markPeriodStart('2026-10-01'); // повтор — без дубля
    await markPeriodEnd('2026-10-05');
    await saveCheckIn({ date: '2026-10-02', pain: 2 });
    await saveCheckIn({ date: '2026-10-02', energy: 3 }); // объединяется
    const d = ready();
    expect(d.periods).toEqual([expect.objectContaining({ startDate: '2026-10-01', endDate: '2026-10-05' })]);
    expect(d.checkIns).toEqual([expect.objectContaining({ date: '2026-10-02', pain: 2, energy: 3 })]);
    await undoLast();
    await new Promise((r) => setTimeout(r, 20));
    expect(ready().checkIns[0]?.energy ?? null).toBeNull();
  });
});

describe('без чек-ина нагрузка не снижается', () => {
  it('модуль включён, сегодня менструация — тренировка по плану стартует без изменений', async () => {
    await enableCycle();
    await markPeriodStart('2026-10-23');
    await updateCycleSettings({ plannedLightDays: true });
    const ex = (await db.exercises.toArray())[0]!;
    const w = await startWorkout({ name: 'T', items: [{ exerciseId: ex.id, sets: 4, repMin: 6, repMax: 8, targetRir: 2, suggestedWeightKg: 50 }] });
    const [we] = await workoutExercises(w.id);
    expect(we?.plan).toMatchObject({ sets: 4, targetRir: 2, suggestedWeightKg: 50 });
    expect(await exerciseSets(we!.id)).toHaveLength(4);
    expect(w.isLightVersion).toBe(false);
  });
});

describe('PIN и шифрование', () => {
  it('шифрование AES-GCM: верный ключ расшифровывает, неверный — нет', async () => {
    const salt = randomBytes(16);
    const k = await deriveKey('1234', salt, 1000);
    const bad = await deriveKey('0000', salt, 1000);
    const e = await encryptJson(k, { a: 1 });
    expect(await decryptJson(k, e.iv, e.ct)).toEqual({ a: 1 });
    await expect(decryptJson(bad, e.iv, e.ct)).rejects.toBeTruthy();
  });

  it('с PIN в базе нет открытых данных; блокировка, разблокировка, неверный PIN, снятие PIN', async () => {
    await enableCycle();
    await markPeriodStart('2026-10-01');
    await setCyclePin('2468');
    const row = await db.cycle.get('data');
    expect(row?.plain).toBeNull();
    expect(row?.enc?.ct).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain('2026-10-01');
    expect(lastUndo()).toBeNull(); // открытые копии в стеке отмены стёрты

    lockCycle();
    expect(getCycleState().status).toBe('locked');
    resetCycleMemory();
    expect((await loadCycle()).status).toBe('locked');
    await expect(unlockCycle('1111')).rejects.toThrow('Неверный PIN');
    await unlockCycle('2468');
    expect(ready().periods[0]?.startDate).toBe('2026-10-01');

    // правки при включённом PIN тоже шифруются
    await markPeriodEnd('2026-10-04');
    expect(JSON.stringify(await db.cycle.get('data'))).not.toContain('2026-10-04');

    await removeCyclePin();
    expect((await db.cycle.get('data'))?.plain?.periods[0]?.endDate).toBe('2026-10-04');
    expect((await getSettings()).cyclePinEnabled).toBe(false);
  }, 30_000);
});

describe('экспорт и удаление', () => {
  it('по умолчанию данные цикла не входят в экспорт — ни документ, ни флаги модуля', async () => {
    await enableCycle();
    await markPeriodStart('2026-10-01');
    const f = await exportData();
    expect(f.cycle).toBeUndefined();
    const json = JSON.stringify(f);
    expect(json).not.toContain('2026-10-01');
    expect(f.tables.settings[0]).toMatchObject({ cycleEnabled: false, cyclePinEnabled: false });
  });

  it('с галочкой — входят; экспорт → очистка → импорт возвращают данные цикла', async () => {
    await enableCycle();
    await markPeriodStart('2026-10-01');
    const f = parseExport(JSON.parse(JSON.stringify(await exportData({ includeCycle: true }))) as unknown);
    expect(f.cycle?.plain?.periods).toHaveLength(1);
    await clearAllData();
    expect(await db.cycle.count()).toBe(0);
    await importData(f);
    resetCycleMemory();
    expect((await loadCycle()).status).toBe('ready');
    expect(ready().periods[0]?.startDate).toBe('2026-10-01');
  });

  it('импорт файла без цикла не трогает локальные данные цикла', async () => {
    await enableCycle();
    await markPeriodStart('2026-10-01');
    const f = parseExport(JSON.parse(JSON.stringify(await exportData())) as unknown);
    await importData(f);
    resetCycleMemory();
    expect((await loadCycle()).status).toBe('ready');
    expect(ready().periods).toHaveLength(1);
  });

  it('«Удалить все данные цикла» удаляет всё: документ, флаги, ключ, копии в памяти', async () => {
    await enableCycle();
    await markPeriodStart('2026-10-01');
    await setCyclePin('2468');
    await markPeriodEnd('2026-10-03');
    await deleteAllCycleData();
    expect(await db.cycle.count()).toBe(0);
    expect(await getSettings()).toMatchObject({ cycleEnabled: false, cyclePinEnabled: false });
    expect(getCycleState().status).toBe('disabled');
    expect(lastUndo()).toBeNull();
    // повторное включение — с чистого листа
    await enableCycle();
    expect(ready().periods).toEqual([]);
  }, 30_000);
});
