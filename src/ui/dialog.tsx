// Подтверждения и сообщения внутри приложения вместо window.confirm / window.alert:
// системные диалоги блокируются во встроенных браузерах (и тогда confirm() молча возвращает false),
// а на телефоне всплывают в неудобном месте. Это окно — снизу, в зоне большого пальца.

import { useEffect, useRef, useSyncExternalStore } from 'react';

interface DialogRequest {
  message: string;
  confirmLabel: string;
  /** null — только сообщение с кнопкой «Понятно» */
  cancelLabel: string | null;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

let current: DialogRequest | null = null;
const queue: DialogRequest[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function push(r: DialogRequest) {
  if (current) queue.push(r);
  else current = r;
  emit();
}

function close(ok: boolean) {
  const r = current;
  current = queue.shift() ?? null;
  emit();
  r?.resolve(ok);
}

/** Подтверждение действия. Возвращает true, если пользователь нажал кнопку действия. */
export function askConfirm(message: string, opts: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => push({ message, confirmLabel: opts.confirmLabel ?? 'Продолжить', cancelLabel: 'Отмена', danger: !!opts.danger, resolve }));
}

/** Сообщение с одной кнопкой. */
export function showMessage(message: string): Promise<void> {
  return new Promise((resolve) => push({ message, confirmLabel: 'Понятно', cancelLabel: null, danger: false, resolve: () => resolve() }));
}

/** Подтверждение удаления (ТЗ, раздел 11: подтверждение — только для удаления). */
export function confirmDelete(what: string): Promise<boolean> {
  return askConfirm(`Удалить ${what}?`, { confirmLabel: 'Удалить', danger: true });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const snapshot = () => current;

/** Рисует текущее окно; один экземпляр в корне приложения. */
export function DialogHost() {
  const req = useSyncExternalStore(subscribe, snapshot, snapshot);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!req) return;
    // Фокус на безопасной кнопке: «Отмена» для подтверждений
    (req.cancelLabel ? cancelRef : okRef).current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);
  if (!req) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => close(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={req.message} onClick={(e) => e.stopPropagation()}>
        <p className="dialog-text">{req.message}</p>
        <div className="row">
          {req.cancelLabel && (
            <button ref={cancelRef} className="btn big grow" onClick={() => close(false)}>
              {req.cancelLabel}
            </button>
          )}
          <button ref={okRef} className={`btn big grow ${req.danger ? 'danger' : 'primary'}`} onClick={() => close(true)}>
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
