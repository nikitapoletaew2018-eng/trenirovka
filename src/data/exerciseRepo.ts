import type { Exercise, MuscleId } from '../domain/types';
import { db } from './db';
import { nowIso, uuid } from './ids';
import { withUndo } from './undo';

export async function listExercises(): Promise<Exercise[]> {
  const all = await db.exercises.toArray();
  return all.filter((e) => !e.deletedAt).sort((a, b) => a.nameRu.localeCompare(b.nameRu, 'ru'));
}

export interface ExerciseFilter {
  query?: string;
  muscle?: MuscleId | null;
  equipmentType?: Exercise['equipmentType'] | null;
  favoritesOnly?: boolean;
}

export function filterExercises(list: Exercise[], f: ExerciseFilter): Exercise[] {
  const q = f.query?.trim().toLowerCase() ?? '';
  return list
    .filter((e) => {
      if (f.favoritesOnly && !e.isFavorite) return false;
      if (f.muscle && !e.primaryMuscles.includes(f.muscle) && !e.secondaryMuscles.includes(f.muscle)) return false;
      if (f.equipmentType && e.equipmentType !== f.equipmentType) return false;
      if (q && !e.nameRu.toLowerCase().includes(q) && !e.nameEn.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => Number(!!b.isFavorite) - Number(!!a.isFavorite) || a.nameRu.localeCompare(b.nameRu, 'ru'));
}

/**
 * Кандидаты на замену: сначала облегчённые альтернативы из карточки упражнения,
 * затем упражнения с общими основными мышцами (ТЗ, раздел 2: «заменить на аналог»).
 */
export function replacementCandidates(ex: Exercise, all: Exercise[]): { lighter: Exercise[]; similar: Exercise[] } {
  const byId = new Map(all.map((e) => [e.id, e]));
  const lighter = ex.lighterAlternatives.map((id) => byId.get(id)).filter((e): e is Exercise => !!e && !e.deletedAt);
  const lighterIds = new Set(lighter.map((e) => e.id));
  const similar = all.filter(
    (e) => e.id !== ex.id && !lighterIds.has(e.id) && e.primaryMuscles.some((m) => ex.primaryMuscles.includes(m)),
  );
  return { lighter, similar };
}

export async function toggleFavorite(id: string): Promise<void> {
  const e = await db.exercises.get(id);
  if (!e) return;
  await withUndo(e.isFavorite ? 'Убрано из избранного' : 'Добавлено в избранное', (rec) =>
    rec.update(db.exercises, id, { isFavorite: !e.isFavorite, updatedAt: nowIso() }),
  );
}

export type ExercisePatch = Partial<
  Pick<
    Exercise,
    | 'nameRu'
    | 'nameEn'
    | 'primaryMuscles'
    | 'secondaryMuscles'
    | 'equipment'
    | 'equipmentType'
    | 'trackingType'
    | 'isUnilateral'
    | 'category'
    | 'isStructural'
    | 'movementPattern'
    | 'defaultRestSec'
    | 'weightStepKg'
    | 'instructions'
  >
>;

export async function updateExercise(id: string, patch: ExercisePatch): Promise<void> {
  await withUndo('Упражнение изменено', (rec) => rec.update(db.exercises, id, { ...patch, updatedAt: nowIso() }));
}

export function newCustomExercise(nameRu: string): Exercise {
  const t = nowIso();
  return {
    id: uuid(),
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    nameRu,
    nameEn: '',
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: [],
    trackingType: 'weight_reps',
    isUnilateral: false,
    category: 'assistance',
    isStructural: false,
    equipmentType: 'free_weight',
    movementPattern: 'isolation',
    lighterAlternatives: [],
    instructions: [],
    commonMistakes: [],
    defaultRestSec: 90,
    weightStepKg: 2.5,
    source: 'Своё упражнение',
    isCustom: true,
  };
}

export async function saveCustomExercise(e: Exercise): Promise<void> {
  await withUndo('Упражнение сохранено', (rec) => rec.put(db.exercises, { ...e, isCustom: true, updatedAt: nowIso() }));
}

/** Удалять можно только свои упражнения (мягко). Встроенные остаются, их можно не использовать. */
export async function deleteCustomExercise(id: string): Promise<void> {
  const e = await db.exercises.get(id);
  if (!e?.isCustom) return;
  await withUndo('Упражнение удалено', (rec) => rec.update(db.exercises, id, { deletedAt: nowIso() }));
}
