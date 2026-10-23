import { DATA_TABLES, SCHEMA_VERSION, db, type DataTable } from './db';
import { nowIso } from './ids';
import { isDemoMode } from './mode';

export const EXPORT_APP_ID = 'trenirovka';

export interface ExportFile {
  app: typeof EXPORT_APP_ID;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<DataTable, unknown[]>;
}

/**
 * Полный экспорт, включая мягко удалённые записи — чтобы экспорт → очистка → импорт
 * давали идентичные данные. Таймер отдыха (временное состояние) не экспортируется.
 * Данные модуля «Цикл» (этап 3) будут включаться только отдельной галочкой.
 */
export async function exportData(): Promise<ExportFile> {
  const tables = {} as Record<DataTable, unknown[]>;
  await db.transaction('r', DATA_TABLES.map((t) => db.table(t)), async () => {
    for (const t of DATA_TABLES) tables[t] = await db.table(t).toArray();
  });
  return { app: EXPORT_APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(), tables };
}

export class ImportError extends Error {}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Миграции формата экспорта: exportMigrations[n] переводит файл версии n в n + 1.
 * Каждый шаг — чистая функция над таблицами файла.
 */
const exportMigrations: Record<number, (tables: Record<string, unknown[]>) => Record<string, unknown[]>> = {
  // 1 → 2: появилась таблица программ
  1: (t) => ({ ...t, programs: t.programs ?? [] }),
};

export function parseExport(raw: unknown): ExportFile {
  if (!isRecord(raw) || raw.app !== EXPORT_APP_ID) throw new ImportError('Это не файл экспорта приложения «Тренировка».');
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new ImportError('В файле нет корректной версии схемы.');
  if (version > SCHEMA_VERSION)
    throw new ImportError(`Файл создан более новой версией приложения (схема ${version}). Обновите приложение.`);
  if (!isRecord(raw.tables)) throw new ImportError('В файле нет таблиц с данными.');

  let tables: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(raw.tables)) {
    if (!Array.isArray(v)) throw new ImportError(`Таблица «${k}» повреждена.`);
    tables[k] = v;
  }
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const m = exportMigrations[v];
    if (!m) throw new ImportError(`Нет миграции со схемы ${v}.`);
    tables = m(tables);
  }

  const out = {} as Record<DataTable, unknown[]>;
  for (const t of DATA_TABLES) {
    const rows = tables[t] ?? [];
    for (const r of rows) {
      if (!isRecord(r) || typeof r.id !== 'string') throw new ImportError(`В таблице «${t}» есть запись без id.`);
    }
    out[t] = rows;
  }
  return {
    app: EXPORT_APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : nowIso(),
    tables: out,
  };
}

/** Импорт с полной заменой текущих данных (в одной транзакции: либо всё, либо ничего). */
export async function importData(file: ExportFile): Promise<void> {
  const all = [...DATA_TABLES.map((t) => db.table(t)), db.restTimer];
  await db.transaction('rw', all, async () => {
    await db.restTimer.clear();
    for (const t of DATA_TABLES) {
      await db.table(t).clear();
      await db.table(t).bulkPut(file.tables[t]);
    }
  });
}

/** Полная очистка пользовательских данных. */
export async function clearAllData(): Promise<void> {
  const all = [...DATA_TABLES.map((t) => db.table(t)), db.restTimer, db.meta];
  await db.transaction('rw', all, async () => {
    for (const t of all) await t.clear();
  });
}

export function exportFileName(d = new Date(), demo = isDemoMode()): string {
  return `trenirovka-${demo ? 'DEMO-' : ''}backup-${d.toISOString().slice(0, 10)}.json`;
}
