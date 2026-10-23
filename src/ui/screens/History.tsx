import { useLiveQuery } from 'dexie-react-hooks';
import { formatLongDate, localDate } from '../../domain/dates';
import { workoutSummary } from '../../domain/workoutLogic';
import { formatDuration, formatWeight } from '../../domain/units';
import { db } from '../../data/db';
import { Empty, Page } from '../components';
import { useSettings } from '../hooks';
import { navigate } from '../router';

export function HistoryScreen() {
  const settings = useSettings();
  const rows = useLiveQuery(async () => {
    const workouts = (await db.workouts.orderBy('startedAt').reverse().toArray()).filter((w) => !w.deletedAt && w.finishedAt);
    const ex = new Map((await db.exercises.toArray()).map((e) => [e.id, e]));
    const out = [];
    for (const w of workouts) {
      const wes = (await db.workoutExercises.where('workoutId').equals(w.id).toArray()).filter((x) => !x.deletedAt);
      const sets = (await db.sets.where('workoutId').equals(w.id).toArray()).filter((x) => !x.deletedAt);
      const s = workoutSummary(
        w.startedAt,
        w.finishedAt ?? w.startedAt,
        wes.map((we) => ({ trackingType: ex.get(we.exerciseId)?.trackingType ?? 'weight_reps', sets: sets.filter((x) => x.workoutExerciseId === we.id) })),
        { includeBodyweight: settings.includeBodyweightInTonnage, bodyWeightKg: settings.bodyWeightKg },
      );
      out.push({ w, s, exercises: wes.length });
    }
    return out;
  }, [settings.includeBodyweightInTonnage, settings.bodyWeightKg]);

  return (
    <Page title="История">
      {rows?.length === 0 && <Empty>Завершённых тренировок пока нет.</Empty>}
      {rows?.map(({ w, s, exercises }) => (
        <button key={w.id} className="list-btn" onClick={() => navigate(`/workout/${w.id}`)}>
          <span className="grow">
            <b>{w.name}</b>
            <span className="small muted" style={{ display: 'block' }}>
              {formatLongDate(localDate(w.startedAt, w.timeZone))} · {formatDuration(s.durationSec)} · упражнений {exercises} · рабочих подходов {s.workingSets} ·{' '}
              {formatWeight(s.tonnageKg, settings.unit)}
              {w.wellbeing ? ` · самочувствие ${w.wellbeing}/5` : ''}
            </span>
          </span>
          ›
        </button>
      ))}
    </Page>
  );
}
