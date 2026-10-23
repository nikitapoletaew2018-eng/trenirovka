import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDayMonth, weekStart } from '../../domain/dates';
import { MUSCLES, MUSCLE_IDS } from '../../domain/muscles';
import { exerciseSeries, exerciseSeriesByWeek, frequencyByWeek, lastWeeks, muscleSetsByWeek, type ExercisePoint } from '../../domain/series';
import type { MuscleId, Settings } from '../../domain/types';
import { formatNumber, round, toDisplayWeight, unitLabel } from '../../domain/units';
import type { Snapshot } from '../../data/analyticsRepo';
import { Empty, Seg, Why } from '../components';
import { today } from '../hooks';
import { analysisSettings } from './Progress';

// Одна серия на график — цвет серии 1 из эталонной палитры (проверен валидатором на фоне #181b21:
// контраст ≥ 3:1, светлота и насыщенность в допуске). Сетка и оси — приглушённые.
const SERIES = '#3987e5';
const GRID = '#323844';
const AXIS = '#a3aab6';

type Metric = 'e1rm' | 'maxWeight' | 'tonnage';
type Gran = 'session' | 'week';

const METRIC_LABEL: Record<Metric, string> = { e1rm: 'e1RM ≈', maxWeight: 'Макс. вес', tonnage: 'Тоннаж' };

interface TipProps {
  active?: boolean;
  payload?: readonly { value?: unknown }[];
  label?: unknown;
  unit: string;
}

function ChartTooltip({ active, payload, label, unit }: TipProps) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;
  return (
    <div className="chart-tip">
      <div className="small muted">{String(label)}</div>
      <b>
        {typeof v === 'number' ? formatNumber(v, 1) : '—'} {unit}
      </b>
    </div>
  );
}

export function ChartsView({ snap, settings }: { snap: Snapshot; settings: Settings }) {
  const s = analysisSettings(settings);
  const unit = settings.unit;
  const done = useMemo(() => {
    const ids = new Set<string>();
    for (const x of snap.sessions) for (const se of x.exercises) if (se.sets.some((st) => st.completed && st.setType !== 'warmup')) ids.add(se.ex.id);
    return snap.exercises.filter((e) => ids.has(e.id)).sort((a, b) => a.nameRu.localeCompare(b.nameRu, 'ru'));
  }, [snap]);
  const [exId, setExId] = useState<string>('');
  const [metric, setMetric] = useState<Metric>('e1rm');
  const [gran, setGran] = useState<Gran>('session');
  const [table, setTable] = useState(false);
  const [muscle, setMuscle] = useState<MuscleId>('chest');
  const current = exId || done[0]?.id || '';

  const points: ExercisePoint[] = useMemo(
    () => (current ? (gran === 'session' ? exerciseSeries(snap.sessions, current, s) : exerciseSeriesByWeek(snap.sessions, current, s)) : []),
    // s пересоздаётся каждый рендер; зависимость — от настроек
    [snap, current, gran, settings],
  );
  const data = points
    .filter((p) => p[metric] != null)
    .map((p) => ({ label: gran === 'week' ? `нед. ${formatDayMonth(p.date)}` : formatDayMonth(p.date), value: round(toDisplayWeight(p[metric] ?? 0, unit), 1) }));

  const weeks = lastWeeks(weekStart(today()), 12);
  const muscleData = muscleSetsByWeek(snap.sessions, muscle, weeks, s).map((x) => ({ label: formatDayMonth(x.week), value: x.sets }));
  const freqData = frequencyByWeek(snap.sessions, weeks).map((x) => ({ label: formatDayMonth(x.week), value: x.sessions }));

  if (done.length === 0) return <Empty>Графики появятся после первой завершённой тренировки с рабочими подходами.</Empty>;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>По упражнению</h2>
      <div className="card stack">
        <select className="input" aria-label="Упражнение" value={current} onChange={(e) => setExId(e.target.value)}>
          {done.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nameRu}
            </option>
          ))}
        </select>
        <div className="row wrap">
          <Seg<Metric> label="Показатель" value={metric} onChange={setMetric} options={(Object.keys(METRIC_LABEL) as Metric[]).map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />
          <Seg<Gran> label="Группировка" value={gran} onChange={setGran} options={[{ value: 'session', label: 'Тренировки' }, { value: 'week', label: 'Недели' }]} />
        </div>
        {data.length === 0 ? (
          <p className="muted">Нет данных для этого показателя{metric === 'e1rm' ? ' (e1RM считается только при r ≤ 10 и известном весе)' : ''}.</p>
        ) : table ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>{gran === 'week' ? 'Неделя' : 'Дата'}</th>
                <th>
                  {METRIC_LABEL[metric]}, {unitLabel(unit)}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i}>
                  <td>{d.label}</td>
                  <td>{formatNumber(d.value, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ width: '100%', height: 220 }} role="img" aria-label={`${METRIC_LABEL[metric]} по ${gran === 'week' ? 'неделям' : 'тренировкам'}`}>
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} tickLine={false} minTickGap={16} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} tickLine={false} width={48} domain={['auto', 'auto']} />
                <Tooltip content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} unit={unitLabel(unit)} />} cursor={{ stroke: AXIS, strokeWidth: 1 }} />
                <Line type="linear" dataKey="value" stroke={SERIES} strokeWidth={2} dot={{ r: 4, fill: SERIES, stroke: '#181b21', strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="row">
          <button className="btn sm" onClick={() => setTable(!table)}>
            {table ? 'Показать график' : 'Показать таблицей'}
          </button>
        </div>
        {metric === 'e1rm' && <Why>e1RM — оценка по формуле {settings.e1rmFormula === 'epley' ? 'Epley' : 'Brzycki'}, только рабочие подходы с r ≤ 10.</Why>}
      </div>

      <h2>Подходы на мышечную группу по неделям</h2>
      <div className="card stack">
        <select className="input" aria-label="Мышечная группа" value={muscle} onChange={(e) => setMuscle(e.target.value as MuscleId)}>
          {MUSCLE_IDS.map((m) => (
            <option key={m} value={m}>
              {MUSCLES[m].ru}
            </option>
          ))}
        </select>
        <MiniBars data={muscleData} label={`Рабочие подходы: ${MUSCLES[muscle].ru}`} unit="подх." />
        <p className="small muted">Основная мышца = 1, вспомогательная = {formatNumber(settings.secondaryMuscleFactor, 1)} — условность.</p>
      </div>

      <h2>Частота тренировок</h2>
      <div className="card">
        <MiniBars data={freqData} label="Тренировок в неделю" unit="трен." />
        <p className="small muted">Ориентир, не цель: ВОЗ (2020) — силовые на основные мышечные группы ≥ 2 дней в неделю.</p>
      </div>
    </div>
  );
}

function MiniBars({ data, label, unit }: { data: { label: string; value: number }[]; label: string; unit: string }) {
  return (
    <div style={{ width: '100%', height: 180 }} role="img" aria-label={label}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: -16 }} barCategoryGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 10 }} stroke={GRID} tickLine={false} interval={2} />
          <YAxis tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} tickLine={false} allowDecimals={false} width={40} />
          <Tooltip content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} unit={unit} />} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
          <Bar dataKey="value" fill={SERIES} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
