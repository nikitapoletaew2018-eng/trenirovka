import { useLiveQuery } from 'dexie-react-hooks';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { getActiveWorkout } from '../data/workoutRepo';
import { db } from '../data/db';
import { deleteDemo, exitDemo, isDemoMode } from '../data/demo';
import { UndoSnackbar } from './components';
import { DialogHost, askConfirm } from './dialog';
import { match, useRoute } from './router';
import { HistoryScreen } from './screens/History';
import { ExerciseDetail, LibraryScreen, NewExerciseScreen } from './screens/Library';
import { AboutScreen, MoreScreen, SettingsScreen } from './screens/More';
import { PlanScreen, PlannedEditor } from './screens/Plan';
import { ProgramEditor, ProgramsScreen } from './screens/Programs';
import { ProgressScreen } from './screens/Progress';
import { CycleScreen } from './screens/Cycle';
import { BodyScreen } from './screens/Body';
import { RemindersScreen } from './screens/Reminders';
import { TemplateEditor, TemplatesScreen } from './screens/Templates';
import { TodayScreen } from './screens/Today';
import { RestBar, WorkoutView } from './screens/Workout';

const TABS = [
  { href: '/today', label: 'Сегодня', ico: '🏋', match: ['/today'] },
  { href: '/plan', label: 'План', ico: '📅', match: ['/plan', '/planned'] },
  { href: '/progress', label: 'Прогресс', ico: '📈', match: ['/progress'] },
  { href: '/history', label: 'История', ico: '🕘', match: ['/history', '/workout'] },
  { href: '/more', label: 'Ещё', ico: '☰', match: ['/more', '/library', '/exercise', '/templates', '/template', '/programs', '/program', '/settings', '/about', '/cycle', '/body', '/reminders'] },
];

function Screen({ path }: { path: string }) {
  let p: Record<string, string> | null;
  if ((p = match('/exercise/:id', path))) return <ExerciseDetail id={p.id!} />;
  if ((p = match('/template/:id', path))) return <TemplateEditor id={p.id!} />;
  if ((p = match('/planned/:id', path))) return <PlannedEditor id={p.id!} />;
  if ((p = match('/program/:id', path))) return <ProgramEditor id={p.id!} />;
  if ((p = match('/workout/:id', path))) return <WorkoutView key={p.id} workoutId={p.id!} mode="edit" />;
  switch (path) {
    case '/plan':
      return <PlanScreen />;
    case '/history':
      return <HistoryScreen />;
    case '/progress':
      return <ProgressScreen />;
    case '/programs':
      return <ProgramsScreen />;
    case '/cycle':
      return <CycleScreen />;
    case '/body':
      return <BodyScreen />;
    case '/reminders':
      return <RemindersScreen />;
    case '/more':
      return <MoreScreen />;
    case '/library':
      return <LibraryScreen />;
    case '/exercise-new':
      return <NewExerciseScreen />;
    case '/templates':
      return <TemplatesScreen />;
    case '/settings':
      return <SettingsScreen />;
    case '/about':
      return <AboutScreen />;
    default:
      return <TodayScreen />;
  }
}

/** Обновление PWA — только по подтверждению и не во время активной тренировки. */
function UpdatePrompt({ workoutActive }: { workoutActive: boolean }) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh || workoutActive) return null;
  return (
    <div className="snackbar" role="status">
      <span className="grow small">Доступна новая версия приложения</span>
      <button className="btn sm primary" onClick={() => void updateServiceWorker(true)}>
        Обновить
      </button>
      <button className="btn sm ghost" onClick={() => setNeedRefresh(false)}>
        Позже
      </button>
    </div>
  );
}

/** Плашка демо-режима: видна на всех экранах. Демо-данные — в отдельной базе. */
function DemoBanner() {
  return (
    <div className="demo-banner" role="status">
      <b>ДЕМО</b>
      <span className="grow small">Отдельная база, ваши данные не затронуты</span>
      <button
        className="btn sm"
        onClick={() => {
          exitDemo();
          window.location.reload();
        }}
      >
        Выйти
      </button>
      <button
        className="btn sm danger"
        onClick={() => {
          void askConfirm('Удалить демо-базу целиком? Реальные данные не затрагиваются.', { confirmLabel: 'Удалить демо', danger: true }).then(
            (ok): unknown => ok && deleteDemo(db).then(() => window.location.reload()),
          );
        }}
      >
        Удалить демо
      </button>
    </div>
  );
}

export function App() {
  const path = useRoute();
  const active = useLiveQuery(() => getActiveWorkout(), []);
  return (
    <div className="app">
      {isDemoMode() && <DemoBanner />}
      <Screen path={path} />
      <div className="bottom-dock">
        <UpdatePrompt workoutActive={!!active} />
        <UndoSnackbar />
        {active && <RestBar />}
      </div>
      <DialogHost />
      <nav className="tabbar" aria-label="Разделы">
        {TABS.map((t) => (
          <a
            key={t.href}
            href={`#${t.href}`}
            aria-current={t.match.some((m) => path === m || path.startsWith(`${m}/`)) ? 'page' : undefined}
          >
            <span className="ico" aria-hidden="true">
              {t.ico}
            </span>
            {t.label}
            {t.href === '/today' && active ? ' •' : ''}
          </a>
        ))}
      </nav>
    </div>
  );
}
