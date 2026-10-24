import { describe, expect, it } from 'vitest';
import { isLinkedWithNext, linkWithNext, supersetNumbers } from './superset';

describe('суперсеты', () => {
  it('объединить со следующим', () => {
    expect(linkWithNext([null, null, null], 0, true)).toEqual(['A', 'A', null]);
  });
  it('круг из трёх: цепочка продолжает ту же группу', () => {
    const a = linkWithNext([null, null, null], 0, true);
    expect(linkWithNext(a, 1, true)).toEqual(['A', 'A', 'A']);
  });
  it('разделить: одиночки теряют метку', () => {
    expect(linkWithNext(['A', 'A', null], 0, false)).toEqual([null, null, null]);
    // разрыв посередине круга из трёх: первое одно — без метки, двое оставшихся — новый суперсет
    expect(linkWithNext(['A', 'A', 'A'], 0, false)).toEqual([null, 'B', 'B']);
    expect(linkWithNext(['A', 'A', 'A'], 1, false)).toEqual(['A', 'A', null]);
  });
  it('два суперсета подряд и их слияние', () => {
    expect(linkWithNext(['A', 'A', 'B', 'B'], 1, true)).toEqual(['A', 'A', 'A', 'A']);
  });
  it('последнее упражнение не с чем объединять', () => {
    expect(linkWithNext(['A', 'A'], 1, true)).toEqual(['A', 'A']);
  });
  it('номера для отображения и признак связи', () => {
    const g = [null, 'C', 'C', 'A', 'A'];
    expect([...supersetNumbers(g).entries()]).toEqual([
      ['C', 1],
      ['A', 2],
    ]);
    expect(isLinkedWithNext(g, 1)).toBe(true);
    expect(isLinkedWithNext(g, 2)).toBe(false);
    expect(isLinkedWithNext(g, 0)).toBe(false);
  });
});
