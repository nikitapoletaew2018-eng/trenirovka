// Калькуляторы блинов и разминки. Работают в единицах отображения (кг или lb).

export interface PlatesResult {
  /** Блины на одну сторону, по убыванию */
  perSide: number[];
  /** Вес, который получится с этими блинами */
  achieved: number;
  /** Сколько не удалось набрать имеющимися блинами */
  remainder: number;
  /** Целевой вес меньше грифа */
  belowBar: boolean;
}

/**
 * Блины на одну сторону: жадно от самого тяжёлого, количество каждого блина не ограничено.
 * total и bar — в одних единицах.
 */
export function platesPerSide(total: number, bar: number, plates: number[]): PlatesResult {
  const sorted = [...new Set(plates.filter((p) => p > 0))].sort((a, b) => b - a);
  if (total < bar) return { perSide: [], achieved: bar, remainder: 0, belowBar: true };
  let side = (total - bar) / 2;
  const perSide: number[] = [];
  const eps = 1e-6;
  for (const p of sorted) {
    while (side + eps >= p) {
      perSide.push(p);
      side -= p;
    }
  }
  const achieved = bar + 2 * perSide.reduce((a, b) => a + b, 0);
  return { perSide, achieved: round3(achieved), remainder: round3(total - achieved), belowBar: false };
}

export interface WarmupSet {
  percent: number;
  weight: number;
  reps: number | null;
}

/**
 * Разминочные подходы: проценты рабочего веса (по умолчанию 40/60/80% — эвристика из ТЗ),
 * вес округляется вниз до шага и не меньше грифа; повторяющиеся и ≥ рабочего веса отбрасываются.
 */
export function warmupSets(work: number, percents: number[], reps: (number | null)[], step: number, bar: number): WarmupSet[] {
  const out: WarmupSet[] = [];
  [...percents]
    .sort((a, b) => a - b)
    .forEach((pct, i) => {
      const raw = (work * pct) / 100;
      const w = Math.max(bar, Math.floor(raw / step + 1e-9) * step);
      const weight = round3(w);
      if (weight >= work) return;
      if (out.some((x) => x.weight === weight)) return;
      out.push({ percent: pct, weight, reps: reps[i] ?? null });
    });
  return out;
}

/** Вес грифа в фунтах для отображения: распространённые грифы 45/35/25 lb соответствуют 20/15/10 кг (≈). */
export function barInUnit(barKg: number, unit: 'kg' | 'lb'): number {
  if (unit === 'kg') return barKg;
  const map: Record<number, number> = { 20: 45, 15: 35, 10: 25 };
  return map[barKg] ?? Math.round(barKg / 0.45359237);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
