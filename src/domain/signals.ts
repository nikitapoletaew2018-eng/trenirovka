// Сигналы недели (ТЗ, раздел 5.2). Все пороги — эвристики и настраиваются в настройках.
// У каждого сигнала есть «Почему?» с конкретными числами. Приложение только предлагает.

import { aggregateWeek, mean, trend, weeksBack, type AnalysisSettings, type Session, type WeekAgg } from './analysis';
import { rpeFromRir } from './formulas';
import { MUSCLES } from './muscles';
import { plannedInWeek, plannedMuscles } from './report';
import type { Exercise, ISODate, MuscleId, PlannedWorkout } from './types';
import { formatNumber } from './units';

export type SignalKind = 'stagnation' | 'fatigue' | 'volume_jump' | 'missed_muscle';

export interface Signal {
  id: string;
  kind: SignalKind;
  title: string;
  /** Пояснение «Почему?»: на каких числах сработал сигнал */
  why: string;
  heuristic: boolean;
  action?: 'deload' | 'progression_options';
  exerciseId?: string;
  muscle?: MuscleId;
}

export interface SignalInput {
  week: ISODate;
  sessions: Session[];
  planned: PlannedWorkout[];
  exercises: Exercise[];
  settings: AnalysisSettings;
  /** Неделя ещё идёт — формулировки «пока» */
  inProgress: boolean;
  /** Форматирование веса для текста «Почему?» (единицы отображения) */
  fmtKg?: (kg: number) => string;
}

const f1 = (n: number) => formatNumber(n, 1);

/** Лучший e1RM упражнения по неделям, где оно выполнялось (по возрастанию даты), до недели включительно. */
export function weeklyE1rmSeries(sessions: Session[], exerciseId: string, upTo: ISODate, s: AnalysisSettings): { week: ISODate; value: number }[] {
  const weeks = [...new Set(sessions.filter((x) => x.week <= upTo).map((x) => x.week))].sort();
  const out: { week: ISODate; value: number }[] = [];
  for (const w of weeks) {
    const b = aggregateWeek(sessions, w, s).bestE1rm.get(exerciseId);
    if (b) out.push({ week: w, value: b.value });
  }
  return out;
}

/**
 * Стагнация: лучший e1RM за последние N недель с этим упражнением не превышает лучший
 * за предыдущие недели больше чем на порог «стабильно». Нужно ≥ N + 1 недель данных.
 */
export function isStagnating(series: { value: number }[], n: number, thresholdPct: number): boolean {
  if (series.length < n + 1) return false;
  const recent = Math.max(...series.slice(-n).map((x) => x.value));
  const before = Math.max(...series.slice(0, -n).map((x) => x.value));
  return recent <= before * (1 + thresholdPct / 100);
}

