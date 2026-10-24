import { describe, expect, it } from 'vitest';
import { buildSessions, type AnalysisSettings } from './analysis';
import { platesPerSide, warmupSets } from './calculators';
import { deloadItem, performancesOf, suggestNext, suggestionCandidates, type SuggestArgs } from './progression';
import { exerciseSeries } from './series';
import { computeRecords } from './records';
import { weeklyReport } from './report';
import { computeSignals, isStagnating } from './signals';
import type { Exercise, PlannedItem, PlannedWorkout, SetType, Workout, WorkoutExercise, WorkoutSet } from './types';

// ——— Фикстуры ———
const T = '2026-01-01T00:00:00.000Z';
const ent = (id: string) => ({ id, createdAt: T, updatedAt: T, deletedAt: null });

function ex(id: string, o: Partial<Exercise>): Exercise {
  return {
    ...ent(id),
    nameRu: id,
    nameEn: id,
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: [],
    trackingType: 'weight_reps',
    isUnilateral: false,
    category: 'core',
    isStructural: false,
    equipmentType: 'free_weight',
    movementPattern: 'horizontal_push',
    lighterAlternatives: [],
    instructions: [],
    commonMistakes: [],
    defaultRestSec: 120,
    weightStepKg: 2.5,
    source: 'test',
    isCustom: false,
    ...o,
  };
}

const BENCH = ex('bench', { nameRu: 'Жим', primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'front_delts'] });
const CURL = ex('curl', { nameRu: 'Сгибания', category: 'assistance', movementPattern: 'isolation', primaryMuscles: ['biceps'], secondaryMuscles: ['forearms'] });
const SQUAT = ex('squat', { nameRu: 'Присед', primaryMuscles: ['quads'], secondaryMuscles: ['glutes'], movementPattern: 'squat' });
const PULLUP = ex('pullup', { trackingType: 'bodyweight_reps', primaryMuscles: ['lats'], movementPattern: 'vertical_pull' });
const PLANK = ex('plank', { trackingType: 'time', primaryMuscles: ['abs'], movementPattern: 'core', category: 'assistance' });
const EXERCISES = [BENCH, CURL, SQUAT, PULLUP, PLANK];

type S = [number, number, number?, SetType?]; // вес, повторы, RIR, тип

interface Db {
  workouts: Workout[];
  wes: WorkoutExercise[];
  sets: WorkoutSet[];
}

let seq = 0;
function db(): Db {
  return { workouts: [], wes: [], sets: [] };
}

function workout(d: Db, date: string, items: { ex: Exercise; sets: S[]; plan?: PlannedItem; replacedFrom?: string }[], extra: Partial<Workout> = {}): Workout {
  const w: Workout = {
    ...ent(`w${++seq}`),
    name: 'T',
    startedAt: `${date}T10:00:00.000Z`,
    finishedAt: `${date}T11:00:00.000Z`,
    timeZone: 'UTC',
    isLightVersion: false,
    ...extra,
  };
  d.workouts.push(w);
  items.forEach((it, i) => {
    const we: WorkoutExercise = { ...ent(`we${++seq}`), workoutId: w.id, exerciseId: it.ex.id, order: i, plan: it.plan ?? null, replacedFromExerciseId: it.replacedFrom ?? null };
    d.wes.push(we);
    it.sets.forEach(([kg, reps, rir, type], j) => {
      d.sets.push({
        ...ent(`s${++seq}`),
        workoutExerciseId: we.id,
        workoutId: w.id,
        order: j,
        setType: type ?? 'working',
        weightKg: it.ex.trackingType === 'weight_reps' ? kg : null,
        addedWeightKg: it.ex.trackingType === 'bodyweight_reps' ? kg : null,
        durationSec: it.ex.trackingType === 'time' ? kg : null,
        reps: it.ex.trackingType === 'time' ? null : reps,
        rir: rir ?? null,
        completed: true,
      });
    });
  });
  return w;
}

const sessions = (d: Db) => buildSessions(d.workouts, d.wes, d.sets, EXERCISES);

