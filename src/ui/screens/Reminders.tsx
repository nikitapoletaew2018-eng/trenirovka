import { useState } from 'react';
import { WEEKDAY_SHORT, addDays } from '../../domain/dates';
import { measurementsCsv, setsCsv } from '../../domain/csv';
import { buildIcs } from '../../domain/ics';
import { loadSnapshot } from '../../data/analyticsRepo';
import { listMeasurements } from '../../data/bodyRepo';
import { plannedInRange } from '../../data/planRepo';
import { updateSettings } from '../../data/settings';
import { Page, Seg, Why } from '../components';
import { today, useExerciseMap, useSettings } from '../hooks';
import { saveFile } from '../protect';

export function RemindersScreen() {
  const s = useSettings();
  const exMap = useExerciseMap();
  const [weeks, setWeeks] = useState('2');
  const [msg, setMsg] = useState<string | null>(null);

  const exportIcs = async () => {
    const from = today();
    const planned = await plannedInRange(from, addDays(from, 7 * Number(weeks)));
    const todo = planned.filter((p) => p.status === 'planned' && !p.workoutId);
    if (!todo.length) return setMsg('В выбранном периоде нет запланированных тренировок.');
    const ics = buildIcs(todo, { time: s.reminderTime, durationMin: 75, minutesBefore: s.reminderMinutesBefore, exerciseName: (id) => exMap.get(id)?.nameRu ?? 'упражнение' });
    if (await saveFile(`trenirovka-plan-${from}.ics`, ics, 'text/calendar')) setMsg(`Тренировок в файле: ${todo.length}. Откройте файл — телефон предложит добавить события в календарь.`);
  };

  return (
    <Page title="Напоминания и CSV" onBack>
      <h2 style={{ marginTop: 0 }}>Напоминания о тренировках</h2>
      <div className="card stack">
        <p className="small" style={{ marginTop: 0 }}>
          Веб-приложение без сервера не может надёжно присылать уведомления по расписанию, когда оно закрыто. Поэтому план выгружается в календарь
          телефона — напоминание придёт от календаря, даже если приложение закрыто.
        </p>
        <label className="field">
          <span>Время тренировки</span>
          <input className="input" type="time" value={s.reminderTime} onChange={(e) => e.target.value && void updateSettings({ reminderTime: e.target.value })} />
        </label>
        <label className="field">
          <span>Напомнить заранее</span>
          <select className="input" value={s.reminderMinutesBefore} onChange={(e) => void updateSettings({ reminderMinutesBefore: Number(e.target.value) })}>
            {[0, 15, 30, 60, 120, 180].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'в момент начала' : m < 60 ? `за ${m} мин` : `за ${m / 60} ч`}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Период</span>
          <Seg<string> label="Период" value={weeks} onChange={setWeeks} options={[{ value: '1', label: '1 нед.' }, { value: '2', label: '2 нед.' }, { value: '4', label: '4 нед.' }]} />
        </div>
        <button className="btn primary block" onClick={() => void exportIcs()}>
          Скачать план в календарь (.ics)
        </button>
        <Why>
          Файл iCalendar (RFC 5545): одно событие на каждую запланированную тренировку, длительность 75 минут, с сигналом. При изменении плана скачайте файл
          заново: события обновятся по тем же идентификаторам (зависит от приложения календаря).
        </Why>
      </div>

      <h2>Напоминание о замерах</h2>
      <div className="card">
        <label className="field">
          <span>День недели — на экране «Сегодня» появится подсказка</span>
          <select
            className="input"
            value={s.measurementReminderWeekday ?? ''}
            onChange={(e) => void updateSettings({ measurementReminderWeekday: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">Не напоминать</option>
            {WEEKDAY_SHORT.map((w, i) => (
              <option key={w} value={i}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h2>Экспорт CSV</h2>
      <div className="card stack">
        <p className="small" style={{ marginTop: 0 }}>
          Для Excel, Numbers, Google Таблиц: разделитель «;», десятичная запятая, кодировка UTF-8. Вес — в кг, время — в секундах. Данные модуля «Цикл» в CSV
          не выгружаются.
        </p>
        <button
          className="btn block"
          onClick={() => void loadSnapshot().then((snap) => saveFile(`trenirovka-sets-${today()}.csv`, setsCsv(snap.sessions), 'text/csv'))}
        >
          Подходы (все тренировки)
        </button>
        <button className="btn block" onClick={() => void listMeasurements().then((ms) => saveFile(`trenirovka-body-${today()}.csv`, measurementsCsv(ms), 'text/csv'))}>
          Замеры тела
        </button>
      </div>
      {msg && <div className="banner info small">{msg}</div>}
    </Page>
  );
}
