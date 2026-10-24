// Суперсеты и круги: соседние упражнения с одной меткой группы выполняются по кругу,
// отдых — после последнего упражнения группы. Метка — внутренняя (A, B, …), в интерфейсе — «Суперсет 1, 2…».

export type Groups = (string | null | undefined)[];

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function freshLetter(used: Groups): string {
  const set = new Set(used.filter(Boolean));
  return [...LETTERS].find((l) => !set.has(l)) ?? `G${set.size + 1}`;
}

/** Группа из одного упражнения — не суперсет: метку убираем. */
function dropSingletons(gs: (string | null)[]): (string | null)[] {
  const count = new Map<string, number>();
  for (const g of gs) if (g) count.set(g, (count.get(g) ?? 0) + 1);
  return gs.map((g) => (g && (count.get(g) ?? 0) > 1 ? g : null));
}

export function isLinkedWithNext(groups: Groups, i: number): boolean {
  const g = groups[i];
  return !!g && groups[i + 1] === g;
}

/** Объединить упражнение i со следующим (on) или разъединить их (off). Возвращает новые метки по порядку. */
export function linkWithNext(groups: Groups, i: number, on: boolean): (string | null)[] {
  const gs = groups.map((g) => g ?? null);
  if (i < 0 || i + 1 >= gs.length) return dropSingletons(gs);
  if (on) {
    const g = gs[i] ?? gs[i + 1] ?? freshLetter(gs);
    const old = gs[i + 1];
    for (let k = 0; k < gs.length; k++) if (old && gs[k] === old) gs[k] = g;
    gs[i] = g;
    gs[i + 1] = g;
  } else if (isLinkedWithNext(gs, i)) {
    const g = gs[i]!;
    const g2 = freshLetter(gs);
    for (let k = i + 1; k < gs.length && gs[k] === g; k++) gs[k] = g2;
  }
  return dropSingletons(gs);
}

/** Номера суперсетов для отображения: по порядку первого появления. */
export function supersetNumbers(groups: Groups): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of groups) if (g && !out.has(g)) out.set(g, out.size + 1);
  return out;
}