const SETTINGS: AnalysisSettings = {
  e1rmFormula: 'epley',
  secondaryMuscleFactor: 0.5,
  includeBodyweightInTonnage: false,
  bodyWeightKg: 80,
  stableThresholdPct: 2,
  stagnationWeeks: 3,
  volumeJumpPct: 20,
  rirTolerance: 1,
  fatigueWellbeing: 2,
};

function planned(date: string, items: PlannedItem[], status: PlannedWorkout['status'] = 'planned'): PlannedWorkout {
  return { ...ent(`p${++seq}`), date, name: 'P', plannedItems: items, status };
}

const item = (exerciseId: string, sets: number, repMin: number, repMax: number, targetRir: number | null = 2, w: number | null = null): PlannedItem => ({
  exerciseId,
  sets,
  repMin,
  repMax,
  targetRir,
  suggestedWeightKg: w,
});

const W = '2026-10-19'; // понедельник
const report = (d: Db, plan: PlannedWorkout[] = [], unit: 'kg' | 'lb' = 'kg') =>
  weeklyReport({ week: W, sessions: sessions(d), planned: plan, exercises: EXERCISES, settings: SETTINGS, unit });

// ——— Недельный отчёт: эталон, посчитанный вручную ———
describe('недельный отчёт — совпадает с ручным расчётом', () => {
  const d = db();
  // Прошлая неделя: жим 100×5 ×3
  workout(d, '2026-10-12', [{ ex: BENCH, sets: [[100, 5], [100, 5], [100, 5]] }]);
  // Пн: разминка 60×5 + жим 100×5, 100×5, 100×4 (RIR 2, 2, 1) по плану с целевым RIR 2
  const plan = item('bench', 3, 4, 6, 2, 100);
  workout(d, '2026-10-19', [{ ex: BENCH, plan, sets: [[60, 5, undefined, 'warmup'], [100, 5, 2], [100, 5, 2], [100, 4, 1]] }], { wellbeing: 4 });
  // Чт: жим 102,5×5 ×2; сгибания 15×10 ×3
  workout(d, '2026-10-22', [
    { ex: BENCH, sets: [[102.5, 5], [102.5, 5]] },
    { ex: CURL, sets: [[15, 10], [15, 10], [15, 10]] },
  ], { wellbeing: 3 });
  const plans = [planned('2026-10-19', [item('bench', 3, 4, 6)], 'done'), planned('2026-10-24', [item('squat', 3, 5, 8)])];
  const r = report(d, plans);

  it('план / факт', () => {
    // 2 запланированы, 1 выполнена; 6 подходов в плане, 3 + 2 + 3 = 8 рабочих → 133%
    expect(r.planFact).toMatchObject({ plannedWorkouts: 2, doneWorkouts: 1, plannedSets: 6, workingSets: 8, sessions: 2 });
    expect(r.planFact.completionPct).toBeCloseTo(133.33, 1);
  });
  it('тоннаж: разминка не считается', () => {
    // 100×5 + 100×5 + 100×4 = 1400; 102,5×5×2 = 1025; 15×10×3 = 450 → 2875; прошлая 1500
    expect(r.tonnage.total).toBe(2875);
    expect(r.tonnage.lastWeek).toBe(1500);
    expect(r.tonnage.change).toEqual({ kind: 'pct', value: ((2875 - 1500) / 1500) * 100 });
    expect(r.tonnage.byExercise.find((x) => x.exerciseId === 'bench')?.value).toBe(2425);
    expect(r.tonnage.byExercise.find((x) => x.exerciseId === 'curl')?.change).toEqual({ kind: 'new' });
  });
  it('подходы на мышцы: основная = 1, вспомогательная = 0,5', () => {
    const m = Object.fromEntries(r.muscles.map((x) => [x.muscle, x.thisWeek]));
    expect(m).toMatchObject({ chest: 5, triceps: 2.5, front_delts: 2.5, biceps: 3, forearms: 1.5, quads: 0 });
    expect(r.muscles.find((x) => x.muscle === 'chest')).toMatchObject({ lastWeek: 3, avg4: 2 }); // (5 + 3 + 0 + 0) / 4
  });
  it('лучший e1RM и статус', () => {
    // Epley: 102,5 × (1 + 5/30) = 119,583; прошлая неделя 100 × 7/6 = 116,667; +2,5% > порога 2% → ↑
    const b = r.e1rm.find((x) => x.exerciseId === 'bench')!;
    expect(b.value).toBeCloseTo(119.583, 3);
    expect(b.lastWeek).toBeCloseTo(116.667, 3);
    expect(b.changeVsLast?.kind === 'pct' && b.changeVsLast.value).toBeCloseTo(2.5, 6);
    expect(b.status).toBe('up');
    expect(b.fourWeeksAgo).toBeNull();
  });
  it('RIR / RPE и доля в целевом диапазоне', () => {
    expect(r.effort.avgRir).toBeCloseTo(5 / 3, 6);
    expect(r.effort.avgRpe).toBeCloseTo(10 - 5 / 3, 6);
    expect(r.effort).toMatchObject({ withRir: 3, withTarget: 3, inTarget: 3, inTargetPct: 100 });
  });
  it('рекорды недели: вес 102,5 и e1RM; первое выполнение сгибаний — не рекорд', () => {
    expect(r.records.map((x) => x.kind).sort()).toEqual(['e1rm', 'max_weight']);
    expect(r.records.every((x) => x.exerciseId === 'bench')).toBe(true);
  });
  it('самочувствие и баланс движений', () => {
    expect(r.wellbeing).toEqual({ avg: 3.5, count: 2 });
    expect(r.balance).toEqual({ push: 5, pull: 0, upper: 14.5, lower: 0 });
  });
  it('выводы — из посчитанных данных', () => {
    expect(r.summary.length).toBeGreaterThanOrEqual(3);
    expect(r.summary.length).toBeLessThanOrEqual(5);
    expect(r.summary[0]).toBe('Тренировок по плану: 1 из 2; рабочих подходов: 8 из 6 (133%).');
    expect(r.summary).toContain('Без рабочих подходов, хотя были в плане: Квадрицепс.');
    expect(r.summary).toContain('Новых личных рекордов: 2.');
  });
  it('смена единиц не меняет чисел отчёта (только текст выводов)', () => {
    const lb = report(d, plans, 'lb');
    expect(lb.tonnage).toEqual(r.tonnage);
    expect(lb.e1rm).toEqual(r.e1rm);
  });
});

