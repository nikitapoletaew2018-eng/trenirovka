import { DATA_TABLES, SCHEMA_VERSION, db, type CycleRow, type DataTable } from './db';
import { nowIso } from './ids';
import { isDemoMode } from './mode';

export const EXPORT_APP_ID = 'trenirovka';

export interface ExportedPhoto {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  date: string;
  mime: string;
  note?: string;
  /** Фото в base64 */
  data: string;
}

export interface ExportFile {
  app: typeof EXPORT_APP_ID;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<DataTable, unknown[]>;
  /** Данные модуля «Цикл» — только если при экспорте отмечена отдельная галочка (ТЗ, 6.4) */
  cycle?: CycleRow | null;
  /** Фото замеров — только по отдельной галочке (файл может стать большим) */
  photos?: ExportedPhoto[] | null;
}

export interface ExportOptions {
  includeCycle?: boolean;
  includePhotos?: boolean;
}

async function blobToB64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: mime });
}

/**
 * Полный экспорт, включая мягко удалённые записи — чтобы экспорт → очистка → импорт давали идентичные данные.
 * Таймер отдыха (временное состояние) не экспортируется. Данные цикла и фото — только по отдельным галочкам;
 * без галочки «цикл» в файле нет ни документа цикла, ни признаков того, что модуль включён.
 */
export async function exportData(opts: ExportOptions = {}): Promise<ExportFile> {
  const tables = {} as Record<DataTable, unknown[]>;
  await db.transaction('r', DATA_TABLES.map((t) => db.table(t)), async () => {
    for (const t of DATA_TABLES) tables[t] = await db.table(t).toArray();
  });
  const file: ExportFile = { app: EXPORT_APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(), tables };
  if (opts.includeCycle) file.cycle = (await db.cycle.get('data')) ?? null;
  else
    tables.settings = tables.settings.map((s) =>
      typeof s === 'object' && s !== null ? { ...s, cycleEnabled: false, cyclePinEnabled: false } : s,
    );
  if (opts.includePhotos) {
    const photos = await db.photos.toArray();
    file.photos = await Promise.all(
      photos.map(async ({ blob, ...p }) => ({ ...p, data: await blobToB64(blob) })),
    );
  }
  return file;
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
  // 2 → 3: замеры тела
  2: (t) => ({ ...t, measurements: t.measurements ?? [] }),
};

function parseCycle(x: unknown): CycleRow | null {
  if (x == null) return null;
  if (!isRecord(x) || x.id !== 'data' || (x.plain == null && x.enc == null)) throw new ImportError('Данные цикла в файле повреждены.');
  return x as unknown as CycleRow;
}

function parsePhotos(x: unknown): ExportedPhoto[] | null {
  if (x == null) return null;
  if (!Array.isArray(x)) throw new ImportError('Фото в файле повреждены.');
  for (const p of x) if (!isRecord(p) || typeof p.id !== 'string' || typeof p.data !== 'string' || typeof p.mime !== 'string') throw new ImportError('Фото в файле повреждены.');
  return x as ExportedPhoto[];
}

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
    cycle: parseCycle(raw.cycle),
    photos: parsePhotos(raw.photos),
  };
}

/**
 * Импорт с полной заменой текущих данных (в одной транзакции: либо всё, либо ничего).
 * Если в файле нет данных цикла — локальные данные цикла не трогаются и модуль остаётся в прежнем состоянии.
 * Если нет фото — локальные фото остаются.
 */
export async function importData(file: ExportFile): Promise<void> {
  const all = [...DATA_TABLES.map((t) => db.table(t)), db.restTimer, db.cycle, db.photos];
  const before = await db.settings.get('settings');
  await db.transaction('rw', all, async () => {
    await db.restTimer.clear();
    for (const t of DATA_TABLES) {
      await db.table(t).clear();
      await db.table(t).bulkPut(file.tables[t]);
    }
    if (file.cycle) await db.cycle.put(file.cycle);
    const s = await db.settings.get('settings');
    if (s) {
      const cycle = file.cycle
        ? { cycleEnabled: true, cyclePinEnabled: !!file.cycle.enc }
        : { cycleEnabled: before?.cycleEnabled ?? false, cyclePinEnabled: before?.cyclePinEnabled ?? false };
      await db.settings.put({ ...s, ...cycle });
    }
    if (file.photos) {
      await db.photos.clear();
      await db.photos.bulkPut(file.photos.map(({ data, ...p }) => ({ ...p, blob: b64ToBlob(data, p.mime) })));
    }
  });
}

/** Полная очистка пользовательских данных, включая данные цикла, замеры и фото. */
export async function clearAllData(): Promise<void> {
  const all = [...DATA_TABLES.map((t) => db.table(t)), db.restTimer, db.meta, db.cycle, db.photos];
  await db.transaction('rw', all, async () => {
    for (const t of all) await t.clear();
  });
}

export function exportFileName(d = new Date(), demo = isDemoMode()): string {
  return `trenirovka-${demo ? 'DEMO-' : ''}backup-${d.toISOString().slice(0, 10)}.json`;
}
