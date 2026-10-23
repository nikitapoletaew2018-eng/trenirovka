// Операции с тренировками. Каждый подход пишется в IndexedDB сразу.
// Изменения, которые пользователь может захотеть отменить, идут через withUndo.

import { isWorkingSet } from '../domain/formulas';
import { userTimeZone } from '../domain/dates';
import type { PlannedItem, Workout, WorkoutExercise, WorkoutSet } from '../domain/types';
import {
  firstSetValues,
  nextSetValues,
  plannedStatusAfterFinish,
  propagateAfterComplete,
  type SetValues,
} from '../domain/workoutLogic';
import { db } from './db';
import { nowIso, uuid } from './ids';
import { getSettings } from './settings';
import { withUndo, type Recorder } from './undo';

const alive = <T extends { deletedAt?: string | null }>(x: T | undefined): x is T => !!x && !x.deletedAt;

function base() {
  const t = nowIso();
  return { id: uuid(), createdAt: t, updatedAt: t, deletedAt: null };
}

/** Незавершённая тренировка (восстанавливается после закрытия приложения). */
export async function getActiveWorkout(): Promise<Workout | null> {
  const list = await db.workouts.orderBy('startedAt').reverse().toArray();
  return list.find((w) => alive(w) && !w.finishedAt) ?? null;
}

export async function workoutExercises(workoutId: string): Promise<WorkoutExercise[]> {
  const list = await db.workoutExercises.where('workoutId').equals(workoutId).toArray();
  return list.filter(alive).sort((a, b) => a.order - b.order);
}

export async function exerciseSets(workoutExerciseId: string): Promise<WorkoutSet[]> {
  const list = await db.sets.where('workoutExerciseId').equals(workoutExerciseId).toArray();
  return list.filter(alive).sort((a, b) => a.order - b.order);
}

/**
 * Подходы последней завершённой тренировки с этим упражнением («прошлый раз»).
 * Выполненные подходы, по порядку. Пустой массив, если упражнение ещё не делали.
 */
export async function lastTimeSets(
  exerciseId: string,
  excludeWorkoutId?: string,
): Promise<{ workout: Workout; sets: WorkoutSet[] } | null> {
  const wes = (await db.workoutExercises.where('exerciseId').equals(exerciseId).toArray()).filter(alive);
  const workouts = (await db.workouts.bulkGet([...new Set(wes.map((w) => w.workoutId))]))
    .filter(alive)
    .filter((w) => !!w.finishedAt && w.id !== excludeWorkoutId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const w of workouts) {
    const ids = wes.filter((x) => x.workoutId === w.id).map((x) => x.id);
    const sets: WorkoutSet[] = [];
    for (const id of ids) sets.push(...(await exerciseSets(id)).filter((s) => s.completed));
    if (sets.length > 0) return { workout: w, sets };
  }
  return null;
}

function setRow(workoutId: string, workoutExerciseId: string, order: number, v: SetValues): WorkoutSet {
  return {
    ...base(),
    workoutId,
    workoutExerciseId,
    order,
    setType: v.setType,
    weightKg: v.weightKg,
    addedWeightKg: v.addedWeightKg,
    reps: v.reps,
    durationSec: v.durationSec,
    rir: v.rir,
    completed: false,
    completedAt: null,
    autofilled: true,
  };
}

function valuesOf(s: WorkoutSet): SetValues {
  return {
    setType: s.setType,
    weightKg: s.weightKg ?? null,
    addedWeightKg: s.addedWeightKg ?? null,
    reps: s.reps ?? null,
    durationSec: s.durationSec ?? null,
    rir: s.rir ?? null,
  };
}

/** Создаёт упражнение в тренировке с подходами: из плана (число подходов) или по прошлому разу. */
async function createWorkoutExercise(
  rec: Recorder,
  workoutId: string,
  exerciseId: string,
  order: number,
  plan: PlannedItem | null,
  last: { sets: WorkoutSet[] } | null,
): Promise<WorkoutExercise> {
  const we: WorkoutExercise = {
    ...base(),
    workoutId,
    exerciseId,
    order,
    supersetGroup: plan?.supersetGroup ?? null,
    restSec: plan?.restSec ?? null,
    plan,
  };
  await rec.put(db.workoutExercises, we);
  const lastWorking = last?.sets.filter((s) => s.setType !== 'warmup') ?? [];
  const count = plan ? plan.sets : Math.max(1, lastWorking.length);
  const first = firstSetValues(
    plan,
    (last?.sets ?? []).map((s) => ({ ...valuesOf(s) })),
  );
  let v = first;
  for (let i = 0; i < count; i++) {
    await rec.put(db.sets, setRow(workoutId, we.id, i, v));
    v = nextSetValues(v);
  }
  return we;
}