describe('недельный отчёт — крайние случаи', () => {
  it('неделя без тренировок', () => {
    const r = report(db());
    expect(r.isEmpty).toBe(true);
    expect(r.planFact).toMatchObject({ sessions: 0, workingSets: 0, plannedSets: 0, completionPct: null });
    expect(r.tonnage.total).toBe(0);
    expect(r.tonnage.change).toBeNull();
    expect(r.summary).toEqual(['За неделю тренировок нет.']);
    expect(r.effort.inTargetPct).toBeNull();
  });
  it('только разминочные подходы', () => {
    const d = db();
    workout(d, '2026-10-20', [{ ex: BENCH, sets: [[40, 10, undefined, 'warmup'], [60, 5, undefined, 'warmup']] }]);
    const r = report(d);
    expect(r.planFact.workingSets).toBe(0);
    expect(r.tonnage.total).toBe(0);
    expect(r.e1rm).toEqual([]);
    expect(r.muscles.every((m) => m.thisWeek === 0)).toBe(true);
    expect(r.records).toEqual([]);
  });
  it('отредактированная прошлая тренировка — отчёт пересчитывается', () => {
    const d = db();
    workout(d, '2026-10-20', [{ ex: BENCH, sets: [[100, 5]] }]);
    expect(report(d).tonnage.total).toBe(500);
    d.sets[0]!.weightKg = 110; // правка в истории
    expect(report(d).tonnage.total).toBe(550);
    d.sets[0]!.deletedAt = T; // удалили подход
    expect(report(d).tonnage.total).toBe(0);
  });
  it('замена упражнения: подходы засчитываются выполненному упражнению', () => {
    const d = db();
    workout(d, '2026-10-20', [{ ex: CURL, replacedFrom: 'bench', sets: [[15, 10]] }]);
    const r = report(d);
    expect(r.muscles.find((m) => m.muscle === 'biceps')?.thisWeek).toBe(1);
    expect(r.muscles.find((m) => m.muscle === 'chest')).toBeUndefined();
  });
  it('незавершённая и удалённая тренировки не учитываются', () => {
    const d = db();
    workout(d, '2026-10-20', [{ ex: BENCH, sets: [[100, 5]] }], { finishedAt: null });
    workout(d, '2026-10-21', [{ ex: BENCH, sets: [[100, 5]] }], { deletedAt: T });
    expect(report(d).isEmpty).toBe(true);
  });
  it('собственный вес: e1RM по эффективному весу, в тоннаж не входит', () => {
    const d = db();
    workout(d, '2026-10-20', [{ ex: PULLUP, sets: [[10, 5]] }], { bodyWeightKg: 80 });
    const r = report(d);
    expect(r.tonnage.total).toBe(0);
    expect(r.e1rm[0]?.value).toBeCloseTo(90 * (1 + 5 / 30), 6);
  });
});

