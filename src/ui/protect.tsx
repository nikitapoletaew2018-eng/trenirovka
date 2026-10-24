// Защита данных: постоянное хранилище, подсказка установки, напоминание о бэкапе.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../data/db';
import { exportData, exportFileName, type ExportOptions } from '../data/backup';
import { updateSettings } from '../data/settings';
import { nowIso } from '../data/ids';
import { useSettings } from './hooks';

const WEEK_MS = 7 * 86_400_000;

/** Просим браузер не удалять данные при нехватке места (Storage API, где поддерживается). */
export async function requestPersistence(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  try {
    const already = await navigator.storage.persisted();
    const granted = already || (await navigator.storage.persist());
    await updateSettings({ persistGranted: granted });
    return granted;
  } catch {
    return null;
  }
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
});

export function InstallHint() {
  const settings = useSettings();
  const [, force] = useState(0);
  if (isStandalone() || settings.installHintDismissed) return null;
  return (
    <div className="banner info">
      <b>Установите приложение на главный экран</b>
      <p className="small">
        Так оно открывается без браузера, работает офлайн, а браузер реже очищает его данные.
        {isIos() ? ' На iPhone: Safari → «Поделиться» → «На экран Домой».' : ''}
      </p>
      <div className="row">
        {deferredPrompt && (
          <button
            className="btn primary sm"
            onClick={() => {
              void deferredPrompt?.prompt().then(() => {
                deferredPrompt = null;
                force((n) => n + 1);
              });
            }}
          >
            Установить
          </button>
        )}
        <button className="btn sm ghost" onClick={() => void updateSettings({ installHintDismissed: true })}>
          Скрыть
        </button>
      </div>
    </div>
  );
}

/** Сохранить бэкап JSON. Данные цикла и фото — только по галочкам (ТЗ, 6.4). */
export async function saveBackup(opts: ExportOptions = {}): Promise<void> {
  const data = await exportData(opts);
  if (await saveFile(exportFileName(), JSON.stringify(data, null, 2), 'application/json')) await updateSettings({ lastBackupAt: nowIso() });
}

/** Отдать файл пользователю: «Поделиться» (удобно на телефоне) или обычная загрузка. false — пользователь отменил. */
export async function saveFile(name: string, content: string, type: string): Promise<boolean> {
  const blob = new Blob([content], { type });
  const file = new File([blob], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** Раз в неделю — напоминание сделать JSON-бэкап (если есть что сохранять). */
export function BackupReminder() {
  const settings = useSettings();
  const workouts = useLiveQuery(() => db.workouts.count(), []);
  const [now] = useState(() => Date.now());
  if (!workouts) return null;
  const last = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : 0;
  const dismissed = settings.backupReminderDismissedAt ? Date.parse(settings.backupReminderDismissedAt) : 0;
  if (now - last < WEEK_MS || now - dismissed < WEEK_MS) return null;
  return (
    <div className="banner warn">
      <b>Пора сделать резервную копию</b>
      <p className="small">
        Данные хранятся только на этом устройстве. {settings.lastBackupAt ? `Последний бэкап: ${new Date(settings.lastBackupAt).toLocaleDateString('ru-RU')}.` : 'Бэкапов ещё не было.'}
      </p>
      <div className="row">
        <button className="btn primary sm" onClick={() => void saveBackup()}>
          Сохранить JSON
        </button>
        <button className="btn sm ghost" onClick={() => void updateSettings({ backupReminderDismissedAt: nowIso() })}>
          Через неделю
        </button>
      </div>
    </div>
  );
}
