import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatDuration, formatNumber, round } from '../domain/units';
import { LIMITS, parseDecimal, parseDuration } from '../domain/validation';
import { undoLast } from '../data/undo';
import { back } from './router';
import { useUndoEntry } from './hooks';

export function Page({ title, children, onBack, actions, className }: {
  title: ReactNode;
  children: ReactNode;
  onBack?: boolean | (() => void);
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <main className={`page ${className ?? ''}`}>
      <header className="page-head">
        {onBack && (
          <button className="icon-btn" aria-label="Назад" onClick={() => (typeof onBack === 'function' ? onBack() : back())}>
            ‹
          </button>
        )}
        <h1>{title}</h1>
        {actions}
      </header>
      {children}
    </main>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Числовое поле с кнопками ±. Числовая клавиатура (inputMode=decimal).
 * Значение в единицах отображения; конвертацию делает вызывающий код.
 */
export function Stepper({
  value,
  step,
  min,
  max,
  onChange,
  label,
  unit,
  decimals = 2,
  integer = false,
}: {
  value: number | null;
  step: number;
  min: number;
  max: number;
  onChange: (v: number | null) => void;
  label: string;
  unit?: string;
  decimals?: number;
  integer?: boolean;
}) {
  const shown = value == null ? '' : formatNumber(round(value, decimals), decimals === 1 ? 1 : 2);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = () => {
    setFocused(false);
    const n = parseDecimal(text);
    if (n == null) {
      if (text.trim() === '') onChange(null);
      else setText(shown);
      return;
    }
    const v = clamp(integer ? Math.round(n) : n);
    onChange(v);
    setText(formatNumber(round(v, decimals), decimals === 1 ? 1 : 2));
  };
  const bump = (d: number) => {
    const base = value ?? 0;
    const v = clamp(round(base + d, 4));
    onChange(v);
  };
  return (
    <div className="stepper">
      <button type="button" aria-label={`${label}: уменьшить`} onClick={() => bump(-step)}>
        −
      </button>
      <div>
        <input
          aria-label={label}
          inputMode={integer ? 'numeric' : 'decimal'}
          value={text}
          onFocus={(e) => {
            setFocused(true);
            e.currentTarget.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
      <button type="button" aria-label={`${label}: увеличить`} onClick={() => bump(step)}>
        +
      </button>
    </div>
  );
}

/**
 * Поле времени: показывает и принимает мин:сек («1:30»), а также «1.30», «1,30» или просто секунды («90»).
 * Хранение — в секундах. Кнопки ± — по 5 секунд.
 */
export function DurationInput({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  const shown = value == null ? '' : formatDuration(value);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);
  const commit = () => {
    setFocused(false);
    if (text.trim() === '') return onChange(null);
    const sec = parseDuration(text);
    if (sec == null) return setText(shown); // неверный ввод — вернуть прежнее значение
    onChange(sec);
    setText(formatDuration(sec));
  };
  const bump = (d: number) => onChange(Math.min(LIMITS.durationSec.max, Math.max(0, (value ?? 0) + d)));
  return (
    <div className="stepper">
      <button type="button" aria-label={`${label}: минус 5 секунд`} onClick={() => bump(-5)}>
        −
      </button>
      <div>
        <input
          aria-label={`${label} (мин:сек или секунды)`}
          inputMode="decimal"
          placeholder="0:00"
          value={text}
          onFocus={(e) => {
            setFocused(true);
            e.currentTarget.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span className="unit">мин:сек</span>
      </div>
      <button type="button" aria-label={`${label}: плюс 5 секунд`} onClick={() => bump(5)}>
        +
      </button>
    </div>
  );
}

/** «Почему?» — раскрывающееся пояснение с источником или пометкой «эвристика». */
export function Why({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="why" aria-expanded={open} onClick={() => setOpen(!open)}>
        Почему?
      </button>
      {open && <div className="banner info small">{children}</div>}
    </>
  );
}

/** Плашка «Отменить» на ~5 секунд после каждого действия. */
export function UndoSnackbar() {
  const entry = useUndoEntry();
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | null>(null);
  // Показываем только новые действия: после отмены верх стека — уже показанная запись.
  const seen = useRef(new WeakSet<object>());
  useEffect(() => {
    if (!entry || seen.current.has(entry)) {
      setVisible(false);
      return;
    }
    seen.current.add(entry);
    setVisible(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(false), 5000);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [entry]);
  if (!visible || !entry) return null;
  return (
    <div className="snackbar" role="status">
      <span className="grow small">{entry.label}</span>
      <button className="btn sm" onClick={() => void undoLast()}>
        Отменить
      </button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export { confirmDelete } from './dialog';
