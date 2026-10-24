import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLongDate, localDate } from '../../domain/dates';
import type { Exercise, Settings, Workout, WorkoutExercise, WorkoutSet } from '../../domain/types';
import { displayStep, formatDuration, formatWeight, fromDisplayWeight, toDisplayWeight, unitLabel } from '../../domain/units';
import { nextSetType, workoutSummary } from '../../domain/workoutLogic';
import { isLinkedWithNext, supersetNumbers } from '../../domain/superset';
import { buildSessions } from '../../domain/analysis';
import { RECORD_LABEL, computeRecords, prsInWorkout, type PrEvent } from '../../domain/records';
import { nowIso } from '../../data/ids';
import { PlateCalculator, WarmupCalculator } from '../Calculators';
import { analysisSettings, recordValue } from './Progress';
import { db } from '../../data/db';
import {
  addExercise,
  addSet,
  addWarmupSets,
  linkExerciseWithNext,
  adjustRest,
  deleteSet,
  deleteWorkout,
  finishWorkout,
  lastTimeSets,
  moveExercise,
  removeExercise,
  replaceExercise,
  stopRest,
  toggleSetCompleted,
  updateSet,
  updateWorkout,
  updateWorkoutExercise,
  workoutExercises,
} from '../../data/workoutRepo';
import { DurationInput, Empty, Sheet, Stepper, Why, confirmDelete } from '../components';
import { ExercisePicker } from '../ExercisePicker';
import { EFFORT_VALUES, SET_TYPE_LABEL, SET_TYPE_SHORT, formatSet, effortOf, planLine } from '../format';
import { useExerciseMap, useNow, useSettings } from '../hooks';
import { navigate } from '../router';
import { notifyRestOver, setWakeLock, unlockAudio } from '../signals';

const alive = <T extends { deletedAt?: string | null }>(x: T) => !x.deletedAt;

type Mode = 'active' | 'edit';

export function WorkoutView({ workoutId, mode }: { workoutId: string; mode: Mode }) {
  const settings = useSettings();
  const workout = useLiveQuery(() => db.workouts.get(workoutId), [workoutId]);
  const wes = useLiveQuery(() => workoutExercises(workoutId), [workoutId]);
  const sets = useLiveQuery(
    async () =>
      (await db.sets.where('workoutId').equals(workoutId).toArray()).filter(alive).sort((a, b) => a.order - b.order),
    [workoutId],
  );
  const exMap = useExerciseMap();
  const exIds = (wes ?? []).map((w) => w.exerciseId).join(',');
  const lasts = useLiveQuery(async () => {
    const m = new Map<string, Awaited<ReturnType<typeof lastTimeSets>>>();
    if (mode !== 'active') return m;
    for (const id of new Set(exIds.split(',').filter(Boolean))) m.set(id, await lastTimeSets(id, workoutId));
    return m;
  }, [exIds, workoutId, mode]);
  const [picker, setPicker] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (mode !== 'active') return;
    setWakeLock(true);
    return () => setWakeLock(false);
  }, [mode]);

  if (!workout || !wes || !sets) return <main className="page" />;
  if (workout.deletedAt) return <Empty>Тренировка удалена.</Empty>;

  const setsByWe = new Map<string, WorkoutSet[]>();
  for (const s of sets) setsByWe.set(s.workoutExerciseId, [...(setsByWe.get(s.workoutExerciseId) ?? []), s]);

  return (
    <main className={`page workout ${mode === "active" ? "has-dock" : ""}`}>
      <WorkoutHeader workout={workout} mode={mode} onFinish={() => setFinishing(true)} />
      {mode === 'edit' && workout.finishedAt && <WorkoutSummaryCard workoutId={workout.id} wes={wes} setsByWe={setsByWe} exMap={exMap} settings={settings} startedAt={workout.startedAt} finishedAt={workout.finishedAt} wellbeing={workout.wellbeing ?? null} />}
      {wes.length === 0 && <Empty>Добавьте первое упражнение.</Empty>}
      {wes.map((we, i) => {
        const ex = exMap.get(we.exerciseId);
        if (!ex) return null;
        return (
          <ExerciseCard
            key={we.id}
            we={we}
            ex={ex}
            sets={setsByWe.get(we.id) ?? []}
            last={lasts?.get(we.exerciseId) ?? null}
            settings={settings}
            mode={mode}
            isFirst={i === 0}
            isLast={i === wes.length - 1}
            supersetNo={we.supersetGroup ? supersetNumbers(wes.map((x) => x.supersetGroup)).get(we.supersetGroup) : undefined}
            linkedNext={isLinkedWithNext(wes.map((x) => x.supersetGroup), i)}
            replacedFrom={we.replacedFromExerciseId ? exMap.get(we.replacedFromExerciseId) : undefined}
          />
        );
      })}
      <button className="btn block big" onClick={() => setPicker(true)}>
        + Упражнение
      </button>
      {mode === 'edit' && (
        <>
          <h2>Заметки</h2>
          <NotesField value={workout.notes ?? ''} onSave={(notes) => void updateWorkout(workout.id, { notes })} />
          <button
            className="btn danger block"
            style={{ marginTop: 16 }}
            onClick={() => {
              void confirmDelete('тренировку').then((ok): unknown => ok && deleteWorkout(workout.id).then(() => navigate('/history')));
            }}
          >
            Удалить тренировку
          </button>
        </>
      )}
      {picker && (
        <ExercisePicker
          title="Добавить упражнение"
          onClose={() => setPicker(false)}
          onPick={(e) => {
            setPicker(false);
            void addExercise(workout.id, e.id);
          }}
        />
      )}
      {finishing && <FinishSheet workoutId={workout.id} wes={wes} setsByWe={setsByWe} exMap={exMap} settings={settings} onClose={() => setFinishing(false)} />}
    </main>
  );
}

