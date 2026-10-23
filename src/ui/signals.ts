// Сигнал окончания отдыха: вибрация (где есть — на iOS Safari Vibration API нет), звук, уведомление.
// Ограничение веба: без сервера пушей сигнал в свёрнутом приложении ненадёжен —
// браузер может приостановить таймеры. Основной сценарий — приложение открыто, экран не гаснет (Wake Lock).

let ctx: AudioContext | null = null;

/** Звук можно включить только после жеста пользователя — вызываем на первом касании. */
export function unlockAudio(): void {
  if (ctx) return;
  try {
    ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function beep(): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const [i, f] of [880, 880, 1320].entries()) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i * 0.25);
    g.gain.exponentialRampToValueAtTime(0.4, t + i * 0.25 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.25 + 0.2);
    o.connect(g).connect(ctx.destination);
    o.start(t + i * 0.25);
    o.stop(t + i * 0.25 + 0.22);
  }
}

export function canVibrate(): boolean {
  return typeof navigator.vibrate === 'function';
}

export async function notifyRestOver(opts: { sound: boolean; vibration: boolean }): Promise<void> {
  if (opts.vibration && canVibrate()) navigator.vibrate([200, 100, 200, 100, 400]);
  if (opts.sound) beep();
  if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const options: NotificationOptions = { body: 'Отдых окончен — следующий подход', tag: 'rest', icon: 'icon-192.png' };
      if (reg) await reg.showNotification('Тренировка', options);
      else new Notification('Тренировка', options);
    } catch {
      /* уведомления недоступны — остаются звук и вибрация */
    }
  }
}

export async function requestNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

// ——— Wake Lock: экран не гаснет во время тренировки ———

let lock: WakeLockSentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  if (!wanted || lock || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => {
      lock = null;
    });
  } catch {
    lock = null;
  }
}

document.addEventListener('visibilitychange', () => void acquire());

export function setWakeLock(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else if (lock) {
    void lock.release();
    lock = null;
  }
}

export function wakeLockSupported(): boolean {
  return 'wakeLock' in navigator;
}
