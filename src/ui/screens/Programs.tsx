import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { WEEKDAY_SHORT, addDays, formatDayMonth, weekStart } from '../../domain/dates';
import type { Program, ProgressionRule } from '../../domain/types';
import { db } from '../../data/db';
import { listTemplates, plannedInRange } from '../../data/planRepo';
import { BUILT_IN_PROGRAMS, addBuiltInProgram, applyProgram, deleteProgram, deloadWeeks, listPrograms, newProgram, saveProgram } from '../../data/programRepo';
import { Empty, Page, Seg, Sheet, Stepper, Why, confirmDelete } from '../components';
import { today, useSettings } from '../hooks';
import { navigate } from '../router';

export function ProgramsScreen() {
  const programs = useLiveQuery(() => listPrograms(), []);
  const [builtIn, setBuiltIn] = useState(false);
  return (
    <Page
      title="Программы"
      onBack
      actions={
        <button
          className="btn sm"
          onClick={() => {
            const p = newProgram('Новая программа');
            void saveProgram(p).then(() => navigate(`/program/${p.id}`));
          }}
        >
          + Своя
        </button>
      }
    >
      <p className="small muted">
        Программа — расписание шаблонов по дням недели на мезоцикл 4–8 недель с правилом прогрессии и разгрузкой. «Запустить» ставит тренировки в план; веса
        подбираются неделя за неделей во вкладке «Прогресс → План на след. неделю».
      </p>
      <button className="btn block" style={{ marginBottom: 10 }} onClick={() => setBuiltIn(true)}>
        Добавить готовую схему
      </button>
      {programs?.length === 0 && <Empty>Программ пока нет.</Empty>}
      {programs?.map((p) => (
        <button key={p.id} className="list-btn" onClick={() => navigate(`/program/${p.id}`)}>
          <span className="grow">
            <b>{p.name}</b>
            <span className="small muted" style={{ display: 'block' }}>
              {p.weeks} нед. · {p.days.length} трен./нед. · {p.progressionRule === 'double' ? 'двойная прогрессия' : 'линейная'}
            </span>
          </span>
          ›
        </button>
      ))}
      {builtIn && (
        <Sheet title="Готовые схемы" onClose={() => setBuiltIn(false)}>
          <p className="small muted">
            Только общеизвестные схемы с источником. Упражнения и 3×8–12 @RIR 2 в шаблонах — значения по умолчанию приложения: поменяйте их под себя.
          </p>
          {BUILT_IN_PROGRAMS.map((b) => (
            <div key={b.key} className="card">
              <b>{b.name}</b>
              <p className="small muted">Источник: {b.source}</p>
              <button
                className="btn primary block"
                onClick={() =>
                  void addBuiltInProgram(b.key).then((id) => {
                    setBuiltIn(false);
                    if (id) navigate(`/program/${id}`);
                  })
                }
              >
                Добавить
              </button>
            </div>
          ))}
          <p className="small muted">Сплит по группам мышц не добавлен: для конкретной раскладки нет проверенного источника. Его можно собрать самому из шаблонов.</p>
        </Sheet>
      )}
    </Page>
  );
}