export interface StartOptions {
  name: string;
  plannedWorkoutId?: string | null;
  items?: PlannedItem[];
  exerciseIds?: string[];
}

export async function startWorkout(opts: StartOptions): Promise<Workout> {
  const existing = await getActiveWorkout();
  if (existing) return existing;
  const settings = await getSettings();
  // «Прошлый раз» читаем до транзакции: внутри неё ждём только простые операции Dexie.
  const ids = [...(opts.items ?? []).map((i) => i.exerciseId), ...(opts.exerciseIds ?? [])];
  const lasts = new Map<string, Awaited<ReturnType<typeof lastTimeSets>>>();
  for (const id of ids) if (!lasts.has(id)) lasts.set(id, await lastTimeSets(id));
  return withUndo('Начата тренировка', async (rec) => {
    const w: Workout = {
      ...base(),
      name: opts.name,
      plannedWorkoutId: opts.plannedWorkoutId ?? null,
      startedAt: nowIso(),
      finishedAt: null,
      timeZone: userTimeZone(),
      notes: '',
      wellbeing: null,
      bodyWeightKg: settings.bodyWeightKg ?? null,
      isLightVersion: false,
    };
    await rec.put(db.workouts, w);
    let order = 0;
    for (const item of opts.items ?? [])
      await createWorkoutExercise(rec, w.id, item.exerciseId, order++, item, lasts.get(item.exerciseId) ?? null);
    for (const id of opts.exerciseIds ?? [])
      await createWorkoutExercise(rec, w.id, id, order++, null, lasts.get(id) ?? null);
    if (opts.plannedWorkoutId) await rec.update(db.plannedWorkouts, opts.plannedWorkoutId, { workoutId: w.id });
    return w;
  });
}

/** Упражнения прошлой тренировки — для «повторить прошлую». */
export async function exercisesOfWorkout(workoutId: string): Promise<string[]> {
  return (await workoutExercises(workoutId)).map((we) => we.exerciseId);
}

export async function addExercise(workoutId: string, exerciseId: string): Promise<WorkoutExercise> {
  const list = await workoutExercises(workoutId);
  const order = (list[list.length - 1]?.order ?? -1) + 1;
  const last = await lastTimeSets(exerciseId, workoutId);
  return withUndo('Добавлено упражнение', (rec) =>
    createWorkoutExercise(rec, workoutId, exerciseId, order, null, last),
  );
}

/** Новый подход: значения предыдущего сегодняшнего, иначе план/прошлый раз. */
export async function addSet(workoutExerciseId: string): Promise<void> {
  const we = await db.workoutExercises.get(workoutExerciseId);
  if (!we) return;
  const sets = await exerciseSets(workoutExerciseId);
  const prev = sets[sets.length - 1];
  let v: SetValues;
  if (prev) v = nextSetValues(valuesOf(prev));
  else {
    const last = await lastTimeSets(we.exerciseId, we.workoutId);
    v = firstSetValues(we.plan ?? null, (last?.sets ?? []).map(valuesOf));
  }
  const order = (prev?.order ?? -1) + 1;
  await withUndo('Добавлен подход', (rec) => rec.put(db.sets, setRow(we.workoutId, we.id, order, v)));
}

export type SetPatch = Partial<
  Pick<WorkoutSet, 'setType' | 'weightKg' | 'addedWeightKg' | 'reps' | 'durationSec' | 'rir' | 'rpe' | 'notes'>
>;

/** Правка значений подхода. Снимает флаг автозаполнения — дальше значения не перезаписываются. */
export async function updateSet(id: string, patch: SetPatch): Promise<void> {
  const valueChanged = Object.keys(patch).some((k) => k !== 'setType' && k !== 'notes');
  await withUndo('Изменён подход', (rec) =>
    rec.update(db.sets, id, { ...patch, ...(valueChanged ? { autofilled: false } : {}), updatedAt: nowIso() }),
  );
}

/**
 * Отметить подход выполненным (или снять отметку).
 * При отметке: значения переносятся в следующие нетронутые подходы, стартует таймер отдыха.
 * Возвращает длительность отдыха в секундах (или null при снятии отметки).
 */
