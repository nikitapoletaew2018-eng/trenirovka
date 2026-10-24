import { useLiveQuery } from 'dexie-react-hooks';
import { useState, useSyncExternalStore } from 'react';
import { addDays, formatDayMonth } from '../domain/dates';
import { checkInMode, isPredictedPeriodDay, needsLightOptions } from '../domain/cycle';
import { COMFORT_NOTE, lightVersion, lighterReplacements, withoutExcluded } from '../domain/lightVersion';
import type { CheckIn, CycleData, PlannedItem, PlannedWorkout, Settings } from '../domain/types';
import { getCycleState, saveCheckIn, subscribeCycle, type CycleState } from '../data/cycleRepo';
import { isDemoMode } from '../data/mode';
import { lightenPlanned, movePlannedDate, plannedForWeek, reschedule } from '../data/planRepo';
import { updateSettings } from '../data/settings';
import { startWorkout, type StartOptions } from '../data/workoutRepo';
import { Sheet } from './components';
import { planLine } from './format';
import { today, useExerciseMap, useSettings } from './hooks';
import { navigate } from './router';

export function useCycle(): CycleState {
  return useSyncExternalStore(subscribeCycle, getCycleState, getCycleState);
}

export function useCycleData(): CycleData | null {
  const s = useCycle();
  return s.status === 'ready' ? s.data : null;
}

