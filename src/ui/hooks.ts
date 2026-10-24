import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { localDate, userTimeZone } from "../domain/dates";
import type { Exercise, Settings } from "../domain/types";
import { db } from "../data/db";
import { DEFAULT_SETTINGS } from "../data/settings";
import { lastUndo, subscribeUndo } from "../data/undo";

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get("settings"), []);
  // Стабильная ссылка, пока настройки не изменились: объект стоит в зависимостях живых запросов.
  return useMemo(() => ({ ...DEFAULT_SETTINGS, ...s }), [s]);
}

export function useExercises(): Exercise[] | undefined {
  return useLiveQuery(
    async () => (await db.exercises.toArray()).filter((e) => !e.deletedAt),
    [],
  );
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

type VisibleArea = { top: number; height: number; keyboard: boolean };

function readVisibleArea(): VisibleArea {
  const v = window.visualViewport;
  if (!v) return { top: 0, height: window.innerHeight, keyboard: false };
  // На iPhone клавиатура не уменьшает окно, а перекрывает его: видимая часть — visualViewport.
  return {
    top: v.offsetTop,
    height: v.height,
    keyboard: window.innerHeight - v.height > 150,
  };
}

/** Видимая часть экрана (без экранной клавиатуры). */
export function useVisibleArea(): VisibleArea {
  const [area, setArea] = useState(readVisibleArea);
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const on = () => setArea(readVisibleArea());
    v.addEventListener("resize", on);
    v.addEventListener("scroll", on);
    return () => {
      v.removeEventListener("resize", on);
      v.removeEventListener("scroll", on);
    };
  }, []);
  return area;
}
