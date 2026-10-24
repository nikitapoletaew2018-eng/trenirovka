import { seriesOf } from '../domain/body';
import type { BodyMeasurement, BodyPhoto, ISODate, MeasurementType } from '../domain/types';
import { db } from './db';
import { nowIso, uuid } from './ids';
import { updateSettings } from './settings';
import { withUndo } from './undo';

export async function listMeasurements(): Promise<BodyMeasurement[]> {
  return (await db.measurements.toArray()).filter((m) => !m.deletedAt);
}

/**
 * Новый замер. Если это самый свежий вес тела — он же становится весом тела в настройках
 * (нужен для упражнений с собственным весом).
 */
export async function addMeasurement(date: ISODate, type: MeasurementType, value: number): Promise<void> {
  const t = nowIso();
  const row: BodyMeasurement = { id: uuid(), createdAt: t, updatedAt: t, deletedAt: null, date, type, value };
  await withUndo('Замер сохранён', (rec) => rec.put(db.measurements, row));
  if (type === 'weight') {
    const s = seriesOf(await listMeasurements(), 'weight');
    if (s[s.length - 1]?.date === date) await updateSettings({ bodyWeightKg: value });
  }
}

export async function deleteMeasurement(id: string): Promise<void> {
  await withUndo('Замер удалён', (rec) => rec.update(db.measurements, id, { deletedAt: nowIso() }));
}

export async function listPhotos(): Promise<BodyPhoto[]> {
  return (await db.photos.toArray()).filter((p) => !p.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}

export async function addPhoto(date: ISODate, blob: Blob, note?: string): Promise<void> {
  const t = nowIso();
  await db.photos.put({ id: uuid(), createdAt: t, updatedAt: t, deletedAt: null, date, mime: blob.type || 'image/jpeg', blob, note: note ?? '' });
}

/** Удаление фото: запись помечается удалённой, а само изображение стирается (фото — личные данные). */
export async function deletePhoto(id: string): Promise<void> {
  const p = await db.photos.get(id);
  if (!p) return;
  await db.photos.put({ ...p, deletedAt: nowIso(), blob: new Blob([], { type: p.mime }) });
}
