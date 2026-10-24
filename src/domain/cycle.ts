// Модуль «Цикл» (ТЗ, раздел 6). Чистые функции.
//
// Научная основа, на которой строится логика:
// — Colenso-Semple et al., 2023, Frontiers in Sports and Active Living (зонтичный обзор): убедительных доказательств
//   влияния фазы цикла на силу и адаптации к силовым тренировкам нет; рекомендован индивидуальный подход;
// — McNulty et al., 2020, Sports Medicine (метаанализ): возможное снижение результатов в раннюю фолликулярную фазу
//   тривиально, качество доказательств низкое; рекомендован индивидуальный подход.
// Поэтому: нагрузка НЕ снижается автоматически из-за фазы; фазы не называются «лучше» или «вреднее».
// Облегчение — только по чек-ину самочувствия или по явно включённому плановому облегчению.

import { bestE1rmInSession, workingSetsOf, type AnalysisSettings, type Session } from './analysis';
import { addDays, daysBetween } from './dates';
import type { CheckIn, CycleData, ISODate, PeriodEntry, PlannedWorkout } from './types';
import { formatNumber } from './units';

/** Если конец менструации не отмечен — считаем её идущей не дольше этого числа дней (для отметок в календаре). */
export const OPEN_PERIOD_MAX_DAYS = 10;

