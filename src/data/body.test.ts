import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addMeasurement, addPhoto, deletePhoto, listMeasurements, listPhotos } from './bodyRepo';
import { AppDB, db, useDatabase } from './db';
import { uuid } from './ids';
import { getSettings } from './settings';
import { clearAllData, exportData, importData, parseExport } from './backup';

beforeEach(() => useDatabase(new AppDB(`body-${uuid()}`)));

describe('замеры тела', () => {
  it('самый свежий вес становится весом тела в настройках; более старый — нет', async () => {
    await addMeasurement('2026-10-20', 'weight', 80);
    expect((await getSettings()).bodyWeightKg).toBe(80);
    await addMeasurement('2026-10-10', 'weight', 85); // задним числом
    expect((await getSettings()).bodyWeightKg).toBe(80);
    await addMeasurement('2026-10-20', 'waist', 72);
    expect(await listMeasurements()).toHaveLength(3);
  });
  it('удаление фото стирает изображение', async () => {
    await addPhoto('2026-10-20', new Blob(['jpegdata'], { type: 'image/jpeg' }));
    const [p] = await listPhotos();
    await deletePhoto(p!.id);
    expect(await listPhotos()).toEqual([]);
    expect((await db.photos.get(p!.id))?.blob.size).toBe(0);
  });
  it('замеры — в экспорте; фото — только по галочке; экспорт → очистка → импорт', async () => {
    await addMeasurement('2026-10-20', 'weight', 80);
    await addPhoto('2026-10-20', new Blob(['img'], { type: 'image/png' }));
    expect((await exportData()).photos).toBeUndefined();
    const f = parseExport(JSON.parse(JSON.stringify(await exportData({ includePhotos: true }))) as unknown);
    expect(f.tables.measurements).toHaveLength(1);
    expect(f.photos).toHaveLength(1);
    await clearAllData();
    await importData(f);
    expect(await listMeasurements()).toHaveLength(1);
    const [ph] = await listPhotos();
    expect(await ph!.blob.text()).toBe('img');
  });
});
