import { describe, expect, it } from 'vitest';
import { buildSessions } from './analysis';
import {
  approximatePhase,
  averageCycleLength,
  averagePeriodLength,
  checkInMode,
  cycleAnalytics,
  cycleDay,
  cycleLengths,
  cycleSignals,
  isLoggedPeriodDay,
  needsLightOptions,
  predictNext,
} from './cycle';
import { lightVersion, lighterReplacements, withoutExcluded } from './lightVersion';
import type { CycleData, Exercise, PeriodEntry, PlannedItem, Workout, WorkoutExercise, WorkoutSet } from './types';
import { addDays } from './dates';
import { DEFAULT_SETTINGS } from '../data/settings';

const P = (startDate: string, endDate: string | null = null): PeriodEntry => ({ id: startDate, startDate, endDate });
const data = (periods: PeriodEntry[], o: Partial<CycleData['settings']> = {}, checkIns: CycleData['checkIns'] = []): CycleData => ({
  settings: { enabled: true, contraception: 'none', pregnancy: false, plannedLightDays: false, excludedExerciseIds: [], ...o },
  periods,
  checkIns,
});

// Циклы 28, 30, 29, 27 дней
const PERIODS = [P('2026-06-01', '2026-06-05'), P('2026-06-29', '2026-07-03'), P('2026-07-29', '2026-08-02'), P('2026-08-27', '2026-08-31'), P('2026-09-23', '2026-09-27')];

describe('длина цикла и прогноз', () => {
  it('длины циклов и среднее по последним 3–6', () => {
    expect(cycleLengths(PERIODS).map((c) => c.length)).toEqual([28, 30, 29, 27]);
    expect(averageCycleLength(PERIODS)).toMatchObject({ avg: 28.5, count: 4, reliable: true });
    expect(averageCycleLength(PERIODS.slice(0, 3))).toMatchObject({ count: 2, reliable: false }); // меньше 3 — грубо
    expect(averageCycleLength([P('2026-06-01')]).avg).toBeNull();
  });
  it('учитываются только последние 6 циклов', () => {
    const many = Array.from({ length: 9 }, (_, i) => P(addDays('2026-01-01', i * (i < 3 ? 40 : 28))));
    const r = averageCycleLength(many);
    expect(r.count).toBe(6);
  });
  it('средняя длительность менструации', () => {
    expect(averagePeriodLength(PERIODS)).toBe(5);
    expect(averagePeriodLength([P('2026-06-01')])).toBeNull();
  });
  it('прогноз ≈ следующей менструации', () => {
    const pr = predictNext(PERIODS)!;
    expect(pr.start).toBe(addDays('2026-09-23', 29)); // round(28,5) = 29
    expect(pr.days).toHaveLength(5);
    expect(pr.reliable).toBe(true);
    expect(predictNext([P('2026-06-01')])).toBeNull();
  });
  it('день цикла и отмеченные дни', () => {
    expect(cycleDay(PERIODS, '2026-09-23')).toBe(1);
    expect(cycleDay(PERIODS, '2026-10-06')).toBe(14);
    expect(cycleDay(PERIODS, '2026-05-01')).toBeNull();
    expect(isLoggedPeriodDay(PERIODS, '2026-09-27')).toBe(true);
    expect(isLoggedPeriodDay(PERIODS, '2026-09-28')).toBe(false);
    // начало без конца — считается идущей не дольше 10 дней
    expect(isLoggedPeriodDay([P('2026-10-01')], '2026-10-10')).toBe(true);
    expect(isLoggedPeriodDay([P('2026-10-01')], '2026-10-11')).toBe(false);
  });
});