export function sortedPeriods(periods: PeriodEntry[]): PeriodEntry[] {
  return [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Длины завершённых циклов: от начала одной менструации до начала следующей. */
export function cycleLengths(periods: PeriodEntry[]): { start: ISODate; length: number }[] {
  const p = sortedPeriods(periods);
  const out: { start: ISODate; length: number }[] = [];
  for (let i = 0; i + 1 < p.length; i++) out.push({ start: p[i]!.startDate, length: daysBetween(p[i]!.startDate, p[i + 1]!.startDate) });
  return out;
}

export interface AverageLength {
  avg: number | null;
  /** Сколько циклов учтено (последние до 6) */
  count: number;
  /** ТЗ: по последним 3–6 циклам; меньше 3 — оценка грубая */
  reliable: boolean;
  lengths: number[];
}

export function averageCycleLength(periods: PeriodEntry[], maxCycles = 6): AverageLength {
  const lengths = cycleLengths(periods).slice(-maxCycles).map((c) => c.length);
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : null;
  return { avg, count: lengths.length, reliable: lengths.length >= 3, lengths };
}

/** Средняя длительность менструации по отмеченным концам (последние до 6); нет отметок — null. */
export function averagePeriodLength(periods: PeriodEntry[]): number | null {
  const ls = sortedPeriods(periods)
    .filter((p) => p.endDate)
    .slice(-6)
    .map((p) => daysBetween(p.startDate, p.endDate!) + 1);
  return ls.length ? Math.round(ls.reduce((a, b) => a + b, 0) / ls.length) : null;
}

export interface Prediction {
  /** ≈ дата начала следующей менструации */
  start: ISODate;
  /** ≈ дни менструации (если известна средняя длительность; иначе только день начала) */
  days: ISODate[];
  basedOnCycles: number;
  reliable: boolean;
}

/** Прогноз следующей менструации — всегда «≈ примерно». Нужен хотя бы один завершённый цикл. */
export function predictNext(periods: PeriodEntry[]): Prediction | null {
  const p = sortedPeriods(periods);
  const last = p[p.length - 1];
  const avg = averageCycleLength(periods);
  if (!last || avg.avg == null) return null;
  const start = addDays(last.startDate, Math.round(avg.avg));
  const len = averagePeriodLength(periods) ?? 1;
  return { start, days: Array.from({ length: len }, (_, i) => addDays(start, i)), basedOnCycles: avg.count, reliable: avg.reliable };
}

/** День цикла (с 1) для даты: от последнего начала менструации не позже этой даты. */
export function cycleDay(periods: PeriodEntry[], date: ISODate): number | null {
  const p = sortedPeriods(periods).filter((x) => x.startDate <= date);
  const last = p[p.length - 1];
  return last ? daysBetween(last.startDate, date) + 1 : null;
}

/** Отмеченный день менструации (по записям пользовательницы). */
export function isLoggedPeriodDay(periods: PeriodEntry[], date: ISODate): boolean {
  return periods.some((p) => {
    if (date < p.startDate) return false;
    const end = p.endDate ?? addDays(p.startDate, OPEN_PERIOD_MAX_DAYS - 1);
    return date <= end;
  });
}

export function isPredictedPeriodDay(periods: PeriodEntry[], date: ISODate): boolean {
  const pr = predictNext(periods);
  return !!pr && pr.days.includes(date) && !isLoggedPeriodDay(periods, date);
}

export type Phase = 'menstruation' | 'follicular' | 'luteal';

export const PHASE_LABEL: Record<Phase, string> = {
  menstruation: 'менструация',
  follicular: '≈ фолликулярная фаза',
  luteal: '≈ лютеиновая фаза',
};

/**
 * Приблизительная КАЛЕНДАРНАЯ оценка фазы. Без измерения гормонов неточна.
 * Граница фолликулярной и лютеиновой — условно за 14 дней до прогнозируемой менструации
 * (календарная условность, требует проверки; у разных людей и в разных циклах она разная).
 * При гормональной контрацепции естественных фаз нет — возвращает null.
 */
export function approximatePhase(data: CycleData, date: ISODate): { phase: Phase; day: number } | null {
  if (data.settings.contraception === 'hormonal') return null;
  const day = cycleDay(data.periods, date);
  if (day == null) return null;
  if (isLoggedPeriodDay(data.periods, date)) return { phase: 'menstruation', day };
  const avg = averageCycleLength(data.periods).avg;
  if (avg == null) return null;
  return { phase: day <= Math.round(avg) - 14 ? 'follicular' : 'luteal', day };
}

// ——— Чек-ин и облегчение ———

/** ТЗ, 6.3: если энергия ≤ 2 или боль ≥ 2 — предложить варианты на выбор. */
export function needsLightOptions(ci: Pick<CheckIn, 'energy' | 'pain'>): boolean {
  return (ci.energy != null && ci.energy <= 2) || (ci.pain != null && ci.pain >= 2);
}

/**
 * Когда предлагать чек-ин перед тренировкой: в дни менструации (отмеченные или прогнозируемые) — автоматически,
 * в остальные дни — по желанию. Модуль выключен — не предлагать.
 */
export function checkInMode(data: CycleData | null, date: ISODate): 'auto' | 'optional' | 'off' {
  if (!data?.settings.enabled) return 'off';
  return isLoggedPeriodDay(data.periods, date) || isPredictedPeriodDay(data.periods, date) ? 'auto' : 'optional';
}

// ——— Мягкие сигналы (без диагнозов) ———

export interface CycleSignal {
  id: 'no_period_90' | 'length_out_of_range' | 'recurring_pain';
  title: string;
  why: string;
  source: string;
}

const DOCTOR = 'Это не диагноз. Если это повторяется или беспокоит — обсудите с врачом.';

export function cycleSignals(data: CycleData, today: ISODate): CycleSignal[] {
  const out: CycleSignal[] = [];
  const p = sortedPeriods(data.periods);
  const last = p[p.length - 1];
  const hormonal = data.settings.contraception === 'hormonal';

  // Нет менструации ≥ 90 дней (вне беременности и без контрацепции, которая её подавляет)
  if (last && !hormonal && !data.settings.pregnancy) {
    const days = daysBetween(last.startDate, today);
    if (days >= 90)
      out.push({
        id: 'no_period_90',
        title: `Менструации нет ${days} дней`,
        why: `Последнее отмеченное начало — ${days} дней назад. У физически активных женщин отсутствие менструации может быть связано с низкой энергодоступностью. ${DOCTOR}`,
        source: 'IOC consensus statement on REDs (Mountjoy et al., 2023)',
      });
  }

  // Длина цикла стабильно вне 24–38 дней (последние 3 и больше завершённых цикла)
  if (!hormonal) {
    const ls = cycleLengths(data.periods).slice(-3).map((c) => c.length);
    if (ls.length >= 3 && ls.every((l) => l < 24 || l > 38))
      out.push({
        id: 'length_out_of_range',
        title: 'Длина цикла стабильно вне 24–38 дней',
        why: `Последние циклы: ${ls.join(', ')} дн. Обычный диапазон по FIGO — 24–38 дней. ${DOCTOR}`,
        source: 'FIGO, Munro et al., 2018',
      });
  }

  // Боль 3 из 3 повторяется из цикла в цикл: в каждом из двух последних циклов
  const starts = p.map((x) => x.startDate);
  const painIn = (from: ISODate, to: ISODate | null) => data.checkIns.some((c) => c.pain === 3 && c.date >= from && (to == null || c.date < to));
  if (starts.length >= 2) {
    const a = starts[starts.length - 2]!;
    const b = starts[starts.length - 1]!;
    if (painIn(a, b) && painIn(b, null))
      out.push({
        id: 'recurring_pain',
        title: 'Сильная боль (3 из 3) повторяется из цикла в цикл',
        why: `Боль 3 из 3 отмечена в двух последних циклах подряд. ${DOCTOR} Тренироваться через боль не нужно.`,
        source: 'эвристика приложения (критерий из ТЗ)',
      });
  }
  return out;
}

// ——— Личная аналитика (после ≥ 3 записанных циклов) ———

export type CycleMetric = 'e1rm' | 'rpe' | 'wellbeing' | 'completion';

export const CYCLE_METRIC_LABEL: Record<CycleMetric, string> = {
  e1rm: 'e1RM ≈, % к своему среднему',
  rpe: 'RPE при одинаковом весе, отклонение',
  wellbeing: 'Самочувствие, 1–5',
  completion: 'Выполнение плана, %',
};

/** Порог «заметной» разницы между днями менструации и остальными — эвристика. */
export const PATTERN_THRESHOLD: Record<CycleMetric, number> = { e1rm: 2, rpe: 0.5, wellbeing: 0.5, completion: 15 };

export interface CycleComparison {
  metric: CycleMetric;
  /** Разница «дни менструации − остальные» по каждому завершённому циклу */
  perCycle: number[];
  meanDiff: number | null;
  verdict: 'pattern' | 'noise' | 'insufficient';
}

export interface CycleAnalytics {
  completeCycles: number;
  enough: boolean;
  /** Среднее значение метрики по дню цикла */
  byDay: Record<CycleMetric, { day: number; value: number; n: number }[]>;
  comparisons: CycleComparison[];
}

interface Point {
  date: ISODate;
  value: number;
}

function sessionPoints(sessions: Session[], s: AnalysisSettings): Record<'e1rm' | 'rpe' | 'wellbeing', Point[]> {
  // e1RM: % к среднему этого упражнения; RPE: отклонение от среднего RPE для того же упражнения и веса
  const e1rmByEx = new Map<string, { date: ISODate; v: number }[]>();
  const rpeByKey = new Map<string, { date: ISODate; v: number }[]>();
  const wellbeing: Point[] = [];
  for (const session of sessions) {
    if (session.workout.wellbeing != null) wellbeing.push({ date: session.date, value: session.workout.wellbeing });
    for (const se of session.exercises) {
      const b = bestE1rmInSession(se, session, s);
      if (b) e1rmByEx.set(se.ex.id, [...(e1rmByEx.get(se.ex.id) ?? []), { date: session.date, v: b.value }]);
      for (const set of workingSetsOf(se)) {
        if (set.rir == null || set.weightKg == null) continue;
        const k = `${se.ex.id}@${Math.round(set.weightKg * 100)}`;
        rpeByKey.set(k, [...(rpeByKey.get(k) ?? []), { date: session.date, v: 10 - set.rir }]);
      }
    }
  }
  const norm = (m: Map<string, { date: ISODate; v: number }[]>, f: (v: number, mean: number) => number, minN: number): Point[] => {
    const out: Point[] = [];
    for (const list of m.values()) {
      if (list.length < minN) continue;
      const mean = list.reduce((a, b) => a + b.v, 0) / list.length;
      for (const x of list) out.push({ date: x.date, value: f(x.v, mean) });
    }
    return out;
  };
  return {
    e1rm: norm(e1rmByEx, (v, mean) => (v / mean - 1) * 100, 2),
    rpe: norm(rpeByKey, (v, mean) => v - mean, 2),
    wellbeing,
  };
}

export function cycleAnalytics(sessions: Session[], planned: PlannedWorkout[], data: CycleData, today: ISODate, s: AnalysisSettings): CycleAnalytics {
  const periods = sortedPeriods(data.periods);
  const complete = cycleLengths(periods);
  const enough = complete.length >= 3;
  const pts = sessionPoints(sessions, s);
  const completion: Point[] = planned
    .filter((p) => !p.deletedAt && p.status !== 'moved' && p.date < today)
    .map((p) => ({ date: p.date, value: p.status === 'done' || p.status === 'partial' ? 100 : 0 }));
  const all: Record<CycleMetric, Point[]> = { ...pts, completion };

  const byDay = {} as CycleAnalytics['byDay'];
  const comparisons: CycleComparison[] = [];
  for (const metric of Object.keys(all) as CycleMetric[]) {
    const buckets = new Map<number, number[]>();
    for (const p of all[metric]) {
      const d = cycleDay(periods, p.date);
      if (d == null || d > 45) continue;
      buckets.set(d, [...(buckets.get(d) ?? []), p.value]);
    }
    byDay[metric] = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([day, vs]) => ({ day, value: vs.reduce((a, b) => a + b, 0) / vs.length, n: vs.length }));

    const perCycle: number[] = [];
    for (const c of complete) {
      const end = addDays(c.start, c.length);
      const inCycle = all[metric].filter((p) => p.date >= c.start && p.date < end);
      const pd = inCycle.filter((p) => isLoggedPeriodDay(periods, p.date)).map((p) => p.value);
      const other = inCycle.filter((p) => !isLoggedPeriodDay(periods, p.date)).map((p) => p.value);
      if (pd.length && other.length) perCycle.push(pd.reduce((a, b) => a + b, 0) / pd.length - other.reduce((a, b) => a + b, 0) / other.length);
    }
    const meanDiff = perCycle.length ? perCycle.reduce((a, b) => a + b, 0) / perCycle.length : null;
    const sameSign = perCycle.length > 0 && (perCycle.every((x) => x > 0) || perCycle.every((x) => x < 0));
    const verdict: CycleComparison['verdict'] =
      !enough || perCycle.length < 3 ? 'insufficient' : sameSign && Math.abs(meanDiff ?? 0) >= PATTERN_THRESHOLD[metric] ? 'pattern' : 'noise';
    comparisons.push({ metric, perCycle, meanDiff, verdict });
  }
  return { completeCycles: complete.length, enough, byDay, comparisons };
}

/** Текст вывода по сравнению — строго из чисел. */
export function comparisonText(c: CycleComparison): string {
  const f = (n: number) => formatNumber(Math.abs(n), 1);
  const unit = c.metric === 'e1rm' || c.metric === 'completion' ? '%' : '';
  if (c.verdict === 'insufficient') return `Мало данных: нужно ≥ 3 завершённых цикла с тренировками и в дни менструации, и в остальные (сейчас сравнимых циклов: ${c.perCycle.length}).`;
  const dir = (c.meanDiff ?? 0) < 0 ? 'ниже' : 'выше';
  if (c.verdict === 'noise')
    return `Устойчивой закономерности нет: разница между днями менструации и остальными в пределах шума (в среднем ${f(c.meanDiff ?? 0)}${unit}, по циклам: ${c.perCycle.map((x) => formatNumber(x, 1)).join('; ')}).`;
  return `В дни менструации показатель в среднем на ${f(c.meanDiff ?? 0)}${unit} ${dir}, одинаково во всех ${c.perCycle.length} циклах. Можно (но не обязательно) учесть это в плане.`;
}
