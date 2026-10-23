// Сборка начальной базы упражнений из free-exercise-db + курирования (curation.mjs).
// Запуск: node scripts/build-seed.mjs <путь к exercises.json из free-exercise-db>
// Результат: src/data/seed/exercises.json и docs/exercises-review.md (таблица на проверку).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { curation } from './curation.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawPath = process.argv[2];
if (!rawPath) {
  console.error('Укажите путь к exercises.json из free-exercise-db');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
const byId = new Map(raw.map((e) => [e.id, e]));
const SOURCE_URL = 'https://github.com/yuhonas/free-exercise-db';
const CREATED = '2026-10-23T00:00:00.000Z';

/** Детерминированный UUID (формат v5, SHA-1) из id базы — стабилен между пересборками. */
function stableUuid(name) {
  const h = createHash('sha1').update(`trenirovka:free-exercise-db:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const MUSCLES = {
  chest: 'Большая грудная',
  front_delts: 'Передние дельты',
  side_delts: 'Средние дельты',
  rear_delts: 'Задние дельты',
  lats: 'Широчайшая',
  upper_traps: 'Трапеция (верх)',
  mid_back: 'Ромбовидные / ср. трапеция',
  lower_back: 'Разгибатели спины',
  biceps: 'Бицепс и плечевая',
  triceps: 'Трицепс',
  forearms: 'Предплечья',
  abs: 'Пресс',
  glutes: 'Большая ягодичная',
  abductors: 'Ср./малая ягодичные',
  quads: 'Квадрицепс',
  hamstrings: 'Задняя поверхность бедра',
  adductors: 'Приводящие',
  calves: 'Икры',
};
const PATTERN = {
  squat: 'присед',
  hinge: 'наклон/тяга бедром',
  lunge: 'выпад',
  horizontal_push: 'гориз. жим',
  vertical_push: 'верт. жим',
  horizontal_pull: 'гориз. тяга',
  vertical_pull: 'верт. тяга',
  isolation: 'изоляция',
  core: 'кор*',
  carry: 'перенос*',
};
const EQTYPE = { free_weight: 'свободный вес', machine: 'тренажёр', cable: 'блок', bodyweight: 'собств. вес' };
const TRACK = {
  weight_reps: 'вес × повт',
  bodyweight_reps: 'собств. вес × повт',
  reps: 'повторы',
  time: 'время',
  weight_time: 'вес × время',
};

const problems = [];
const curatedIds = new Set(curation.map((c) => c.id));

// ACSM (2009) Progression Models in Resistance Training: отдых 2–3 мин для базовых с большим весом,
// 1–2 мин для вспомогательных. Берём середину/верх диапазона.
const REST = { core: 150, assistance: 90 };
// Шаг веса — эвристика интерфейса, меняется в карточке упражнения.
const STEP = { free_weight: 2.5, machine: 5, cable: 5, bodyweight: 2.5 };

const seed = curation.map((c) => {
  const src = byId.get(c.id);
  if (!src) throw new Error(`Нет в базе: ${c.id}`);
  const fromMechanic = src.mechanic === 'compound' ? 'core' : src.mechanic === 'isolation' ? 'assistance' : null;
  const category = c.cat ?? fromMechanic;
  if (!category) throw new Error(`Нет категории: ${c.id}`);
  const notes = [...c.notes];
  if (c.cat && fromMechanic && c.cat !== fromMechanic && !notes.some((n) => n.includes('mechanic')))
    notes.push(`Категория изменена: mechanic = ${src.mechanic}`);
  if (c.str && category !== 'core') problems.push(`${c.id}: структурное, но не базовое`);
  for (const a of c.alt) {
    if (!curatedIds.has(a)) problems.push(`${c.id}: альтернатива ${a} не в выборке`);
    const alt = curation.find((x) => x.id === a);
    if (alt && !alt.P.some((m) => c.P.includes(m))) problems.push(`${c.id}: у альтернативы ${a} нет общих основных мышц`);
    if (alt && alt.str && alt.cat !== 'assistance' && (alt.cat ?? 'core') === 'core' && byId.get(a)?.mechanic === 'compound')
      notes.push(`Альтернатива ${a} сама структурная — требует проверки`);
  }
  if (c.ins.length < 3 || c.ins.length > 6) problems.push(`${c.id}: техника ${c.ins.length} пунктов`);
  const dumbbellOnly = c.eq.includes('dumbbell') && c.et === 'free_weight' && !c.eq.includes('barbell');
  return {
    id: stableUuid(c.id),
    createdAt: CREATED,
    updatedAt: CREATED,
    deletedAt: null,
    nameRu: c.ru,
    nameEn: src.name,
    primaryMuscles: c.P,
    secondaryMuscles: c.S,
    equipment: c.eq,
    trackingType: c.tr,
    isUnilateral: !!c.uni,
    category,
    isStructural: !!c.str,
    equipmentType: c.et,
    movementPattern: c.pat,
    lighterAlternatives: c.alt.map(stableUuid),
    instructions: c.ins,
    commonMistakes: c.mis,
    commonMistakesSource: null,
    defaultRestSec: c.rest ?? REST[category],
    weightStepKg: c.step ?? (dumbbellOnly ? 2 : STEP[c.et]),
    source: `free-exercise-db (${SOURCE_URL}), id: ${c.id}. Лицензия: The Unlicense (public domain). Перевод техники — свой.`,
    sourceId: c.id,
    reviewNotes: notes,
    isCustom: false,
    _db: { mechanic: src.mechanic, P: src.primaryMuscles, S: src.secondaryMuscles, equipment: src.equipment },
  };
});

const out = seed.map(({ _db, ...e }) => e);
mkdirSync(join(root, 'src/data/seed'), { recursive: true });
writeFileSync(join(root, 'src/data/seed/exercises.json'), JSON.stringify(out, null, 2) + '\n');

// ——— Таблица на проверку ———
const ru = (ids) => ids.map((m) => MUSCLES[m] ?? `?${m}`).join(', ') || '—';
const nameOf = new Map(seed.map((e) => [e.id, e.nameRu]));
const esc = (s) => String(s).replace(/\|/g, '\\|');
const groups = [
  ['Ноги', 0, 21],
  ['Грудь', 21, 32],
  ['Спина', 32, 44],
  ['Плечи', 44, 53],
  ['Руки', 53, 65],
  ['Пресс и перенос', 65, seed.length],
];

let md = `# Упражнения: таблица на утверждение

Сгенерировано \`scripts/build-seed.mjs\` из free-exercise-db (${SOURCE_URL}).
Лицензия базы проверена 2026-10-23: **The Unlicense** (public domain), атрибуция не обязательна, но будет указана в «О приложении».

**Всего: ${seed.length}.** Пока вы не утвердите таблицу, в приложение ничего не загружается.

## Как читать

- **Кат.** — категория по NSCA: **Б** — базовое (многосуставное, крупные мышцы), **В** — вспомогательное (односуставное). Берётся из поля \`mechanic\` (compound → Б, isolation → В) и сверяется с определением NSCA; расхождения — в пометках.
- **Стр.** — структурное (NSCA: базовое, которое прямо или косвенно нагружает позвоночник): **да** / —.
- **Обор.** — тип оборудования; **Запись** — форма ввода подхода.
- **Мышцы:** основные / вспомогательные. Плечи из базы (\`shoulders\`) разнесены по пучкам дельт; другие отличия от базы — в пометках.
- **Техника** — перевод \`instructions\` с сохранением смысла. Убраны только служебные шаги «повторите нужное число раз» и ссылки на разделы, которых в базе нет.
- **Частые ошибки** — источника нет, поэтому в интерфейсе у всех стоит пометка «требует проверки».
- **Отдых по умолчанию:** Б — 150 с, В — 90 с, пресс — 60 с. Основа — ACSM (2009): 2–3 мин для базовых с большим весом, 1–2 мин для вспомогательных. Для пресса 60 с — эвристика.
- **Шаг веса** (эвристика, меняется в карточке): штанга 2,5 кг, гантели 2 кг, тренажёр и блок 5 кг.
- \`*\` в паттерне — значения **не из списка ТЗ** (см. вопрос 1 ниже).

`;

for (const [title, a, b] of groups) {
  md += `\n## ${title}\n\n| # | Упражнение | Мышцы: основные / вспомогательные | Кат. | Стр. | Обор. | Паттерн | Запись | Облегчённые альтернативы | Пометки |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  seed.slice(a, b).forEach((e, i) => {
    const alts = e.lighterAlternatives.map((id) => nameOf.get(id)).join('; ') || '—';
    const n = e.reviewNotes.length ? e.reviewNotes.map(esc).join('<br>') : '';
    md += `| ${a + i + 1} | **${esc(e.nameRu)}**<br><sub>${esc(e.nameEn)}</sub> | ${ru(e.primaryMuscles)} / ${ru(e.secondaryMuscles)} | ${e.category === 'core' ? 'Б' : 'В'} | ${e.isStructural ? 'да' : '—'} | ${EQTYPE[e.equipmentType]} | ${PATTERN[e.movementPattern]} | ${TRACK[e.trackingType]}${e.isUnilateral ? ', одностор.' : ''} | ${esc(alts)} | ${n} |\n`;
  });
}

md += `
## Вопросы к вам

1. **Паттерны «кор» и «перенос».** Для планки, скручиваний, жима Паллофа и прогулки фермера в списке паттернов ТЗ нет подходящего значения. Предлагаю добавить «кор» и «перенос». Другой вариант — отнести их к «изоляции».
2. **Спорные советы из оригинала** — например, «колени не должны выходить за носки». В переводе я их опустил и отметил в пометках. Вернуть их дословно или оставить так?
3. **Структурность** выпадов, сплит-приседа, зашагиваний и жимов сидя отмечена «да» с пометкой «требует проверки». У NSCA сказано «прямо или косвенно нагружает позвоночник»; я трактовал так: вес в руках стоя или над головой — значит, да.
4. **Становая тяга:** в базе основная мышца только поясница. Я добавил ягодичные и заднюю поверхность бедра, иначе тяга бедром и сгибания ног не проходят как облегчённые альтернативы (у альтернатив должны быть общие основные мышцы).

Полная техника и частые ошибки каждого упражнения — в \`src/data/seed/exercises.json\`.
`;

writeFileSync(join(root, 'docs/exercises-review.md'), md);
console.log(`Готово: ${seed.length} упражнений.`);
if (problems.length) {
  console.log('Проблемы:');
  for (const p of problems) console.log(' - ' + p);
}