describe('рекорды', () => {
  it('повторы с тем же весом, время, первый раз — не рекорд', () => {
    const d = db();
    workout(d, '2026-10-01', [{ ex: BENCH, sets: [[80, 8]] }, { ex: PLANK, sets: [[60, 0]] }]);
    workout(d, '2026-10-08', [{ ex: BENCH, sets: [[80, 9]] }, { ex: PLANK, sets: [[75, 0]] }]);
    const { records, events } = computeRecords(sessions(d), SETTINGS);
    expect(events.map((e) => e.kind).sort()).toEqual(['e1rm', 'max_duration', 'reps_at_weight', 'volume']);
    expect(records.get('bench')?.repsAtWeight.get(80)?.value).toBe(9);
    expect(records.get('plank')?.maxDuration?.value).toBe(75);
    expect(records.get('bench')?.maxWeight).toMatchObject({ value: 80, extra: 8 }); // вес не вырос
  });
});

describe('сигналы', () => {
  it('стагнация: рост e1RM не больше порога N недель', () => {
    expect(isStagnating([{ value: 100 }, { value: 100.5 }, { value: 101 }, { value: 100.8 }], 3, 2)).toBe(true);
    expect(isStagnating([{ value: 100 }, { value: 100.5 }, { value: 103 }, { value: 100.8 }], 3, 2)).toBe(false);
    expect(isStagnating([{ value: 100 }, { value: 100 }, { value: 100 }], 3, 2)).toBe(false); // мало данных
  });

  function weeks(values: [number, number?][], wellbeing?: number) {
    const d = db();
    const dates = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'].slice(-values.length);
    values.forEach(([kg, rir], i) => workout(d, dates[i]!, [{ ex: BENCH, sets: [[kg, 5, rir], [kg, 5, rir]] }], { wellbeing: i === values.length - 1 ? wellbeing ?? null : null }));
    return d;
  }
  const sig = (d: Db, plan: PlannedWorkout[] = []) =>
    computeSignals({ week: W, sessions: sessions(d), planned: plan, exercises: EXERCISES, settings: SETTINGS, inProgress: false });

  it('стагнация срабатывает с «Почему?»', () => {
    const s = sig(weeks([[100], [100], [101], [100]]));
    const st = s.find((x) => x.kind === 'stagnation');
    expect(st?.exerciseId).toBe('bench');
    expect(st?.why).toContain('эвристики');
  });
  it('усталость: e1RM падает 2 недели подряд при росте RPE → предложить разгрузку', () => {
    const s = sig(weeks([[110, 2], [105, 2], [100, 1]]));
    expect(s.find((x) => x.kind === 'fatigue')).toMatchObject({ action: 'deload', heuristic: true });
  });
  it('усталость: не срабатывает, если RPE снизился или не записан', () => {
    expect(sig(weeks([[110, 1], [105, 2], [100, 2]])).some((x) => x.kind === 'fatigue')).toBe(false);
    expect(sig(weeks([[110], [105], [100]])).some((x) => x.kind === 'fatigue')).toBe(false);
  });
  it('усталость: по самочувствию ≤ 2', () => {
    expect(sig(weeks([[100], [100]], 2)).some((x) => x.kind === 'fatigue')).toBe(true);
    expect(sig(weeks([[100], [100]], 3)).some((x) => x.kind === 'fatigue')).toBe(false);
  });
  it('резкий рост объёма > +20% (эвристика); ровно +20% — нет', () => {
    const d = db();
    workout(d, '2026-10-12', [{ ex: BENCH, sets: Array.from({ length: 5 }, () => [100, 5] as S) }]);
    workout(d, '2026-10-19', [{ ex: BENCH, sets: Array.from({ length: 7 }, () => [100, 5] as S) }]);
    expect(sig(d).find((x) => x.id === 'volume:chest')).toBeTruthy();
    const d2 = db();
    workout(d2, '2026-10-12', [{ ex: BENCH, sets: Array.from({ length: 5 }, () => [100, 5] as S) }]);
    workout(d2, '2026-10-19', [{ ex: BENCH, sets: Array.from({ length: 6 }, () => [100, 5] as S) }]);
    expect(sig(d2).find((x) => x.id === 'volume:chest')).toBeUndefined();
  });
  it('мышца из плана без рабочих подходов', () => {
    const s = sig(db(), [planned('2026-10-21', [item('squat', 3, 5, 8)])]);
    expect(s.map((x) => x.id)).toEqual(['missed:quads']);
  });
});

