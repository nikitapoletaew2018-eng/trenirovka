import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { WEEKDAY_SHORT, addDays, formatDayMonth, weekDays, weekStart } from '../../domain/dates';
import type { PlannedWorkout } from '../../domain/types';
import { db } from '../../data/db';
import {
  copyWeek,
  deletePlanned,
  listTemplates,
  mergeWithNext,
  movePlannedDate,
  planWorkout,
  plannedForWeek,
  reschedule,
  skipPlanned,
  updatePlanned,
} from '../../data/planRepo';
import { getActiveWorkout, startWorkout } from '../../data/workoutRepo';
import { Empty, Page, Sheet, Why, confirmDelete } from '../components';
import { STATUS_CLASS, STATUS_LABEL } from '../format';
import { ItemsEditor } from '../ItemsEditor';
import { today, useSettings } from '../hooks';
import { navigate } from '../router';

export function PlanScreen() {
  const d = today();
  const [monday, setMonday] = useState(weekStart(d));
  const planned = useLiveQuery(() => plannedForWeek(monday), [monday]) ?? [];
  const prevCount = useLiveQuery(async () => (await plannedForWeek(addDays(monday, -7))).filter((p) => p.status !== 'moved').length, [monday]) ?? 0;
  const [addDay, setAddDay] = useState<string | null>(null);
  const [actions, setActions] = useState<PlannedWorkout | null>(null);
  const drag = useDrag((id, day) => void movePlannedDate(id, day));

  const byDay = new Map<string, PlannedWorkout[]>();
  for (const p of planned) byDay.set(p.date, [...(byDay.get(p.date) ?? []), p]);
  const active = planned.filter((p) => p.status !== 'moved');
  const done = active.filter((p) => p.status === 'done' || p.status === 'partial').length;

  return (
    <Page title="План недели">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn sm" aria-label="Предыдущая неделя" onClick={() => setMonday(addDays(monday, -7))}>
          ‹
        </button>
        <button className="btn sm grow" onClick={() => setMonday(weekStart(d))}>
          {formatDayMonth(monday)} — {formatDayMonth(addDays(monday, 6))}
        </button>
        <button className="btn sm" aria-label="Следующая неделя" onClick={() => setMonday(addDays(monday, 7))}>
          ›
        </button>
      </div>
      <p className="small muted">
        Тренировок: {active.length}, выполнено: {done}.
        {planned.some((p) => p.status === 'planned' && !p.workoutId) && ' Запланированные можно перетаскивать за ⠿ между днями.'}
      </p>
      {prevCount > 0 && (
        <button
          className="btn block"
          style={{ marginBottom: 10 }}
          onClick={() => void copyWeek(addDays(monday, -7), monday)}
        >
          Скопировать прошлую неделю сюда ({prevCount})
        </button>
      )}

      {weekDays(monday).map((day, i) => (
        <div key={day} data-day={day} className={`day ${day === d ? 'today' : ''} ${drag.overDay === day ? 'drop-target' : ''}`}>
          <div className="day-head">
            <span className="dname">{WEEKDAY_SHORT[i]}</span>
            <span className="grow small muted">
              {formatDayMonth(day)}
              {day === d ? ' · сегодня' : ''}
              {!(byDay.get(day)?.length) ? ' · отдых' : ''}
            </span>
            <button className="btn sm" aria-label={`Добавить тренировку на ${formatDayMonth(day)}`} onClick={() => setAddDay(day)}>
              +
            </button>
          </div>
          {(byDay.get(day) ?? []).map((p) => {
            const missed = p.status === 'planned' && !p.workoutId && day < d;
            const movable = p.status === 'planned' && !p.workoutId;
            return (
              <div key={p.id} className={`pw ${drag.draggingId === p.id ? 'dragging' : ''}`}>
                {movable && (
                  <span className="handle icon-btn" aria-hidden="true" onPointerDown={(e) => drag.start(e, p.id, p.name)}>
                    ⠿
                  </span>
                )}
                <button className="grow" style={{ textAlign: 'left', background: 'none', border: 'none', minHeight: 44, padding: 0 }} onClick={() => setActions(p)}>
                  <b>{p.name}</b>
                  <span className="small muted" style={{ display: 'block' }}>
                    Упражнений: {p.plannedItems.length}
                    {p.status === 'moved' && p.movedTo ? ` → ${formatDayMonth(p.movedTo)}` : ''}
                  </span>
                </button>
                {missed ? <span className="chip warn">пропущена?</span> : <span className={`chip ${STATUS_CLASS[p.status]}`}>{STATUS_LABEL[p.status]}</span>}
              </div>
            );
          })}
        </div>
      ))}
      {drag.ghost}
      {addDay && <AddSheet day={addDay} onClose={() => setAddDay(null)} />}
      {actions && <ActionsSheet pw={actions} todayDate={d} onClose={() => setActions(null)} />}
    </Page>
  );
}

