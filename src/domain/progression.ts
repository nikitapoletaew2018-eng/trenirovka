// Предложения на следующую неделю (ТЗ, раздел 5.3) и разгрузка (5.4).
// Приложение ПРЕДЛАГАЕТ; план меняется только после подтверждения пользователя.

import { workingSetsOf, type Session } from './analysis';
import type { Exercise, PlannedItem, ProgressionRule } from './types';

export interface Performance {
  date: string;
  /** Рабочие подходы: вес (для собственного веса — доп. вес), повторы, RIR */
  sets: { weightKg: number | null; reps: number | null; rir: number | null }[];
  plan: PlannedItem | null;
}

export type SuggestionKind = 'increase' | 'add_rep' | 'same' | 'choose' | 'none';

export type OptionId = 'apply_rule' | 'keep' | 'reduce5' | 'reduce10' | 'replace' | 'change_range' | 'deload';

export interface SuggestionOption {
  id: OptionId;
  label: string;
  /** Предлагаемый пункт плана; нет — действие выполняется вручную (замена, смена диапазона) */
  item?: PlannedItem;
}

export interface Suggestion {
  exerciseId: string;
  kind: SuggestionKind;
  /** Предлагаемый пункт плана (для kind = choose — вариант по умолчанию «оставить как есть») */
  item: PlannedItem;
  reason: string;
  heuristic: boolean;
  options?: SuggestionOption[];
}

/** Выполнения упражнения из тренировок (по возрастанию даты), только с рабочими подходами. */
export function performancesOf(sessions: Session[], exerciseId: string): Performance[] {
  const out: Performance[] = [];
  for (const session of sessions) {
    for (const se of session.exercises) {
      if (se.ex.id !== exerciseId) continue;
      const ws = workingSetsOf(se);
      if (!ws.length) continue;
      out.push({
        date: session.date,
        plan: se.we.plan ?? null,
        sets: ws.map((x) => ({
          weightKg: se.ex.trackingType === 'bodyweight_reps' ? x.addedWeightKg ?? 0 : x.weightKg ?? null,
          reps: x.reps ?? null,
          rir: x.rir ?? null,
        })),
      });
    }
  }
  return out;
}

function roundToStep(kg: number, step: number): number {
  return Math.round(Math.round(kg / step) * step * 1000) / 1000;
}

export interface SuggestArgs {
  exercise: Exercise;
  /** Текущий пункт плана (из этой недели), его копия пойдёт на следующую */
  current: PlannedItem;
  history: Performance[];
  rule: ProgressionRule;
  lowerBoundFailSessions: number;
  stagnating: boolean;
  unitLabel: string;
  /** Конвертер для текста причины (кг → единицы отображения) */
  fmt: (kg: number) => string;
}

