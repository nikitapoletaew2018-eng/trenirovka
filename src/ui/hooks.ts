import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { localDate, userTimeZone } from '../domain/dates';
import type { Exercise, Settings } from '../domain/types';
import { db } from '../data/db';
import { DEFAULT_SETTINGS } from '../data/settings';
import { lastUndo, subscribeUndo } from '../data/undo';

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('settings'), []);
  return { ...DEFAULT_SETTINGS, ...s };
}

export function useExercises(): Exercise[] | undefined {
  return useLiveQuery(async () => (await db.exercises.toArray()).filter((e) => !e.deletedAt), []);
}

export function useExerciseMap(): Map<string, Exercise> {
  const list = useLiveQuery(() => db.exercises.toArray(), []);
  return new Map((list ?? []).map((e) => [e.id, e]));
}

/** Текущее время, обновляется с заданным интервалом (для таймеров). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function today(): string {
  return localDate(new Date().toISOString(), userTimeZone());
}

export function useUndoEntry() {
  return useSyncExternalStore(subscribeUndo, lastUndo, lastUndo);
}