function WorkoutHeader({ workout, mode, onFinish }: { workout: Workout; mode: Mode; onFinish: () => void }) {
  const now = useNow(1000);
  const [menu, setMenu] = useState(false);
  const elapsed = (now - Date.parse(workout.startedAt)) / 1000;
  return (
    <div className="workout-head">
      <div className="row">
        {mode === 'edit' && (
          <button className="icon-btn" aria-label="Назад" onClick={() => navigate('/history')}>
            ‹
          </button>
        )}
        <div className="grow">
          <div style={{ fontWeight: 700, fontSize: 18 }}>{workout.name}</div>
          <div className="small muted">
            {mode === 'active'
              ? `Идёт ${formatDuration(elapsed)}`
              : `${formatLongDate(localDate(workout.startedAt, workout.timeZone))}${workout.finishedAt ? '' : ' · не завершена'}`}
          </div>
        </div>
        {mode === 'active' && (
          <>
            <button className="icon-btn" aria-label="Меню тренировки" onClick={() => setMenu(true)}>
              ⋯
            </button>
            <button className="btn primary" onClick={onFinish}>
              Завершить
            </button>
          </>
        )}
      </div>
      {menu && (
        <Sheet title="Тренировка" onClose={() => setMenu(false)}>
          <label className="field">
            <span>Название</span>
            <input className="input" defaultValue={workout.name} onBlur={(e) => void updateWorkout(workout.id, { name: e.target.value.trim() || workout.name })} />
          </label>
          <label className="field">
            <span>Заметка к тренировке</span>
            <NotesField value={workout.notes ?? ''} onSave={(notes) => void updateWorkout(workout.id, { notes })} />
          </label>
          <button
            className="btn danger block"
            onClick={() => {
              void confirmDelete('эту тренировку целиком').then((ok): unknown => ok && deleteWorkout(workout.id).then(() => setMenu(false)));
            }}
          >
            Удалить тренировку
          </button>
        </Sheet>
      )}
    </div>
  );
}