describe('фазы — только приблизительная календарная оценка', () => {
  it('без гормональной контрацепции: менструация / ≈ фолликулярная / ≈ лютеиновая', () => {
    expect(approximatePhase(data(PERIODS), '2026-09-24')?.phase).toBe('menstruation');
    expect(approximatePhase(data(PERIODS), '2026-10-01')?.phase).toBe('follicular'); // день 9 ≤ 29 − 14
    expect(approximatePhase(data(PERIODS), '2026-10-15')?.phase).toBe('luteal'); // день 23
  });
  it('при гормональной контрацепции фазы не показываются', () => {
    expect(approximatePhase(data(PERIODS, { contraception: 'hormonal' }), '2026-10-01')).toBeNull();
    expect(approximatePhase(data(PERIODS, { contraception: 'hormonal' }), '2026-09-24')).toBeNull();
  });
});

describe('чек-ин', () => {
  it('варианты облегчения: энергия ≤ 2 или боль ≥ 2', () => {
    expect(needsLightOptions({ energy: 2, pain: 0 })).toBe(true);
    expect(needsLightOptions({ energy: 3, pain: 2 })).toBe(true);
    expect(needsLightOptions({ energy: 3, pain: 1 })).toBe(false);
    expect(needsLightOptions({ energy: null, pain: null })).toBe(false);
  });
  it('в дни менструации — автоматически, иначе по желанию, модуль выключен — нет', () => {
    expect(checkInMode(data(PERIODS), '2026-09-24')).toBe('auto');
    expect(checkInMode(data(PERIODS), predictNext(PERIODS)!.start)).toBe('auto'); // прогнозируемый день
    expect(checkInMode(data(PERIODS), '2026-10-05')).toBe('optional');
    expect(checkInMode(data(PERIODS, { enabled: false }), '2026-09-24')).toBe('off');
    expect(checkInMode(null, '2026-09-24')).toBe('off');
  });
});

describe('облегчённая версия — только по выбору', () => {
  const items: PlannedItem[] = [
    { exerciseId: 'squat', sets: 4, repMin: 5, repMax: 8, targetRir: 2, suggestedWeightKg: 100 },
    { exerciseId: 'curl', sets: 3, repMin: 10, repMax: 15, targetRir: null },
  ];
  it('−40% подходов, RIR +2, вес не выше плана', () => {
    const r = lightVersion(items, { setsFactor: 0.6, rirPlus: 2 });
    expect(r.map((x) => [x.sets, x.targetRir, x.suggestedWeightKg ?? null])).toEqual([
      [2, 4, 100],
      [2, null, null],
    ]);
    expect(r[0]!.reason).toContain('не медицинская необходимость');
  });
  it('облегчённые замены для базовых структурных и удаление некомфортных', () => {
    const ex = (id: string, o: Partial<Exercise>) => ({ id, nameRu: id, isStructural: false, category: 'core', lighterAlternatives: [], ...o }) as unknown as Exercise;
    const map = new Map([
      ['squat', ex('squat', { isStructural: true, lighterAlternatives: ['legpress'] })],
      ['legpress', ex('legpress', {})],
      ['curl', ex('curl', { category: 'assistance' })],
    ]);
    const r = lighterReplacements(items, map);
    expect(r.items.map((x) => x.exerciseId)).toEqual(['legpress', 'curl']);
    expect(r.replaced).toEqual([{ from: 'squat', to: 'legpress' }]);
    expect(withoutExcluded(items, ['curl']).map((x) => x.exerciseId)).toEqual(['squat']);
  });
});