describe('прогрессия', () => {
  const fmt = (kg: number) => `${kg} кг`;
  const hist = (...rows: S[][]) =>
    rows.map((sets, i) => ({ date: `2026-10-${10 + i}`, plan: item('bench', 3, 8, 12, 2), sets: sets.map(([w, r, rir]) => ({ weightKg: w, reps: r, rir: rir ?? null })) }));
  const args = (o: Partial<SuggestArgs>): SuggestArgs => ({
    exercise: BENCH,
    current: item('bench', 3, 8, 12, 2, 80),
    history: [],
    rule: 'double',
    lowerBoundFailSessions: 2,
    stagnating: false,
    unitLabel: 'кг',
    fmt,
    ...o,
  });

  it('двойная: верх диапазона во всех подходах и RIR ≥ цели → вес + шаг, цель — низ диапазона', () => {
    const s = suggestNext(args({ history: hist([[80, 12, 2], [80, 12, 2], [80, 12, 3]]) }));
    expect(s.kind).toBe('increase');
    expect(s.item).toMatchObject({ suggestedWeightKg: 82.5, targetReps: 8 });
    expect(s.reason).toContain('Двойная прогрессия');
  });
  it('двойная: RIR ниже целевого → тот же вес, +1 повтор', () => {
    const s = suggestNext(args({ history: hist([[80, 12, 1], [80, 12, 2], [80, 12, 2]]) }));
    expect(s.kind).toBe('add_rep');
    expect(s.item).toMatchObject({ suggestedWeightKg: 80, targetReps: 12 });
  });
  it('двойная: не все подходы на верхней границе → тот же вес, цель +1 к минимуму', () => {
    const s = suggestNext(args({ history: hist([[80, 10], [80, 9], [80, 9]]) }));
    expect(s).toMatchObject({ kind: 'add_rep', item: { suggestedWeightKg: 80, targetReps: 10 } });
  });
  it('нижняя граница не выполнена 2 тренировки подряд → выбор (эвристика)', () => {
    const s = suggestNext(args({ history: hist([[80, 7], [80, 6], [80, 6]], [[80, 7], [80, 7], [80, 6]]) }));
    expect(s.kind).toBe('choose');
    expect(s.heuristic).toBe(true);
    expect(s.options?.map((o) => o.id)).toEqual(['keep', 'reduce5', 'reduce10', 'replace']);
    expect(s.options?.find((o) => o.id === 'reduce5')?.item?.suggestedWeightKg).toBe(75); // 76 → кратно 2,5
    expect(s.options?.find((o) => o.id === 'reduce10')?.item?.suggestedWeightKg).toBe(72.5);
  });
  it('линейная: все подходы выполнены → + шаг; нет — тот же вес', () => {
    expect(suggestNext(args({ rule: 'linear', history: hist([[80, 8], [80, 8], [80, 9]]) })).item.suggestedWeightKg).toBe(82.5);
    expect(suggestNext(args({ rule: 'linear', history: hist([[80, 8], [80, 8]]) }))).toMatchObject({ kind: 'same', item: { suggestedWeightKg: 80 } });
  });
  it('стагнация → варианты на выбор, автоматически ничего не меняется', () => {
    const s = suggestNext(args({ stagnating: true, history: hist([[80, 12, 2], [80, 12, 2], [80, 12, 2]]) }));
    expect(s.kind).toBe('choose');
    expect(s.options?.map((o) => o.id)).toEqual(['apply_rule', 'change_range', 'replace', 'deload']);
  });
  it('упражнения на время — без правила; нет истории — без изменений', () => {
    expect(suggestNext(args({ exercise: PLANK })).kind).toBe('none');
    expect(suggestNext(args({})).kind).toBe('none');
  });
  it('история выполнений из тренировок: только рабочие подходы', () => {
    const d = db();
    workout(d, '2026-10-20', [{ ex: BENCH, sets: [[40, 10, undefined, 'warmup'], [80, 8]] }]);
    expect(performancesOf(sessions(d), 'bench')[0]?.sets).toEqual([{ weightKg: 80, reps: 8, rir: null }]);
  });
  it('разгрузка: −50% подходов, RIR ≥ 3, вес тот же или −10%', () => {
    const it0 = item('bench', 4, 6, 8, 2, 100);
    expect(deloadItem(it0, { setsFactor: 0.5, weightFactor: 1, minRir: 3 }, 2.5)).toMatchObject({ sets: 2, targetRir: 3, suggestedWeightKg: 100 });
    expect(deloadItem(it0, { setsFactor: 0.5, weightFactor: 0.9, minRir: 3 }, 2.5)).toMatchObject({ suggestedWeightKg: 90 });
    expect(deloadItem(item('bench', 1, 6, 8, 4), { setsFactor: 0.5, weightFactor: 1, minRir: 3 }, 2.5)).toMatchObject({ sets: 1, targetRir: 4 });
  });
});

