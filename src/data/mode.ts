// Режим запуска: реальные данные или демо. Без зависимостей — импортируется базой данных при старте.
// База выбирается один раз при загрузке приложения; переключение режима — только через перезагрузку.

export const REAL_DB_NAME = 'trenirovka';
export const DEMO_DB_NAME = 'trenirovka-demo';
const MODE_KEY = 'trenirovka:mode';

/** Включён ли демо-режим. Если хранилище недоступно — всегда реальные данные. */
export function isDemoMode(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MODE_KEY) === 'demo';
  } catch {
    return false;
  }
}

/** Можно ли включить демо (нужно localStorage для флага режима). */
export function demoAvailable(): boolean {
  try {
    localStorage.setItem(`${MODE_KEY}:probe`, '1');
    localStorage.removeItem(`${MODE_KEY}:probe`);
    return true;
  } catch {
    return false;
  }
}

export function databaseName(): string {
  return isDemoMode() ? DEMO_DB_NAME : REAL_DB_NAME;
}

export function setDemoMode(demo: boolean): void {
  try {
    if (demo) localStorage.setItem(MODE_KEY, 'demo');
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* без хранилища демо-режим недоступен */
  }
}
