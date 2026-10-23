// Недельный отчёт (ТЗ, раздел 5.1). Всё считается из подходов; выводы — строго из посчитанных чисел.

import {
  LOWER,
  PULL,
  PUSH,
  UPPER,
  aggregateWeek,
  mean,
  trend,
  weeksBack,
  type AnalysisSettings,
  type Session,
  type Trend,
  type WeekAgg,
} from './analysis';
import { addDays } from './dates';
import { percentChange, rpeFromRir, type PercentChange } from './formulas';
import { MUSCLES } from './muscles';
import { computeRecords, type PrEvent } from './records';
import type { Exercise, ISODate, MuscleId, PlannedWorkout, WeightUnit } from './types';
import { formatNumber, formatWeight } from './units';

export interface MuscleRow {
  muscle: MuscleId;
  thisWeek: number;
  lastWeek: number;
  /** Среднее за 4 недели: эта и три предыдущие */
  avg4: number;
  inPlan: boolean;
}

export interface E1rmRow {
  exerciseId: string;
  value: number;
  weightKg: number;
  reps: number;
  lastWeek: number | null;
  fourWeeksAgo: number | null;
  changeVsLast: PercentChange;
  changeVs4: PercentChange;
  status: Trend | null;
}

export interface WeeklyReport {
  week: ISODate;
  isEmpty: boolean;
  planFact: {
    plannedWorkouts: number;
    doneWorkouts: number;
    sessions: number;
    plannedSets: number;
    workingSets: number;
    /** % выполнения по рабочим подходам; null — плана нет */
    completionPct: number | null;
  };
  muscles: MuscleRow[];
  tonnage: {
    total: number;
    lastWeek: number;
    change: PercentChange;
    byExercise: { exerciseId: string; value: number; lastWeek: number; change: PercentChange }[];
  };
  e1rm: E1rmRow[];
  effort: {
    avgRir: number | null;
    avgRpe: number | null;
    withRir: number;
    withTarget: number;
    inTarget: number;
    inTargetPct: number | null;
  };
  records: PrEvent[];
  wellbeing: { avg: number | null; count: number };
  balance: { push: number; pull: number; upper: number; lower: number };
  summary: string[];
}

export interface ReportInput {
  week: ISODate;
  sessions: Session[];
  planned: PlannedWorkout[];
  exercises: Exercise[];
  settings: AnalysisSettings;
  /** Только для текста выводов; числа в отчёте — в кг */
  unit: WeightUnit;
}

const r1 = (n: number) => formatNumber(n, 1);
const pct = (c: PercentChange) => (c == null ? '' : c.kind === 'new' ? 'новое' : `${c.value >= 0 ? '+' : '−'}${r1(Math.abs(c.value))}%`);

export function plannedInWeek(planned: PlannedWorkout[], week: ISODate): PlannedWorkout[] {
  const end = addDays(week, 6);
  // Перенесённые не считаем: их копия стоит на новой дате.
  return planned.filter((p) => !p.deletedAt && p.date >= week && p.date <= end && p.status !== 'moved');
}

/** Основные мышцы упражнений из плана недели. */
export function plannedMuscles(planned: PlannedWorkout[], exById: Map<string, Exercise>): Set<MuscleId> {
  const out = new Set<MuscleId>();
  for (const p of planned) for (const it of p.plannedItems) for (const m of exById.get(it.exerciseId)?.primaryMuscles ?? []) out.add(m);
  return out;
}