export async function toggleSetCompleted(id: string, opts: { startRest?: boolean } = {}): Promise<number | null> {
  const set = await db.sets.get(id);
  if (!set) return null;
  const we = await db.workoutExercises.get(set.workoutExerciseId);
  if (!we) return null;
  const ex = await db.exercises.get(we.exerciseId);
  const settings = await getSettings();
  const willComplete = !set.completed;
  const restSec = we.restSec ?? ex?.defaultRestSec ?? settings.defaultRestSec;
  const sets = await exerciseSets(we.id);
  // Суперсет / круг: отдых — только после последнего упражнения группы.
  let startRest = opts.startRest ?? true;
  if (startRest && we.supersetGroup) {
    const group = (await workoutExercises(we.workoutId)).filter((x) => x.supersetGroup === we.supersetGroup);
    if (group.some((x) => x.order > we.order)) startRest = false;
  }
  return withUndo(willComplete ? 'Подход выполнен' : 'Отметка снята', async (rec) => {
    const t = nowIso();
    await rec.update(db.sets, id, { completed: willComplete, completedAt: willComplete ? t : null, updatedAt: t });
    if (!willComplete) return null;
    const updates = propagateAfterComplete(
      sets.map((s) => ({ ...valuesOf(s), id: s.id, completed: s.completed, autofilled: s.autofilled ?? false })),
      id,
    );
    for (const [sid, v] of updates) await rec.update(db.sets, sid, { ...v, updatedAt: t });
    if (!startRest) return 0;
    rec.put(db.restTimer, {
      id: 'current',
      workoutExerciseId: we.id,
      startedAt: t,
      endsAt: new Date(Date.parse(t) + restSec * 1000).toISOString(),
    });
    return restSec;
  });
}

/** Добавить разминочные подходы перед рабочими (из калькулятора разминки). Порядок пересчитывается. */
export async function addWarmupSets(workoutExerciseId: string, warmups: { weightKg: number; reps: number | null }[]): Promise<void> {
  const we = await db.workoutExercises.get(workoutExerciseId);
  if (!we || warmups.length === 0) return;
  const sets = await exerciseSets(workoutExerciseId);
  await withUndo('Добавлена разминка', async (rec) => {
    warmups.forEach((w, i) =>
      rec.put(db.sets, {
        ...setRow(we.workoutId, we.id, i, { ...EMPTY_WARMUP, weightKg: w.weightKg, reps: w.reps }),
        autofilled: false,
      }),
    );
    for (const [j, s] of sets.entries()) await rec.update(db.sets, s.id, { order: warmups.length + j });
  });
}

const EMPTY_WARMUP: SetValues = { setType: 'warmup', weightKg: null, addedWeightKg: null, reps: null, durationSec: null, rir: null };

export async function deleteSet(id: string): Promise<void> {
  await withUndo('Подход удалён', (rec) => rec.update(db.sets, id, { deletedAt: nowIso() }));
}

export async function removeExercise(workoutExerciseId: string): Promise<void> {
  const sets = await exerciseSets(workoutExerciseId);
  await withUndo('Упражнение удалено', async (rec) => {
    const t = nowIso();
    await rec.update(db.workoutExercises, workoutExerciseId, { deletedAt: t });
    for (const s of sets) await rec.update(db.sets, s.id, { deletedAt: t });
  });
}

export async function moveExercise(workoutExerciseId: string, dir: -1 | 1): Promise<void> {
  const we = await db.workoutExercises.get(workoutExerciseId);
  if (!we) return;
  const list = await workoutExercises(we.workoutId);
  const i = list.findIndex((x) => x.id === workoutExerciseId);
  const other = list[i + dir];
  if (!other) return;
  await withUndo('Порядок изменён', async (rec) => {
    await rec.update(db.workoutExercises, we.id, { order: other.order });
    await rec.update(db.workoutExercises, other.id, { order: we.order });
  });
}

/**
 * Замена упражнения на аналог. Выполненные подходы остаются;
 * невыполненные автозаполненные — перезаполняются по «прошлому разу» нового упражнения.
 */
export async function replaceExercise(workoutExerciseId: string, newExerciseId: string): Promise<void> {
  const we = await db.workoutExercises.get(workoutExerciseId);
  if (!we || we.exerciseId === newExerciseId) return;
  const sets = await exerciseSets(we.id);
  const last = await lastTimeSets(newExerciseId, we.workoutId);
  const v = firstSetValues(null, (last?.sets ?? []).map(valuesOf));
  await withUndo('Упражнение заменено', async (rec) => {
    await rec.update(db.workoutExercises, we.id, {
      exerciseId: newExerciseId,
      replacedFromExerciseId: we.replacedFromExerciseId ?? we.exerciseId,
      plan: we.plan ? { ...we.plan, exerciseId: newExerciseId, suggestedWeightKg: null } : null,
      updatedAt: nowIso(),
    });
    for (const s of sets) {
      if (s.completed || !s.autofilled) continue;
      await rec.update(db.sets, s.id, { ...v, setType: s.setType });
    }
  });
}

