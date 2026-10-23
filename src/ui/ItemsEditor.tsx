import { useState } from 'react';
import type { PlannedItem, Settings } from '../domain/types';
import { fromDisplayWeight, toDisplayWeight, unitLabel, displayStep } from '../domain/units';
import { Stepper } from './components';
import { ExercisePicker } from './ExercisePicker';
import { EFFORT_VALUES } from './format';
import { useExerciseMap } from './hooks';

/** Редактор упражнений плана/шаблона: подходы × диапазон повторов × целевой RIR (+ вес для плана). */
export function ItemsEditor({
  items,
  onChange,
  settings,
  withWeight,
}: {
  items: PlannedItem[];
  onChange: (items: PlannedItem[]) => void;
  settings: Settings;
  withWeight: boolean;
}) {
  const exMap = useExerciseMap();
  const [picker, setPicker] = useState(false);
  const unit = settings.unit;
  const upd = (i: number, patch: Partial<PlannedItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <div>
      {items.map((it, i) => {
        const ex = exMap.get(it.exerciseId);
        const timed = ex?.trackingType === 'time' || ex?.trackingType === 'weight_time';
        return (
          <div key={`${it.exerciseId}-${i}`} className="card">
            <div className="row">
              <b className="grow">{ex?.nameRu ?? 'Упражнение удалено'}</b>
              <button className="icon-btn" aria-label="Выше" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="icon-btn" aria-label="Ниже" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button className="icon-btn" aria-label="Убрать" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            <div className="row wrap">
              <label className="field grow">
                <span>Подходы</span>
                <Stepper label="Подходы" value={it.sets} step={1} min={1} max={20} integer onChange={(v) => upd(i, { sets: v ?? 1 })} />
              </label>
              {!timed && (<>
              <label className="field grow">
                <span>Повторы от</span>
                <Stepper label="Повторы от" value={it.repMin} step={1} min={0} max={999} integer onChange={(v) => upd(i, { repMin: v ?? 0, repMax: Math.max(v ?? 0, it.repMax) })} />
              </label>
              <label className="field grow">
                <span>до</span>
                <Stepper label="Повторы до" value={it.repMax} step={1} min={0} max={999} integer onChange={(v) => upd(i, { repMax: v ?? 0, repMin: Math.min(v ?? 0, it.repMin) })} />
              </label>
              </>)}
            </div>
            <div className="row wrap">
              {!timed && (
              <label className="field grow">
                <span>Целевой {settings.effortScale === 'rir' ? 'RIR' : 'RPE'}</span>
                <select
                  className="input"
                  value={it.targetRir ?? ''}
                  onChange={(e) => upd(i, { targetRir: e.target.value === '' ? null : Number(e.target.value) })}
                >
                  <option value="">—</option>
                  {EFFORT_VALUES.map((r) => (
                    <option key={r} value={r}>
                      {settings.effortScale === 'rir' ? r : 10 - r}
                    </option>
                  ))}
                </select>
              </label>
              )}
              <label className="field grow">
                <span>Отдых, сек</span>
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder={String(ex?.defaultRestSec ?? settings.defaultRestSec)}
                  value={it.restSec ?? ''}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    upd(i, { restSec: Number.isFinite(n) ? Math.min(3600, Math.max(0, n)) : null });
                  }}
                />
              </label>
              <label className="field grow">
                <span>Суперсет</span>
                <select className="input" value={it.supersetGroup ?? ''} onChange={(e) => upd(i, { supersetGroup: e.target.value || null })}>
                  <option value="">Нет</option>
                  {['A', 'B', 'C', 'D'].map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {withWeight && ex && (ex.trackingType === 'weight_reps' || ex.trackingType === 'weight_time') && (
              <label className="field">
                <span>Вес, {unitLabel(unit)} (необязательно)</span>
                <Stepper
                  label="Вес"
                  value={it.suggestedWeightKg == null ? null : toDisplayWeight(it.suggestedWeightKg, unit)}
                  step={displayStep(ex.weightStepKg, unit)}
                  min={0}
                  max={toDisplayWeight(1000, unit)}
                  onChange={(v) => upd(i, { suggestedWeightKg: v == null ? null : fromDisplayWeight(v, unit) })}
                />
              </label>
            )}
          </div>
        );
      })}
      <button className="btn block" style={{ marginTop: 10 }} onClick={() => setPicker(true)}>
        + Упражнение
      </button>
      {picker && (
        <ExercisePicker
          title="Добавить упражнение"
          onClose={() => setPicker(false)}
          onPick={(e) => {
            setPicker(false);
            onChange([
              ...items,
              { exerciseId: e.id, sets: 3, repMin: 8, repMax: 12, targetRir: 2, suggestedWeightKg: null, restSec: null, supersetGroup: null, reason: null },
            ]);
          }}
        />
      )}
    </div>
  );
}
