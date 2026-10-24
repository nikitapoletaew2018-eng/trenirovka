import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { EQUIPMENT, EQUIPMENT_TYPES, MUSCLES, MUSCLE_IDS, PATTERNS, TRACKING } from '../../domain/muscles';
import type { Category, EquipmentType, Exercise, MovementPattern, MuscleId, TrackingType } from '../../domain/types';
import { db } from '../../data/db';
import {
  deleteCustomExercise,
  filterExercises,
  newCustomExercise,
  saveCustomExercise,
  toggleFavorite,
  updateExercise,
} from '../../data/exerciseRepo';
import { Empty, Page, Seg, Stepper, Why, confirmDelete } from '../components';
import { ExerciseFilters, ExerciseRow, useExerciseFilter } from '../ExercisePicker';
import { useExerciseMap, useExercises, useSettings } from '../hooks';
import { navigate } from '../router';
import { displayStep, fromDisplayWeight, toDisplayWeight, unitLabel } from '../../domain/units';

export function LibraryScreen() {
  const all = useExercises();
  const f = useExerciseFilter();
  const list = useMemo(
    () => filterExercises(all ?? [], { query: f.query, muscle: f.muscle, equipmentType: f.eqType, favoritesOnly: f.favOnly }),
    [all, f.query, f.muscle, f.eqType, f.favOnly],
  );
  return (
    <Page
      title="Упражнения"
      onBack
      actions={
        <button className="btn sm" onClick={() => navigate('/exercise-new')}>
          + Своё
        </button>
      }
    >
      <ExerciseFilters {...f} />
      <p className="small muted">Найдено: {list.length}</p>
      {list.map((e) => (
        <ExerciseRow key={e.id} e={e} onClick={() => navigate(`/exercise/${e.id}`)} right={e.isCustom ? <span className="chip">своё</span> : undefined} />
      ))}
      {all && list.length === 0 && <Empty>Ничего не найдено.</Empty>}
    </Page>
  );
}

