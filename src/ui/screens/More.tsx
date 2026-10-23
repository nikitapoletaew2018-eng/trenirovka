import { useRef, useState } from 'react';
import { SCHEMA_VERSION } from '../../data/db';
import { ImportError, clearAllData, importData, parseExport } from '../../data/backup';
import { ensureSeed } from '../../data/seed';
import { updateSettings } from '../../data/settings';
import { clearUndo } from '../../data/undo';
import type { EffortScale, WeightUnit } from '../../domain/types';
import { toDisplayWeight, fromDisplayWeight, unitLabel } from '../../domain/units';
import { Page, Seg, Stepper, Why } from '../components';
import { useSettings } from '../hooks';
import { navigate } from '../router';
import { requestPersistence, saveBackup } from '../protect';
import { canVibrate, requestNotifications, wakeLockSupported } from '../signals';

export function MoreScreen() {
  return (
    <Page title="Ещё">
      {[
        ['/library', 'Упражнения', 'Библиотека, избранное, свои упражнения'],
        ['/templates', 'Шаблоны', 'Наборы упражнений для плана'],
        ['/settings', 'Настройки', 'Единицы, отдых, сигналы, данные и бэкап'],
        ['/about', 'О приложении', 'Источники, формулы, лицензии, приватность'],
      ].map(([href, title, sub]) => (
        <button key={href} className="list-btn" onClick={() => navigate(href!)}>
          <span className="grow">
            <b>{title}</b>
            <span className="small muted" style={{ display: 'block' }}>
              {sub}
            </span>
          </span>
          ›
        </button>
      ))}
    </Page>
  );
}

export function SettingsScreen() {
  const s = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [notif, setNotif] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));

  const onImport = async (file: File) => {
    try {
      const parsed = parseExport(JSON.parse(await file.text()) as unknown);
      if (!window.confirm('Импорт заменит все текущие данные данными из файла. Продолжить?')) return;
      await importData(parsed);
      await ensureSeed();
      clearUndo();
      setMsg(`Импортировано: тренировок ${parsed.tables.workouts.length}, упражнений ${parsed.tables.exercises.length}.`);
    } catch (e) {
      setMsg(e instanceof ImportError ? e.message : 'Не удалось прочитать файл: это не JSON-экспорт приложения.');
    }
  };

  return (
    <Page title="Настройки" onBack>
      <h2>Единицы и ввод</h2>
      <div className="card stack">
        <div className="row">
          <span className="grow">Вес</span>
          <Seg<WeightUnit> label="Единицы веса" value={s.unit} onChange={(unit) => void updateSettings({ unit })} options={[{ value: 'kg', label: 'кг' }, { value: 'lb', label: 'lb' }]} />
        </div>
        <p className="small muted">Значения хранятся в кг; переключение меняет только отображение.</p>
        <div className="row">
          <span className="grow">Усилие</span>
          <Seg<EffortScale> label="Шкала усилия" value={s.effortScale} onChange={(effortScale) => void updateSettings({ effortScale })} options={[{ value: 'rir', label: 'RIR' }, { value: 'rpe', label: 'RPE' }]} />
        </div>
        <Why>
          RIR — повторы в запасе. RPE = 10 − RIR (Zourdos et al., 2016, Journal of Strength and Conditioning Research). Хранится RIR, RPE пересчитывается.
        </Why>
        <div className="row">
          <span className="grow">Вес грифа</span>
          <Seg<string>
            label="Вес грифа"
            value={String(s.barWeightKg)}
            onChange={(v) => void updateSettings({ barWeightKg: Number(v) })}
            options={[20, 15, 10].map((n) => ({ value: String(n), label: `${n} кг` }))}
          />
        </div>
        <label className="field">
          <span>Отдых по умолчанию (если не задан у упражнения), сек</span>
          <Stepper label="Отдых" value={s.defaultRestSec} step={15} min={0} max={3600} integer onChange={(v) => v != null && void updateSettings({ defaultRestSec: v })} />
        </label>
        <label className="field">
          <span>Вес тела, {unitLabel(s.unit)} (для упражнений с собственным весом)</span>
          <Stepper
            label="Вес тела"
            value={s.bodyWeightKg == null ? null : toDisplayWeight(s.bodyWeightKg, s.unit)}
            step={s.unit === 'kg' ? 0.5 : 1}
            min={0}
            max={toDisplayWeight(400, s.unit)}
            onChange={(v) => void updateSettings({ bodyWeightKg: v == null || v === 0 ? null : fromDisplayWeight(v, s.unit) })}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={s.includeBodyweightInTonnage} onChange={(e) => void updateSettings({ includeBodyweightInTonnage: e.target.checked })} />
          Включать упражнения с собственным весом в тоннаж
        </label>
      </div>

      <h2>Таймер отдыха</h2>
      <div className="card stack">
        <label className="check">
          <input type="checkbox" checked={s.soundEnabled} onChange={(e) => void updateSettings({ soundEnabled: e.target.checked })} />
          Звук
        </label>
        <label className="check">
          <input type="checkbox" checked={s.vibrationEnabled} disabled={!canVibrate()} onChange={(e) => void updateSettings({ vibrationEnabled: e.target.checked })} />
          Вибрация{!canVibrate() && ' — не поддерживается этим браузером (например, Safari на iPhone)'}
        </label>
        <div className="row">
          <span className="grow small">
            Уведомления: {notif === 'granted' ? 'разрешены' : notif === 'denied' ? 'запрещены в настройках браузера' : notif === 'unsupported' ? 'не поддерживаются' : 'не запрошены'}
          </span>
          {notif === 'default' && (
            <button className="btn sm" onClick={() => void requestNotifications().then(setNotif)}>
              Разрешить
            </button>
          )}
        </div>
        <p className="small muted">
          Экран во время тренировки: {wakeLockSupported() ? 'не гаснет (Wake Lock)' : 'Wake Lock не поддерживается — экран может гаснуть'}. В свёрнутом приложении
          браузер может приостановить таймер: сигнал надёжен, пока приложение открыто.
        </p>
      </div>

      <h2>Данные</h2>
      <div className="card stack">
        <p className="small">
          Хранилище:{' '}
          {s.persistGranted === true ? 'постоянное — браузер не удалит данные при нехватке места' : s.persistGranted === false ? 'обычное — браузер может очистить данные при нехватке места' : 'статус неизвестен'}
        </p>
        {s.persistGranted !== true && (
          <button className="btn sm" onClick={() => void requestPersistence()}>
            Запросить постоянное хранилище
          </button>
        )}
        <p className="small">Последний бэкап: {s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleString('ru-RU') : 'не было'}</p>
        <button className="btn primary block" onClick={() => void saveBackup()}>
          Экспорт JSON (бэкап)
        </button>
        <button className="btn block" onClick={() => fileRef.current?.click()}>
          Импорт JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = '';
          }}
        />
        {msg && <div className="banner info small">{msg}</div>}
        <button
          className="btn danger block"
          onClick={() => {
            if (!window.confirm('Удалить ВСЕ данные приложения на этом устройстве? Сначала сделайте бэкап.')) return;
            void clearAllData()
              .then(() => ensureSeed())
              .then(() => {
                clearUndo();
                setMsg('Все данные удалены.');
              });
          }}
        >
          Удалить все данные
        </button>
        <p className="small muted">Версия схемы данных: {SCHEMA_VERSION}.</p>
      </div>
    </Page>
  );
}