export function weeklyReport(input: ReportInput): WeeklyReport {
  const { week, sessions, settings: s } = input;
  const exById = new Map(input.exercises.map((e) => [e.id, e]));
  const weeks = [0, 1, 2, 3, 4].map((n) => aggregateWeek(sessions, weeksBack(week, n), s));
  const [cur, prev] = weeks as [WeekAgg, WeekAgg, WeekAgg, WeekAgg, WeekAgg];
  const four = weeks[4]!;

  // План / факт
  const planned = plannedInWeek(input.planned, week);
  const plannedSets = planned.reduce((n, p) => n + p.plannedItems.reduce((k, it) => k + it.sets, 0), 0);
  const doneWorkouts = planned.filter((p) => p.status === 'done' || p.status === 'partial').length;
  const planFact = {
    plannedWorkouts: planned.length,
    doneWorkouts,
    sessions: cur.sessions.length,
    plannedSets,
    workingSets: cur.workingSets,
    completionPct: plannedSets > 0 ? (cur.workingSets / plannedSets) * 100 : null,
  };

  // Мышечные группы
  const inPlan = plannedMuscles(planned, exById);
  const muscleIds = new Set<MuscleId>([...inPlan]);
  for (const w of weeks.slice(0, 4)) for (const m of w.muscleSets.keys()) muscleIds.add(m);
  const muscles: MuscleRow[] = [...muscleIds]
    .map((m) => ({
      muscle: m,
      thisWeek: cur.muscleSets.get(m) ?? 0,
      lastWeek: prev.muscleSets.get(m) ?? 0,
      avg4: weeks.slice(0, 4).reduce((n, w) => n + (w.muscleSets.get(m) ?? 0), 0) / 4,
      inPlan: inPlan.has(m),
    }))
    .sort((a, b) => b.thisWeek - a.thisWeek || a.muscle.localeCompare(b.muscle));

  // Тоннаж
  const tonnageIds = new Set([...cur.tonnageByExercise.keys(), ...prev.tonnageByExercise.keys()]);
  const byExercise = [...tonnageIds]
    .map((id) => {
      const value = cur.tonnageByExercise.get(id) ?? 0;
      const lastWeek = prev.tonnageByExercise.get(id) ?? 0;
      return { exerciseId: id, value, lastWeek, change: percentChange(value, lastWeek) };
    })
    .filter((x) => x.value > 0 || x.lastWeek > 0)
    .sort((a, b) => b.value - a.value);

  // e1RM
  const e1rm: E1rmRow[] = [...cur.bestE1rm.entries()]
    .map(([id, b]) => {
      const lw = prev.bestE1rm.get(id)?.value ?? null;
      const fw = four.bestE1rm.get(id)?.value ?? null;
      return {
        exerciseId: id,
        value: b.value,
        weightKg: b.weightKg,
        reps: b.reps,
        lastWeek: lw,
        fourWeeksAgo: fw,
        changeVsLast: lw == null ? null : percentChange(b.value, lw),
        changeVs4: fw == null ? null : percentChange(b.value, fw),
        status: trend(b.value, lw, s.stableThresholdPct),
      };
    })
    .sort((a, b) => (exById.get(a.exerciseId)?.nameRu ?? '').localeCompare(exById.get(b.exerciseId)?.nameRu ?? '', 'ru'));

  // Усилие
  const avgRir = mean(cur.rirValues);
  const effort = {
    avgRir,
    avgRpe: avgRir == null ? null : rpeFromRir(avgRir),
    withRir: cur.rirValues.length,
    withTarget: cur.targetRir.total,
    inTarget: cur.targetRir.inRange,
    inTargetPct: cur.targetRir.total > 0 ? (cur.targetRir.inRange / cur.targetRir.total) * 100 : null,
  };

  // Рекорды недели
  const records = computeRecords(sessions, s).events.filter((e) => e.date >= week && e.date <= addDays(week, 6));

  // Баланс движений — только описательно
  const sumP = (ps: typeof PUSH) => ps.reduce((n, p) => n + (cur.patternSets.get(p) ?? 0), 0);
  const sumM = (ms: MuscleId[]) => ms.reduce((n, m) => n + (cur.muscleSets.get(m) ?? 0), 0);
  const balance = { push: sumP(PUSH), pull: sumP(PULL), upper: sumM(UPPER), lower: sumM(LOWER) };

  const wellbeing = { avg: mean(cur.wellbeing), count: cur.wellbeing.length };
  const isEmpty = cur.sessions.length === 0;

  const report: WeeklyReport = {
    week,
    isEmpty,
    planFact,
    muscles,
    tonnage: { total: cur.tonnage, lastWeek: prev.tonnage, change: percentChange(cur.tonnage, prev.tonnage), byExercise },
    e1rm,
    effort,
    records,
    wellbeing,
    balance,
    summary: [],
  };
  report.summary = summarize(report, prev, exById, input.unit);
  return report;
}

/** 3–5 пунктов строго из посчитанных данных. */
function summarize(r: WeeklyReport, prev: WeekAgg, exById: Map<string, Exercise>, unit: WeightUnit): string[] {
  const out: string[] = [];
  const name = (id: string) => exById.get(id)?.nameRu ?? 'упражнение';
  const pf = r.planFact;
  if (r.isEmpty) {
    out.push(pf.plannedWorkouts > 0 ? `Тренировок нет; в плане было ${pf.plannedWorkouts}.` : 'За неделю тренировок нет.');
  } else if (pf.plannedWorkouts > 0) {
    out.push(
      `Тренировок по плану: ${pf.doneWorkouts} из ${pf.plannedWorkouts}; рабочих подходов: ${pf.workingSets} из ${pf.plannedSets}` +
        (pf.completionPct != null ? ` (${Math.round(pf.completionPct)}%).` : '.'),
    );
  } else {
    out.push(`Тренировок: ${pf.sessions}, рабочих подходов: ${pf.workingSets} (без плана).`);
  }
  if (!r.isEmpty && prev.workingSets > 0) {
    const c = percentChange(pf.workingSets, prev.workingSets);
    out.push(`Рабочих подходов: ${pf.workingSets}, на прошлой неделе ${prev.workingSets} (${pct(c)}).`);
  }
  const ups = r.e1rm.filter((x) => x.status === 'up');
  const downs = r.e1rm.filter((x) => x.status === 'down');
  if (ups.length || downs.length) {
    const best = [...ups].sort((a, b) => (b.changeVsLast?.kind === 'pct' ? b.changeVsLast.value : 0) - (a.changeVsLast?.kind === 'pct' ? a.changeVsLast.value : 0))[0];
    const worst = [...downs].sort((a, b) => (a.changeVsLast?.kind === 'pct' ? a.changeVsLast.value : 0) - (b.changeVsLast?.kind === 'pct' ? b.changeVsLast.value : 0))[0];
    const parts = [];
    if (best) parts.push(`вырос в ${ups.length} упр. (больше всего — ${name(best.exerciseId)}, ${pct(best.changeVsLast)})`);
    if (worst) parts.push(`снизился в ${downs.length} (${name(worst.exerciseId)}, ${pct(worst.changeVsLast)})`);
    out.push(`e1RM ≈ к прошлой неделе: ${parts.join('; ')}.`);
  }
  const missed = r.muscles.filter((m) => m.inPlan && m.thisWeek === 0).map((m) => MUSCLES[m.muscle].ru);
  if (missed.length) out.push(`Без рабочих подходов, хотя были в плане: ${missed.join(', ')}.`);
  if (r.records.length) out.push(`Новых личных рекордов: ${r.records.length}.`);
  if (out.length < 3 && !r.isEmpty && r.tonnage.lastWeek > 0) out.push(`Тоннаж: ${formatWeight(r.tonnage.total, unit)} (${pct(r.tonnage.change)} к прошлой неделе).`);
  return out.slice(0, 5);
}
