import { useLiveQuery } from 'dexie-react-hooks';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { MEASUREMENT_LABEL, MEASUREMENT_TYPES, latestByType, measurementLimits, weightWithAverage } from '../../domain/body';
import { formatDayMonth, formatLongDate } from '../../domain/dates';
import type { BodyPhoto, MeasurementType } from '../../domain/types';
import { formatNumber, formatWeight, fromDisplayWeight, round, toDisplayWeight, unitLabel } from '../../domain/units';
import { addMeasurement, addPhoto, deleteMeasurement, deletePhoto, listMeasurements, listPhotos } from '../../data/bodyRepo';
import { Empty, Page, Stepper, Why, confirmDelete } from '../components';
import { today, useSettings } from '../hooks';

const WeightChart = lazy(() => import('./Charts').then((m) => ({ default: m.WeightChart })));

export function BodyScreen() {
  const settings = useSettings();
  const unit = settings.unit;
  const ms = useLiveQuery(() => listMeasurements(), []) ?? [];
  const [type, setType] = useState<MeasurementType>('weight');
  const [date, setDate] = useState(today());
  const latest = latestByType(ms);
  const isWeight = type === 'weight';
  const lim = measurementLimits(type);
  const initial = latest[type]?.value ?? null;
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => setValue(initial == null ? null : isWeight ? round(toDisplayWeight(initial, unit), 1) : initial), [type, initial, isWeight, unit]);
  const weights = useMemo(() => weightWithAverage(ms), [ms]);
  const list = [...ms].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 30);

  return (
    <Page title="Замеры тела" onBack>
      <div className="card">
        <label className="field">
          <span>Замер</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as MeasurementType)}>
            {MEASUREMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {MEASUREMENT_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <div className="row wrap">
          <label className="field grow">
            <span>Значение, {isWeight ? unitLabel(unit) : 'см'}</span>
            <Stepper
              label="Значение"
              value={value}
              step={isWeight ? (unit === 'kg' ? 0.1 : 0.2) : 0.5}
              min={isWeight ? round(toDisplayWeight(lim.min, unit), 0) : lim.min}
              max={isWeight ? round(toDisplayWeight(lim.max, unit), 0) : lim.max}
              decimals={1}
              onChange={setValue}
            />
          </label>
          <label className="field grow">
            <span>Дата</span>
            <input className="input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />
          </label>
        </div>
        <button
          className="btn primary block big"
          disabled={value == null}
          onClick={() => value != null && void addMeasurement(date, type, isWeight ? fromDisplayWeight(value, unit) : value)}
        >
          Сохранить
        </button>
        {isWeight && <p className="small muted">Самый свежий вес также подставляется как вес тела для упражнений с собственным весом.</p>}
      </div>

      <h2>Вес тела</h2>
      <div className="card">
        {weights.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Записей веса пока нет.
          </p>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              Последний: <b>{formatWeight(weights[weights.length - 1]!.weight, unit)}</b> · среднее за 7 дней ≈ {formatWeight(weights[weights.length - 1]!.avg7, unit)}
            </p>
            <Suspense fallback={<p className="muted">Загрузка графика…</p>}>
              <WeightChart points={weights} unit={unit} />
            </Suspense>
            <Why>Скользящее среднее — среднее всех записей за последние 7 календарных дней (сегодня и 6 предыдущих), оно сглаживает колебания воды и еды.</Why>
          </>
        )}
      </div>

      <h2>Последние значения</h2>
      <div className="card">
        <dl className="kv">
          {MEASUREMENT_TYPES.filter((t) => latest[t]).map((t) => (
            <span key={t} style={{ display: 'contents' }}>
              <dt>{MEASUREMENT_LABEL[t]}</dt>
              <dd>
                {t === 'weight' ? formatWeight(latest[t]!.value, unit) : `${formatNumber(latest[t]!.value, 1)} см`} <span className="small muted">{formatDayMonth(latest[t]!.date)}</span>
              </dd>
            </span>
          ))}
        </dl>
        {Object.keys(latest).length === 0 && <p className="muted" style={{ margin: 0 }}>Замеров пока нет.</p>}
      </div>

      <h2>Записи</h2>
      {list.length === 0 && <Empty>Пусто.</Empty>}
      {list.map((x) => (
        <div key={x.id} className="row" style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
          <span className="grow small">
            {formatLongDate(x.date)} · {MEASUREMENT_LABEL[x.type]}: <b>{x.type === 'weight' ? formatWeight(x.value, unit) : `${formatNumber(x.value, 1)} см`}</b>
          </span>
          <button className="icon-btn" aria-label="Удалить замер" onClick={() => confirmDelete('замер') && void deleteMeasurement(x.id)}>
            ✕
          </button>
        </div>
      ))}

      <h2>Фото</h2>
      <Photos />
    </Page>
  );
}

function Photos() {
  const photos = useLiveQuery(() => listPhotos(), []) ?? [];
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="small muted">Фото хранятся только на этом устройстве. В экспорт JSON входят только по отдельной галочке.</p>
      <button className="btn block" onClick={() => input.current?.click()}>
        + Добавить фото
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addPhoto(today(), f);
          e.target.value = '';
        }}
      />
      <div className="photo-grid">
        {photos.map((p) => (
          <PhotoTile key={p.id} p={p} />
        ))}
      </div>
    </div>
  );
}

function PhotoTile({ p }: { p: BodyPhoto }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(p.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [p.blob]);
  return (
    <figure className="photo">
      {url && <img src={url} alt={`Фото от ${formatLongDate(p.date)}`} />}
      <figcaption className="row">
        <span className="grow small">{formatDayMonth(p.date)}</span>
        <button className="icon-btn" aria-label="Удалить фото" onClick={() => confirmDelete('фото') && void deletePhoto(p.id)}>
          ✕
        </button>
      </figcaption>
    </figure>
  );
}
