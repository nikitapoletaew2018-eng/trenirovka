import type { Table } from 'dexie';
import { db } from './db';

/**
 * «Отменить» для последних действий.
 *
 * Операция сначала собирает изменения в Recorder (чтения — обычные, вне транзакции),
 * затем withUndo применяет их в одной транзакции и запоминает прежнее состояние строк.
 * Тело транзакции — плоский цикл операций Dexie: так транзакция не закрывается раньше времени
 * (вложенные async-функции внутри транзакции IndexedDB ненадёжны).
 */
interface PendingWrite {
  table: string;
  id: string;
  /** undefined — удалить строку */
  row: unknown | undefined;
}

interface Change {
  table: string;
  id: string;
  before: unknown | undefined;
}

export interface UndoEntry {
  label: string;
  changes: Change[];
}

export class Recorder {
  readonly writes: PendingWrite[] = [];

  /** Текущее состояние строки с учётом уже записанных в этот Recorder изменений. */
  async get<T extends { id: string }>(table: Table<T, string>, id: string): Promise<T | undefined> {
    for (let i = this.writes.length - 1; i >= 0; i--) {
      const w = this.writes[i];
      if (w && w.table === table.name && w.id === id) return w.row as T | undefined;
    }
    return table.get(id);
  }

  put<T extends { id: string }>(table: Table<T, string>, row: T): void {
    this.writes.push({ table: table.name, id: row.id, row: structuredClone(row) });
  }

  async update<T extends { id: string }>(table: Table<T, string>, id: string, patch: Partial<T>): Promise<void> {
    const cur = await this.get(table, id);
    if (!cur) return;
    this.writes.push({ table: table.name, id, row: { ...structuredClone(cur), ...patch } });
  }

  delete<T extends { id: string }>(table: Table<T, string>, id: string): void {
    this.writes.push({ table: table.name, id, row: undefined });
  }
}

const MAX_UNDO = 20;
let stack: UndoEntry[] = [];
const listeners = new Set<() => void>();

export function subscribeUndo(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const l of listeners) l();
}

export function lastUndo(): UndoEntry | null {
  return stack[stack.length - 1] ?? null;
}

async function apply(writes: PendingWrite[]): Promise<Change[]> {
  const names = [...new Set(writes.map((w) => w.table))];
  const changes: Change[] = [];
  if (names.length === 0) return changes;
  await db.transaction('rw', names.map((n) => db.table(n)), async () => {
    for (const w of writes) {
      const t = db.table(w.table);
      const before: unknown = await t.get(w.id);
      changes.push({ table: w.table, id: w.id, before });
      if (w.row === undefined) await t.delete(w.id);
      else await t.put(w.row);
    }
  });
  return changes;
}

/** Собирает изменения через fn, применяет их атомарно и кладёт в стек отмены. */
export async function withUndo<R>(label: string, fn: (rec: Recorder) => Promise<R> | R): Promise<R> {
  const rec = new Recorder();
  const result = await fn(rec);
  const changes = await apply(rec.writes);
  if (changes.length > 0) {
    stack = [...stack.slice(-(MAX_UNDO - 1)), { label, changes }];
    emit();
  }
  return result;
}

export async function undoLast(): Promise<UndoEntry | null> {
  const entry = stack[stack.length - 1];
  if (!entry) return null;
  // Восстанавливаем в обратном порядке: для строки, менявшейся несколько раз, итог — самое раннее состояние.
  const reversed = [...entry.changes].reverse();
  const names = [...new Set(reversed.map((c) => c.table))];
  await db.transaction('rw', names.map((n) => db.table(n)), async () => {
    for (const c of reversed) {
      const t = db.table(c.table);
      if (c.before === undefined) await t.delete(c.id);
      else await t.put(c.before);
    }
  });
  stack = stack.slice(0, -1);
  emit();
  return entry;
}

export function clearUndo(): void {
  stack = [];
  emit();
}
