import { useLiveQuery } from 'dexie-react-hooks';
import { Suspense, lazy, useMemo, useState } from 'react';
import type { AnalysisSettings, Session } from '../../domain/analysis';
import { WEEKDAY_SHORT, addDays, formatDayMonth, weekStart } from '../../domain/dates';
import type { PercentChange } from '../../domain/formulas';
import { MUSCLES } from '../../domain/muscles';
import { performancesOf, suggestNext, suggestionCandidates, type OptionId, type Suggestion } from '../../domain/progression';
import { RECORD_LABEL, computeRecords } from '../../domain/records';
import { weeklyReport, type WeeklyReport } from '../../domain/report';
import { computeSignals, isStagnating, weeklyE1rmSeries, type Signal } from '../../domain/signals';
import type { Exercise, PlannedItem, Settings } from '../../domain/types';
import { formatDuration, formatNumber, formatWeight, formatWeightApprox } from '../../domain/units';
import { loadSnapshot, type Snapshot } from '../../data/analyticsRepo';
import { copyWeek, plannedForWeek } from '../../data/planRepo';
import { applySuggestions, isDeloadWeek, makeWeekDeload, previewDeload } from '../../data/programRepo';
import { Empty, Page, Sheet, Why } from '../components';
import { planLine } from '../format';
import { today, useSettings } from '../hooks';
import { navigate } from '../router';
// Графики (Recharts) грузятся отдельным чанком — только при открытии вкладки.
const ChartsView = lazy(() => import('./Charts').then((m) => ({ default: m.ChartsView })));

type Tab = 'report' | 'next' | 'records' | 'charts';

export function analysisSettings(s: Settings): AnalysisSettings {
  return {
    e1rmFormula: s.e1rmFormula,
    secondaryMuscleFactor: s.secondaryMuscleFactor,
    includeBodyweightInTonnage: s.includeBodyweightInTonnage,
    bodyWeightKg: s.bodyWeightKg ?? null,
    stableThresholdPct: s.stableThresholdPct,
    stagnationWeeks: s.stagnationWeeks,
    volumeJumpPct: s.volumeJumpPct,
    rirTolerance: s.rirTolerance,
    fatigueWellbeing: s.fatigueWellbeing,
  };
}

const f1 = (n: number) => formatNumber(n, 1);
export const pctText = (c: PercentChange) => (c == null ? '—' : c.kind === 'new' ? 'новое' : `${c.value >= 0 ? '+' : '−'}${f1(Math.abs(c.value))}%`);
const ARROW = { up: '↑', flat: '→', down: '↓' } as const;

export function ProgressScreen() {
  const settings = useSettings();
  const d = today();
  const [week, setWeek] = useState(weekStart(d));
  const [tab, setTab] = useState<Tab>('report');
  const snap = useLiveQuery(() => loadSnapshot(), []);

  return (
    <Page title="Прогресс">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn sm" aria-label="Предыдущая неделя" onClick={() => setWeek(addDays(week, -7))}>
          ‹
        </button>
        <button className="btn sm grow" onClick={() => setWeek(weekStart(d))}>
          {formatDayMonth(week)} — {formatDayMonth(addDays(week, 6))}
          {week === weekStart(d) ? ' · эта неделя' : ''}
        </button>
        <button className="btn sm" aria-label="Следующая неделя" onClick={() => setWeek(addDays(week, 7))}>
          ›
        </button>
      </div>
      <div className="chips" role="tablist" aria-label="Раздел" style={{ marginBottom: 10 }}>
        {(
          [
            ['report', 'Отчёт'],
            ['next', 'План на след. неделю'],
            ['records', 'Рекорды'],
            ['charts', 'Графики'],
          ] as [Tab, string][]
        ).map(([v, l]) => (
          <button key={v} role="tab" className="chip" aria-pressed={tab === v} aria-selected={tab === v} onClick={() => setTab(v)}>
            {l}
          </button>
        ))}
      </div>
      {!snap ? null : tab === 'report' ? (
        <ReportView snap={snap} week={week} settings={settings} inProgress={week === weekStart(d)} onPlanNext={() => setTab('next')} />
      ) : tab === 'next' ? (
        <NextWeekView snap={snap} week={week} settings={settings} />
      ) : tab === 'records' ? (
        <RecordsView snap={snap} settings={settings} />
      ) : (
        <Suspense fallback={<p className="muted">Загрузка графиков…</p>}>
          <ChartsView snap={snap} settings={settings} />
        </Suspense>
      )}
    </Page>
  );
}

