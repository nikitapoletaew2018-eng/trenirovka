import { describe, expect, it } from 'vitest';
import {
  e1rm,
  e1rmBrzycki,
  e1rmEpley,
  effectiveBodyweightLoad,
  movingAverage7,
  percentChange,
  rirFromRpe,
  rpeFromRir,
  tonnage,
  type SetLike,
} from './formulas';
import { displayStep, formatWeight, fromDisplayWeight, kgToLb, lbToKg, toDisplayWeight } from './units';
import { clampField, isHalfStep, isValidField, parseDecimal } from './validation';

const w = (weightKg: number, reps: number, setType: SetLike['setType'] = 'working', completed = true): SetLike => ({
  setType,
  completed,
  weightKg,
  reps,
});

describe('e1RM', () => {
  it('Epley 100 × 5 = 116,7 (эталон ТЗ)', () => {
    expect(e1rmEpley(100, 5)).toBeCloseTo(116.6667, 3);
    expect(Math.round((e1rmEpley(100, 5) ?? 0) * 10) / 10).toBe(116.7);
  });
  it('Brzycki 100 × 5 = 112,5 (эталон ТЗ)', () => {
    expect(e1rmBrzycki(100, 5)).toBe(112.5);
  });
  it('r = 1 → e1RM = w для обеих формул', () => {
    expect(e1rmEpley(140, 1)).toBe(140);
    expect(e1rmBrzycki(140, 1)).toBe(140);
  });
  it('считается только для 1 ≤ r ≤ 10', () => {
    expect(e1rmEpley(100, 10)).toBeCloseTo(133.333, 2);
    expect(e1rmBrzycki(100, 10)).toBeCloseTo(133.333, 2);
    expect(e1rmEpley(100, 11)).toBeNull();
    expect(e1rmBrzycki(100, 11)).toBeNull();
    expect(e1rmEpley(100, 0)).toBeNull();
    expect(e1rmEpley(0, 5)).toBeNull();
    expect(e1rmEpley(100, 2.5)).toBeNull();
  });
  it('выбор формулы', () => {
    expect(e1rm(100, 5, 'epley')).toBeCloseTo(116.667, 2);
    expect(e1rm(100, 5, 'brzycki')).toBe(112.5);
  });
});

describe('RPE ↔ RIR (Zourdos et al., 2016)', () => {
  it('RPE = 10 − RIR, с половинками', () => {
    expect(rpeFromRir(2)).toBe(8);
    expect(rpeFromRir(1.5)).toBe(8.5);
    expect(rirFromRpe(7.5)).toBe(2.5);
    expect(rirFromRpe(10)).toBe(0);
  });
});

describe('тоннаж', () => {
  const opts = { includeBodyweight: false };
  it('Σ вес × повторы рабочих подходов', () => {
    expect(tonnage([w(100, 5), w(100, 5), w(90, 8)], 'weight_reps', opts)).toBe(1720);
  });
  it('разминочные не учитываются; только разминка → 0', () => {
    expect(tonnage([w(40, 10, 'warmup'), w(60, 5, 'warmup')], 'weight_reps', opts)).toBe(0);
    expect(tonnage([w(40, 10, 'warmup'), w(100, 5)], 'weight_reps', opts)).toBe(500);
  });
  it('дроп-сет и «до отказа» — рабочие', () => {
    expect(tonnage([w(100, 5, 'failure'), w(80, 6, 'dropset')], 'weight_reps', opts)).toBe(980);
  });
  it('невыполненные не учитываются', () => {
    expect(tonnage([w(100, 5, 'working', false)], 'weight_reps', opts)).toBe(0);
  });
  it('пустой список → 0', () => {
    expect(tonnage([], 'weight_reps', opts)).toBe(0);
  });
  it('собственный вес: по умолчанию не включается', () => {
    const s: SetLike = { setType: 'working', completed: true, reps: 10, addedWeightKg: 10 };
    expect(tonnage([s], 'bodyweight_reps', { includeBodyweight: false, bodyWeightKg: 80 })).toBe(0);
    expect(tonnage([s], 'bodyweight_reps', { includeBodyweight: true, bodyWeightKg: 80 })).toBe(900);
    // вес тела неизвестен — не считаем
    expect(tonnage([s], 'bodyweight_reps', { includeBodyweight: true })).toBe(0);
  });
  it('время и «только повторы» в тоннаж не входят', () => {
    expect(tonnage([{ setType: 'working', completed: true, durationSec: 60, weightKg: 20 }], 'weight_time', opts)).toBe(0);
    expect(tonnage([{ setType: 'working', completed: true, reps: 20 }], 'reps', opts)).toBe(0);
  });
});