describe('мягкие сигналы', () => {
  it('нет менструации ≥ 90 дней — вне беременности и гормональной контрацепции', () => {
    const d = data([P('2026-06-01')]);
    expect(cycleSignals(d, '2026-08-29').map((s) => s.id)).toEqual([]); // 89 дней
    expect(cycleSignals(d, '2026-08-30').map((s) => s.id)).toEqual(['no_period_90']); // 90
    expect(cycleSignals(data([P('2026-06-01')], { pregnancy: true }), '2026-10-01')).toEqual([]);
    expect(cycleSignals(data([P('2026-06-01')], { contraception: 'hormonal' }), '2026-10-01')).toEqual([]);
    expect(cycleSignals(d, '2026-08-30')[0]!.source).toContain('REDs');
  });
  it('длина цикла стабильно вне 24–38 дней (FIGO)', () => {
    const long = [P('2026-01-01'), P('2026-02-15'), P('2026-04-01'), P('2026-05-20')]; // 45, 45, 49
    expect(cycleSignals(data(long), '2026-05-25').map((s) => s.id)).toEqual(['length_out_of_range']);
    const mixed = [P('2026-01-01'), P('2026-02-15'), P('2026-03-15'), P('2026-05-01')]; // 45, 28, 47
    expect(cycleSignals(data(mixed), '2026-05-05')).toEqual([]);
  });
  it('боль 3 из 3 два цикла подряд', () => {
    const ci = (date: string, pain: number) => ({ id: date, date, pain });
    const two = data(PERIODS, {}, [ci('2026-08-28', 3), ci('2026-09-24', 3)]);
    expect(cycleSignals(two, '2026-10-01').map((s) => s.id)).toEqual(['recurring_pain']);
    expect(cycleSignals(data(PERIODS, {}, [ci('2026-09-24', 3)]), '2026-10-01')).toEqual([]);
  });
  it('каждый сигнал советует врача и не ставит диагноз', () => {
    const d = data([P('2026-06-01')]);
    expect(cycleSignals(d, '2026-10-01')[0]!.why).toMatch(/Это не диагноз.*врачом/);
  });
});

describe('личная аналитика', () => {
  const ex = { id: 'bench', nameRu: 'Жим', trackingType: 'weight_reps', primaryMuscles: [], secondaryMuscles: [], category: 'core', movementPattern: 'horizontal_push' } as unknown as Exercise;
  function build(weights: (d: string) => number) {
    const workouts: Workout[] = [];
    const wes: WorkoutExercise[] = [];
    const sets: WorkoutSet[] = [];
    for (let d = '2026-06-02'; d < '2026-09-23'; d = addDays(d, 3)) {
      const id = `w${d}`;
      workouts.push({ id, name: 'T', startedAt: `${d}T10:00:00Z`, finishedAt: `${d}T11:00:00Z`, timeZone: 'UTC', isLightVersion: false, createdAt: 'x', updatedAt: 'x' });
      wes.push({ id: `we${d}`, workoutId: id, exerciseId: 'bench', order: 0, createdAt: 'x', updatedAt: 'x' });
      sets.push({ id: `s${d}`, workoutExerciseId: `we${d}`, workoutId: id, order: 0, setType: 'working', weightKg: weights(d), reps: 5, completed: true, createdAt: 'x', updatedAt: 'x' });
    }
    return buildSessions(workouts, wes, sets, [ex]);
  }
  const S = { ...DEFAULT_SETTINGS };
  it('меньше 3 циклов — «мало данных»', () => {
    const a = cycleAnalytics(build(() => 100), [], data(PERIODS.slice(0, 3)), '2026-10-01', S);
    expect(a.enough).toBe(false);
    expect(a.comparisons.every((c) => c.verdict === 'insufficient')).toBe(true);
  });
  it('одинаковый результат во все дни — «в пределах шума»', () => {
    const a = cycleAnalytics(build((d) => 100 + (d.charCodeAt(9) % 2)), [], data(PERIODS), '2026-10-01', S);
    expect(a.enough).toBe(true);
    expect(a.comparisons.find((c) => c.metric === 'e1rm')?.verdict).toBe('noise');
  });
  it('устойчиво ниже в дни менструации во всех циклах — «закономерность» (только предложение)', () => {
    const a = cycleAnalytics(build((d) => (isLoggedPeriodDay(PERIODS, d) ? 90 : 100)), [], data(PERIODS), '2026-10-01', S);
    const c = a.comparisons.find((x) => x.metric === 'e1rm')!;
    expect(c.verdict).toBe('pattern');
    expect(c.meanDiff).toBeLessThan(-2);
  });
});
