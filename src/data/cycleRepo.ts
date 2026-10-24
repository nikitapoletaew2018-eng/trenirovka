// Хранилище модуля «Цикл» (ТЗ, 6.4): только локально; модуль выключен по умолчанию;
// опционально — шифрование PIN-кодом; «удалить все данные цикла» — одной кнопкой, включая копии в памяти.
// Данные — один документ в таблице cycle: правка = перезапись документа (с «отменить»).

import type { CheckIn, CycleData, CycleSettings, ISODate, PeriodEntry } from '../domain/types';
import { PBKDF2_ITERATIONS, decryptJson, deriveKey, encryptJson, fromB64, randomBytes, toB64 } from './crypto';
import { db, type CycleRow } from './db';
import { nowIso, uuid } from './ids';
import { getSettings, updateSettings } from './settings';
import { clearUndo, subscribeUndo, withUndo } from './undo';

export type CycleState = { status: 'loading' } | { status: 'disabled' } | { status: 'locked' } | { status: 'ready'; data: CycleData };

export const EMPTY_CYCLE_SETTINGS: CycleSettings = { enabled: true, contraception: null, pregnancy: false, plannedLightDays: false, excludedExerciseIds: [] };

let state: CycleState = { status: 'loading' };
let key: { key: CryptoKey; salt: string; iterations: number } | null = null;
const listeners = new Set<() => void>();

function set(next: CycleState) {
  state = next;
  for (const l of listeners) l();
}

export function getCycleState(): CycleState {
  return state;
}