describe('эффективный вес (собственный вес)', () => {
  it('вес тела ± доп. вес / ассистирование', () => {
    expect(effectiveBodyweightLoad(80, 10)).toBe(90);
    expect(effectiveBodyweightLoad(80, -20)).toBe(60);
    expect(effectiveBodyweightLoad(80, null)).toBe(80);
    expect(effectiveBodyweightLoad(null, 10)).toBeNull();
    expect(effectiveBodyweightLoad(60, -100)).toBe(0);
  });
});

describe('изменение, %', () => {
  it('(текущая − прошлая) / прошлая × 100', () => {
    expect(percentChange(110, 100)).toEqual({ kind: 'pct', value: 10 });
    expect(percentChange(90, 100)).toEqual({ kind: 'pct', value: -10 });
  });
  it('прошлая = 0 → «новое»', () => {
    expect(percentChange(5, 0)).toEqual({ kind: 'new' });
    expect(percentChange(0, 0)).toBeNull();
  });
});

describe('скользящее среднее 7 дней', () => {
  it('окно по календарным дням', () => {
    const r = movingAverage7([
      { date: '2026-10-01', value: 80 },
      { date: '2026-10-02', value: 82 },
      { date: '2026-10-07', value: 84 },
      { date: '2026-10-08', value: 86 }, // 10-01 выпадает из окна
    ]);
    expect(r.map((p) => p.value)).toEqual([80, 81, 82, 84]);
  });
});

describe('единицы', () => {
  it('кг ↔ lb', () => {
    expect(kgToLb(lbToKg(225))).toBeCloseTo(225, 10);
    expect(lbToKg(1)).toBe(0.45359237);
  });
  it('смена единиц не меняет хранимое значение: только отображение', () => {
    const stored = 100;
    expect(toDisplayWeight(stored, 'kg')).toBe(100);
    expect(toDisplayWeight(stored, 'lb')).toBeCloseTo(220.462, 3);
    expect(fromDisplayWeight(toDisplayWeight(stored, 'lb'), 'lb')).toBeCloseTo(stored, 10);
    expect(formatWeight(stored, 'lb')).toBe('220,5 lb');
    expect(formatWeight(82.5, 'kg')).toBe('82,5 кг');
    expect(formatWeight(1.25, 'kg')).toBe('1,25 кг');
  });
  it('шаг в lb кратен 2,5', () => {
    expect(displayStep(2.5, 'kg')).toBe(2.5);
    expect(displayStep(2.5, 'lb')).toBe(5);
    expect(displayStep(1.25, 'lb')).toBe(2.5);
    expect(displayStep(5, 'lb')).toBe(10);
  });
});

describe('валидация', () => {
  it('диапазоны ТЗ', () => {
    expect(isValidField('weightKg', 1000)).toBe(true);
    expect(isValidField('weightKg', 1000.5)).toBe(false);
    expect(isValidField('reps', 999)).toBe(true);
    expect(isValidField('reps', -1)).toBe(false);
    expect(isValidField('rir', 10)).toBe(true);
    expect(isValidField('rir', 11)).toBe(false);
    expect(clampField('weightKg', 1200)).toBe(1000);
    expect(isHalfStep(2.5)).toBe(true);
    expect(isHalfStep(2.3)).toBe(false);
  });
  it('разбор чисел с запятой', () => {
    expect(parseDecimal('82,5')).toBe(82.5);
    expect(parseDecimal(' 80 ')).toBe(80);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
  });
});
