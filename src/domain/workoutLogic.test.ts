import { describe, expect, it } from 'vitest';
import { addDays, localDate, weekDays, weekStart, weekdayIndex } from './dates';
import {
  EMPTY_SET_VALUES,
  firstSetValues,
  nextSetType,
  nextSetValues,
  plannedStatusAfterFinish,
  propagateAfterComplete,
  workoutSummary,
  type PendingSet,
} from './workoutLogic';

describe('автозаполнение первого подхода', () => {
  const plan = { exerciseId: 'x', sets: 3, repMin: 6, repMax: 8, targetRir: 2, suggestedWeightKg: 82.5 };
  const last = [
    { setType: 'warmup' as const, weightKg: 40, reps: 10 },
    { setType: 'working' as const, weightKg: 80, reps: 8, rir: 1 },
  ];

  it('план на сегодня в приоритете', () => {
    expect(firstSetValues(plan, last)).toMatchObject({ weightKg: 82.5, reps: 6, rir: 2 });
  });
  it('без плана — первый рабочий подход прошлого раза', () => {
    expect(firstSetValues(null, last)).toMatchObject({ setType: 'working', weightKg: 80, reps: 8, rir: 1 });
  });
  it('план без веса — вес из прошлого раза', () => {
    expect(firstSetValues({ ...plan, suggestedWeightKg: null }, last).weightKg).toBe(80);
  });
  it('ничего нет — пусто', () => {
    expect(firstSetValues(null, [])).toEqual(EMPTY_SET_VALUES);
  });
  it('следующий подход — из предыдущего сегодняшнего', () => {
    const prev = { ...EMPTY_SET_VALUES, setType: 'failure' as const, weightKg: 100, reps: 5 };
    expect(nextSetValues(prev)).toMatchObject({ setType: 'working', weightKg: 100, reps: 5 });
  });
});

describe('тип подхода', () => {
  it('цикл рабочий → разминка → дроп-сет → отказ → рабочий', () => {
    expect(nextSetType('working')).toBe('warmup');
    expect(nextSetType('warmup')).toBe('dropset');
    expect(nextSetType('dropset')).toBe('failure');
    expect(nextSetType('failure')).toBe('working');
  });
});

describe('перенос значений после отметки', () => {
  const mk = (id: string, o: Partial<PendingSet>): PendingSet => ({
    ...EMPTY_SET_VALUES,
    id,
    completed: false,
    autofilled: true,
    ...o,
  });
  it('обновляет только нетронутые невыполненные подходы того же типа', () => {
    const sets = [
      mk('w', { setType: 'warmup', weightKg: 40, completed: true }),
      mk('a', { weightKg: 85, reps: 6, completed: true }),
      mk('b', { weightKg: 80, reps: 8 }),
      mk('c', { weightKg: 70, reps: 8, autofilled: false }),
      mk('d', { weightKg: 80, reps: 8, setType: 'warmup' }),
      mk('e', { weightKg: 80, reps: 8, setType: 'dropset' }),
    ];
    const r = propagateAfterComplete(sets, 'a');
    expect([...r.keys()]).toEqual(['b', 'e']);
    expect(r.get('b')).toMatchObject({ weightKg: 85, reps: 6, setType: 'working' });
    expect(r.get('e')).toMatchObject({ weightKg: 85, setType: 'dropset' });
  });
});

describe('статус плана', () => {
  it('done / partial / planned', () => {
    expect(plannedStatusAfterFinish(9, 9)).toBe('done');
    expect(plannedStatusAfterFinish(9, 10)).toBe('done');
    expect(plannedStatusAfterFinish(9, 4)).toBe('partial');
    expect(plannedStatusAfterFinish(9, 0)).toBe('planned');
    expect(plannedStatusAfterFinish(0, 3)).toBe('done');
  });
});

describe('итог тренировки', () => {
  it('длительность, рабочие подходы, тоннаж; разминка не считается', () => {
    const r = workoutSummary(
      '2026-10-23T10:00:00Z',
      '2026-10-23T11:05:00Z',
      [
        {
          trackingType: 'weight_reps',
          sets: [
            { setType: 'warmup', completed: true, weightKg: 60, reps: 5 },
            { setType: 'working', completed: true, weightKg: 100, reps: 5 },
            { setType: 'working', completed: false, weightKg: 100, reps: 5 },
          ],
        },
        { trackingType: 'time', sets: [{ setType: 'working', completed: true, durationSec: 60 }] },
      ],
      { includeBodyweight: false },
    );
    expect(r).toEqual({ durationSec: 3900, workingSets: 2, tonnageKg: 500 });
  });
});

describe('даты', () => {
  it('неделя начинается в понедельник', () => {
    expect(weekdayIndex('2026-10-19')).toBe(0); // понедельник
    expect(weekdayIndex('2026-10-25')).toBe(6); // воскресенье
    expect(weekStart('2026-10-25')).toBe('2026-10-19');
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(weekDays('2026-10-19')).toHaveLength(7);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('локальная дата с учётом часового пояса', () => {
    expect(localDate('2026-10-23T22:30:00Z', 'Europe/Moscow')).toBe('2026-10-24');
    expect(localDate('2026-10-23T22:30:00Z', 'UTC')).toBe('2026-10-23');
  });
});