export function computeSignals(input: SignalInput): Signal[] {
  const { week, sessions, settings: s } = input;
  const exById = new Map(input.exercises.map((e) => [e.id, e]));
  const name = (id: string) => exById.get(id)?.nameRu ?? 'упражнение';
  const kg = input.fmtKg ?? ((v: number) => `${f1(v)} кг`);
  const [cur, prev, prev2] = [0, 1, 2].map((n) => aggregateWeek(sessions, weeksBack(week, n), s)) as [WeekAgg, WeekAgg, WeekAgg];
  const out: Signal[] = [];

  // 1. Стагнация
  for (const id of cur.bestE1rm.keys()) {
    const series = weeklyE1rmSeries(sessions, id, week, s);
    if (!isStagnating(series, s.stagnationWeeks, s.stableThresholdPct)) continue;
    const recent = series.slice(-s.stagnationWeeks);
    const before = Math.max(...series.slice(0, -s.stagnationWeeks).map((x) => x.value));
    out.push({
      id: `stagnation:${id}`,
      kind: 'stagnation',
      title: `Стагнация: ${name(id)}`,
      why:
        `Лучший e1RM ≈ за последние ${s.stagnationWeeks} нед. с этим упражнением: ${recent.map((x) => kg(x.value)).join(', ')}; ` +
        `раньше лучший был ${kg(before)}. Рост не больше порога «стабильно» ±${f1(s.stableThresholdPct)}%. ` +
        `Порог и число недель (${s.stagnationWeeks}) — эвристики, меняются в настройках.`,
      heuristic: true,
      action: 'progression_options',
      exerciseId: id,
    });
  }

  // 2. Накопленная усталость: e1RM базовых упражнений падает 2 недели подряд при том же или большем RPE,
  //    и/или среднее самочувствие ≤ порога.
  const key = [...cur.bestE1rm.keys()].filter((id) => exById.get(id)?.category === 'core' && prev.bestE1rm.has(id) && prev2.bestE1rm.has(id));
  const falling: string[] = [];
  const details: string[] = [];
  for (const id of key) {
    const v0 = cur.bestE1rm.get(id)!.value;
    const v1 = prev.bestE1rm.get(id)!.value;
    const v2 = prev2.bestE1rm.get(id)!.value;
    if (trend(v1, v2, s.stableThresholdPct) !== 'down' || trend(v0, v1, s.stableThresholdPct) !== 'down') continue;
    const rir0 = mean(cur.rirByExercise.get(id) ?? []);
    const rir2 = mean(prev2.rirByExercise.get(id) ?? []);
    if (rir0 == null || rir2 == null) continue; // без записанного RIR/RPE условие проверить нельзя
    const rpe0 = rpeFromRir(rir0);
    const rpe2 = rpeFromRir(rir2);
    if (rpe0 < rpe2) continue;
    falling.push(id);
    details.push(`${name(id)}: e1RM ≈ ${kg(v2)} → ${kg(v1)} → ${kg(v0)}, средний RPE ${f1(rpe2)} → ${f1(rpe0)}`);
  }
  const wb = mean(cur.wellbeing);
  const lowWellbeing = wb != null && wb <= s.fatigueWellbeing;
  const fallingEnough = falling.length > 0 && falling.length >= key.length / 2;
  if (fallingEnough || lowWellbeing) {
    const parts = [];
    if (fallingEnough) parts.push(`Падение e1RM 2 недели подряд при том же или большем RPE: ${details.join('; ')}.`);
    if (lowWellbeing) parts.push(`Среднее самочувствие за неделю ${f1(wb!)} из 5 (порог ≤ ${s.fatigueWellbeing}).`);
    out.push({
      id: 'fatigue',
      kind: 'fatigue',
      title: 'Возможна накопленная усталость — можно запланировать разгрузку',
      why: `${parts.join(' ')} Это эвристика: пороги настраиваются. Решение о разгрузке — за вами.`,
      heuristic: true,
      action: 'deload',
    });
  }

  // 3. Резкий рост объёма на мышечную группу
  for (const [m, n] of cur.muscleSets) {
    const before = prev.muscleSets.get(m) ?? 0;
    if (before <= 0) continue;
    const growth = ((n - before) / before) * 100;
    if (growth > s.volumeJumpPct)
      out.push({
        id: `volume:${m}`,
        kind: 'volume_jump',
        title: `Резкий рост объёма: ${MUSCLES[m].ru}`,
        why: `Рабочих подходов: ${f1(before)} → ${f1(n)} (+${f1(growth)}%), порог +${f1(s.volumeJumpPct)}% — эвристика. Вспомогательная мышца считается как ${f1(s.secondaryMuscleFactor)} подхода (условность).`,
        heuristic: true,
        muscle: m,
      });
  }

  // 4. Мышечная группа из плана без рабочих подходов
  const inPlan = plannedMuscles(plannedInWeek(input.planned, week), exById);
  for (const m of inPlan) {
    if ((cur.muscleSets.get(m) ?? 0) > 0) continue;
    out.push({
      id: `missed:${m}`,
      kind: 'missed_muscle',
      title: `${input.inProgress ? 'Пока без' : 'Без'} рабочих подходов: ${MUSCLES[m].ru}`,
      why: `Мышца — основная в упражнениях плана этой недели, но рабочих подходов на неё ${input.inProgress ? 'пока ' : ''}нет.`,
      heuristic: false,
      muscle: m,
    });
  }
  return out;
}