function NotesField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  return <textarea className="input" defaultValue={value} onBlur={(e) => e.target.value !== value && onSave(e.target.value)} aria-label="Заметка" />;
}

function ExerciseCard({
  we,
  ex,
  sets,
  last,
  settings,
  mode,
  isFirst,
  isLast,
  replacedFrom,
  supersetNo,
  linkedNext,
}: {
  we: WorkoutExercise;
  ex: Exercise;
  sets: WorkoutSet[];
  last: Awaited<ReturnType<typeof lastTimeSets>>;
  settings: Settings;
  mode: Mode;
  isFirst: boolean;
  isLast: boolean;
  replacedFrom?: Exercise;
  supersetNo?: number;
  linkedNext: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [replace, setReplace] = useState(false);
  const [calc, setCalc] = useState<'plates' | 'warmup' | null>(null);
  const unit = settings.unit;
  const weighted = ex.trackingType === 'weight_reps' || ex.trackingType === 'weight_time';
  const workKg = we.plan?.suggestedWeightKg ?? sets.find((s) => s.setType !== 'warmup' && s.weightKg != null)?.weightKg ?? null;
  const lastWorking = last?.sets.filter((s) => s.setType !== 'warmup') ?? [];
  const showEffort = settings.showEffort;
  // Без колонки «запас повторов» строка короче: вес + повторы + ✓
  const cols =
    ex.trackingType === 'time' ? 'cols-2' : ex.trackingType === 'weight_time' ? 'cols-wt' : ex.trackingType === 'reps' ? (showEffort ? 'cols-3' : 'cols-2') : showEffort ? '' : 'cols-wt';
  let workingNo = 0;

  return (
    <section className={`ex-card ${we.supersetGroup ? 'superset' : ''}`} aria-label={ex.nameRu}>
      <div className="row">
        <div className="grow">
          <p className="ex-title">
            {supersetNo && <span className="chip" style={{ marginRight: 6 }}>Суперсет {supersetNo}</span>}
            {ex.nameRu}
          </p>
          {replacedFrom && <p className="ex-meta">Замена: {replacedFrom.nameRu}</p>}
          {we.plan && (
            <p className="ex-meta">
              План: <b>{planLine(we.plan, unit, effortOf(settings), ex.trackingType)}</b>
            </p>
          )}
          {mode === 'active' && (
            <p className="ex-meta">
              Прошлый раз:{' '}
              {last ? (
                <b>
                  {lastWorking.map((s) => formatSet(s, ex.trackingType, unit)).join(', ') || '—'}
                </b>
              ) : (
                'впервые'
              )}
              {last && <span> · {formatLongDate(localDate(last.workout.startedAt, last.workout.timeZone))}</span>}
            </p>
          )}
          {we.notes && <p className="ex-meta">📝 {we.notes}</p>}
        </div>
        <button className="icon-btn" aria-label={`Меню: ${ex.nameRu}`} onClick={() => setMenu(true)}>
          ⋯
        </button>
      </div>

      <div className={`col-labels ${cols}`} aria-hidden="true">
        <span>№</span>
        {(ex.trackingType === 'weight_reps' || ex.trackingType === 'weight_time') && <span>Вес, {unitLabel(unit)}</span>}
        {ex.trackingType === 'bodyweight_reps' && <span>Доп./асс., {unitLabel(unit)}</span>}
        {ex.trackingType !== 'time' && ex.trackingType !== 'weight_time' && <span>Повторы</span>}
        {(ex.trackingType === 'time' || ex.trackingType === 'weight_time') && <span>Время</span>}
        {showEffort && ex.trackingType !== 'time' && ex.trackingType !== 'weight_time' && <span>{settings.effortScale === 'rir' ? 'Запас' : 'RPE'}</span>}
        <span>✓</span>
      </div>
      {sets.map((s) => {
        if (s.setType !== 'warmup') workingNo++;
        return <SetRow key={s.id} set={s} ex={ex} settings={settings} cols={cols} label={s.setType === 'working' ? String(workingNo) : SET_TYPE_SHORT[s.setType]} mode={mode} />;
      })}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm grow" onClick={() => void addSet(we.id)}>
          + Подход
        </button>
      </div>

      {menu && (
        <Sheet title={ex.nameRu} onClose={() => setMenu(false)}>
          <div className="stack">
            <button className="btn block" onClick={() => { setMenu(false); setReplace(true); }}>
              Заменить на аналог
            </button>
            <div className="row">
              <button className="btn grow" disabled={isFirst} onClick={() => void moveExercise(we.id, -1)}>
                ↑ Выше
              </button>
              <button className="btn grow" disabled={isLast} onClick={() => void moveExercise(we.id, 1)}>
                ↓ Ниже
              </button>
            </div>
            <div>
              <button className="btn block" disabled={isLast && !linkedNext} onClick={() => void linkExerciseWithNext(we.id, !linkedNext)}>
                {linkedNext ? 'Отделить от следующего упражнения' : 'Суперсет со следующим упражнением'}
              </button>
              <p className="small muted" style={{ margin: '4px 0 0' }}>
                Суперсет — упражнения делаются по очереди без отдыха: подход одного → подход другого → отдых → снова по кругу. Таймер отдыха запускается
                после последнего упражнения суперсета.
              </p>
            </div>
            <label className="field">
              <span>Отдых, сек (по умолчанию {ex.defaultRestSec})</span>
              <input
                className="input"
                inputMode="numeric"
                defaultValue={we.restSec ?? ''}
                placeholder={String(ex.defaultRestSec)}
                onBlur={(e) => {
                  const n = parseInt(e.target.value, 10);
                  void updateWorkoutExercise(we.id, { restSec: Number.isFinite(n) && n >= 0 && n <= 3600 ? n : null });
                }}
              />
            </label>
            <label className="field">
              <span>Заметка к упражнению</span>
              <NotesField value={we.notes ?? ''} onSave={(notes) => void updateWorkoutExercise(we.id, { notes })} />
            </label>
            {weighted && (
              <div className="row">
                <button className="btn grow" onClick={() => { setMenu(false); setCalc('plates'); }}>
                  Блины
                </button>
                <button className="btn grow" onClick={() => { setMenu(false); setCalc('warmup'); }}>
                  Разминка
                </button>
              </div>
            )}
            <button className="btn block" onClick={() => navigate(`/exercise/${ex.id}`)}>
              Техника и карточка упражнения
            </button>
            <button
              className="btn danger block"
              onClick={() => {
                void confirmDelete(`упражнение «${ex.nameRu}» из тренировки`).then((ok) => {
                  if (!ok) return;
                  setMenu(false);
                  void removeExercise(we.id);
                });
              }}
            >
              Удалить из тренировки
            </button>
          </div>
        </Sheet>
      )}
      {calc === 'plates' && <PlateCalculator initialKg={workKg} settings={settings} onClose={() => setCalc(null)} />}
      {calc === 'warmup' && (
        <WarmupCalculator workKg={workKg} stepKg={ex.weightStepKg} settings={settings} onAdd={(ws) => void addWarmupSets(we.id, ws)} onClose={() => setCalc(null)} />
      )}
      {replace && (
        <ExercisePicker
          title={`Замена: ${ex.nameRu}`}
          replacing={ex}
          onClose={() => setReplace(false)}
          onPick={(e) => {
            setReplace(false);
            void replaceExercise(we.id, e.id);
          }}
        />
      )}
    </section>
  );
}

function SetRow({ set, ex, settings, cols, label, mode }: { set: WorkoutSet; ex: Exercise; settings: Settings; cols: string; label: string; mode: Mode }) {
  const [menu, setMenu] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const unit = settings.unit;
  const step = displayStep(ex.weightStepKg, unit);
  const w = (kg: number | null | undefined) => (kg == null ? null : toDisplayWeight(kg, unit));
  const kg = (v: number | null) => (v == null ? null : fromDisplayWeight(v, unit));

  const startPress = () => {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setMenu(true);
    }, 500);
  };
  const endPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
  };

  const effort = (
    <select
      className="effort"
      aria-label={settings.effortScale === 'rir' ? 'Запас повторов (RIR)' : 'RPE'}
      value={set.rir ?? ''}
      onChange={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value);
        void updateSet(set.id, { rir: v, rpe: v == null ? null : 10 - v });
      }}
    >
      <option value="">—</option>
      {EFFORT_VALUES.map((rir) => (
        <option key={rir} value={rir}>
          {settings.effortScale === 'rir' ? rir : 10 - rir}
        </option>
      ))}
    </select>
  );

  return (
    <div className={`set-row ${cols} ${set.completed ? 'done' : ''} ${set.setType === 'warmup' ? 'warmup' : ''}`}>
      <button
        className={`set-num ${set.setType}`}
        aria-label={`${SET_TYPE_LABEL[set.setType]} подход. Нажмите, чтобы сменить тип; удерживайте для меню`}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
        onClick={() => {
          if (longPressed.current) return;
          void updateSet(set.id, { setType: nextSetType(set.setType) });
        }}
      >
        {label}
      </button>
      {(ex.trackingType === 'weight_reps' || ex.trackingType === 'weight_time') && (
        <Stepper label="Вес" value={w(set.weightKg)} step={step} min={0} max={toDisplayWeight(1000, unit)} onChange={(v) => void updateSet(set.id, { weightKg: kg(v) })} />
      )}
      {ex.trackingType === 'bodyweight_reps' && (
        <Stepper
          label="Доп. вес (минус — ассистирование)"
          value={w(set.addedWeightKg ?? 0)}
          step={step}
          min={-toDisplayWeight(1000, unit)}
          max={toDisplayWeight(1000, unit)}
          onChange={(v) => void updateSet(set.id, { addedWeightKg: kg(v) })}
        />
      )}
      {ex.trackingType !== 'time' && ex.trackingType !== 'weight_time' && (
        <Stepper label="Повторы" value={set.reps ?? null} step={1} min={0} max={999} integer onChange={(v) => void updateSet(set.id, { reps: v })} />
      )}
      {(ex.trackingType === 'time' || ex.trackingType === 'weight_time') && (
        <DurationInput label="Время" value={set.durationSec ?? null} onChange={(v) => void updateSet(set.id, { durationSec: v })} />
      )}
      {settings.showEffort && ex.trackingType !== 'time' && ex.trackingType !== 'weight_time' && effort}
      <button
        className="done-btn"
        aria-pressed={set.completed}
        aria-label={set.completed ? 'Снять отметку' : 'Отметить выполненным'}
        onClick={() => {
          unlockAudio();
          void toggleSetCompleted(set.id, { startRest: mode === 'active' });
        }}
      >
        ✓
      </button>
      {menu && (
        <Sheet title={`Подход ${label}`} onClose={() => setMenu(false)}>
          <label className="field">
            <span>Тип подхода</span>
            <select className="input" value={set.setType} onChange={(e) => void updateSet(set.id, { setType: e.target.value as WorkoutSet['setType'] })}>
              {(Object.keys(SET_TYPE_LABEL) as WorkoutSet['setType'][]).map((t) => (
                <option key={t} value={t}>
                  {SET_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <p className="small muted">Разминочные подходы не входят в тоннаж, рекорды и подсчёт рабочих подходов.</p>
          <label className="field">
            <span>Заметка к подходу</span>
            <NotesField value={set.notes ?? ''} onSave={(notes) => void updateSet(set.id, { notes })} />
          </label>
          <button
            className="btn danger block"
            onClick={() => {
              void confirmDelete('подход').then((ok) => {
                if (!ok) return;
                setMenu(false);
                void deleteSet(set.id);
              });
            }}
          >
            Удалить подход
          </button>
        </Sheet>
      )}
    </div>
  );
}

/** Таймер отдыха: стартует сам после отметки подхода; конец хранится в базе и переживает перезапуск. */
export function RestBar() {
  const timer = useLiveQuery(() => db.restTimer.get('current'), []);
  const settings = useSettings();
  const now = useNow(250);
  const signaled = useRef<string | null>(null);
  const remaining = timer ? (Date.parse(timer.endsAt) - now) / 1000 : 0;
  useEffect(() => {
    if (timer && remaining <= 0 && signaled.current !== timer.endsAt) {
      signaled.current = timer.endsAt;
      // Сигнал только если отдых закончился недавно (а не, например, час назад до перезапуска)
      if (remaining > -10) void notifyRestOver({ sound: settings.soundEnabled, vibration: settings.vibrationEnabled });
    }
  }, [timer, remaining, settings.soundEnabled, settings.vibrationEnabled]);
  if (!timer) return null;
  const over = remaining <= 0;
  if (remaining < -600) return null; // старый таймер — не показываем
  return (
    <div className={`rest-bar ${over ? 'over' : ''}`} role="timer" aria-live="off">
      <button className="btn sm" onClick={() => void adjustRest(-15)} aria-label="Минус 15 секунд">
        −15
      </button>
      <span className="rest-time">{over ? `+${formatDuration(-remaining)}` : formatDuration(remaining)}</span>
      <span className="small muted">{over ? 'отдых окончен' : 'отдых'}</span>
      <button className="btn sm" onClick={() => void adjustRest(15)} aria-label="Плюс 15 секунд">
        +15
      </button>
      <button className="btn sm" onClick={() => void stopRest()} aria-label="Закрыть таймер">
        ✕
      </button>
    </div>
  );
}

interface SummaryProps {
  wes: WorkoutExercise[];
  setsByWe: Map<string, WorkoutSet[]>;
  exMap: Map<string, Exercise>;
  settings: Settings;
}

function useSummary({ wes, setsByWe, exMap, settings }: SummaryProps, startedAt: string, finishedAt: string) {
  return useMemo(() => {
    const exercises = wes.map((we) => ({ trackingType: exMap.get(we.exerciseId)?.trackingType ?? 'weight_reps', sets: setsByWe.get(we.id) ?? [] }));
    const s = workoutSummary(startedAt, finishedAt, exercises, { includeBodyweight: settings.includeBodyweightInTonnage, bodyWeightKg: settings.bodyWeightKg });
    const plannedSets = wes.reduce((n, we) => n + (we.plan?.sets ?? 0), 0);
    return { ...s, plannedSets };
  }, [wes, setsByWe, exMap, settings, startedAt, finishedAt]);
}

function SummaryKv({ s, settings }: { s: ReturnType<typeof useSummary>; settings: Settings }) {
  return (
    <dl className="kv">
      <dt>Длительность</dt>
      <dd>{formatDuration(s.durationSec)}</dd>
      <dt>Рабочие подходы</dt>
      <dd>
        {s.workingSets}
        {s.plannedSets > 0 && ` из ${s.plannedSets} по плану (${Math.round((s.workingSets / s.plannedSets) * 100)}%)`}
      </dd>
      <dt>Тоннаж</dt>
      <dd>
        {formatWeight(s.tonnageKg, settings.unit)}
        {!settings.includeBodyweightInTonnage && <span className="small muted"> · без упражнений с собственным весом</span>}
      </dd>
    </dl>
  );
}

function WorkoutSummaryCard(props: SummaryProps & { workoutId: string; startedAt: string; finishedAt: string; wellbeing: number | null }) {
  const s = useSummary(props, props.startedAt, props.finishedAt);
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <SummaryKv s={s} settings={props.settings} />
      <PrList workoutId={props.workoutId} settings={props.settings} exMap={props.exMap} />
      {props.wellbeing != null && <p className="small muted">Самочувствие: {props.wellbeing} из 5</p>}
      <p className="small muted">
        Тоннаж = Σ вес × повторы рабочих подходов (разминочные не считаются).
      </p>
    </div>
  );
}

function FinishSheet(props: SummaryProps & { workoutId: string; onClose: () => void }) {
  const now = useNow(5000);
  const workout = useLiveQuery(() => db.workouts.get(props.workoutId), [props.workoutId]);
  const s = useSummary(props, workout?.startedAt ?? new Date(now).toISOString(), new Date(now).toISOString());
  const [wellbeing, setWellbeing] = useState<number | null>(null);
  const pending = [...props.setsByWe.values()].flat().filter((x) => !x.completed).length;
  const done = async (unfinished: 'delete' | 'complete' | 'keep') => {
    await finishWorkout(props.workoutId, { wellbeing, unfinished });
    setWakeLock(false);
    navigate(`/workout/${props.workoutId}`);
  };
  return (
    <Sheet title="Завершить тренировку" onClose={props.onClose}>
      <SummaryKv s={s} settings={props.settings} />
      <PrList workoutId={props.workoutId} settings={props.settings} exMap={props.exMap} />
      <h3>Самочувствие (необязательно)</h3>
      <div className="row">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={`btn grow ${wellbeing === n ? 'primary' : ''}`} aria-pressed={wellbeing === n} onClick={() => setWellbeing(wellbeing === n ? null : n)}>
            {n}
          </button>
        ))}
      </div>
      <p className="small muted">1 — очень плохо, 5 — отлично.</p>
      {pending > 0 ? (
        <>
          <p>
            Невыполненных подходов: <b>{pending}</b>. Что с ними сделать?
          </p>
          <div className="stack">
            <button className="btn primary block" onClick={() => void done('delete')}>
              Удалить невыполненные и завершить
            </button>
            <button className="btn block" onClick={() => void done('complete')}>
              Отметить выполненными и завершить
            </button>
          </div>
        </>
      ) : (
        <button className="btn primary block big" onClick={() => void done('keep')}>
          Завершить
        </button>
      )}
      <Why>
        Рабочие подходы — все выполненные, кроме разминочных. Тоннаж = Σ (вес × повторы) рабочих подходов. Упражнения с собственным весом
        входят в тоннаж только при включённой настройке. Сравнение с планом — доля выполненных рабочих подходов от запланированных.
      </Why>
    </Sheet>
  );
}


