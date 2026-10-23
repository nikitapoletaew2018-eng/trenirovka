import { useState } from 'react';
import { barInUnit, platesPerSide, warmupSets } from '../domain/calculators';
import type { Settings } from '../domain/types';
import { displayStep, formatNumber, fromDisplayWeight, round, toDisplayWeight, unitLabel } from '../domain/units';
import { Sheet, Stepper, Why } from './components';

const n2 = (n: number) => formatNumber(round(n, 2), 2);

/** Калькулятор блинов: что повесить на каждую сторону грифа. */
export function PlateCalculator({ initialKg, settings, onClose }: { initialKg: number | null; settings: Settings; onClose: () => void }) {
  const unit = settings.unit;
  const bar = barInUnit(settings.barWeightKg, unit);
  const plates = unit === 'kg' ? settings.platesKg : settings.platesLb;
  const [total, setTotal] = useState<number | null>(initialKg == null ? bar : round(toDisplayWeight(initialKg, unit), 2));
  const r = total == null ? null : platesPerSide(total, bar, plates);
  return (
    <Sheet title="Калькулятор блинов" onClose={onClose}>
      <label className="field">
        <span>Вес на штанге, {unitLabel(unit)}</span>
        <Stepper label="Вес на штанге" value={total} step={unit === 'kg' ? 2.5 : 5} min={0} max={unit === 'kg' ? 1000 : 2200} onChange={setTotal} />
      </label>
      <p className="small muted">
        Гриф: {n2(bar)} {unitLabel(unit)}
        {unit === 'lb' ? ' (≈ соответствие грифу в кг из настроек)' : ''}. Вес грифа и набор блинов меняются в настройках.
      </p>
      {r &&
        (r.belowBar ? (
          <p>Вес меньше грифа.</p>
        ) : (
          <div className="card">
            <p style={{ marginTop: 0 }}>На каждую сторону:</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: '4px 0' }}>{r.perSide.length ? r.perSide.map(n2).join(' + ') : 'без блинов'}</p>
            {r.remainder > 0 && (
              <p className="small" style={{ color: 'var(--warn)' }}>
                Точно не собрать: получится {n2(r.achieved)} {unitLabel(unit)} (не хватает {n2(r.remainder)}).
              </p>
            )}
          </div>
        ))}
    </Sheet>
  );
}

/** Калькулятор разминки: проценты от рабочего веса; можно добавить подходы в упражнение. */
export function WarmupCalculator({
  workKg,
  stepKg,
  settings,
  onAdd,
  onClose,
}: {
  workKg: number | null;
  stepKg: number;
  settings: Settings;
  onAdd: (sets: { weightKg: number; reps: number | null }[]) => void;
  onClose: () => void;
}) {
  const unit = settings.unit;
  const [work, setWork] = useState<number | null>(workKg == null ? null : round(toDisplayWeight(workKg, unit), 2));
  const step = displayStep(stepKg, unit);
  const bar = barInUnit(settings.barWeightKg, unit);
  const sets = work == null ? [] : warmupSets(work, settings.warmupPercents, settings.warmupReps, step, bar);
  return (
    <Sheet title="Разминочные подходы" onClose={onClose}>
      <label className="field">
        <span>Рабочий вес, {unitLabel(unit)}</span>
        <Stepper label="Рабочий вес" value={work} step={step} min={0} max={unit === 'kg' ? 1000 : 2200} onChange={setWork} />
      </label>
      {sets.length === 0 ? (
        <p className="muted">Введите рабочий вес больше веса грифа.</p>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>%</th>
              <th>Вес, {unitLabel(unit)}</th>
              <th>Повторы</th>
            </tr>
          </thead>
          <tbody>
            {sets.map((s) => (
              <tr key={s.percent}>
                <td>{s.percent}%</td>
                <td>{n2(s.weight)}</td>
                <td>{s.reps ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Why>
        Проценты ({settings.warmupPercents.join('/')}%) и повторы ({settings.warmupReps.join('/')}) — эвристика, меняются в настройках. Вес округляется вниз до шага
        упражнения и не меньше грифа; одинаковые веса не повторяются.
      </Why>
      <button
        className="btn primary block big"
        style={{ marginTop: 10 }}
        disabled={sets.length === 0}
        onClick={() => {
          onAdd(sets.map((s) => ({ weightKg: fromDisplayWeight(s.weight, unit), reps: s.reps })));
          onClose();
        }}
      >
        Добавить как разминочные подходы
      </button>
    </Sheet>
  );
}