export function ProgramEditor({ id }: { id: string }) {
  const stored = useLiveQuery(() => db.programs.get(id), [id]);
  const templates = useLiveQuery(() => listTemplates(), []) ?? [];
  const [draft, setDraft] = useState<Program | null>(null);
  const [launch, setLaunch] = useState(false);
  useEffect(() => {
    if (stored && !draft) setDraft(stored);
  }, [stored, draft]);
  if (stored === undefined || !draft) return <main className="page" />;
  if (!stored || stored.deletedAt) return <Page title="Программа" onBack><Empty>Программа удалена.</Empty></Page>;
  const dirty = JSON.stringify({ ...draft, updatedAt: '' }) !== JSON.stringify({ ...stored, updatedAt: '' });
  const set = (patch: Partial<Program>) => setDraft({ ...draft, ...patch });
  const dayTemplate = (wd: number) => draft.days.find((d) => d.weekday === wd)?.templateId ?? '';
  const setDay = (wd: number, templateId: string) =>
    set({ days: [...draft.days.filter((d) => d.weekday !== wd), ...(templateId ? [{ weekday: wd, templateId }] : [])].sort((a, b) => a.weekday - b.weekday) });
  const deloads = deloadWeeks(draft);

  return (
    <Page title="Программа" onBack>
      <label className="field">
        <span>Название</span>
        <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      {draft.source && <p className="small muted">Источник схемы: {draft.source}</p>}
      <label className="field">
        <span>Длина мезоцикла, недель (4–8)</span>
        <Stepper label="Недель" value={draft.weeks} step={1} min={4} max={8} integer onChange={(v) => set({ weeks: v ?? 4 })} />
      </label>
      <div className="field">
        <span>Правило прогрессии</span>
        <Seg<ProgressionRule>
          label="Правило прогрессии"
          value={draft.progressionRule}
          onChange={(progressionRule) => set({ progressionRule })}
          options={[
            { value: 'double', label: 'Двойная' },
            { value: 'linear', label: 'Линейная' },
          ]}
        />
        <Why>
          Двойная: если во всех рабочих подходах достигнута верхняя граница диапазона и RIR не ниже целевого — вес + шаг упражнения, цель — нижняя граница;
          иначе тот же вес, цель +1 повтор. Линейная: + шаг, если все рабочие подходы выполнены. Правило применяется к предложениям «План на след. неделю».
        </Why>
      </div>
      <label className="field">
        <span>Разгрузка по расписанию</span>
        <select className="input" value={draft.deloadEveryNWeeks ?? ''} onChange={(e) => set({ deloadEveryNWeeks: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Нет</option>
          {[3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              Каждую {n}-ю неделю
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={draft.lastWeekDeload} onChange={(e) => set({ lastWeekDeload: e.target.checked })} />
        Последняя неделя — разгрузочная
      </label>
      <p className="small muted">Разгрузочные недели: {deloads.length ? deloads.join(', ') : 'нет'}.</p>

      <h2>Дни недели</h2>
      {templates.length === 0 && <p className="small muted">Сначала создайте шаблоны: «Ещё → Шаблоны».</p>}
      {WEEKDAY_SHORT.map((wd, i) => (
        <div key={wd} className="row" style={{ marginBottom: 6 }}>
          <b style={{ width: 32 }}>{wd}</b>
          <select className="input grow" aria-label={`Тренировка в ${wd}`} value={dayTemplate(i)} onChange={(e) => setDay(i, e.target.value)}>
            <option value="">Отдых</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      ))}

      <div className="stack" style={{ marginTop: 16 }}>
        <button className="btn primary block big" disabled={!dirty || !draft.name.trim()} onClick={() => void saveProgram(draft)}>
          {dirty ? 'Сохранить' : 'Сохранено'}
        </button>
        <button className="btn block" disabled={draft.days.length === 0} onClick={() => void saveProgram(draft).then(() => setLaunch(true))}>
          Спланировать на {draft.weeks} нед.…
        </button>
        <button
          className="btn danger block"
          onClick={() => {
            void confirmDelete(`программу «${draft.name}» (шаблоны и уже поставленные тренировки останутся)`).then((ok): unknown => ok && deleteProgram(id).then(() => navigate('/programs')));
          }}
        >
          Удалить программу
        </button>
      </div>
      {launch && <LaunchSheet program={draft} onClose={() => setLaunch(false)} />}
    </Page>
  );
}

function LaunchSheet({ program, onClose }: { program: Program; onClose: () => void }) {
  const settings = useSettings();
  const thisMonday = weekStart(today());
  const [start, setStart] = useState(addDays(thisMonday, 7));
  const end = addDays(start, 7 * program.weeks - 1);
  const existing = useLiveQuery(async () => (await plannedInRange(start, end)).filter((p) => p.status !== 'moved').length, [start, end]) ?? 0;
  const [done, setDone] = useState<number | null>(null);
  const deload = { setsFactor: settings.deloadSetsFactor, weightFactor: settings.deloadWeightFactor, minRir: settings.deloadMinRir };
  return (
    <Sheet title={`Запуск: ${program.name}`} onClose={onClose}>
      <div className="field">
        <span>Начало мезоцикла</span>
        <Seg<string>
          label="Начало"
          value={start}
          onChange={setStart}
          options={[
            { value: thisMonday, label: `эта неделя (${formatDayMonth(thisMonday)})` },
            { value: addDays(thisMonday, 7), label: `со след. (${formatDayMonth(addDays(thisMonday, 7))})` },
          ]}
        />
      </div>
      <p>
        {program.weeks} нед.: {formatDayMonth(start)} — {formatDayMonth(end)}, тренировок: {program.days.length * program.weeks}. Разгрузочные недели:{' '}
        {deloadWeeks(program).join(', ') || 'нет'}.
      </p>
      {existing > 0 && <div className="banner warn small">В эти недели уже запланировано тренировок: {existing}. Новые добавятся к ним — лишние можно удалить в «Плане».</div>}
      {done == null ? (
        <button className="btn primary block big" onClick={() => void applyProgram(program, start, deload).then(setDone)}>
          Поставить в план
        </button>
      ) : (
        <div className="stack">
          <div className="banner info small">Поставлено тренировок: {done}. Отменить можно кнопкой «Отменить» внизу.</div>
          <button className="btn block" onClick={() => navigate('/plan')}>
            Открыть план
          </button>
        </div>
      )}
    </Sheet>
  );
}