/** Перетаскивание на pointer-событиях: работает и пальцем, и мышью. */
function useDrag(onDrop: (id: string, day: string) => void) {
  const [state, setState] = useState<{ id: string; name: string; x: number; y: number; over: string | null } | null>(null);
  const ref = useRef(state);
  ref.current = state;
  useEffect(() => {
    if (!state) return;
    const dayAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-day]')?.getAttribute('data-day') ?? null;
    const move = (e: PointerEvent) => {
      const cur = ref.current;
      if (cur) setState({ ...cur, x: e.clientX, y: e.clientY, over: dayAt(e.clientX, e.clientY) });
    };
    const up = (e: PointerEvent) => {
      const cur = ref.current;
      const day = dayAt(e.clientX, e.clientY);
      if (cur && day) onDrop(cur.id, day);
      setState(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    const cancel = () => setState(null);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    // Подписка нужна только на время перетаскивания; актуальное состояние читаем из ref.
  }, [state !== null]);
  return {
    start: (e: ReactPointerEvent, id: string, name: string) => {
      e.preventDefault();
      setState({ id, name, x: e.clientX, y: e.clientY, over: null });
    },
    draggingId: state?.id ?? null,
    overDay: state?.over ?? null,
    ghost: state ? (
      <div className="drag-ghost" style={{ left: state.x, top: state.y }}>
        {state.name}
      </div>
    ) : null,
  };
}

function AddSheet({ day, onClose }: { day: string; onClose: () => void }) {
  const templates = useLiveQuery(() => listTemplates(), []) ?? [];
  return (
    <Sheet title={`Тренировка на ${formatDayMonth(day)}`} onClose={onClose}>
      {templates.map((t) => (
        <button key={t.id} className="list-btn" onClick={() => void planWorkout(day, t).then(onClose)}>
          <span className="grow">
            <b>{t.name}</b>
            <span className="small muted" style={{ display: 'block' }}>
              Шаблон · упражнений: {t.items.length}
            </span>
          </span>
        </button>
      ))}
      {templates.length === 0 && <p className="small muted">Шаблонов нет — можно создать в «Ещё → Шаблоны».</p>}
      <button
        className="btn block"
        style={{ marginTop: 10 }}
        onClick={() => void planWorkout(day, null, 'Тренировка').then((pw) => navigate(`/planned/${pw.id}`))}
      >
        Новая тренировка (без шаблона)
      </button>
    </Sheet>
  );
}

function ActionsSheet({ pw, todayDate, onClose }: { pw: PlannedWorkout; todayDate: string; onClose: () => void }) {
  const [pickDate, setPickDate] = useState(false);
  const missed = pw.status === 'planned' && !pw.workoutId && pw.date < todayDate;
  const open = pw.status === 'planned' && !pw.workoutId;
  const dates = Array.from({ length: 15 }, (_, i) => addDays(todayDate, i));
  return (
    <Sheet title={pw.name} onClose={onClose}>
      <p className="small muted">
        {formatDayMonth(pw.date)} · {missed ? 'пропущена? выберите, что сделать' : STATUS_LABEL[pw.status]}
      </p>
      <div className="stack">
        {pw.workoutId && (
          <button className="btn block" onClick={() => navigate(`/workout/${pw.workoutId}`)}>
            Открыть тренировку
          </button>
        )}
        {open && (
          <button
            className="btn primary block"
            onClick={() =>
              void getActiveWorkout().then((a) => {
                if (a) {
                  window.alert('Сначала завершите текущую тренировку.');
                  return;
                }
                void startWorkout({ name: pw.name, plannedWorkoutId: pw.id, items: pw.plannedItems }).then(() => navigate('/today'));
              })
            }
          >
            Начать сейчас
          </button>
        )}
        {open && (
          <button className="btn block" onClick={() => navigate(`/planned/${pw.id}`)}>
            Изменить упражнения
          </button>
        )}
        {open && (
          <button className="btn block" onClick={() => setPickDate(!pickDate)}>
            Перенести на…
          </button>
        )}
        {pickDate && (
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {dates.map((dt) => (
              <button
                key={dt}
                className="chip"
                onClick={() => void (missed ? reschedule(pw.id, dt) : movePlannedDate(pw.id, dt)).then(onClose)}
              >
                {formatDayMonth(dt)}
              </button>
            ))}
          </div>
        )}
        {missed && (
          <button
            className="btn block"
            onClick={() =>
              void mergeWithNext(pw.id).then((next) => {
                if (!next) window.alert('Следующей запланированной тренировки нет.');
                onClose();
              })
            }
          >
            Объединить со следующей
          </button>
        )}
        {open && (
          <button className="btn block" onClick={() => void skipPlanned(pw.id).then(onClose)}>
            Пропустить
          </button>
        )}
        {pw.status === 'skipped' && (
          <button className="btn block" onClick={() => void updatePlanned(pw.id, { status: 'planned' }).then(onClose)}>
            Вернуть в план
          </button>
        )}
        <button
          className="btn danger block"
          onClick={() => {
            if (confirmDelete('тренировку из плана')) void deletePlanned(pw.id).then(onClose);
          }}
        >
          Удалить из плана
        </button>
      </div>
      {missed && (
        <Why>
          Пропущенную тренировку приложение не переносит само: решаете вы. «Перенести» — исходная отмечается «перенесена», копия ставится на новый день.
          «Объединить» — её упражнения добавляются к следующей запланированной.
        </Why>
      )}
    </Sheet>
  );
}

export function PlannedEditor({ id }: { id: string }) {
  const stored = useLiveQuery(() => db.plannedWorkouts.get(id), [id]);
  const settings = useSettings();
  const [draft, setDraft] = useState<PlannedWorkout | null>(null);
  useEffect(() => {
    if (stored && !draft) setDraft(stored);
  }, [stored, draft]);
  if (stored === undefined || !draft) return <main className="page" />;
  if (!stored || stored.deletedAt) return <Page title="План" onBack><Empty>Удалено.</Empty></Page>;
  const dirty = JSON.stringify([draft.name, draft.plannedItems]) !== JSON.stringify([stored.name, stored.plannedItems]);
  return (
    <Page title={`План на ${formatDayMonth(draft.date)}`} onBack>
      <label className="field">
        <span>Название</span>
        <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <ItemsEditor items={draft.plannedItems} onChange={(plannedItems) => setDraft({ ...draft, plannedItems })} settings={settings} withWeight />
      <button
        className="btn primary block big"
        style={{ marginTop: 16 }}
        disabled={!dirty}
        onClick={() => void updatePlanned(id, { name: draft.name.trim() || 'Тренировка', plannedItems: draft.plannedItems }).then(() => navigate('/plan'))}
      >
        {dirty ? 'Сохранить' : 'Сохранено'}
      </button>
    </Page>
  );
}
