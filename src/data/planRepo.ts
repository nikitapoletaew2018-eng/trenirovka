// Шаблоны и недельный план.

import { addDays, daysBetween, weekDays } from '../domain/dates';
import type { ISODate, PlannedItem, PlannedWorkout, TemplateItem, WorkoutTemplate } from '../domain/types';
import { db } from './db';
import { nowIso, uuid } from './ids';
import { withUndo } from './undo';

const alive = <T extends { deletedAt?: string | null }>(x: T): boolean => !x.deletedAt;

function base() {
  const t = nowIso();
  return { id: uuid(), createdAt: t, updatedAt: t, deletedAt: null };
}

// ——— Шаблоны ———

export async function listTemplates(): Promise<WorkoutTemplate[]> {
  return (await db.templates.toArray()).filter(alive).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function newTemplate(name: string): WorkoutTemplate {
  return { ...base(), name, items: [] };
}

export async function saveTemplate(t: WorkoutTemplate): Promise<void> {
  const items = t.items.map((it, i) => ({ ...it, order: i }));
  await withUndo('Шаблон сохранён', (rec) => rec.put(db.templates, { ...t, items, updatedAt: nowIso() }));
}

export async function deleteTemplate(id: string): Promise<void> {
  await withUndo('Шаблон удалён', (rec) => rec.update(db.templates, id, { deletedAt: nowIso() }));
}

export function templateItemDefaults(exerciseId: string, order: number, restSec?: number | null): TemplateItem {
  return { exerciseId, order, targetSets: 3, repMin: 8, repMax: 12, targetRir: 2, restSec: restSec ?? null, supersetGroup: null };
}

export function itemsFromTemplate(t: WorkoutTemplate): PlannedItem[] {
  return [...t.items]
    .sort((a, b) => a.order - b.order)
    .map((it) => ({
      exerciseId: it.exerciseId,
      sets: it.targetSets,
      repMin: it.repMin,
      repMax: it.repMax,
      targetRir: it.targetRir ?? null,
      suggestedWeightKg: null,
      restSec: it.restSec ?? null,
      supersetGroup: it.supersetGroup ?? null,
      reason: null,
    }));
}

// ——— План ———

export async function plannedInRange(from: ISODate, to: ISODate): Promise<PlannedWorkout[]> {
  const list = await db.plannedWorkouts.where('date').between(from, to, true, true).toArray();
  return list.filter(alive).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export async function plannedForWeek(monday: ISODate): Promise<PlannedWorkout[]> {
  return plannedInRange(monday, addDays(monday, 6));
}

/** Поставить тренировку на день: из шаблона или пустую. */
export async function planWorkout(date: ISODate, template: WorkoutTemplate | null, name?: string): Promise<PlannedWorkout> {
  const pw: PlannedWorkout = {
    ...base(),
    date,
    name: template?.name ?? name ?? 'Тренировка',
    templateId: template?.id ?? null,
    plannedItems: template ? itemsFromTemplate(template) : [],
    status: 'planned',
    workoutId: null,
    movedTo: null,
  };
  await withUndo('Тренировка запланирована', (rec) => rec.put(db.plannedWorkouts, pw));
  return pw;
}

export async function updatePlanned(id: string, patch: Partial<Pick<PlannedWorkout, 'name' | 'plannedItems' | 'date' | 'status'>>): Promise<void> {
  await withUndo('План изменён', (rec) => rec.update(db.plannedWorkouts, id, { ...patch, updatedAt: nowIso() }));
}

/** Перетаскивание будущей (ещё не начатой) тренировки на другой день — просто меняет дату. */
export async function movePlannedDate(id: string, date: ISODate): Promise<void> {
  const pw = await db.plannedWorkouts.get(id);
  if (!pw || pw.date === date || pw.status !== 'planned' || pw.workoutId) return;
  await withUndo('Тренировка перенесена', (rec) => rec.update(db.plannedWorkouts, id, { date, updatedAt: nowIso() }));
}

/**
 * Пропущенная тренировка → «перенести»: исходная получает статус «перенесена»,
 * на новую дату ставится копия. История пропусков сохраняется.
 */
export async function reschedule(id: string, date: ISODate): Promise<void> {
  const pw = await db.plannedWorkouts.get(id);
  if (!pw) return;
  await withUndo('Тренировка перенесена', async (rec) => {
    const t = nowIso();
    await rec.update(db.plannedWorkouts, id, { status: 'moved', movedTo: date, updatedAt: t });
    rec.put(db.plannedWorkouts, { ...pw, ...base(), date, status: 'planned', workoutId: null, movedTo: null });
  });
}

export async function skipPlanned(id: string): Promise<void> {
  await withUndo('Тренировка пропущена', (rec) => rec.update(db.plannedWorkouts, id, { status: 'skipped', updatedAt: nowIso() }));
}

/** Следующая запланированная (не начатая) тренировка после даты — для «объединить со следующей». */
export async function nextPlannedAfter(pw: PlannedWorkout): Promise<PlannedWorkout | null> {
  const list = await plannedInRange(addDays(pw.date, 1), addDays(pw.date, 60));
  return list.find((x) => x.id !== pw.id && x.status === 'planned' && !x.workoutId) ?? null;
}

/** Объединить с следующей: упражнения пропущенной добавляются в конец следующей. */
export async function mergeWithNext(id: string): Promise<PlannedWorkout | null> {
  const pw = await db.plannedWorkouts.get(id);
  if (!pw) return null;
  const next = await nextPlannedAfter(pw);
  if (!next) return null;
  await withUndo('Тренировки объединены', async (rec) => {
    const t = nowIso();
    await rec.update(db.plannedWorkouts, next.id, {
      plannedItems: [...next.plannedItems, ...pw.plannedItems],
      name: `${next.name} + ${pw.name}`,
      updatedAt: t,
    });
    await rec.update(db.plannedWorkouts, id, { status: 'moved', movedTo: next.date, updatedAt: t });
  });
  return next;
}

/**
 * Плановое облегчение (ТЗ, 6.3.2): только если пользовательница сама включила его в настройках цикла,
 * и только после подтверждения предпросмотра. Пункты заменяются облегчёнными версиями.
 */
export async function lightenPlanned(changes: { id: string; items: PlannedItem[] }[]): Promise<void> {
  await withUndo('Подставлены облегчённые версии', async (rec) => {
    for (const c of changes) {
      const pw = await db.plannedWorkouts.get(c.id);
      if (!pw || pw.status !== 'planned' || pw.workoutId) continue;
      await rec.update(db.plannedWorkouts, c.id, {
        plannedItems: c.items,
        name: pw.name.endsWith('(облегчённая)') ? pw.name : `${pw.name} (облегчённая)`,
        updatedAt: nowIso(),
      });
    }
  });
}

export async function deletePlanned(id: string): Promise<void> {
  await withUndo('Удалено из плана', (rec) => rec.update(db.plannedWorkouts, id, { deletedAt: nowIso() }));
}

/**
 * «Скопировать неделю»: все тренировки недели-источника (кроме перенесённых — их копия уже есть)
 * ставятся на те же дни недели-назначения со статусом «запланирована». Веса из плана сохраняются.
 */
export async function copyWeek(fromMonday: ISODate, toMonday: ISODate): Promise<number> {
  const src = (await plannedForWeek(fromMonday)).filter((p) => p.status !== 'moved');
  const shift = daysBetween(fromMonday, toMonday);
  await withUndo('Неделя скопирована', (rec) => {
    for (const p of src)
      rec.put(db.plannedWorkouts, {
        ...p,
        ...base(),
        date: addDays(p.date, shift),
        status: 'planned',
        workoutId: null,
        movedTo: null,
      });
  });
  return src.length;
}

/** Запланированные на сегодня и ещё не начатые. */
export async function plannedToday(today: ISODate): Promise<PlannedWorkout[]> {
  return (await plannedInRange(today, today)).filter((p) => p.status === 'planned' && !p.workoutId);
}

export { weekDays };
