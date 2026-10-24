import { EQUIPMENT, EQUIPMENT_TYPES, MUSCLES, PATTERNS, TRACKING } from '../domain/muscles';
import type { CommonMistake, Exercise } from '../domain/types';
import { db, type AppDB } from './db';
import raw from './seed/exercises.json';

/**
 * Версия начальной базы упражнений. При увеличении новые упражнения добавляются,
 * существующие не перезаписываются (пользователь мог изменить отдых, шаг, избранное).
 */
export const SEED_VERSION = 3;

const isStr = (x: unknown): x is string => typeof x === 'string';
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const inKeys = <T extends string>(rec: Record<T, unknown>, x: unknown): x is T => isStr(x) && x in rec;

function isMistake(x: unknown): x is CommonMistake {
  return typeof x === 'object' && x !== null && 'text' in x && 'verified' in x && isStr(x.text) && typeof x.verified === 'boolean';
}

/** Проверка формы JSON при сборке приложения: ловим ошибки seed-файла, а не падаем в интерфейсе. */
export function parseSeed(data: unknown): Exercise[] {
  if (!Array.isArray(data)) throw new Error('seed: ожидался массив');
  return data.map((r: unknown, i) => {
    if (typeof r !== 'object' || r === null) throw new Error(`seed[${i}]: не объект`);
    const e = r as Record<string, unknown>;
    const ok =
      isStr(e.id) &&
      isStr(e.nameRu) &&
      isStr(e.nameEn) &&
      Array.isArray(e.primaryMuscles) &&
      e.primaryMuscles.every((m) => inKeys(MUSCLES, m)) &&
      Array.isArray(e.secondaryMuscles) &&
      e.secondaryMuscles.every((m) => inKeys(MUSCLES, m)) &&
      Array.isArray(e.equipment) &&
      e.equipment.every((m) => inKeys(EQUIPMENT, m)) &&
      inKeys(TRACKING, e.trackingType) &&
      inKeys(EQUIPMENT_TYPES, e.equipmentType) &&
      inKeys(PATTERNS, e.movementPattern) &&
      (e.category === 'core' || e.category === 'assistance') &&
      typeof e.isStructural === 'boolean' &&
      typeof e.isUnilateral === 'boolean' &&
      isStrArr(e.lighterAlternatives) &&
      isStrArr(e.instructions) &&
      (e.aliases === undefined || isStrArr(e.aliases)) &&
      Array.isArray(e.commonMistakes) &&
      e.commonMistakes.every(isMistake) &&
      typeof e.defaultRestSec === 'number' &&
      typeof e.weightStepKg === 'number' &&
      isStr(e.source);
    if (!ok) throw new Error(`seed[${i}] (${String(e.id)}): неверная структура`);
    return r as Exercise;
  });
}

export const SEED_EXERCISES: Exercise[] = parseSeed(raw);

/** Добавляет недостающие упражнения начальной базы. Идемпотентно. */
export async function ensureSeed(target: AppDB = db): Promise<void> {
  const meta = await target.meta.get('seedVersion');
  const from = typeof meta?.value === 'number' ? meta.value : 0;
  if (from >= SEED_VERSION) return;
  const rows = await target.exercises.toArray();
  const byId = new Map(rows.map((e) => [e.id, e]));
  await target.transaction('rw', target.exercises, target.meta, async () => {
    await target.exercises.bulkAdd(SEED_EXERCISES.filter((e) => !byId.has(e.id)));
    // v2: новые названия и синонимы встроенных упражнений («Болгарские выпады»); v3: +54 упражнения и понятные названия.
    // Меняются только название и синонимы; отдых, шаг веса и избранное пользователя остаются.
    if (from >= 1)
      for (const s of SEED_EXERCISES) {
        const cur = byId.get(s.id);
        if (cur && !cur.isCustom) await target.exercises.put({ ...cur, nameRu: s.nameRu, aliases: s.aliases ?? [] });
      }
    await target.meta.put({ key: 'seedVersion', value: SEED_VERSION });
  });
}