describe('чередование A/B: предложения по последней тренировке с упражнением', () => {
  it('упражнение есть только в плане следующей недели — расчёт от тренировки 2 недели назад', () => {
    const d = db();
    workout(d, '2026-10-06', [{ ex: SQUAT, sets: [[100, 8], [100, 8], [100, 8]] }]); // тренировка B, 2 недели назад
    workout(d, '2026-10-20', [{ ex: BENCH, sets: [[80, 12, 2], [80, 12, 2], [80, 12, 2]] }]); // A на этой неделе
    const plan = [planned('2026-10-20', [item('bench', 3, 8, 12, 2)]), planned('2026-10-29', [item('squat', 3, 5, 8, 2)])];
    const cands = suggestionCandidates(plan, W);
    expect(cands.map((c) => [c.exerciseId, c.source])).toEqual([
      ['bench', 'this_week'],
      ['squat', 'next_week'],
    ]);
    const sq = cands.find((c) => c.exerciseId === 'squat')!;
    const s = suggestNext({
      exercise: SQUAT,
      current: sq.current,
      history: performancesOf(sessions(d), 'squat'),
      rule: 'double',
      lowerBoundFailSessions: 2,
      stagnating: false,
      unitLabel: 'кг',
      fmt: (kg) => `${kg} кг`,
    });
    expect(s.basedOnDate).toBe('2026-10-06');
    expect(s).toMatchObject({ kind: 'increase', item: { suggestedWeightKg: 102.5, targetReps: 5 } });
  });
  it('без выполнений — дата расчёта не указывается', () => {
    const s = suggestNext({ exercise: BENCH, current: item('bench', 3, 8, 12), history: [], rule: 'double', lowerBoundFailSessions: 2, stagnating: false, unitLabel: 'кг', fmt: String });
    expect(s.basedOnDate).toBeNull();
  });
});

