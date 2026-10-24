import { useLiveQuery } from 'dexie-react-hooks';
import { Suspense, lazy, useMemo, useState } from 'react';
import {
  CYCLE_METRIC_LABEL,
  PHASE_LABEL,
  approximatePhase,
  averageCycleLength,
  averagePeriodLength,
  comparisonText,
  cycleAnalytics,
  cycleLengths,
  cycleSignals,
  isLoggedPeriodDay,
  isPredictedPeriodDay,
  predictNext,
  sortedPeriods,
  type CycleMetric,
} from '../../domain/cycle';
import { WEEKDAY_SHORT, addDays, daysBetween, formatDayMonth, formatLongDate } from '../../domain/dates';
import type { CheckIn, Contraception, CycleData } from '../../domain/types';
import { formatNumber } from '../../domain/units';
import { loadSnapshot } from '../../data/analyticsRepo';
import {
  deleteAllCycleData,
  deletePeriod,
  enableCycle,
  lockCycle,
  markPeriodEnd,
  markPeriodStart,
  removeCyclePin,
  saveCheckIn,
  setCyclePin,
  unlockCycle,
  updateCycleSettings,
} from '../../data/cycleRepo';
import { Empty, Page, Sheet, Why, confirmDelete } from '../components';
import { CheckInFields, useCycle } from '../cycleUi';
import { ExerciseRow, ExercisePicker } from '../ExercisePicker';
import { today, useExerciseMap, useSettings } from '../hooks';
import { analysisSettings } from './Progress';

const CycleDayChart = lazy(() => import('./Charts').then((m) => ({ default: m.CycleDayChart })));

const SCIENCE = (
  <>
    Логика модуля основана на обзорах: убедительных доказательств влияния фазы цикла на силу и адаптации к силовым тренировкам нет, рекомендован
    индивидуальный подход (Colenso-Semple et al., 2023, Frontiers in Sports and Active Living — зонтичный обзор); возможное снижение результатов в раннюю
    фолликулярную фазу тривиально, качество доказательств низкое (McNulty et al., 2020, Sports Medicine — метаанализ). Поэтому приложение не снижает нагрузку
    автоматически из-за фазы и не называет какую-то фазу «лучше» — оно подстраивается под ваше самочувствие и ваши данные.
  </>
);

const NOT_CONTRACEPTION = 'Приложение не предназначено для контрацепции и определения фертильности.';

export function CycleScreen() {
  const state = useCycle();
  return (
    <Page title="Цикл" onBack>
      {state.status === 'loading' ? null : state.status === 'disabled' ? <Intro /> : state.status === 'locked' ? <Unlock /> : <Ready data={state.data} />}
    </Page>
  );
}

function Intro() {
  return (
    <div>
      <p>Необязательный модуль: учёт менструального цикла и самочувствия, чтобы при желании подстраивать тренировки.</p>
      <div className="card small">{SCIENCE}</div>
      <h2>Приватность</h2>
      <ul className="small">
        <li>Модуль выключен по умолчанию и включается только вами.</li>
        <li>Данные хранятся только на этом устройстве. Синхронизации нет.</li>
        <li>Можно зашифровать данные PIN-кодом.</li>
        <li>В экспорт данные цикла по умолчанию не входят — только по отдельной галочке.</li>
        <li>«Удалить все данные цикла» — одной кнопкой, полностью.</li>
      </ul>
      <div className="banner warn small">{NOT_CONTRACEPTION} Это не медицинское приложение: оно не ставит диагнозов.</div>
      <button className="btn primary block big" onClick={() => void enableCycle()}>
        Включить модуль
      </button>
    </div>
  );
}

function Unlock() {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <p>Данные цикла зашифрованы. Введите PIN.</p>
      <input className="input" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} aria-label="PIN" />
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      <button
        className="btn primary block big"
        style={{ marginTop: 10 }}
        disabled={busy || pin.length < 4}
        onClick={() => {
          setBusy(true);
          setErr(null);
          void unlockCycle(pin)
            .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Ошибка'))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Проверяю…' : 'Открыть'}
      </button>
      <p className="small muted">Если PIN забыт, данные цикла не восстановить: их можно только удалить в «Настройки → Данные».</p>
    </div>
  );
}