export function suggestNext(a: SuggestArgs): Suggestion {
  const { exercise: ex, current, history } = a;
  const base: PlannedItem = { ...current, reason: null };
  const none = (reason: string): Suggestion => ({ exerciseId: ex.id, kind: 'none', item: base, reason, heuristic: false });

  if (ex.trackingType === 'time' || ex.trackingType === 'weight_time')
    return none('Для упражнений на время правило прогрессии не задано — план без изменений.');
  const last = history[history.length - 1];
  if (!last) return none('Нет выполненных рабочих подходов — план без изменений.');

  const reps = last.sets.map((x) => x.reps ?? 0);
  const weights = last.sets.map((x) => x.weightKg).filter((x): x is number => x != null);
  const topWeight = weights.length ? Math.max(...weights) : null;
  const hasWeight = ex.trackingType !== 'reps' && topWeight != null;
  const step = ex.weightStepKg;
  const enoughSets = last.sets.length >= current.sets;
  const minReps = Math.min(...reps);
  const target = current.targetRir;
  const rirKnown = last.sets.every((x) => x.rir != null);
  const rirOk = target == null || last.sets.every((x) => x.rir == null || x.rir >= target);

  const make = (patch: Partial<PlannedItem>, reason: string): PlannedItem => ({ ...base, ...patch, reason });

  // Нижняя граница не выполнена N тренировок подряд → выбор (эвристика)
  const recent = history.slice(-a.lowerBoundFailSessions);
  const lowerFail =
    recent.length >= a.lowerBoundFailSessions &&
    recent.every((p) => p.sets.some((x) => (x.reps ?? 0) < (p.plan?.repMin ?? current.repMin)));

  // Результат основного правила
  let rule: { kind: SuggestionKind; item: PlannedItem; reason: string };
  if (a.rule === 'double') {
    const allTop = enoughSets && reps.every((r) => r >= current.repMax) && rirOk;
    if (allTop && hasWeight) {
      const w = roundToStep(topWeight + step, step);
      rule = {
        kind: 'increase',
        item: make({ suggestedWeightKg: w, targetReps: current.repMin }, ''),
        reason:
          `Двойная прогрессия: во всех ${last.sets.length} рабочих подходах ≥ ${current.repMax} повт.` +
          (target != null ? (rirKnown ? ` при RIR ≥ ${target}` : ' (RIR записан не везде — условие по RIR проверено только там, где он есть)') : '') +
          ` → вес ${a.fmt(topWeight)} → ${a.fmt(w)} (шаг ${a.fmt(step)}), цель — ${current.repMin} повт.`,
      };
    } else if (allTop && !hasWeight) {
      rule = {
        kind: 'add_rep',
        item: make({ targetReps: null }, ''),
        reason: `Во всех подходах достигнута верхняя граница ${current.repMax} повт. Для упражнений без веса добавьте подход или расширьте диапазон — это решение за вами.`,
      };
    } else {
      const t = Math.min(current.repMax, minReps + 1);
      rule = {
        kind: 'add_rep',
        item: make({ suggestedWeightKg: topWeight ?? current.suggestedWeightKg ?? null, targetReps: t }, ''),
        reason:
          `Двойная прогрессия: верхняя граница ${current.repMax} повт. достигнута не во всех подходах` +
          (!enoughSets ? ` (выполнено ${last.sets.length} из ${current.sets})` : '') +
          (!rirOk ? `, или RIR ниже целевого ${target}` : '') +
          ` → тот же вес${topWeight != null ? ` ${a.fmt(topWeight)}` : ''}, цель +1 повтор: ${t}.`,
      };
    }
  } else {
    const allDone = enoughSets && reps.every((r) => r >= current.repMin);
    if (allDone && hasWeight) {
      const w = roundToStep(topWeight + step, step);
      rule = {
        kind: 'increase',
        item: make({ suggestedWeightKg: w, targetReps: null }, ''),
        reason: `Линейная прогрессия: все ${current.sets} рабочих подхода выполнены (≥ ${current.repMin} повт.) → вес ${a.fmt(topWeight)} → ${a.fmt(w)}.`,
      };
    } else {
      rule = {
        kind: 'same',
        item: make({ suggestedWeightKg: topWeight ?? current.suggestedWeightKg ?? null, targetReps: null }, ''),
        reason: `Линейная прогрессия: не все рабочие подходы выполнены (≥ ${current.repMin} повт.) → тот же вес${topWeight != null ? ` ${a.fmt(topWeight)}` : ''}.`,
      };
    }
  }
  rule.item.reason = rule.reason;

  if (lowerFail && hasWeight) {
    const keep = make({ suggestedWeightKg: topWeight, targetReps: null }, `Оставить вес ${a.fmt(topWeight)}`);
    const r5 = roundToStep(topWeight * 0.95, step);
    const r10 = roundToStep(topWeight * 0.9, step);
    return {
      exerciseId: ex.id,
      kind: 'choose',
      item: keep,
      heuristic: true,
      reason:
        `Нижняя граница ${current.repMin} повт. не выполнена ${a.lowerBoundFailSessions} тренировки подряд (минимум в последней: ${minReps}). ` +
        'Варианты на выбор — это эвристика, число тренировок настраивается.',
      options: [
        { id: 'keep', label: `Оставить вес ${a.fmt(topWeight)}`, item: keep },
        { id: 'reduce5', label: `Снизить на 5%: ${a.fmt(r5)}`, item: make({ suggestedWeightKg: r5, targetReps: null }, `Снижение веса на 5% после невыполнения нижней границы`) },
        { id: 'reduce10', label: `Снизить на 10%: ${a.fmt(r10)}`, item: make({ suggestedWeightKg: r10, targetReps: null }, `Снижение веса на 10% после невыполнения нижней границы`) },
        { id: 'replace', label: 'Заменить вариант упражнения (в редакторе плана)' },
      ],
    };
  }

  if (a.stagnating) {
    return {
      exerciseId: ex.id,
      kind: 'choose',
      item: rule.item,
      heuristic: true,
      reason: `Сигнал стагнации по e1RM. Варианты на выбор, автоматически ничего не меняется. По правилу: ${rule.reason}`,
      options: [
        { id: 'apply_rule', label: 'Продолжить по правилу прогрессии', item: rule.item },
        { id: 'change_range', label: 'Сменить диапазон повторов (в редакторе плана)' },
        { id: 'replace', label: 'Сменить вариант упражнения (в редакторе плана)' },
        { id: 'deload', label: 'Разгрузка на следующей неделе' },
      ],
    };
  }

  return { exerciseId: ex.id, kind: rule.kind, item: rule.item, reason: rule.reason, heuristic: false };
}

// ——— Разгрузка ———

export interface DeloadParams {
  setsFactor: number;
  weightFactor: number;
  minRir: number;
}

/**
 * Разгрузочный вариант пункта плана. Значения по умолчанию (ТЗ, 5.4): −50% подходов, вес тот же или −10%,
 * RIR ≥ 3. Это практические значения, а не строгая норма: исследований мало (Bell et al., 2023).
 */
export function deloadItem(item: PlannedItem, p: DeloadParams, stepKg: number): PlannedItem {
  const sets = Math.max(1, Math.round(item.sets * p.setsFactor));
  const w = item.suggestedWeightKg == null ? null : roundToStep(item.suggestedWeightKg * p.weightFactor, stepKg);
  const rir = Math.max(item.targetRir ?? p.minRir, p.minRir);
  const parts = [`подходов ${item.sets} → ${sets}`, `RIR ≥ ${rir}`, p.weightFactor === 1 ? 'вес тот же' : `вес −${Math.round((1 - p.weightFactor) * 100)}%`];
  return { ...item, sets, suggestedWeightKg: w, targetRir: rir, targetReps: null, reason: `Разгрузка: ${parts.join(', ')}.` };
}