function Scale({ label, value, min, max, onChange, hint }: { label: string; value: number | null; min: number; max: number; onChange: (v: number | null) => void; hint: string }) {
  return (
    <div className="field">
      <span>
        {label} <span className="muted">({hint})</span>
      </span>
      <div className="row">
        {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
          <button key={n} type="button" className={`btn grow ${value === n ? 'primary' : ''}`} aria-pressed={value === n} onClick={() => onChange(value === n ? null : n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Симптомы / чек-ин: энергия 1–5, боль 0–3, сон 1–5. Всё необязательно. */
export function CheckInFields({ value, onChange }: { value: Partial<CheckIn>; onChange: (v: Partial<CheckIn>) => void }) {
  return (
    <>
      <Scale label="Энергия" hint="1 — нет сил, 5 — отлично" value={value.energy ?? null} min={1} max={5} onChange={(energy) => onChange({ ...value, energy })} />
      <Scale label="Боль / спазмы" hint="0 — нет, 3 — сильная" value={value.pain ?? null} min={0} max={3} onChange={(pain) => onChange({ ...value, pain })} />
      <Scale label="Сон" hint="1 — плохо, 5 — отлично" value={value.sleep ?? null} min={1} max={5} onChange={(sleep) => onChange({ ...value, sleep })} />
    </>
  );
}

interface PendingStart {
  opts: StartOptions;
  planned?: PlannedWorkout | null;
}

/**
 * Старт тренировки с чек-ином (ТЗ, 6.3.1). Модуль выключен — старт сразу.
 * В дни менструации чек-ин предлагается автоматически; в остальные — кнопкой «Сначала чек-ин».
 * Если энергия ≤ 2 или боль ≥ 2 — варианты на выбор. Без чек-ина нагрузка не меняется.
 */
export function useStartFlow() {
  const data = useCycleData();
  const [pending, setPending] = useState<PendingStart | null>(null);
  const [stage, setStage] = useState<'checkin' | 'options' | null>(null);
  const d = today();
  const todayCi = data?.checkIns.find((c) => c.date === d) ?? null;
  const mode = checkInMode(data, d);

  const start = (p: PendingStart, forceCheckIn = false) => {
    if (mode === 'off') return void startWorkout(p.opts);
    setPending(p);
    if (todayCi && needsLightOptions(todayCi) && p.opts.items?.length) return setStage('options');
    if ((mode === 'auto' && !todayCi) || forceCheckIn) return setStage('checkin');
    void startWorkout(p.opts);
    setPending(null);
  };
  const close = () => {
    setStage(null);
    setPending(null);
  };
  const sheets =
    pending && stage === 'checkin' ? (
      <CheckInSheet
        auto={mode === 'auto'}
        onSkip={() => {
          void startWorkout(pending.opts);
          close();
        }}
        onSaved={(ci) => {
          if (needsLightOptions(ci) && pending.opts.items?.length) setStage('options');
          else {
            void startWorkout(pending.opts);
            close();
          }
        }}
        onClose={close}
      />
    ) : pending && stage === 'options' && data ? (
      <LightOptionsSheet pending={pending} data={data} onClose={close} />
    ) : null;
  return { start, sheets, mode, enabled: mode !== 'off' };
}

function CheckInSheet({ auto, onSaved, onSkip, onClose }: { auto: boolean; onSaved: (ci: Partial<CheckIn>) => void; onSkip: () => void; onClose: () => void }) {
  const d = today();
  const [v, setV] = useState<Partial<CheckIn>>({});
  return (
    <Sheet title="Чек-ин перед тренировкой" onClose={onClose}>
      <p className="small muted">
        {auto ? 'Сегодня отмечены (или ≈ прогнозируются) дни менструации, поэтому чек-ин предлагается автоматически. ' : ''}
        Можно пропустить — тогда тренировка пойдёт по плану без изменений.
      </p>
      <CheckInFields value={v} onChange={setV} />
      <div className="stack">
        <button
          className="btn primary block big"
          onClick={() =>
            void saveCheckIn({ date: d, energy: v.energy ?? null, pain: v.pain ?? null, sleep: v.sleep ?? null }).then(() => onSaved(v))
          }
        >
          Сохранить и продолжить
        </button>
        <button className="btn block" onClick={onSkip}>
          Пропустить чек-ин
        </button>
      </div>
    </Sheet>
  );
}

function LightOptionsSheet({ pending, data, onClose }: { pending: PendingStart; data: CycleData; onClose: () => void }) {
  const settings = useSettings();
  const exMap = useExerciseMap();
  const [moving, setMoving] = useState(false);
  const items = pending.opts.items ?? [];
  const params = { setsFactor: settings.lightSetsFactor, rirPlus: settings.lightRirPlus };
  const go = (next: PlannedItem[], light: boolean) => {
    void startWorkout({ ...pending.opts, items: next, isLightVersion: light });
    onClose();
  };
  const repl = lighterReplacements(items, exMap);
  const excluded = data.settings.excludedExerciseIds.filter((id) => items.some((i) => i.exerciseId === id));
  const d = today();
  return (
    <Sheet title="Как тренироваться сегодня?" onClose={onClose}>
      <p className="small">Энергия низкая или есть боль. Выберите вариант — {COMFORT_NOTE}.</p>
      <div className="stack">
        <button className="btn block" onClick={() => go(items, false)}>
          По плану
        </button>
        <button className="btn block" onClick={() => go(lightVersion(items, params), true)}>
          Облегчённая версия: −{Math.round((1 - params.setsFactor) * 100)}% подходов, RIR +{params.rirPlus}, без попыток рекордов
        </button>
        <button className="btn block" disabled={repl.replaced.length === 0} onClick={() => go(repl.items, true)}>
          Облегчённые замены{repl.replaced.length ? `: ${repl.replaced.map((r) => `${exMap.get(r.from)?.nameRu} → ${exMap.get(r.to)?.nameRu}`).join('; ')}` : ' — в плане нет базовых структурных упражнений с альтернативами'}
        </button>
        <button className="btn block" disabled={excluded.length === 0} onClick={() => go(withoutExcluded(items, data.settings.excludedExerciseIds), true)}>
          Убрать некомфортные{excluded.length ? `: ${excluded.map((id) => exMap.get(id)?.nameRu).join(', ')}` : ' — отметьте их в «Цикл → Настройки»'}
        </button>
        {pending.planned && (
          <button className="btn block" onClick={() => setMoving(!moving)}>
            Перенести тренировку…
          </button>
        )}
        {moving && pending.planned && (
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {Array.from({ length: 7 }, (_, i) => addDays(d, i + 1)).map((dt) => (
              <button
                key={dt}
                className="chip"
                onClick={() =>
                  void (pending.planned!.date < d ? reschedule(pending.planned!.id, dt) : movePlannedDate(pending.planned!.id, dt)).then(onClose)
                }
              >
                {formatDayMonth(dt)}
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Онбординг: модуль предлагается один раз, с кнопкой «Не нужно» (ТЗ, 6.4). */
export function CycleOffer() {
  const settings = useSettings();
  if (settings.cycleEnabled || settings.cycleOfferDismissed || isDemoMode()) return null;
  return (
    <div className="banner">
      <b>Модуль «Цикл» (необязательно)</b>
      <p className="small">
        Учёт менструального цикла и самочувствия, чтобы при желании подстраивать тренировки. Выключен по умолчанию, данные только на устройстве.
      </p>
      <div className="row">
        <button className="btn sm" onClick={() => navigate('/cycle')}>
          Подробнее
        </button>
        <button className="btn sm ghost" onClick={() => void updateSettings({ cycleOfferDismissed: true })}>
          Не нужно
        </button>
      </div>
    </div>
  );
}

/**
 * Плановое облегчение (ТЗ, 6.3.2): только если пользовательница включила его сама.
 * На прогнозируемые дни менструации недели предлагается подставить облегчённые версии — с предпросмотром и подтверждением.
 */
export function PlannedLightBanner({ monday, settings }: { monday: string; settings: Settings }) {
  const data = useCycleData();
  const planned = useLiveQuery(() => plannedForWeek(monday), [monday]) ?? [];
  const exMap = useExerciseMap();
  const [open, setOpen] = useState(false);
  if (!data?.settings.plannedLightDays) return null;
  const targets = planned.filter((p) => p.status === 'planned' && !p.workoutId && !p.name.endsWith('(облегчённая)') && isPredictedPeriodDay(data.periods, p.date));
  if (!targets.length) return null;
  const params = { setsFactor: settings.lightSetsFactor, rirPlus: settings.lightRirPlus };
  const changes = targets.map((p) => ({ pw: p, items: lightVersion(p.plannedItems, params) }));
  return (
    <div className="banner info">
      <b>≈ Прогнозируемые дни менструации: {targets.map((p) => formatDayMonth(p.date)).join(', ')}</b>
      <p className="small">Вы включили плановое облегчение. Подставить облегчённые версии этих тренировок? Прогноз приблизительный.</p>
      <button className="btn sm" onClick={() => setOpen(true)}>
        Посмотреть и подтвердить
      </button>
      {open && (
        <Sheet title="Облегчённые версии" onClose={() => setOpen(false)}>
          <p className="small muted">{COMFORT_NOTE[0]!.toUpperCase() + COMFORT_NOTE.slice(1)}. Изменения можно отменить.</p>
          {changes.map(({ pw, items }) => (
            <div key={pw.id} className="card">
              <b>
                {formatDayMonth(pw.date)} · {pw.name}
              </b>
              {items.map((it, i) => (
                <p key={i} className="small" style={{ margin: '2px 0' }}>
                  {exMap.get(it.exerciseId)?.nameRu}: {planLine(pw.plannedItems[i]!, settings.unit, settings.effortScale, exMap.get(it.exerciseId)?.trackingType)} →{' '}
                  <b>{planLine(it, settings.unit, settings.effortScale, exMap.get(it.exerciseId)?.trackingType)}</b>
                </p>
              ))}
            </div>
          ))}
          <button
            className="btn primary block big"
            onClick={() => void lightenPlanned(changes.map((c) => ({ id: c.pw.id, items: c.items }))).then(() => setOpen(false))}
          >
            Подставить
          </button>
        </Sheet>
      )}
    </div>
  );
}