export function AboutScreen() {
  return (
    <Page title="О приложении" onBack>
      <p>Дневник силовых тренировок. Работает офлайн, данные хранятся только на этом устройстве. Без рекламы, трекеров и сторонней аналитики.</p>
      <div className="banner warn small">
        Приложение не заменяет врача и тренера: оно не ставит диагнозов и не лечит. При боли во время упражнения прекратите его — тренироваться через боль не нужно.
      </div>

      <h2>База упражнений</h2>
      <p className="small">
        Упражнения основаны на <b>free-exercise-db</b> (github.com/yuhonas/free-exercise-db), лицензия <b>The Unlicense</b> (public domain), проверена 23.10.2026.
        Техника — перевод оригинальных описаний; где перевод сокращён или мышцы изменены, это указано в источнике упражнения. Категории (базовое/вспомогательное,
        структурное) — по определениям NSCA, Essentials of Strength Training and Conditioning; спорные случаи помечены «требует проверки». Частые ошибки пока скрыты:
        у них нет источника.
      </p>

      <h2>Формулы</h2>
      <ul className="small">
        <li>Тоннаж = Σ (вес × повторы) рабочих подходов; разминочные не учитываются.</li>
        <li>e1RM ≈ Epley (1985): w × (1 + r/30); альтернатива — Brzycki (1993): w × 36 / (37 − r). Только при r ≤ 10, при r = 1 e1RM = w. Это оценка.</li>
        <li>RPE = 10 − RIR (Zourdos et al., 2016, J Strength Cond Res).</li>
        <li>1 lb = 0,45359237 кг (International Yard and Pound Agreement, 1959).</li>
        <li>Отдых по умолчанию: 2–3 мин базовые, 1–2 мин вспомогательные — ACSM Position Stand «Progression Models in Resistance Training for Healthy Adults» (2009).</li>
      </ul>

      <h2>Эвристики (настраиваются)</h2>
      <ul className="small">
        <li>Шаг веса кнопок ±: штанга 2,5 кг, гантели 2 кг, тренажёр/блок 5 кг; в фунтах — кратно 2,5 lb.</li>
        <li>Отдых для упражнений на пресс — 60 с.</li>
        <li>Коэффициент вспомогательной мышцы в подсчёте подходов — 0,5 (условность; этап 2).</li>
      </ul>

      <h2>Технологии</h2>
      <p className="small muted">React, Dexie (IndexedDB), Vite, vite-plugin-pwa / Workbox. Все расчёты выполняются на устройстве.</p>
    </Page>
  );
}