export async function updateWorkout(
  id: string,
  patch: Partial<Pick<Workout, 'name' | 'notes' | 'wellbeing' | 'bodyWeightKg' | 'startedAt' | 'finishedAt'>>,
): Promise<void> {
  await withUndo('Тренировка изменена', (rec) => rec.update(db.workouts, id, { ...patch, updatedAt: nowIso() }));
}

export async function updateWorkoutExercise(
  id: string,
  patch: Partial<Pick<WorkoutExercise, 'notes' | 'supersetGroup' | 'restSec'>>,
): Promise<void> {
  await withUndo('Упражнение изменено', (rec) =>
    rec.update(db.workoutExercises, id, { ...patch, updatedAt: nowIso() }),
  );
}

export async function pendingSetsCount(workoutId: string): Promise<number> {
  const sets = (await db.sets.where('workoutId').equals(workoutId).toArray()).filter(alive);
  return sets.filter((s) => !s.completed).length;
}

export interface FinishOptions {
  wellbeing?: number | null;
  /** Что делать с невыполненными подходами */
  unfinished: 'delete' | 'complete' | 'keep';
}

export async function finishWorkout(workoutId: string, opts: FinishOptions): Promise<void> {
  const w = await db.workouts.get(workoutId);
  if (!w) return;
  const sets = (await db.sets.where('workoutId').equals(workoutId).toArray()).filter(alive);
  const timer = await db.restTimer.get('current');
  const pw = w.plannedWorkoutId ? await db.plannedWorkouts.get(w.plannedWorkoutId) : undefined;
  await withUndo('Тренировка завершена', async (rec) => {
    const t = nowIso();
    for (const s of sets) {
      if (s.completed) continue;
      if (opts.unfinished === 'delete') await rec.update(db.sets, s.id, { deletedAt: t });
      if (opts.unfinished === 'complete') await rec.update(db.sets, s.id, { completed: true, completedAt: t });
    }
    await rec.update(db.workouts, workoutId, { finishedAt: t, wellbeing: opts.wellbeing ?? null, updatedAt: t });
    if (timer) rec.delete(db.restTimer, 'current');
    if (pw) {
      const planned = pw.plannedItems.reduce((n, i) => n + i.sets, 0);
      const doneNow = sets.filter(
        (s) => s.setType !== 'warmup' && (s.completed || opts.unfinished === 'complete'),
      ).length;
      await rec.update(db.plannedWorkouts, pw.id, {
        status: plannedStatusAfterFinish(planned, doneNow),
        workoutId,
        updatedAt: t,
      });
    }
  });
}

/** Удалить тренировку (мягко), вместе с её упражнениями и подходами. */
export async function deleteWorkout(workoutId: string): Promise<void> {
  const wes = await workoutExercises(workoutId);
  const sets = (await db.sets.where('workoutId').equals(workoutId).toArray()).filter(alive);
  const w = await db.workouts.get(workoutId);
  const timer = await db.restTimer.get('current');
  await withUndo('Тренировка удалена', async (rec) => {
    const t = nowIso();
    await rec.update(db.workouts, workoutId, { deletedAt: t });
    for (const we of wes) await rec.update(db.workoutExercises, we.id, { deletedAt: t });
    for (const s of sets) await rec.update(db.sets, s.id, { deletedAt: t });
    if (w?.plannedWorkoutId) await rec.update(db.plannedWorkouts, w.plannedWorkoutId, { status: 'planned', workoutId: null });
    if (!w?.finishedAt && timer) rec.delete(db.restTimer, 'current');
  });
}

export async function completedWorkingSets(workoutId: string): Promise<WorkoutSet[]> {
  const sets = (await db.sets.where('workoutId').equals(workoutId).toArray()).filter(alive);
  return sets.filter(isWorkingSet);
}

// ——— Таймер отдыха ———

export async function adjustRest(deltaSec: number): Promise<void> {
  const t = await db.restTimer.get('current');
  if (!t) return;
  const endsAt = new Date(Math.max(Date.now(), Date.parse(t.endsAt) + deltaSec * 1000)).toISOString();
  await db.restTimer.put({ ...t, endsAt });
}

export async function stopRest(): Promise<void> {
  await db.restTimer.delete('current');
}