export function ExerciseDetail({ id }: { id: string }) {
  const ex = useLiveQuery(() => db.exercises.get(id), [id]);
  const exMap = useExerciseMap();
  const settings = useSettings();
  const [editing, setEditing] = useState(false);
  if (ex === undefined) return <main className="page" />;
  if (!ex || ex.deletedAt) return <Page title="Упражнение" onBack><Empty>Упражнение не найдено или удалено.</Empty></Page>;
  if (editing && ex.isCustom) return <CustomExerciseForm initial={ex} onDone={() => setEditing(false)} />;
  const unit = settings.unit;
  const mistakes = ex.commonMistakes.filter((m) => m.verified);

  return (
    <Page
      title={ex.nameRu}
      onBack
      actions={
        <button className="icon-btn" aria-label={ex.isFavorite ? 'Убрать из избранного' : 'В избранное'} aria-pressed={!!ex.isFavorite} onClick={() => void toggleFavorite(ex.id)}>
          {ex.isFavorite ? '★' : '☆'}
        </button>
      }
    >
      {ex.nameEn && <p className="muted">{ex.nameEn}</p>}
      <div className="card">
        <dl className="kv">
          <dt>Основные</dt>
          <dd>{ex.primaryMuscles.map((m) => `${MUSCLES[m].ru} (${MUSCLES[m].lat})`).join('; ') || '—'}</dd>
          <dt>Вспомогательные</dt>
          <dd>{ex.secondaryMuscles.map((m) => MUSCLES[m].ru).join(', ') || '—'}</dd>
          <dt>Оборудование</dt>
          <dd>{ex.equipment.map((e) => EQUIPMENT[e]).join(', ') || '—'} · {EQUIPMENT_TYPES[ex.equipmentType]}</dd>
          <dt>Категория</dt>
          <dd>
            {ex.category === 'core' ? 'Базовое' : 'Вспомогательное'}
            {ex.isStructural ? ', структурное' : ''}
          </dd>
          <dt>Паттерн</dt>
          <dd>{PATTERNS[ex.movementPattern]}</dd>
          <dt>Запись</dt>
          <dd>
            {TRACKING[ex.trackingType]}
            {ex.isUnilateral ? ', одностороннее' : ''}
          </dd>
        </dl>
        <Why>
          Категории — по определениям NSCA (Essentials of Strength Training and Conditioning): базовое — многосуставное, с участием крупных мышечных
          групп; вспомогательное — односуставное. Структурное — базовое упражнение, которое прямо или косвенно нагружает позвоночник.
          {ex.reviewNotes && ex.reviewNotes.length > 0 && (
            <>
              <br />
              Пометки: {ex.reviewNotes.join('; ')}.
            </>
          )}
        </Why>
      </div>

      <h2>Настройки упражнения</h2>
      <div className="card">
        <label className="field">
          <span>Отдых по умолчанию, сек</span>
          <Stepper label="Отдых" value={ex.defaultRestSec} step={15} min={0} max={3600} integer onChange={(v) => v != null && void updateExercise(ex.id, { defaultRestSec: v })} />
        </label>
        <label className="field">
          <span>Шаг веса для кнопок ±, {unitLabel(unit)}</span>
          <Stepper
            label="Шаг веса"
            value={toDisplayWeight(ex.weightStepKg, unit)}
            step={unit === 'kg' ? 0.25 : 0.5}
            min={0.25}
            max={50}
            onChange={(v) => v != null && v > 0 && void updateExercise(ex.id, { weightStepKg: fromDisplayWeight(v, unit) })}
          />
        </label>
        {unit === 'lb' && <p className="small muted">В фунтах кнопки ± округляют шаг до кратного 2,5 lb: сейчас {displayStep(ex.weightStepKg, unit)} lb.</p>}
        <Why>
          Отдых по умолчанию: базовые — 150 с, вспомогательные — 90 с. Основа — ACSM (2009) «Progression Models in Resistance Training for Healthy
          Adults»: 2–3 мин для базовых упражнений с большим весом, 1–2 мин для вспомогательных. Для пресса 60 с и шаг веса — эвристики, их можно менять.
        </Why>
      </div>

      {ex.instructions.length > 0 && (
        <>
          <h2>Техника</h2>
          <ol className="steps">
            {ex.instructions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      )}
      {mistakes.length > 0 && (
        <>
          <h2>Частые ошибки</h2>
          <ul>
            {mistakes.map((m, i) => (
              <li key={i}>
                {m.text}
                {m.source ? <span className="small muted"> — {m.source}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {ex.lighterAlternatives.length > 0 && (
        <>
          <h2>Облегчённые альтернативы</h2>
          {ex.lighterAlternatives
            .map((aid) => exMap.get(aid))
            .filter((a): a is Exercise => !!a && !a.deletedAt)
            .map((a) => (
              <ExerciseRow key={a.id} e={a} onClick={() => navigate(`/exercise/${a.id}`)} />
            ))}
        </>
      )}

      <p className="small muted" style={{ marginTop: 16 }}>
        Источник: {ex.source}
      </p>
      {ex.isCustom && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn grow" onClick={() => setEditing(true)}>
            Изменить
          </button>
          <button
            className="btn danger grow"
            onClick={() => {
              void confirmDelete(`упражнение «${ex.nameRu}»`).then((ok): unknown => ok && deleteCustomExercise(ex.id).then(() => navigate('/library')));
            }}
          >
            Удалить
          </button>
        </div>
      )}
    </Page>
  );
}

function MuscleChips({ value, onChange, label }: { value: MuscleId[]; onChange: (v: MuscleId[]) => void; label: string }) {
  return (
    <div className="chips wrap" role="group" aria-label={label} style={{ flexWrap: 'wrap' }}>
      {MUSCLE_IDS.map((m) => (
        <button
          key={m}
          type="button"
          className="chip"
          aria-pressed={value.includes(m)}
          onClick={() => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m])}
        >
          {MUSCLES[m].ru}
        </button>
      ))}
    </div>
  );
}

export function NewExerciseScreen() {
  return <CustomExerciseForm initial={newCustomExercise('')} onDone={(id) => navigate(id ? `/exercise/${id}` : '/library')} />;
}

function CustomExerciseForm({ initial, onDone }: { initial: Exercise; onDone: (id?: string) => void }) {
  const [e, setE] = useState<Exercise>(initial);
  const set = <K extends keyof Exercise>(k: K, v: Exercise[K]) => setE({ ...e, [k]: v });
  const valid = e.nameRu.trim().length > 0 && e.primaryMuscles.length > 0;
  return (
    <Page title={initial.nameRu ? 'Изменить упражнение' : 'Своё упражнение'} onBack={() => onDone()}>
      <label className="field">
        <span>Название</span>
        <input className="input" value={e.nameRu} onChange={(x) => set('nameRu', x.target.value)} />
      </label>
      <label className="field">
        <span>Название на английском (необязательно)</span>
        <input className="input" value={e.nameEn} onChange={(x) => set('nameEn', x.target.value)} />
      </label>
      <h3>Основные мышцы</h3>
      <MuscleChips label="Основные мышцы" value={e.primaryMuscles} onChange={(v) => set('primaryMuscles', v)} />
      <h3>Вспомогательные мышцы</h3>
      <MuscleChips label="Вспомогательные мышцы" value={e.secondaryMuscles} onChange={(v) => set('secondaryMuscles', v)} />
      <label className="field">
        <span>Тип записи</span>
        <select className="input" value={e.trackingType} onChange={(x) => set('trackingType', x.target.value as TrackingType)}>
          {(Object.keys(TRACKING) as TrackingType[]).map((t) => (
            <option key={t} value={t}>
              {TRACKING[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Оборудование</span>
        <select className="input" value={e.equipmentType} onChange={(x) => set('equipmentType', x.target.value as EquipmentType)}>
          {(Object.keys(EQUIPMENT_TYPES) as EquipmentType[]).map((t) => (
            <option key={t} value={t}>
              {EQUIPMENT_TYPES[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Паттерн движения</span>
        <select className="input" value={e.movementPattern} onChange={(x) => set('movementPattern', x.target.value as MovementPattern)}>
          {(Object.keys(PATTERNS) as MovementPattern[]).map((t) => (
            <option key={t} value={t}>
              {PATTERNS[t]}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>Категория</span>
        <Seg<Category>
          label="Категория"
          value={e.category}
          onChange={(v) => setE({ ...e, category: v, isStructural: v === 'core' ? e.isStructural : false })}
          options={[
            { value: 'core', label: 'Базовое' },
            { value: 'assistance', label: 'Вспомогательное' },
          ]}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={e.isStructural} disabled={e.category !== 'core'} onChange={(x) => set('isStructural', x.target.checked)} />
        Структурное (нагружает позвоночник)
      </label>
      <label className="check">
        <input type="checkbox" checked={e.isUnilateral} onChange={(x) => set('isUnilateral', x.target.checked)} />
        Одностороннее
      </label>
      <label className="field">
        <span>Отдых по умолчанию, сек</span>
        <input className="input" inputMode="numeric" value={e.defaultRestSec} onChange={(x) => set('defaultRestSec', Math.max(0, Math.min(3600, parseInt(x.target.value, 10) || 0)))} />
      </label>
      <label className="field">
        <span>Техника — по одному пункту на строку (необязательно)</span>
        <textarea className="input" value={e.instructions.join('\n')} onChange={(x) => set('instructions', x.target.value.split('\n'))} />
      </label>
      <button
        className="btn primary block big"
        disabled={!valid}
        onClick={() => {
          const clean = { ...e, nameRu: e.nameRu.trim(), instructions: e.instructions.map((s) => s.trim()).filter(Boolean) };
          void saveCustomExercise(clean).then(() => onDone(clean.id));
        }}
      >
        Сохранить
      </button>
      {!valid && <p className="small muted">Нужны название и хотя бы одна основная мышца.</p>}
    </Page>
  );
}