/**
 * Новые личные рекорды этой тренировки (только рабочие подходы). Незавершённая тренировка
 * считается завершённой «сейчас» — чтобы показать рекорды ещё до нажатия «Завершить».
 */
function PrList({ workoutId, settings, exMap }: { workoutId: string; settings: Settings; exMap: Map<string, Exercise> }) {
  const prs = useLiveQuery(async (): Promise<PrEvent[]> => {
    const [workouts, wes, sets, exercises] = await Promise.all([db.workouts.toArray(), db.workoutExercises.toArray(), db.sets.toArray(), db.exercises.toArray()]);
    const now = nowIso();
    const ws = workouts.map((w) => (w.id === workoutId && !w.finishedAt ? { ...w, finishedAt: now } : w));
    const { events } = computeRecords(buildSessions(ws, wes, sets, exercises), analysisSettings(settings));
    return prsInWorkout(events, workoutId);
  }, [workoutId, settings]);
  if (!prs?.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <b>Новые рекорды</b>
      {prs.map((e, i) => (
        <p key={i} className="small" style={{ margin: '2px 0' }}>
          🏆 {exMap.get(e.exerciseId)?.nameRu ?? '—'}: {RECORD_LABEL[e.kind]} — {recordValue(e.kind, e.value, e.extra ?? null, settings.unit)}
          <span className="muted"> (было {recordValue(e.kind, e.previous, e.extra ?? null, settings.unit)})</span>
        </p>
      ))}
    </div>
  );
}