function useReport(snap: Snapshot, week: string, settings: Settings): WeeklyReport {
  return useMemo(
    () => weeklyReport({ week, sessions: snap.sessions, planned: snap.planned, exercises: snap.exercises, settings: analysisSettings(settings), unit: settings.unit }),
    [snap, week, settings],
  );
}

function ReportView({ snap, week, settings, inProgress, onPlanNext }: { snap: Snapshot; week: string; settings: Settings; inProgress: boolean; onPlanNext: () => void }) {
  const r = useReport(snap, week, settings);
  const signals = useMemo(
    () => computeSignals({ week, sessions: snap.sessions, planned: snap.planned, exercises: snap.exercises, settings: analysisSettings(settings), inProgress, fmtKg: (kg) => formatWeightApprox(kg, settings.unit) }),
    [snap, week, settings, inProgress],
  );
  const exById = new Map(snap.exercises.map((e) => [e.id, e]));
  const name = (id: string) => exById.get(id)?.nameRu ?? '—';
  const unit = settings.unit;
  const [deload, setDeload] = useState(false);

  return (
    <div>
      {inProgress && <p className="small muted">Неделя ещё идёт — отчёт обновляется по мере тренировок.</p>}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Кратко</h3>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {r.summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </div>

      {signals.length > 0 && (
        <>
          <h2>Сигналы</h2>
          {signals.map((s) => (
            <SignalCard key={s.id} s={s} onDeload={() => setDeload(true)} onOptions={onPlanNext} />
          ))}
        </>
      )}

      {r.isEmpty ? (
        <Empty>Завершённых тренировок за неделю нет.</Empty>
      ) : (
        <>
          <h2>План / факт</h2>
          <div className="card">
            <dl className="kv">
              <dt>Тренировки</dt>
              <dd>
                {r.planFact.plannedWorkouts > 0 ? `${r.planFact.doneWorkouts} из ${r.planFact.plannedWorkouts} по плану` : 'плана нет'} · всего {r.planFact.sessions}
              </dd>
              <dt>Рабочие подходы</dt>
              <dd>
                {r.planFact.workingSets}
                {r.planFact.plannedSets > 0 && ` из ${r.planFact.plannedSets} (${Math.round(r.planFact.completionPct ?? 0)}%)`}
              </dd>
              <dt>Самочувствие</dt>
              <dd>{r.wellbeing.avg == null ? 'не отмечено' : `${f1(r.wellbeing.avg)} из 5 (тренировок с отметкой: ${r.wellbeing.count})`}</dd>
            </dl>
          </div>

          <h2>Рабочие подходы на мышцы</h2>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Мышца</th>
                  <th>Эта</th>
                  <th>Прошлая</th>
                  <th>Ср. 4 нед.</th>
                </tr>
              </thead>
              <tbody>
                {r.muscles.map((m) => (
                  <tr key={m.muscle}>
                    <td>
                      {MUSCLES[m.muscle].ru}
                      {m.inPlan && m.thisWeek === 0 ? ' ⚠' : ''}
                    </td>
                    <td>{f1(m.thisWeek)}</td>
                    <td>{f1(m.lastWeek)}</td>
                    <td>{f1(m.avg4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Why>
              Основная мышца упражнения = 1 подход, вспомогательная = {f1(settings.secondaryMuscleFactor)} (коэффициент настраивается). Это условность:
              реальное участие мышц так не измеряется. Справочные ориентиры, не цели: ВОЗ (2020) — силовые на основные мышечные группы ≥ 2 дней в
              неделю; ≥ 10 рабочих подходов в неделю на мышечную группу связаны с большим приростом мышц (Schoenfeld, Ogborn, Krieger, 2017, метаанализ).
              «Ср. 4 нед.» — среднее за эту и три предыдущие недели, включая недели без тренировок.
            </Why>
          </div>

          <h2>Тоннаж</h2>
          <div className="card" style={{ overflowX: 'auto' }}>
            <p style={{ marginTop: 0 }}>
              Всего: <b>{formatWeight(r.tonnage.total, unit)}</b> · к прошлой неделе {pctText(r.tonnage.change)}
            </p>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Упражнение</th>
                  <th>Тоннаж</th>
                  <th>Изм.</th>
                </tr>
              </thead>
              <tbody>
                {r.tonnage.byExercise.map((x) => (
                  <tr key={x.exerciseId}>
                    <td>{name(x.exerciseId)}</td>
                    <td>{formatWeight(x.value, unit, false)}</td>
                    <td>{pctText(x.change)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Why>
              Тоннаж = Σ (вес × повторы) рабочих подходов, разминочные не учитываются. Изменение, % = (эта − прошлая) / прошлая × 100; если на прошлой
              неделе было 0 — «новое».{!settings.includeBodyweightInTonnage && ' Упражнения с собственным весом не включены (переключатель в настройках).'}
            </Why>
          </div>

          {r.e1rm.length > 0 && (
            <>
              <h2>Лучший e1RM недели (≈ оценка)</h2>
              <div className="card" style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Упражнение</th>
                      <th>≈ e1RM</th>
                      <th>к прошл.</th>
                      <th>к 4 нед.</th>
                      <th aria-label="Статус" />
                    </tr>
                  </thead>
                  <tbody>
                    {r.e1rm.map((x) => (
                      <tr key={x.exerciseId}>
                        <td>
                          {name(x.exerciseId)}
                          <span className="small muted" style={{ display: 'block' }}>
                            {formatWeight(x.weightKg, unit)} × {x.reps}
                          </span>
                        </td>
                        <td>≈ {formatWeightApprox(x.value, unit, false)}</td>
                        <td>{pctText(x.changeVsLast)}</td>
                        <td>{pctText(x.changeVs4)}</td>
                        <td aria-label={x.status ?? 'нет сравнения'}>{x.status ? ARROW[x.status] : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Why>
                  e1RM — оценка разового максимума по формуле {settings.e1rmFormula === 'epley' ? 'Epley (1985): w × (1 + r/30)' : 'Brzycki (1993): w × 36 / (37 − r)'}, только по рабочим
                  подходам с r ≤ 10. Статус ↑ / → / ↓ — изменение к прошлой неделе с порогом «стабильно» ±{f1(settings.stableThresholdPct)}% (эвристика, меняется в
                  настройках). «к 4 нед.» — сравнение с неделей 4 недели назад.
                </Why>
              </div>
            </>
          )}

          <h2>Усилие</h2>
          <div className="card">
            {r.effort.withRir === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                RIR/RPE за неделю не записывались.
              </p>
            ) : (
              <dl className="kv">
                <dt>Средний RIR</dt>
                <dd>{f1(r.effort.avgRir ?? 0)} (подходов с RIR: {r.effort.withRir})</dd>
                <dt>Средний RPE</dt>
                <dd>{f1(r.effort.avgRpe ?? 0)}</dd>
                <dt>В целевом RIR</dt>
                <dd>{r.effort.inTargetPct == null ? 'в плане нет целевого RIR' : `${Math.round(r.effort.inTargetPct)}% (${r.effort.inTarget} из ${r.effort.withTarget})`}</dd>
              </dl>
            )}
            <Why>
              RPE = 10 − RIR (Zourdos et al., 2016). «В целевом RIR» — доля рабочих подходов, где |RIR − цель из плана| ≤ {f1(settings.rirTolerance)}; допуск — эвристика,
              настраивается.
            </Why>
          </div>

          {r.records.length > 0 && (
            <>
              <h2>Личные рекорды недели</h2>
              <div className="card">
                {r.records.map((e, i) => (
                  <p key={i} style={{ margin: '4px 0' }}>
                    🏆 <b>{name(e.exerciseId)}</b>: {RECORD_LABEL[e.kind]} — {recordValue(e.kind, e.value, e.extra ?? null, unit)}
                    <span className="small muted"> (было {recordValue(e.kind, e.previous, e.extra ?? null, unit)})</span>
                  </p>
                ))}
              </div>
            </>
          )}

          <h2>Баланс движений</h2>
          <div className="card">
            <dl className="kv">
              <dt>Жимы / тяги</dt>
              <dd>
                {r.balance.push} / {r.balance.pull} рабочих подходов
              </dd>
              <dt>Верх / низ</dt>
              <dd>
                {f1(r.balance.upper)} / {f1(r.balance.lower)} (с учётом вспомогательных мышц)
              </dd>
            </dl>
            <p className="small muted">Только описание: норм соотношения приложение не задаёт.</p>
          </div>
        </>
      )}
      {deload && <DeloadSheet monday={addDays(week, 7)} sourceWeek={week} settings={settings} onClose={() => setDeload(false)} />}
    </div>
  );
}

export function recordValue(kind: keyof typeof RECORD_LABEL, value: number, extra: number | null, unit: Settings['unit']): string {
  switch (kind) {
    case 'max_weight':
      return `${formatWeight(value, unit)}${extra ? ` × ${extra}` : ''}`;
    case 'reps_at_weight':
      return `${value} повт.${extra ? ` с ${formatWeight(extra, unit)}` : ''}`;
    case 'e1rm':
      return `≈ ${formatWeightApprox(value, unit)}`;
    case 'volume':
      return formatWeight(value, unit);
    case 'max_reps':
      return `${value} повт.`;
    case 'max_duration':
      return formatDuration(value);
  }
}

function SignalCard({ s, onDeload, onOptions }: { s: Signal; onDeload: () => void; onOptions: () => void }) {
  return (
    <div className="banner warn">
      <b>{s.title}</b>
      {s.heuristic && <span className="chip" style={{ marginLeft: 6 }}>эвристика</span>}
      <div className="row wrap" style={{ marginTop: 6 }}>
        {s.action === 'deload' && (
          <button className="btn sm primary" onClick={onDeload}>
            Запланировать разгрузку
          </button>
        )}
        {s.action === 'progression_options' && (
          <button className="btn sm" onClick={onOptions}>
            Варианты в плане на след. неделю
          </button>
        )}
      </div>
      <Why>{s.why}</Why>
    </div>
  );
}

// ——— План на следующую неделю ———

interface Choice {
  accepted: boolean;
  option?: OptionId;
}

function NextWeekView({ snap, week, settings }: { snap: Snapshot; week: string; settings: Settings }) {
  const next = addDays(week, 7);
  const nextPlanned = useLiveQuery(() => plannedForWeek(next), [next]) ?? [];
  const nextIsDeload = useLiveQuery(() => isDeloadWeek(next), [next]);
  const exById = useMemo(() => new Map(snap.exercises.map((e) => [e.id, e])), [snap]);
  const unit = settings.unit;
  const fmt = (kg: number) => formatWeight(kg, unit);
  const s = analysisSettings(settings);

  const suggestions = useMemo(() => {
    const sessionsUpTo: Session[] = snap.sessions.filter((x) => x.date <= addDays(week, 6));
    const out: (Suggestion & { source: 'this_week' | 'next_week' })[] = [];
    for (const { exerciseId: exId, current, source } of suggestionCandidates(snap.planned, week)) {
      const ex = exById.get(exId);
      if (!ex) continue;
      const stagnating = isStagnating(weeklyE1rmSeries(snap.sessions, exId, week, s), s.stagnationWeeks, s.stableThresholdPct);
      out.push({
        source,
        ...suggestNext({
          exercise: ex,
          current,
          history: performancesOf(sessionsUpTo, exId),
          rule: settings.progressionRule,
          lowerBoundFailSessions: settings.lowerBoundFailSessions,
          stagnating,
          unitLabel: unit,
          fmt,
        }),
      });
    }
    return out;
    // fmt зависит только от unit
  }, [snap, week, exById, settings.progressionRule, settings.lowerBoundFailSessions, unit, s.stagnationWeeks, s.stableThresholdPct, s.e1rmFormula]);

  const [choices, setChoices] = useState<Map<string, Choice>>(new Map());
  const [msg, setMsg] = useState<string | null>(null);
  const [deload, setDeload] = useState(false);
  const choiceOf = (sg: Suggestion): Choice => choices.get(sg.exerciseId) ?? { accepted: sg.kind !== 'none' && sg.kind !== 'choose' };
  const setChoice = (id: string, c: Choice) => setChoices(new Map(choices).set(id, c));
  const itemFor = (sg: Suggestion): PlannedItem | null => {
    const c = choiceOf(sg);
    if (!c.accepted) return null;
    if (sg.kind === 'choose') return sg.options?.find((o) => o.id === c.option)?.item ?? null;
    return sg.item;
  };
  const acceptedCount = suggestions.filter((sg) => itemFor(sg)).length;
  const wantsDeload = suggestions.some((sg) => choiceOf(sg).option === 'deload');

  const apply = async () => {
    const accepted = suggestions.flatMap((sg) => {
      const it = itemFor(sg);
      return it ? [{ exerciseId: sg.exerciseId, item: it }] : [];
    });
    if (nextPlanned.length === 0) {
      if (!window.confirm(`На неделю ${formatDayMonth(next)} плана нет. Скопировать план этой недели и применить предложения?`)) return;
      await copyWeek(week, next);
    }
    const n = await applySuggestions(next, accepted);
    const inNext = new Set((await plannedForWeek(next)).flatMap((p) => p.plannedItems.map((i) => i.exerciseId)));
    const missing = accepted.filter((a) => !inNext.has(a.exerciseId)).map((a) => exById.get(a.exerciseId)?.nameRu ?? '—');
    setMsg(
      `Изменено пунктов плана: ${n}.` +
        (missing.length ? ` Нет в плане следующей недели, не применено: ${missing.join(', ')}.` : '') +
        ' Посмотреть и поправить — во вкладке «План».',
    );
    setChoices(new Map());
  };

  if (suggestions.length === 0)
    return <Empty>В планах этой и следующей недели нет упражнений — предлагать нечего. Предложения строятся по запланированным упражнениям и их последнему выполнению.</Empty>;

  return (
    <div>
      <p className="small muted">
        Предложения на неделю {formatDayMonth(next)} — {formatDayMonth(addDays(next, 6))} по результатам этой недели. Правило:{' '}
        {settings.progressionRule === 'double' ? 'двойная прогрессия' : 'линейная прогрессия'} (меняется в настройках). План изменится только после «Применить».
        {nextPlanned.length === 0 ? ' Плана на следующую неделю пока нет — при применении он будет скопирован с этой.' : ` В плане следующей недели тренировок: ${nextPlanned.length}.`}
        {nextIsDeload ? ' Следующая неделя отмечена как разгрузочная.' : ''}
      </p>
      {suggestions.map((sg) => {
        const ex = exById.get(sg.exerciseId) as Exercise;
        const c = choiceOf(sg);
        return (
          <div key={sg.exerciseId} className="card">
            <div className="row">
              <b className="grow">{ex.nameRu}</b>
              {sg.heuristic && <span className="chip">эвристика</span>}
            </div>
            {sg.kind !== 'none' && sg.kind !== 'choose' && (
              <p className="small" style={{ margin: '4px 0' }}>
                Предложение: <b>{planLine(sg.item, unit, settings.effortScale, ex.trackingType)}</b>
                {sg.item.targetReps != null && ` · цель ${sg.item.targetReps} повт.`}
              </p>
            )}
            <p className="small muted" style={{ margin: '4px 0' }}>
              {sg.basedOnDate ? `Расчёт по тренировке от ${formatDayMonth(sg.basedOnDate)}` : 'Выполнений этого упражнения нет'}
              {sg.source === 'next_week' ? ' · на этой неделе упражнения нет, взята последняя тренировка с ним' : ''}
            </p>
            <p className="small muted" style={{ margin: '4px 0' }}>
              Почему: {sg.reason}
            </p>
            {sg.kind === 'choose' ? (
              <div className="stack">
                {sg.options?.map((o) => (
                  <label key={o.id} className="check">
                    <input
                      type="radio"
                      name={`opt-${sg.exerciseId}`}
                      checked={c.option === o.id}
                      onChange={() => setChoice(sg.exerciseId, { accepted: true, option: o.id })}
                    />
                    {o.label}
                  </label>
                ))}
                {(c.option === 'replace' || c.option === 'change_range') && (
                  <p className="small muted">Это делается вручную: после применения откройте тренировку во вкладке «План» → «Изменить упражнения».</p>
                )}
              </div>
            ) : (
              sg.kind !== 'none' && (
                <label className="check">
                  <input type="checkbox" checked={c.accepted} onChange={(e) => setChoice(sg.exerciseId, { accepted: e.target.checked })} />
                  Принять
                </label>
              )
            )}
          </div>
        );
      })}
      <div className="stack" style={{ marginTop: 12 }}>
        <button className="btn primary block big" disabled={acceptedCount === 0} onClick={() => void apply()}>
          Применить ({acceptedCount})
        </button>
        <button className={`btn block ${wantsDeload ? 'primary' : ''}`} onClick={() => setDeload(true)}>
          Сделать следующую неделю разгрузочной…
        </button>
        {msg && (
          <div className="banner info small">
            {msg}{' '}
            <button className="why" onClick={() => navigate('/plan')}>
              Открыть план
            </button>
          </div>
        )}
      </div>
      {deload && <DeloadSheet monday={next} sourceWeek={week} settings={settings} onClose={() => setDeload(false)} />}
    </div>
  );
}

export function DeloadSheet({ monday, sourceWeek, settings, onClose }: { monday: string; sourceWeek: string; settings: Settings; onClose: () => void }) {
  const params = { setsFactor: settings.deloadSetsFactor, weightFactor: settings.deloadWeightFactor, minRir: settings.deloadMinRir };
  const [done, setDone] = useState(false);
  const live = useLiveQuery(() => previewDeload(monday, params), [monday, params.setsFactor, params.weightFactor, params.minRir]);
  const already = useLiveQuery(() => isDeloadWeek(monday), [monday]);
  // После подтверждения показываем то, что было подтверждено, а не «разгрузку разгрузки».
  const [frozen, setFrozen] = useState<typeof live>(undefined);
  const preview = frozen ?? live;
  const exById = useLiveQuery(async () => {
    const { exercises } = await loadSnapshot();
    return new Map(exercises.map((e) => [e.id, e]));
  }, []);
  const empty = preview && preview.length === 0;
  return (
    <Sheet title={`Разгрузка: неделя ${formatDayMonth(monday)}`} onClose={onClose}>
      <p className="small">
        Разгрузочная неделя — период сниженной тренировочной нагрузки для снятия физической и психологической усталости и восстановления (консенсус экспертов,
        Bell et al., 2023, Sports Medicine – Open).
      </p>
      <p className="small muted">
        Сейчас: рабочих подходов {Math.round(params.setsFactor * 100)}% от плана, вес {params.weightFactor === 1 ? 'тот же' : `−${Math.round((1 - params.weightFactor) * 100)}%`}, RIR ≥{' '}
        {params.minRir}. Это практические значения, а не строгая норма: исследований мало. Меняются в настройках.
      </p>
      {already && !done && <div className="banner info small">Эта неделя уже разгрузочная. Повторно облегчать её нельзя; отменить — через «Отменить» или правкой плана.</div>}
      {empty && !already && (
        <div className="stack">
          <p>На эту неделю нет незапущенных тренировок.</p>
          <button className="btn block" onClick={() => void copyWeek(sourceWeek, monday)}>
            Скопировать план недели {formatDayMonth(sourceWeek)}
          </button>
        </div>
      )}
      {!(already && !done) && preview?.map(({ pw, items }) => (
        <div key={pw.id} className="card">
          <b>
            {WEEKDAY_SHORT[(new Date(`${pw.date}T12:00:00Z`).getUTCDay() + 6) % 7]}, {formatDayMonth(pw.date)} · {pw.name}
          </b>
          {items.map((it, i) => (
            <p key={i} className="small" style={{ margin: '2px 0' }}>
              {exById?.get(it.exerciseId)?.nameRu ?? '—'}: {pw.plannedItems[i] ? planLine(pw.plannedItems[i]!, settings.unit, settings.effortScale, exById?.get(it.exerciseId)?.trackingType) : ''} →{' '}
              <b>{planLine(it, settings.unit, settings.effortScale, exById?.get(it.exerciseId)?.trackingType)}</b>
            </p>
          ))}
        </div>
      ))}
      {done ? (
        <div className="banner info small">Неделя отмечена как разгрузочная. Отменить можно кнопкой «Отменить» внизу.</div>
      ) : (
        <button
          className="btn primary block big"
          disabled={!preview || empty || !!already}
          onClick={() => {
            setFrozen(live);
            void makeWeekDeload(monday, params).then(() => setDone(true));
          }}
        >
          Подтвердить разгрузку
        </button>
      )}
    </Sheet>
  );
}

// ——— Рекорды ———

function RecordsView({ snap, settings }: { snap: Snapshot; settings: Settings }) {
  const { records } = useMemo(() => computeRecords(snap.sessions, analysisSettings(settings)), [snap, settings]);
  const exById = new Map(snap.exercises.map((e) => [e.id, e]));
  const unit = settings.unit;
  const rows = [...records.entries()].sort((a, b) => (exById.get(a[0])?.nameRu ?? '').localeCompare(exById.get(b[0])?.nameRu ?? '', 'ru'));
  if (rows.length === 0) return <Empty>Рекордов пока нет: нужны завершённые тренировки с рабочими подходами.</Empty>;
  return (
    <div>
      <p className="small muted">Только рабочие подходы (разминочные не учитываются). e1RM — оценка.</p>
      {rows.map(([id, r]) => {
        const top = [...r.repsAtWeight.entries()].sort((a, b) => b[0] - a[0]).slice(0, 5);
        return (
          <div key={id} className="card">
            <b>{exById.get(id)?.nameRu ?? '—'}</b>
            <dl className="kv" style={{ marginTop: 6 }}>
              {r.maxWeight && (
                <>
                  <dt>{RECORD_LABEL.max_weight}</dt>
                  <dd>
                    {recordValue('max_weight', r.maxWeight.value, r.maxWeight.extra ?? null, unit)} <span className="small muted">{formatDayMonth(r.maxWeight.date)}</span>
                  </dd>
                </>
              )}
              {r.e1rm && (
                <>
                  <dt>{RECORD_LABEL.e1rm}</dt>
                  <dd>
                    {recordValue('e1rm', r.e1rm.value, null, unit)} <span className="small muted">{formatDayMonth(r.e1rm.date)}</span>
                  </dd>
                </>
              )}
              {r.volume && (
                <>
                  <dt>{RECORD_LABEL.volume}</dt>
                  <dd>
                    {recordValue('volume', r.volume.value, null, unit)} <span className="small muted">{formatDayMonth(r.volume.date)}</span>
                  </dd>
                </>
              )}
              {r.maxReps && (
                <>
                  <dt>{RECORD_LABEL.max_reps}</dt>
                  <dd>{r.maxReps.value}</dd>
                </>
              )}
              {r.maxDuration && (
                <>
                  <dt>{RECORD_LABEL.max_duration}</dt>
                  <dd>{formatDuration(r.maxDuration.value)}</dd>
                </>
              )}
            </dl>
            {top.length > 0 && (
              <p className="small muted" style={{ marginBottom: 0 }}>
                Повторы с весом: {top.map(([kg, v]) => `${formatWeight(kg, unit)} × ${v.value}`).join(' · ')}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
