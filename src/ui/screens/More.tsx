import { useRef, useState } from 'react';
import { SCHEMA_VERSION } from '../../data/db';
import { ImportError, clearAllData, importData, parseExport } from '../../data/backup';
import { ensureSeed } from '../../data/seed';
import { updateSettings } from '../../data/settings';
import { clearUndo } from '../../data/undo';
import type { EffortScale, ProgressionRule, Settings, WeightUnit } from '../../domain/types';
import { formatNumber, toDisplayWeight, fromDisplayWeight, unitLabel } from '../../domain/units';
import { Page, Seg, Stepper, Why } from '../components';
import { useSettings } from '../hooks';
import { navigate } from '../router';
import { requestPersistence, saveBackup } from '../protect';
import { canVibrate, requestNotifications, wakeLockSupported } from '../signals';
import { askConfirm } from '../dialog';
import { DEMO_DB_NAME, REAL_DB_NAME, demoAvailable, enterDemo, isDemoMode } from '../../data/demo';
import { today } from '../hooks';

export function MoreScreen() {
  return (
    <Page title="Ещё">
      {[
        ['/library', 'Упражнения', 'Библиотека, избранное, свои упражнения'],
        ['/templates', 'Шаблоны', 'Наборы упражнений для плана'],
        ['/programs', 'Программы', 'Мезоцикл на 4–8 недель, разгрузка, готовые схемы'],
        ['/body', 'Замеры тела', 'Вес, обхваты, фото; график веса со средним за 7 дней'],
        ['/cycle', 'Цикл', 'Необязательный модуль: учёт цикла и самочувствия'],
        ['/reminders', 'Напоминания и CSV', 'План в календарь телефона (.ics), выгрузка таблицей'],
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
  // ТЗ, 6.4: данные цикла в экспорт по умолчанию не входят
  const [withCycle, setWithCycle] = useState(false);
  const [withPhotos, setWithPhotos] = useState(false);
  const [notif, setNotif] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));

  const onImport = async (file: File) => {
    try {
      const parsed = parseExport(JSON.parse(await file.text()) as unknown);
      if (!(await askConfirm('Импорт заменит все текущие данные данными из файла. Продолжить?', { confirmLabel: 'Импортировать', danger: true }))) return;
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
        <label className="check">
          <input type="checkbox" checked={s.showEffort} onChange={(e) => void updateSettings({ showEffort: e.target.checked })} />
          Отмечать запас повторов (RIR)
        </label>
        <p className="small muted">
          Сколько повторов вы могли бы сделать ещё, когда закончили подход: 0 — больше ни одного, 2 — ещё два. Помогает точнее подбирать вес, но
          необязательно — без этого приложение ведёт прогрессию по весу и повторам.
        </p>
        {s.showEffort && (<>
        <div className="row">
          <span className="grow">Шкала</span>
          <Seg<EffortScale> label="Шкала усилия" value={s.effortScale} onChange={(effortScale) => void updateSettings({ effortScale })} options={[{ value: 'rir', label: 'RIR' }, { value: 'rpe', label: 'RPE' }]} />
        </div>
        <Why>
          RIR — повторы в запасе. RPE = 10 − RIR (Zourdos et al., 2016, Journal of Strength and Conditioning Research). Хранится RIR, RPE пересчитывается.
        </Why>
        </>)}
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

      <AnalysisSettingsCard s={s} />

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

      <DemoCard />

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
        <label className="check">
          <input type="checkbox" checked={withCycle} onChange={(e) => setWithCycle(e.target.checked)} />
          Включить данные цикла{s.cycleEnabled ? '' : ' (модуль выключен)'}
        </label>
        <label className="check">
          <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
          Включить фото замеров (файл станет больше)
        </label>
        <button className="btn primary block" onClick={() => void saveBackup({ includeCycle: withCycle, includePhotos: withPhotos })}>
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
            void askConfirm('Удалить ВСЕ данные приложения на этом устройстве? Сначала сделайте бэкап.', { confirmLabel: 'Удалить всё', danger: true }).then(
              (ok): unknown => ok && clearAllData()
              .then(() => ensureSeed())
              .then(() => {
                clearUndo();
                setMsg('Все данные удалены.');
              }),
            );
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
        <li>Изменение к прошлой неделе, % = (текущая − прошлая) / прошлая × 100; если прошлая = 0 — «новое».</li>
        <li>Готовые программы (фулбади 3×/нед., верх/низ 4×/нед.) — схемы частоты и сплита из ACSM (2009).</li>
        <li>Разгрузочная неделя — определение по консенсусу экспертов: Bell et al., 2023, Sports Medicine – Open.</li>
      </ul>

      <h2>Модуль «Цикл»</h2>
      <ul className="small">
        <li>Влияние фазы цикла на силу и адаптации к силовым тренировкам: убедительных доказательств нет, рекомендован индивидуальный подход — Colenso-Semple et al., 2023, Frontiers in Sports and Active Living (зонтичный обзор); McNulty et al., 2020, Sports Medicine (метаанализ).</li>
        <li>Отсутствие менструации ≥ 90 дней и низкая энергодоступность — IOC consensus statement on REDs (Mountjoy et al., 2023).</li>
        <li>Обычная длина цикла 24–38 дней — FIGO (Munro et al., 2018).</li>
        <li>Фазы — приблизительная календарная оценка (граница — за 14 дней до прогнозируемой менструации, требует проверки). Модуль не предназначен для контрацепции и определения фертильности.</li>
        <li>Шифрование: AES-GCM, ключ из PIN через PBKDF2-SHA256, 600 000 итераций (OWASP Password Storage Cheat Sheet).</li>
      </ul>

      <h2>Напоминания</h2>
      <p className="small">Файл календаря — формат iCalendar (RFC 5545).</p>

      <h2>Справочные ориентиры (не цели)</h2>
      <ul className="small">
        <li>ВОЗ (2020): силовые тренировки на основные мышечные группы ≥ 2 дней в неделю.</li>
        <li>≥ 10 рабочих подходов в неделю на мышечную группу связаны с большим приростом мышц (Schoenfeld, Ogborn, Krieger, 2017, метаанализ).</li>
      </ul>

      <h2>Эвристики (настраиваются)</h2>
      <ul className="small">
        <li>Шаг веса кнопок ±: штанга 2,5 кг, гантели 2 кг, тренажёр/блок 5 кг; в фунтах — кратно 2,5 lb.</li>
        <li>Отдых для упражнений на пресс — 60 с.</li>
        <li>Коэффициент вспомогательной мышцы в подсчёте подходов — 0,5 (условность).</li>
        <li>Порог «стабильно» для e1RM ±2%; стагнация — 3 недели без роста; резкий рост объёма — больше +20% подходов на мышцу к прошлой неделе.</li>
        <li>Усталость: e1RM базовых упражнений падает 2 недели подряд при том же или большем RPE и/или среднее самочувствие ≤ 2.</li>
        <li>«В целевом RIR» — |RIR − цель| ≤ 1. Нижняя граница повторов не выполнена 2 тренировки подряд → выбор: оставить вес, −5–10% или замена.</li>
        <li>Разгрузка: −50% рабочих подходов, вес тот же или −10%, RIR ≥ 3 — практические значения, исследований мало.</li>
        <li>Разминка 40/60/80% рабочего веса, повторы 8/5/3.</li>
      </ul>

      <h2>Технологии</h2>
      <p className="small muted">React, Dexie (IndexedDB), Vite, vite-plugin-pwa / Workbox. Все расчёты выполняются на устройстве.</p>
    </Page>
  );
}

/** Числа через «;» или пробел: «40; 60; 80» → [40, 60, 80]. Запятая — десятичный разделитель («2,5»). */
function parseList(text: string): number[] {
  return text
    .split(/[;\s]+/)
    .map((x) => Number(x.replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function ListField({ label, value, onSave }: { label: string; value: number[]; onSave: (v: number[]) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        defaultValue={value.map((n) => formatNumber(n, 2)).join('; ')}
        onBlur={(e) => {
          const v = parseList(e.target.value);
          if (v.length) onSave(v);
          e.target.value = (v.length ? v : value).map((n) => formatNumber(n, 2)).join('; ');
        }}
      />
    </label>
  );
}

function AnalysisSettingsCard({ s }: { s: Settings }) {
  const num = (label: string, key: keyof Settings, step: number, min: number, max: number, integer = false) => (
    <label className="field">
      <span>{label}</span>
      <Stepper label={label} value={s[key] as number} step={step} min={min} max={max} integer={integer} onChange={(v) => v != null && void updateSettings({ [key]: v })} />
    </label>
  );
  return (
    <>
      <h2>Анализ и прогрессия</h2>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>Все пороги ниже — эвристики (практические правила без строгой научной базы). Значения по умолчанию — из ТЗ.</p>
        <div className="row">
          <span className="grow">Формула e1RM</span>
          <Seg<Settings['e1rmFormula']> label="Формула e1RM" value={s.e1rmFormula} onChange={(e1rmFormula) => void updateSettings({ e1rmFormula })} options={[{ value: 'epley', label: 'Epley' }, { value: 'brzycki', label: 'Brzycki' }]} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="grow">Правило прогрессии</span>
          <Seg<ProgressionRule> label="Правило прогрессии" value={s.progressionRule} onChange={(progressionRule) => void updateSettings({ progressionRule })} options={[{ value: 'double', label: 'Двойная' }, { value: 'linear', label: 'Линейная' }]} />
        </div>
        {num('Порог «стабильно» для e1RM, ±%', 'stableThresholdPct', 0.5, 0, 10)}
        {num('Стагнация: недель без роста e1RM', 'stagnationWeeks', 1, 2, 8, true)}
        {num('Резкий рост объёма на мышцу, > +%', 'volumeJumpPct', 5, 5, 100, true)}
        {num('Допуск «в целевом RIR», ±', 'rirTolerance', 0.5, 0, 3)}
        {num('Усталость: среднее самочувствие ≤', 'fatigueWellbeing', 1, 1, 5, true)}
        {num('Нижняя граница не выполнена тренировок подряд', 'lowerBoundFailSessions', 1, 1, 5, true)}
        {num('Вспомогательная мышца = доля подхода', 'secondaryMuscleFactor', 0.25, 0, 1)}
      </div>

      <h2>Разгрузка</h2>
      <div className="card">
        {num('Рабочих подходов от плана, доля (0,5 = −50%)', 'deloadSetsFactor', 0.1, 0.1, 1)}
        <div className="row">
          <span className="grow">Вес</span>
          <Seg<string> label="Вес на разгрузке" value={String(s.deloadWeightFactor)} onChange={(v) => void updateSettings({ deloadWeightFactor: Number(v) })} options={[{ value: '1', label: 'тот же' }, { value: '0.9', label: '−10%' }]} />
        </div>
        {num('Минимальный целевой RIR', 'deloadMinRir', 0.5, 0, 6)}
        <p className="small muted">Практические значения, а не строгая норма: исследований мало (Bell et al., 2023).</p>
      </div>

      <h2>Калькуляторы</h2>
      <div className="card">
        <ListField label="Разминка: % рабочего веса (эвристика)" value={s.warmupPercents} onSave={(warmupPercents) => void updateSettings({ warmupPercents })} />
        <ListField label="Разминка: повторы для каждого шага (эвристика)" value={s.warmupReps} onSave={(warmupReps) => void updateSettings({ warmupReps })} />
        <ListField label="Блины, кг (на одну сторону, через «;»)" value={s.platesKg} onSave={(platesKg) => void updateSettings({ platesKg })} />
        <ListField label="Блины, lb" value={s.platesLb} onSave={(platesLb) => void updateSettings({ platesLb })} />
      </div>
    </>
  );
}

function DemoCard() {
  const [busy, setBusy] = useState(false);
  const demo = isDemoMode();
  return (
    <>
      <h2>Демо-режим</h2>
      <div className="card stack">
        {demo ? (
          <p className="small" style={{ margin: 0 }}>
            Сейчас открыта демо-база «{DEMO_DB_NAME}». Выйти или удалить её — кнопками на плашке «ДЕМО» вверху.
          </p>
        ) : (
          <>
            <p className="small" style={{ margin: 0 }}>
              Учебная история за 6 недель (чередование тренировок A/B), чтобы посмотреть отчёты, сигналы и графики. Хранится в отдельной базе «{DEMO_DB_NAME}» и
              никогда не смешивается с вашими данными («{REAL_DB_NAME}»). Вверху будет плашка «ДЕМО» с кнопками «Выйти» и «Удалить демо».
            </p>
            <button
              className="btn block"
              disabled={busy || !demoAvailable()}
              onClick={() => {
                setBusy(true);
                void enterDemo(today()).then(() => window.location.reload());
              }}
            >
              {busy ? 'Готовлю демо…' : 'Открыть демо-режим'}
            </button>
            {!demoAvailable() && <p className="small muted">Недоступно: браузер запрещает локальное хранилище.</p>}
          </>
        )}
      </div>
    </>
  );
}
