import { describe, expect, it } from 'vitest';
import { latestByType, seriesOf, weightWithAverage } from './body';
import { csvCell, measurementsCsv, setsCsv, toCsv } from './csv';
import { buildIcs, foldLine, icsEscape } from './ics';
import { buildSessions } from './analysis';
import type { BodyMeasurement, Exercise, PlannedWorkout } from './types';

const m = (date: string, type: BodyMeasurement['type'], value: number, createdAt = 'a'): BodyMeasurement => ({ id: `${date}${type}${createdAt}`, createdAt, updatedAt: createdAt, date, type, value });

describe('замеры тела', () => {
  it('вес и скользящее среднее за 7 дней', () => {
    const r = weightWithAverage([m('2026-10-01', 'weight', 80), m('2026-10-02', 'weight', 82), m('2026-10-09', 'weight', 84), m('2026-10-01', 'waist', 70)]);
    expect(r).toEqual([
      { date: '2026-10-01', weight: 80, avg7: 80 },
      { date: '2026-10-02', weight: 82, avg7: 81 },
      { date: '2026-10-09', weight: 84, avg7: 84 }, // 01 и 02 вне окна
    ]);
  });
  it('несколько записей за день — берётся последняя; удалённые не учитываются', () => {
    const del = { ...m('2026-10-03', 'weight', 99), deletedAt: 'x' };
    expect(seriesOf([m('2026-10-01', 'weight', 80, 'a'), m('2026-10-01', 'weight', 81, 'b'), del], 'weight')).toEqual([{ date: '2026-10-01', value: 81 }]);
  });
  it('последнее значение по типам', () => {
    expect(latestByType([m('2026-10-01', 'waist', 72), m('2026-10-05', 'waist', 71)])).toEqual({ waist: { date: '2026-10-05', value: 71 } });
  });
});

describe('CSV', () => {
  it('разделитель «;», десятичная запятая, экранирование, BOM', () => {
    expect(csvCell(82.5)).toBe('82,5');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['A', 'B'], [[1, 'x']])).toBe('﻿A;B\r\n1;x\r\n');
  });
  it('подходы: одна строка на подход', () => {
    const ex = { id: 'b', nameRu: 'Жим лёжа', trackingType: 'weight_reps' } as unknown as Exercise;
    const s = buildSessions(
      [{ id: 'w', name: 'Верх; A', startedAt: '2026-10-20T10:00:00Z', finishedAt: '2026-10-20T11:00:00Z', timeZone: 'UTC', isLightVersion: false, createdAt: 'x', updatedAt: 'x' }],
      [{ id: 'we', workoutId: 'w', exerciseId: 'b', order: 0, createdAt: 'x', updatedAt: 'x' }],
      [{ id: 's', workoutExerciseId: 'we', workoutId: 'w', order: 0, setType: 'warmup', weightKg: 42.5, reps: 8, completed: true, createdAt: 'x', updatedAt: 'x' }],
      [ex],
    );
    const lines = setsCsv(s).replace('﻿', '').trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('2026-10-20;"Верх; A";Жим лёжа;1;разминочный;42,5;;8;;;;да');
  });
  it('замеры', () => {
    expect(measurementsCsv([m('2026-10-01', 'weight', 80.4)])).toContain('2026-10-01;Вес тела;80,4;кг');
  });
});

describe('напоминания .ics', () => {
  const pw: PlannedWorkout = {
    id: 'p1',
    createdAt: 'x',
    updatedAt: 'x',
    date: '2026-10-26',
    name: 'Верх, A',
    plannedItems: [{ exerciseId: 'b', sets: 3, repMin: 8, repMax: 12 }],
    status: 'planned',
  };
  it('событие с сигналом за N минут, локальное время, экранирование', () => {
    const ics = buildIcs([pw, { ...pw, id: 'p2', status: 'done' }], { time: '18:30', durationMin: 75, minutesBefore: 60, exerciseName: () => 'Жим лёжа', now: new Date('2026-10-24T10:00:00Z') });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261026T183000');
    expect(ics).toContain('DTEND:20261026T194500');
    expect(ics).toContain('TRIGGER:-PT60M');
    expect(ics).toContain('SUMMARY:Тренировка: Верх\\, A');
    expect(ics).toContain('UID:p1@trenirovka');
    expect(ics).not.toContain('UID:p2@trenirovka'); // выполненные не попадают
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
  it('перенос строк не длиннее 75 октетов', () => {
    const long = 'DESCRIPTION:' + 'Жим штанги лёжа; '.repeat(10);
    const folded = foldLine(long);
    for (const l of folded.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n ').join('')).toBe(long);
    expect(icsEscape('a,b;c\nd\\')).toBe('a\\,b\\;c\\nd\\\\');
  });
});
