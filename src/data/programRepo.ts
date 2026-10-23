// Программы, мезоцикл, разгрузочные недели и применение предложений к плану.
// Все изменения плана — по явному действию пользователя и с «отменить».

import { addDays, weekDays } from '../domain/dates';
import { deloadItem, type DeloadParams } from '../domain/progression';
import type { ISODate, PlannedItem, PlannedWorkout, Program, WeekPlan } from '../domain/types';
import { db } from './db';
import { nowIso, uuid } from './ids';
import { itemsFromTemplate, plannedForWeek } from './planRepo';
import { SEED_EXERCISES } from './seed';
import { withUndo, type Recorder } from './undo';

const alive = <T extends { deletedAt?: string | null }>(x: T) => !x.deletedAt;

function base() {
  const t = nowIso();
  return { id: uuid(), createdAt: t, updatedAt: t, deletedAt: null };
}

export async function listPrograms(): Promise<Program[]> {
  return (await db.programs.toArray()).filter(alive).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function newProgram(name: string): Program {
  return { ...base(), name, weeks: 4, progressionRule: 'double', deloadEveryNWeeks: null, lastWeekDeload: true, days: [], source: null };
}

export async function saveProgram(p: Program): Promise<void> {
  await withUndo('Программа сохранена', (rec) => rec.put(db.programs, { ...p, weeks: Math.min(8, Math.max(4, p.weeks)), updatedAt: nowIso() }));
}

export async function deleteProgram(id: string): Promise<void> {
  await withUndo('Программа удалена', (rec) => rec.update(db.programs, id, { deletedAt: nowIso() }));
}

export async function weekPlanFor(monday: ISODate): Promise<WeekPlan | undefined> {
  return (await db.weekPlans.where('weekStart').equals(monday).toArray()).find(alive);
}

async function putWeekPlan(rec: Recorder, monday: ISODate, patch: Partial<WeekPlan>): Promise<void> {
  const cur = await weekPlanFor(monday);
  if (cur) await rec.update(db.weekPlans, cur.id, { ...patch, updatedAt: nowIso() });
  else rec.put(db.weekPlans, { ...base(), weekStart: monday, isDeload: false, ...patch });
}

async function stepOf(exerciseId: string): Promise<number> {
  return (await db.exercises.get(exerciseId))?.weightStepKg ?? 2.5;
}

/** Номера разгрузочных недель мезоцикла (с 1): по расписанию и/или последняя. */
export function deloadWeeks(p: Pick<Program, 'weeks' | 'deloadEveryNWeeks' | 'lastWeekDeload'>): number[] {
  const out = new Set<number>();
  if (p.deloadEveryNWeeks && p.deloadEveryNWeeks > 1) for (let i = p.deloadEveryNWeeks; i <= p.weeks; i += p.deloadEveryNWeeks) out.add(i);
  if (p.lastWeekDeload) out.add(p.weeks);
  return [...out].sort((a, b) => a - b);
}

/**
 * «Спланировать на N недель»: тренировки по дням программы на каждую неделю мезоцикла.
 * Разгрузочные недели — облегчённые версии тех же тренировок. Веса ставит прогрессия неделя за неделей.
 */
export async function applyProgram(program: Program, startMonday: ISODate, deload: DeloadParams): Promise<number> {
  const templates = new Map((await db.templates.toArray()).filter(alive).map((t) => [t.id, t]));
  const deloads = new Set(deloadWeeks(program));
  const steps = new Map<string, number>();
  for (const d of program.days) for (const it of templates.get(d.templateId)?.items ?? []) steps.set(it.exerciseId, await stepOf(it.exerciseId));
  let count = 0;
  await withUndo(`Мезоцикл: ${program.name}`, async (rec) => {
    for (let w = 1; w <= program.weeks; w++) {
      const monday = addDays(startMonday, 7 * (w - 1));
      const isDeload = deloads.has(w);
      await putWeekPlan(rec, monday, { isDeload, programId: program.id, weekIndex: w });
      for (const day of program.days) {
        const t = templates.get(day.templateId);
        if (!t) continue;
        let items = itemsFromTemplate(t);
        if (isDeload) items = items.map((it) => deloadItem(it, deload, steps.get(it.exerciseId) ?? 2.5));
        rec.put(db.plannedWorkouts, {
          ...base(),
          date: addDays(monday, day.weekday),
          name: isDeload ? `${t.name} (разгрузка)` : t.name,
          templateId: t.id,
          plannedItems: items,
          status: 'planned',
          workoutId: null,
          movedTo: null,
        });
        count++;
      }
    }
  });
  return count;
}

/** Предпросмотр разгрузки: что станет с каждым пунктом плана недели. */
export async function previewDeload(monday: ISODate, deload: DeloadParams): Promise<{ pw: PlannedWorkout; items: PlannedItem[] }[]> {
  const week = (await plannedForWeek(monday)).filter((p) => p.status === 'planned' && !p.workoutId);
  const out = [];
  for (const pw of week) {
    const items = [];
    for (const it of pw.plannedItems) items.push(deloadItem(it, deload, await stepOf(it.exerciseId)));
    out.push({ pw, items });
  }
  return out;
}

/** Сделать неделю разгрузочной (после подтверждения предпросмотра). */
export async function makeWeekDeload(monday: ISODate, deload: DeloadParams): Promise<void> {
  const preview = await previewDeload(monday, deload);
  await withUndo('Неделя — разгрузочная', async (rec) => {
    await putWeekPlan(rec, monday, { isDeload: true });
    for (const { pw, items } of preview) await rec.update(db.plannedWorkouts, pw.id, { plannedItems: items, updatedAt: nowIso() });
  });
}

export interface AcceptedSuggestion {
  exerciseId: string;
  item: PlannedItem;
}

/**
 * Применить принятые предложения к плану недели: у совпадающих по упражнению пунктов
 * меняются вес, цель по повторам и причина. Остальное (подходы, диапазон) — как было.
 * Возвращает число изменённых пунктов.
 */
export async function applySuggestions(monday: ISODate, accepted: AcceptedSuggestion[]): Promise<number> {
  const byEx = new Map(accepted.map((a) => [a.exerciseId, a.item]));
  const week = (await plannedForWeek(monday)).filter((p) => p.status === 'planned' && !p.workoutId);
  let n = 0;
  await withUndo('План следующей недели обновлён', async (rec) => {
    for (const pw of week) {
      let changed = false;
      const items = pw.plannedItems.map((it) => {
        const s = byEx.get(it.exerciseId);
        if (!s) return it;
        changed = true;
        n++;
        return { ...it, suggestedWeightKg: s.suggestedWeightKg ?? null, targetReps: s.targetReps ?? null, reason: s.reason ?? null };
      });
      if (changed) await rec.update(db.plannedWorkouts, pw.id, { plannedItems: items, updatedAt: nowIso() });
    }
  });
  return n;
}

export async function isDeloadWeek(monday: ISODate): Promise<boolean> {
  return (await weekPlanFor(monday))?.isDeload ?? false;
}

export { weekDays };

// ——— Готовые программы ———
// Только общеизвестные схемы с источником. Конкретные упражнения и 3×8–12 @RIR 2 — значения по умолчанию
// приложения, их нужно подобрать под себя.

const ACSM_2009 =
  'ACSM Position Stand «Progression Models in Resistance Training for Healthy Adults» (2009): частота 2–3 дня/нед. на всё тело для начинающих; ' +
  '3 дня/нед. на всё тело или 4 дня/нед. сплит верх/низ для среднего уровня; 1–3 подхода по 8–12 повторений для начинающих.';

const bySource = (id: string) => SEED_EXERCISES.find((e) => e.sourceId === id)?.id;

interface BuiltInDef {
  key: string;
  name: string;
  days: { weekday: number; template: string }[];
  templates: Record<string, string[]>;
}

const BUILT_INS: BuiltInDef[] = [
  {
    key: 'fullbody3',
    name: 'Фулбади 3 раза в неделю',
    days: [
      { weekday: 0, template: 'Фулбади' },
      { weekday: 2, template: 'Фулбади' },
      { weekday: 4, template: 'Фулбади' },
    ],
    templates: {
      Фулбади: ['Barbell_Full_Squat', 'Barbell_Bench_Press_-_Medium_Grip', 'Seated_Cable_Rows', 'Romanian_Deadlift', 'Standing_Military_Press', 'Wide-Grip_Lat_Pulldown'],
    },
  },
  {
    key: 'upperlower4',
    name: 'Верх / низ, 4 раза в неделю',
    days: [
      { weekday: 0, template: 'Верх' },
      { weekday: 1, template: 'Низ' },
      { weekday: 3, template: 'Верх' },
      { weekday: 4, template: 'Низ' },
    ],
    templates: {
      Верх: ['Barbell_Bench_Press_-_Medium_Grip', 'Bent_Over_Barbell_Row', 'Seated_Dumbbell_Press', 'Wide-Grip_Lat_Pulldown', 'Barbell_Curl', 'Triceps_Pushdown'],
      Низ: ['Barbell_Full_Squat', 'Romanian_Deadlift', 'Leg_Press', 'Lying_Leg_Curls', 'Standing_Calf_Raises'],
    },
  },
];

export const BUILT_IN_PROGRAMS = BUILT_INS.map((b) => ({ key: b.key, name: b.name, source: ACSM_2009 }));

/** Создаёт шаблоны и программу готовой схемы. Возвращает id программы. */
export async function addBuiltInProgram(key: string): Promise<string | null> {
  const def = BUILT_INS.find((b) => b.key === key);
  if (!def) return null;
  const program = newProgram(def.name);
  program.source = ACSM_2009;
  await withUndo(`Добавлена программа «${def.name}»`, (rec) => {
    const tplIds = new Map<string, string>();
    for (const [name, ids] of Object.entries(def.templates)) {
      const items = ids
        .map(bySource)
        .filter((x): x is string => !!x)
        .map((exerciseId, order) => ({ exerciseId, order, targetSets: 3, repMin: 8, repMax: 12, targetRir: 2, restSec: null, supersetGroup: null }));
      const t = { ...base(), name: `${name} (${def.name})`, items };
      rec.put(db.templates, t);
      tplIds.set(name, t.id);
    }
    program.days = def.days.map((d) => ({ weekday: d.weekday, templateId: tplIds.get(d.template)! }));
    rec.put(db.programs, program);
  });
  return program.id;
}