describe('e1RM > 10 повторов и разминка в рекордах', () => {
  it('подходы с r > 10 не дают e1RM ни в отчёте, ни в рекордах, ни на графике', () => {
    const d = db();
    workout(d, '2026-10-20', [{ ex: BENCH, sets: [[60, 15], [60, 12], [60, 11]] }]);
    const r = report(d);
    expect(r.e1rm).toEqual([]);
    const { records } = computeRecords(sessions(d), SETTINGS);
    expect(records.get('bench')?.e1rm).toBeUndefined();
    expect(records.get('bench')?.maxWeight?.value).toBe(60); // остальные рекорды считаются
    expect(exerciseSeries(sessions(d), 'bench', SETTINGS)[0]?.e1rm).toBeNull();
  });
  it('в тренировке с r ≤ 10 и r > 10 e1RM берётся только из r ≤ 10', () => {
    const d = db();
    workout(d, '2026-10-20', [{ ex: BENCH, sets: [[60, 20], [80, 10]] }]);
    expect(report(d).e1rm[0]?.value).toBeCloseTo(80 * (1 + 10 / 30), 6);
  });
  it('разминочные подходы не попадают в рекорды, даже если тяжелее рабочих', () => {
    const d = db();
    workout(d, '2026-10-01', [{ ex: BENCH, sets: [[100, 5]] }]);
    workout(d, '2026-10-08', [{ ex: BENCH, sets: [[140, 3, undefined, 'warmup'], [120, 12, undefined, 'warmup'], [100, 5]] }]);
    const { records, events } = computeRecords(sessions(d), SETTINGS);
    expect(records.get('bench')?.maxWeight?.value).toBe(100);
    expect(records.get('bench')?.e1rm?.value).toBeCloseTo(100 * (1 + 5 / 30), 6);
    expect(records.get('bench')?.volume?.value).toBe(500);
    expect(records.get('bench')?.repsAtWeight.has(140)).toBe(false);
    expect(events).toEqual([]);
  });
});

describe('калькуляторы', () => {
  const kg = [25, 20, 15, 10, 5, 2.5, 1.25];
  it('блины на сторону', () => {
    expect(platesPerSide(100, 20, kg)).toEqual({ perSide: [25, 15], achieved: 100, remainder: 0, belowBar: false });
    expect(platesPerSide(102.5, 20, kg).perSide).toEqual([25, 15, 1.25]);
    expect(platesPerSide(101, 20, kg)).toMatchObject({ achieved: 100, remainder: 1 });
    expect(platesPerSide(15, 20, kg).belowBar).toBe(true);
    expect(platesPerSide(20, 20, kg).perSide).toEqual([]);
  });
  it('разминка 40/60/80%: вниз до шага, не меньше грифа, без повторов', () => {
    expect(warmupSets(100, [40, 60, 80], [8, 5, 3], 2.5, 20)).toEqual([
      { percent: 40, weight: 40, reps: 8 },
      { percent: 60, weight: 60, reps: 5 },
      { percent: 80, weight: 80, reps: 3 },
    ]);
    expect(warmupSets(40, [40, 60, 80], [8, 5, 3], 2.5, 20).map((x) => x.weight)).toEqual([20, 22.5, 30]);
    expect(warmupSets(25, [40, 60, 80], [8, 5, 3], 2.5, 20).map((x) => x.weight)).toEqual([20]);
  });
});

describe('запас повторов не записывали', () => {
  it('в причине прогрессии нет упоминания RIR', () => {
    const s = suggestNext({
      exercise: BENCH,
      current: item('bench', 3, 8, 12, 2, 80),
      history: [{ date: '2026-10-20', plan: null, sets: [{ weightKg: 80, reps: 12, rir: null }, { weightKg: 80, reps: 12, rir: null }, { weightKg: 80, reps: 12, rir: null }] }],
      rule: 'double',
      lowerBoundFailSessions: 2,
      stagnating: false,
      unitLabel: 'кг',
      fmt: (kg) => `${kg} кг`,
    });
    expect(s.kind).toBe('increase');
    expect(s.reason).not.toMatch(/RIR/);
  });
});
