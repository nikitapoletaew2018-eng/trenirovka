import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { formatLongDate, localDate } from '../../domain/dates';
import { db } from '../../data/db';
import { itemsFromTemplate, listTemplates, plannedToday } from '../../data/planRepo';
import { exercisesOfWorkout, getActiveWorkout, startWorkout } from '../../data/workoutRepo';
import { Empty, Page, Sheet } from '../components';
import { today } from '../hooks';
import { navigate } from '../router';
import { BackupReminder, InstallHint } from '../protect';
import { WorkoutView } from './Workout';

export function TodayScreen() {
  const active = useLiveQuery(() => getActiveWorkout(), []);
  if (active === undefined) return <main className="page" />;
  if (active) return <WorkoutView workoutId={active.id} mode="active" />;
  return <StartScreen />;
}

function StartScreen() {
  const d = today();
  const planned = useLiveQuery(() => plannedToday(d), [d]) ?? [];
  const templates = useLiveQuery(() => listTemplates(), []) ?? [];
  const last = useLiveQuery(async () => {
    const list = await db.workouts.orderBy('startedAt').reverse().toArray();
    return list.find((w) => !w.deletedAt && w.finishedAt) ?? null;
  }, []);
  const [pickTemplate, setPickTemplate] = useState(false);

  return (
    <Page title={`Сегодня, ${formatLongDate(d).replace(/ \d{4} г\.$/, '')}`}>
      <InstallHint />
      <BackupReminder />

      {planned.length > 0 ? (
        planned.map((pw) => (
          <button
            key={pw.id}
            className="btn primary block big"
            style={{ marginBottom: 8 }}
            onClick={() => void startWorkout({ name: pw.name, plannedWorkoutId: pw.id, items: pw.plannedItems })}
          >
            ▶ По плану: {pw.name}
          </button>
        ))
      ) : (
        <div className="card">
          <p className="muted">На сегодня ничего не запланировано.</p>
          <button className="btn block" onClick={() => navigate('/plan')}>
            Открыть план недели
          </button>
        </div>
      )}

      <h2>Начать другую</h2>
      <div className="stack">
        <button className="btn block big" onClick={() => void startWorkout({ name: 'Тренировка' })}>
          Пустая тренировка
        </button>
        <button className="btn block big" disabled={templates.length === 0} onClick={() => setPickTemplate(true)}>
          Из шаблона{templates.length === 0 ? ' (шаблонов пока нет)' : ''}
        </button>
        {last && (
          <button
            className="btn block big"
            onClick={() => void exercisesOfWorkout(last.id).then((ids) => startWorkout({ name: last.name, exerciseIds: ids }))}
          >
            Повторить прошлую: {last.name} · {formatLongDate(localDate(last.startedAt, last.timeZone)).replace(/ \d{4} г\.$/, '')}
          </button>
        )}
      </div>
      {pickTemplate && (
        <Sheet title="Шаблон" onClose={() => setPickTemplate(false)}>
          {templates.length === 0 && <Empty>Шаблонов нет.</Empty>}
          {templates.map((t) => (
            <button
              key={t.id}
              className="list-btn"
              onClick={() => {
                setPickTemplate(false);
                void startWorkout({ name: t.name, items: itemsFromTemplate(t) });
              }}
            >
              <span className="grow">
                <b>{t.name}</b>
                <span className="small muted" style={{ display: 'block' }}>
                  Упражнений: {t.items.length}
                </span>
              </span>
            </button>
          ))}
        </Sheet>
      )}
    </Page>
  );
}