function Ready({ data }: { data: CycleData }) {
  const d = today();
  const periods = sortedPeriods(data.periods);
  const phase = approximatePhase(data, d);
  const pred = predictNext(data.periods);
  const avg = averageCycleLength(data.periods);
  const avgPeriod = averagePeriodLength(data.periods);
  const open = periods.find((p) => !p.endDate && p.startDate <= d && daysBetween(p.startDate, d) < 10);
  const signals = cycleSignals(data, d);
  const todayCi = data.checkIns.find((c) => c.date === d) ?? {};
  const hormonal = data.settings.contraception === 'hormonal';

  return (
    <div>
      <p className="small muted">{NOT_CONTRACEPTION}</p>
      <div className="card">
        {periods.length === 0 ? (
          <p style={{ marginTop: 0 }}>Отметьте начало менструации — с этого начнётся учёт.</p>
        ) : (
          <p style={{ marginTop: 0 }}>
            {phase ? (
              <>
                <b>День цикла {phase.day}</b> · {PHASE_LABEL[phase.phase]}
              </>
            ) : (
              <b>День цикла {Math.max(1, daysBetween(periods[periods.length - 1]!.startDate, d) + 1)}</b>
            )}
          </p>
        )}
        {hormonal ? (
          <p className="small muted">При гормональной контрацепции естественные фазы не показываются — учитываются только дни кровотечения и симптомы.</p>
        ) : (
          phase && (
            <Why>
              Фаза — приблизительная календарная оценка по датам, без измерения гормонов она неточна. Граница фолликулярной и лютеиновой фаз условно взята за 14
              дней до прогнозируемой менструации — это календарная условность, требует проверки: у разных людей и в разных циклах она разная.
            </Why>
          )
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn grow" onClick={() => void markPeriodStart(d)}>
            Начались сегодня
          </button>
          <button className="btn grow" disabled={!open} onClick={() => void markPeriodEnd(d)}>
            Закончились сегодня
          </button>
        </div>
      </div>

      <h2>Прогноз</h2>
      <div className="card">
        {pred ? (
          <>
            <p style={{ marginTop: 0 }}>
              ≈ Следующая менструация — <b>примерно с {formatDayMonth(pred.start)}</b>
            </p>
            <p className="small muted">
              Средняя длина цикла ≈ {formatNumber(avg.avg ?? 0, 1)} дн. по последним {avg.count} циклам{avgPeriod ? `, менструация ≈ ${avgPeriod} дн.` : ''}.
              {!pred.reliable && ' Циклов меньше 3 — прогноз грубый.'}
            </p>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Для прогноза нужны хотя бы два отмеченных начала менструации.
          </p>
        )}
      </div>

      <h2>Самочувствие сегодня</h2>
      <div className="card">
        <CheckInFields value={todayCi} onChange={(v) => void saveCheckIn({ date: d, energy: v.energy ?? null, pain: v.pain ?? null, sleep: v.sleep ?? null })} />
        <p className="small muted">Сохраняется сразу. Используется для чек-ина перед тренировкой и личной аналитики.</p>
      </div>

      {signals.length > 0 && (
        <>
          <h2>Обратите внимание</h2>
          {signals.map((s) => (
            <div key={s.id} className="banner warn">
              <b>{s.title}</b>
              <p className="small">{s.why}</p>
              <p className="small muted">Источник: {s.source}</p>
            </div>
          ))}
        </>
      )}

      <h2>Календарь</h2>
      <Calendar data={data} />

      <h2>История</h2>
      <PeriodsList data={data} />

      <h2>Личная аналитика</h2>
      <Analytics data={data} />

      <h2>Настройки модуля</h2>
      <CycleSettingsCard data={data} />

      <h2>Источники</h2>
      <div className="small muted">
        <p>{SCIENCE}</p>
        <p>
          Мягкие сигналы: отсутствие менструации ≥ 90 дней у активных женщин может быть связано с низкой энергодоступностью — IOC consensus statement on REDs
          (Mountjoy et al., 2023); длина цикла стабильно вне 24–38 дней — FIGO (Munro et al., 2018). Это не диагнозы: при сомнениях обращайтесь к врачу.
        </p>
      </div>
    </div>
  );
}

function monthDays(monthStart: string): (string | null)[] {
  const first = new Date(`${monthStart}T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const next = new Date(first);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const count = Math.round((next.getTime() - first.getTime()) / 86_400_000);
  return [...Array.from({ length: offset }, () => null), ...Array.from({ length: count }, (_, i) => addDays(monthStart, i))];
}

function Calendar({ data }: { data: CycleData }) {
  const d = today();
  const [month, setMonth] = useState(d.slice(0, 8) + '01');
  const [day, setDay] = useState<string | null>(null);
  const shift = (n: number) => {
    const x = new Date(`${month}T12:00:00Z`);
    x.setUTCMonth(x.getUTCMonth() + n);
    setMonth(x.toISOString().slice(0, 8) + '01');
  };
  const title = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T12:00:00Z`));
  const ciDates = new Set(data.checkIns.map((c) => c.date));
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <button className="btn sm" aria-label="Предыдущий месяц" onClick={() => shift(-1)}>
          ‹
        </button>
        <b className="grow" style={{ textAlign: 'center' }}>
          {title}
        </b>
        <button className="btn sm" aria-label="Следующий месяц" onClick={() => shift(1)}>
          ›
        </button>
      </div>
      <div className="cal">
        {WEEKDAY_SHORT.map((w) => (
          <span key={w} className="cal-head">
            {w}
          </span>
        ))}
        {monthDays(month).map((dt, i) =>
          dt ? (
            <button
              key={dt}
              className={`cal-day ${isLoggedPeriodDay(data.periods, dt) ? 'period' : ''} ${isPredictedPeriodDay(data.periods, dt) ? 'predicted' : ''} ${dt === d ? 'today' : ''}`}
              aria-label={`${formatLongDate(dt)}${isLoggedPeriodDay(data.periods, dt) ? ', менструация' : ''}${isPredictedPeriodDay(data.periods, dt) ? ', ≈ прогноз' : ''}`}
              onClick={() => setDay(dt)}
            >
              {Number(dt.slice(8))}
              {ciDates.has(dt) && <span className="cal-dot" aria-hidden="true" />}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
      <p className="small muted">
        <span className="cal-legend period" /> менструация · <span className="cal-legend predicted" /> ≈ прогноз · точка — отмечено самочувствие
      </p>
      {day && <DaySheet data={data} date={day} onClose={() => setDay(null)} />}
    </div>
  );
}

function DaySheet({ data, date, onClose }: { data: CycleData; date: string; onClose: () => void }) {
  const ci: Partial<CheckIn> = data.checkIns.find((c) => c.date === date) ?? {};
  const covering = data.periods.filter((p) => p.startDate <= date && (p.endDate ?? addDays(p.startDate, 9)) >= date);
  return (
    <Sheet title={formatLongDate(date)} onClose={onClose}>
      <div className="row">
        <button className="btn grow" onClick={() => void markPeriodStart(date).then(onClose)}>
          Начало менструации
        </button>
        <button className="btn grow" disabled={!data.periods.some((p) => p.startDate <= date)} onClick={() => void markPeriodEnd(date).then(onClose)}>
          Окончание
        </button>
      </div>
      {covering.map((p) => (
        <p key={p.id} className="small">
          Запись: с {formatDayMonth(p.startDate)}
          {p.endDate ? ` по ${formatDayMonth(p.endDate)}` : ' (конец не отмечен)'}{' '}
          <button
            className="why"
            onClick={() => {
              if (confirmDelete('эту запись')) void deletePeriod(p.id).then(onClose);
            }}
          >
            удалить
          </button>
        </p>
      ))}
      <h3>Симптомы</h3>
      <CheckInFields value={ci} onChange={(v) => void saveCheckIn({ date, energy: v.energy ?? null, pain: v.pain ?? null, sleep: v.sleep ?? null })} />
    </Sheet>
  );
}

function PeriodsList({ data }: { data: CycleData }) {
  const lengths = new Map(cycleLengths(data.periods).map((c) => [c.start, c.length]));
  const list = [...sortedPeriods(data.periods)].reverse();
  if (!list.length) return <Empty>Записей пока нет.</Empty>;
  return (
    <div className="card">
      <table className="tbl">
        <thead>
          <tr>
            <th>Начало</th>
            <th>Дней</th>
            <th>Цикл</th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id}>
              <td>{formatLongDate(p.startDate)}</td>
              <td>{p.endDate ? daysBetween(p.startDate, p.endDate) + 1 : '—'}</td>
              <td>{lengths.get(p.startDate) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Analytics({ data }: { data: CycleData }) {
  const settings = useSettings();
  const snap = useLiveQuery(() => loadSnapshot(), []);
  const [metric, setMetric] = useState<CycleMetric>('e1rm');
  const a = useMemo(() => (snap ? cycleAnalytics(snap.sessions, snap.planned, data, today(), analysisSettings(settings)) : null), [snap, data, settings]);
  if (!a) return null;
  if (!a.enough)
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Личная аналитика появится после 3 завершённых циклов (сейчас: {a.completeCycles}).
        </p>
      </div>
    );
  const pattern = a.comparisons.some((c) => c.verdict === 'pattern');
  return (
    <div className="card stack">
      <p className="small muted" style={{ marginTop: 0 }}>
        Сравнение «дни менструации — остальные дни» по каждому из {a.completeCycles} завершённых циклов. «Закономерность» — разница одного знака во всех
        циклах и не меньше порога; пороги — эвристика.
      </p>
      {a.comparisons.map((c) => (
        <p key={c.metric} className="small" style={{ margin: 0 }}>
          <b>{CYCLE_METRIC_LABEL[c.metric]}:</b> {comparisonText(c)}
        </p>
      ))}
      <select className="input" aria-label="Показатель" value={metric} onChange={(e) => setMetric(e.target.value as CycleMetric)}>
        {(Object.keys(CYCLE_METRIC_LABEL) as CycleMetric[]).map((m) => (
          <option key={m} value={m}>
            {CYCLE_METRIC_LABEL[m]}
          </option>
        ))}
      </select>
      <Suspense fallback={<p className="muted">Загрузка графика…</p>}>
        <CycleDayChart points={a.byDay[metric]} label={CYCLE_METRIC_LABEL[metric]} />
      </Suspense>
      {pattern && !data.settings.plannedLightDays && (
        <div className="banner info small">
          Есть закономерность. Если хотите, можно включить плановое облегчение в прогнозируемые дни — это только предложение.{' '}
          <button className="why" onClick={() => void updateCycleSettings({ plannedLightDays: true })}>
            Включить
          </button>
        </div>
      )}
    </div>
  );
}

function CycleSettingsCard({ data }: { data: CycleData }) {
  const s = data.settings;
  const exMap = useExerciseMap();
  const settings = useSettings();
  const [pick, setPick] = useState(false);
  const [pin, setPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  return (
    <div className="card stack">
      <label className="field">
        <span>Контрацепция</span>
        <select className="input" value={s.contraception ?? 'none'} onChange={(e) => void updateCycleSettings({ contraception: e.target.value as Contraception })}>
          <option value="none">Нет</option>
          <option value="hormonal">Гормональная (фазы не показываются)</option>
          <option value="non_hormonal">Негормональная</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={!!s.pregnancy} onChange={(e) => void updateCycleSettings({ pregnancy: e.target.checked })} />
        Беременность (сигнал об отсутствии менструации не показывается)
      </label>
      <label className="check">
        <input type="checkbox" checked={s.plannedLightDays} onChange={(e) => void updateCycleSettings({ plannedLightDays: e.target.checked })} />
        Облегчённые тренировки в прогнозируемые дни менструации (с подтверждением в «Плане»)
      </label>

      <div>
        <b className="small">Некомфортные упражнения в эти дни</b>
        <p className="small muted" style={{ margin: '2px 0' }}>
          Их можно убрать из тренировки после чек-ина — только по вашему выбору.
        </p>
        {s.excludedExerciseIds.map((id) => {
          const e = exMap.get(id);
          return e ? (
            <ExerciseRow
              key={id}
              e={e}
              onClick={() => void updateCycleSettings({ excludedExerciseIds: s.excludedExerciseIds.filter((x) => x !== id) })}
              right={<span className="small muted">убрать</span>}
            />
          ) : null;
        })}
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setPick(true)}>
          + Упражнение
        </button>
      </div>

      <div>
        <b className="small">PIN-код</b>
        {settings.cyclePinEnabled ? (
          <div className="row wrap" style={{ marginTop: 6 }}>
            <button className="btn sm" onClick={() => lockCycle()}>
              Заблокировать сейчас
            </button>
            <button className="btn sm" onClick={() => void removeCyclePin().then(() => setPinMsg('PIN снят, данные расшифрованы.'))}>
              Снять PIN
            </button>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 6 }}>
            <input className="input grow" type="password" inputMode="numeric" autoComplete="new-password" placeholder="Не короче 4 символов" value={pin} onChange={(e) => setPin(e.target.value)} aria-label="Новый PIN" />
            <button
              className="btn sm"
              disabled={pin.length < 4}
              onClick={() =>
                void setCyclePin(pin).then(() => {
                  setPin('');
                  setPinMsg('Данные цикла зашифрованы.');
                })
              }
            >
              Задать
            </button>
          </div>
        )}
        <p className="small muted">
          Шифрование AES-GCM, ключ из PIN (PBKDF2, 600 000 итераций). Короткий цифровой PIN защищает от случайного взгляда, но не от перебора, если кто-то
          получит копию базы — для этого используйте длинный код. Забытый PIN не восстановить. Разблокировка биометрией пока не поддерживается.
        </p>
        {pinMsg && <p className="small">{pinMsg}</p>}
      </div>

      <button
        className="btn danger block"
        onClick={() => {
          if (window.confirm('Удалить ВСЕ данные цикла (отметки, симптомы, настройки модуля) без возможности восстановления? Тренировки останутся.'))
            void deleteAllCycleData();
        }}
      >
        Удалить все данные цикла
      </button>
      {pick && (
        <ExercisePicker
          title="Некомфортное упражнение"
          onClose={() => setPick(false)}
          onPick={(e) => {
            setPick(false);
            if (!s.excludedExerciseIds.includes(e.id)) void updateCycleSettings({ excludedExerciseIds: [...s.excludedExerciseIds, e.id] });
          }}
        />
      )}
    </div>
  );
}