export function subscribeCycle(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// После «отменить» документ в базе мог вернуться к прежней версии — перечитываем.
subscribeUndo(() => {
  if (state.status === 'ready') void loadCycle();
});

function isCycleData(x: unknown): x is CycleData {
  return typeof x === 'object' && x !== null && 'settings' in x && 'periods' in x && 'checkIns' in x;
}

/** Прочитать состояние модуля из базы. Зашифрованные данные без ключа — «заблокировано». */
export async function loadCycle(): Promise<CycleState> {
  const s = await getSettings();
  if (!s.cycleEnabled) {
    set({ status: 'disabled' });
    return state;
  }
  const row = await db.cycle.get('data');
  if (row?.enc) {
    if (!key) {
      set({ status: 'locked' });
      return state;
    }
    try {
      const data = await decryptJson(key.key, row.enc.iv, row.enc.ct);
      if (!isCycleData(data)) throw new Error('bad');
      set({ status: 'ready', data });
    } catch {
      key = null;
      set({ status: 'locked' });
    }
    return state;
  }
  set({ status: 'ready', data: row?.plain ?? { settings: EMPTY_CYCLE_SETTINGS, periods: [], checkIns: [] } });
  return state;
}

async function rowFor(data: CycleData): Promise<CycleRow> {
  const t = nowIso();
  if (key) {
    const { iv, ct } = await encryptJson(key.key, data);
    // Время правки зашифрованного документа не храним: «изменено сегодня» рядом с отметкой косвенно выдаёт дату.
    return { id: 'data', plain: null, enc: { salt: key.salt, iv, ct, iterations: key.iterations }, updatedAt: '' };
  }
  return { id: 'data', plain: data, enc: null, updatedAt: t };
}

/** Явное включение модуля (ТЗ, 6.4: только по действию пользовательницы). */
export async function enableCycle(): Promise<void> {
  const existing = await db.cycle.get('data');
  if (!existing) await db.cycle.put(await rowFor({ settings: EMPTY_CYCLE_SETTINGS, periods: [], checkIns: [] }));
  await updateSettings({ cycleEnabled: true, cycleOfferDismissed: true });
  await loadCycle();
}

async function update(label: string, fn: (d: CycleData) => CycleData): Promise<void> {
  if (state.status !== 'ready') throw new Error('Модуль «Цикл» не готов');
  const next = fn(state.data);
  const row = await rowFor(next);
  await withUndo(label, (rec) => rec.put(db.cycle, row));
  set({ status: 'ready', data: next });
}

/** «Начались сегодня» / в выбранный день. Если такая же дата уже есть — ничего не делает. */
export async function markPeriodStart(date: ISODate): Promise<void> {
  await update('Отмечено начало', (d) => (d.periods.some((p) => p.startDate === date) ? d : { ...d, periods: [...d.periods, { id: uuid(), startDate: date, endDate: null }] }));
}

/** «Закончились»: закрывает последнюю менструацию, начавшуюся не позже даты. */
export async function markPeriodEnd(date: ISODate): Promise<void> {
  await update('Отмечено окончание', (d) => {
    const target = [...d.periods].filter((p) => p.startDate <= date).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
    if (!target) return d;
    return { ...d, periods: d.periods.map((p) => (p.id === target.id ? { ...p, endDate: date } : p)) };
  });
}

export async function updatePeriod(id: string, patch: Partial<Omit<PeriodEntry, 'id'>>): Promise<void> {
  await update('Запись изменена', (d) => ({ ...d, periods: d.periods.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
}

export async function deletePeriod(id: string): Promise<void> {
  await update('Запись удалена', (d) => ({ ...d, periods: d.periods.filter((p) => p.id !== id) }));
}

/** Чек-ин / симптомы дня: одна запись на дату, поля объединяются. */
export async function saveCheckIn(ci: Omit<CheckIn, 'id'>): Promise<void> {
  await update('Самочувствие сохранено', (d) => {
    const cur = d.checkIns.find((c) => c.date === ci.date);
    const merged: CheckIn = { ...(cur ?? { id: uuid(), date: ci.date }), ...Object.fromEntries(Object.entries(ci).filter(([, v]) => v !== undefined)) };
    return { ...d, checkIns: [...d.checkIns.filter((c) => c.date !== ci.date), merged] };
  });
}

export async function updateCycleSettings(patch: Partial<CycleSettings>): Promise<void> {
  await update('Настройки цикла изменены', (d) => ({ ...d, settings: { ...d.settings, ...patch } }));
}

// ——— PIN ———

export async function setCyclePin(pin: string): Promise<void> {
  if (state.status !== 'ready') throw new Error('Сначала откройте модуль');
  if (pin.length < 4) throw new Error('Не короче 4 символов');
  const salt = randomBytes(16);
  key = { key: await deriveKey(pin, salt), salt: toB64(salt), iterations: PBKDF2_ITERATIONS };
  await db.cycle.put(await rowFor(state.data));
  await updateSettings({ cyclePinEnabled: true });
  clearUndo(); // в стеке отмены могли остаться открытые копии
}

export async function removeCyclePin(): Promise<void> {
  if (state.status !== 'ready') throw new Error('Сначала откройте модуль');
  key = null;
  await db.cycle.put(await rowFor(state.data));
  await updateSettings({ cyclePinEnabled: false });
  clearUndo();
}

/** Разблокировать. Бросает ошибку «Неверный PIN». */
export async function unlockCycle(pin: string): Promise<void> {
  const row = await db.cycle.get('data');
  if (!row?.enc) return void (await loadCycle());
  const salt = fromB64(row.enc.salt);
  const k = await deriveKey(pin, salt, row.enc.iterations);
  try {
    const data = await decryptJson(k, row.enc.iv, row.enc.ct);
    if (!isCycleData(data)) throw new Error('bad');
    key = { key: k, salt: row.enc.salt, iterations: row.enc.iterations };
    set({ status: 'ready', data });
  } catch {
    throw new Error('Неверный PIN');
  }
}

export function lockCycle(): void {
  if (!key) return;
  key = null;
  clearUndo();
  set({ status: 'locked' });
}

/**
 * Удалить все данные цикла полностью: документ, флаги модуля, ключ и копии в памяти (стек «отменить»).
 * Тренировки и замеры не затрагиваются.
 */
export async function deleteAllCycleData(): Promise<void> {
  await db.cycle.clear();
  await updateSettings({ cycleEnabled: false, cyclePinEnabled: false });
  key = null;
  clearUndo();
  set({ status: 'disabled' });
}

// ——— Экспорт / импорт ———

export async function exportCycleRow(): Promise<CycleRow | null> {
  return (await db.cycle.get('data')) ?? null;
}

export async function importCycleRow(row: CycleRow): Promise<void> {
  await db.cycle.put(row);
  key = null;
  await updateSettings({ cycleEnabled: true, cyclePinEnabled: !!row.enc });
  await loadCycle();
}

/** Для тестов: сбросить состояние в памяти. */
export function resetCycleMemory(): void {
  key = null;
  state = { status: 'loading' };
}
