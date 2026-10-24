// Сборка начальной базы упражнений из free-exercise-db + курирования (curation.mjs, cuts.mjs).
// Запуск: node scripts/build-seed.mjs <путь к exercises.json из free-exercise-db>
// Результат: src/data/seed/exercises.json и docs/exercises-review.md.
// Код выхода 1, если есть ошибки проверок (альтернатива не легче исходного, нет покрытия дельт и т. п.).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { curation as baseCuration } from "./curation.mjs";
import { REASONS, cuts as baseCuts } from "./cuts.mjs";
import { extra, extraCuts } from "./curation-extra.mjs";

// Дополнительные упражнения встают в конец своей группы (перед первым упражнением следующей).
const NEXT_GROUP = {
  legs: "Barbell_Bench_Press_-_Medium_Grip",
  chest: "Pullups",
  back: "Standing_Military_Press",
  shoulders: "Barbell_Curl",
  arms: "Plank",
  core: null,
};
const curation = [...baseCuration];
for (const [g, nextId] of Object.entries(NEXT_GROUP)) {
  const add = extra.filter((e) => e.g === g).map(({ g: _g, ...e }) => e);
  const at = nextId
    ? curation.findIndex((c) => c.id === nextId)
    : curation.length;
  if (at < 0) throw new Error(`Группа не найдена: ${nextId}`);
  curation.splice(at, 0, ...add);
}
if (extra.some((e) => !(e.g in NEXT_GROUP)))
  throw new Error("curation-extra.mjs: неизвестная группа");
const cuts = { ...baseCuts, ...extraCuts };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawPath = process.argv[2];
if (!rawPath) {
  console.error("Укажите путь к exercises.json из free-exercise-db");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(rawPath, "utf8"));
const byId = new Map(raw.map((e) => [e.id, e]));
const SOURCE_URL = "https://github.com/yuhonas/free-exercise-db";
const CREATED = "2026-10-23T00:00:00.000Z";

/** Детерминированный UUID (формат v5, SHA-1) из id базы — стабилен между пересборками. */
function stableUuid(name) {
  const h = createHash("sha1")
    .update(`trenirovka:free-exercise-db:${name}`)
    .digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const MUSCLES = {
  chest: "Большая грудная",
  front_delts: "Передние дельты",
  side_delts: "Средние дельты",
  rear_delts: "Задние дельты",
  lats: "Широчайшая",
  upper_traps: "Трапеция (верх)",
  mid_back: "Ромбовидные / ср. трапеция",
  lower_back: "Разгибатели спины",
  biceps: "Бицепс и плечевая",
  triceps: "Трицепс",
  forearms: "Предплечья",
  abs: "Пресс",
  glutes: "Большая ягодичная",
  abductors: "Ср./малая ягодичные",
  quads: "Квадрицепс",
  hamstrings: "Задняя поверхность бедра",
  adductors: "Приводящие",
  calves: "Икры",
};
/** Мышцы free-exercise-db → справочник приложения. shoulders — любой пучок дельт. */
const DB_MUSCLE = {
  quadriceps: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
  calves: "calves",
  "lower back": "lower_back",
  "middle back": "mid_back",
  traps: "upper_traps",
  lats: "lats",
  chest: "chest",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearms",
  abdominals: "abs",
  adductors: "adductors",
  abductors: "abductors",
  shoulders: "shoulders",
};
const DELTS = ["front_delts", "side_delts", "rear_delts"];
const PATTERN = {
  squat: "присед",
  hinge: "наклон/тяга бедром",
  lunge: "выпад",
  horizontal_push: "гориз. жим",
  vertical_push: "верт. жим",
  horizontal_pull: "гориз. тяга",
  vertical_pull: "верт. тяга",
  isolation: "изоляция",
  core: "кор",
  carry: "перенос",
};
const EQTYPE = {
  free_weight: "свободный вес",
  machine: "тренажёр",
  cable: "блок",
  bodyweight: "собств. вес",
};
const TRACK = {
  weight_reps: "вес × повт",
  bodyweight_reps: "собств. вес × повт",
  reps: "повторы",
  time: "время",
  weight_time: "вес × время",
};

// Служебные фразы о повторениях — выкидываются из перевода всегда.
const FILLER =
  /repeat( the movement| this motion)? for the (recommended|prescribed|specified) (amount|number)|^perform the amount of repetitions|^repeat\.?$/i;
const FILLER_KEEP =
  /then perform|switch|other arm|other leg|with the left|other direction/i;

const FILLER_FRAGMENT =
  /(repeat( the movement| this motion)? for the (recommended|prescribed|specified) (amount|number) of (repetitions|times)( of your training program)?|perform the amount of repetitions prescribed in the program|^repeat)\.?/i;

/** Служебные фразы о повторениях; если служебная только часть предложения — вырезается только она. */
function fillerFragments(instructions) {
  const out = [];
  for (const step of instructions) {
    for (const raw of step.replace(/^\d+\.\s*/, "").split(/(?<=\.)\s+/)) {
      const s = raw.trim();
      if (!FILLER.test(s) || FILLER_KEEP.test(s)) continue;
      const m = s.match(FILLER_FRAGMENT);
      const frag = m ? m[0] : s;
      out.push({
        orig: frag,
        partial: frag.replace(/\.$/, "") !== s.replace(/\.$/, ""),
      });
    }
  }
  return out;
}

const norm = (ids) =>
  [...new Set(ids.map((m) => (DELTS.includes(m) ? "shoulders" : m)))]
    .sort()
    .join(",");
const normDb = (ids) =>
  [...new Set(ids.map((m) => DB_MUSCLE[m]).filter(Boolean))].sort().join(",");

const errors = [];
const curatedIds = new Set(curation.map((c) => c.id));
for (const id of Object.keys(cuts))
  if (!curatedIds.has(id)) errors.push(`cuts.mjs: ${id} нет в выборке`);
// Вырезанное должно дословно встречаться в оригинале — иначе список вырезанного недостоверен.
for (const [id, list] of Object.entries(cuts)) {
  const text = byId.get(id)?.instructions.join(" ") ?? "";
  for (const x of list)
    if (!text.includes(x.orig))
      errors.push(`cuts: ${id}: нет в оригинале «${x.orig.slice(0, 50)}…»`);
}

// ACSM (2009) Progression Models in Resistance Training: отдых 2–3 мин для базовых с большим весом,
// 1–2 мин для вспомогательных.
const REST = { core: 150, assistance: 90 };
// Шаг веса — эвристика интерфейса, меняется в карточке упражнения.
const STEP = { free_weight: 2.5, machine: 5, cable: 5, bodyweight: 2.5 };

const seed = curation.map((c) => {
  const src = byId.get(c.id);
  if (!src) throw new Error(`Нет в базе: ${c.id}`);
  const fromMechanic =
    src.mechanic === "compound"
      ? "core"
      : src.mechanic === "isolation"
        ? "assistance"
        : null;
  const category = c.cat ?? fromMechanic;
  if (!category) throw new Error(`Нет категории: ${c.id}`);
  const notes = [...c.notes];
  if (
    c.cat &&
    fromMechanic &&
    c.cat !== fromMechanic &&
    !notes.some((n) => n.includes("mechanic"))
  )
    notes.push(`Категория изменена: mechanic = ${src.mechanic}`);
  if (c.str && category !== "core")
    errors.push(`${c.id}: структурное, но не базовое`);
  if (c.ins.length < 3 || c.ins.length > 6)
    errors.push(`${c.id}: техника ${c.ins.length} пунктов (нужно 3–6)`);

  const musclesChanged =
    norm(c.P) !== normDb(src.primaryMuscles) ||
    norm(c.S) !== normDb(src.secondaryMuscles);
  const removed = [
    ...(cuts[c.id] ?? []).map((x) => ({ ...x, reasonText: REASONS[x.reason] })),
    ...fillerFragments(src.instructions).map((f) => ({
      orig: f.orig,
      reason: "filler",
      reasonText: "служебная фраза о повторениях",
      note: f.partial ? "остальная часть предложения переведена" : undefined,
    })),
  ];
  const dumbbellOnly =
    c.eq.includes("dumbbell") &&
    c.et === "free_weight" &&
    !c.eq.includes("barbell");
  const sourceParts = [
    `free-exercise-db (${SOURCE_URL}), id: ${c.id}`,
    "лицензия The Unlicense (public domain)",
    removed.length ? "техника: сокращённый перевод" : "техника: перевод",
  ];
  if (musclesChanged) sourceParts.push("мышцы изменены относительно базы");
  return {
    id: stableUuid(c.id),
    createdAt: CREATED,
    updatedAt: CREATED,
    deletedAt: null,
    nameRu: c.ru,
    nameEn: src.name,
    aliases: c.aliases ?? [],
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
    // Частые ошибки без источника: не показываются в интерфейсе до проверки (verified: false).
    commonMistakes: c.mis.map((text) => ({
      text,
      verified: false,
      source: null,
    })),
    defaultRestSec: c.rest ?? REST[category],
    weightStepKg: c.step ?? (dumbbellOnly ? 2 : STEP[c.et]),
    source: sourceParts.join("; ") + ".",
    sourceId: c.id,
    reviewNotes: notes,
    isCustom: false,
    _review: { removed, musclesChanged, db: src },
  };
});

const bySourceId = new Map(seed.map((e) => [e.sourceId, e]));

// ——— Проверка: облегчённая альтернатива действительно легче ———
// Определение ТЗ (раздел 2): вспомогательное, или неструктурное, или на тренажёре/блоке; плюс общие основные мышцы.
const lighterViolations = [];
for (const e of seed) {
  for (const altSrc of curation.find((c) => c.id === e.sourceId).alt) {
    const a = bySourceId.get(altSrc);
    if (!a) {
      lighterViolations.push(
        `${e.nameRu} → ${altSrc}: альтернативы нет в выборке`,
      );
      continue;
    }
    const lighter =
      !a.isStructural ||
      a.category === "assistance" ||
      a.equipmentType === "machine" ||
      a.equipmentType === "cable";
    if (!lighter)
      lighterViolations.push(
        `${e.nameRu} → ${a.nameRu}: структурное базовое на свободном весе — не легче`,
      );
    if (!a.primaryMuscles.some((m) => e.primaryMuscles.includes(m)))
      lighterViolations.push(
        `${e.nameRu} → ${a.nameRu}: нет общих основных мышц`,
      );
    if (a.isStructural)
      e.reviewNotes.push(
        `Альтернатива «${a.nameRu}» сама структурная (проходит как тренажёр) — требует проверки`,
      );
  }
}
errors.push(...lighterViolations);

// ——— Проверка: покрытие пучков дельт ———
const coverage = DELTS.map((m) => {
  const list = seed.filter((e) => e.primaryMuscles.includes(m));
  const machine = list.filter(
    (e) => e.equipmentType === "machine" || e.equipmentType === "cable",
  );
  const ok = list.length >= 2 && machine.length >= 1;
  if (!ok)
    errors.push(
      `${MUSCLES[m]}: ${list.length} упр. как основная, из них тренажёр/блок — ${machine.length}`,
    );
  return { m, list, machine, ok };
});

const out = seed.map(({ _review, ...e }) => e);
mkdirSync(join(root, "src/data/seed"), { recursive: true });
writeFileSync(
  join(root, "src/data/seed/exercises.json"),
  JSON.stringify(out, null, 2) + "\n",
);

// ——— Таблица на проверку ———
const ru = (ids) => ids.map((m) => MUSCLES[m] ?? `?${m}`).join(", ") || "—";
const nameOf = new Map(seed.map((e) => [e.id, e.nameRu]));
const esc = (s) => String(s).replace(/\|/g, "\\|");
const GROUPS = [
  ["Ноги", "Barbell_Full_Squat"],
  ["Грудь", "Barbell_Bench_Press_-_Medium_Grip"],
  ["Спина", "Pullups"],
  ["Плечи", "Standing_Military_Press"],
  ["Руки", "Barbell_Curl"],
  ["Пресс и перенос", "Plank"],
];
const starts = GROUPS.map(([, id]) => seed.findIndex((e) => e.sourceId === id));
if (starts.some((i) => i < 0)) throw new Error("Группа не найдена");

let md = `# Упражнения: таблица на утверждение

Сгенерировано \`scripts/build-seed.mjs\` из free-exercise-db (${SOURCE_URL}).
Лицензию базы проверил 2026-10-23: **The Unlicense** (public domain). Атрибуция не обязательна, но будет указана в «О приложении».

**Всего: ${seed.length}.**

## Как читать

- **Кат.** — категория по NSCA: **Б** — базовое (многосуставное, крупные мышцы), **В** — вспомогательное (односуставное). Берётся из поля \`mechanic\` (compound → Б, isolation → В) и сверяется с определением NSCA; расхождения — в пометках.
- **Стр.** — структурное (NSCA: базовое, которое прямо или косвенно нагружает позвоночник).
- **Мышцы:** основные / вспомогательные. Плечи из базы (\`shoulders\`) разнесены по пучкам дельт. Если мышцы отличаются от базы, в \`source\` упражнения стоит «мышцы изменены относительно базы»; что именно изменено — в пометках.
- **Техника** — перевод \`instructions\` с сохранением смысла. Всё, что вырезано, перечислено в разделе «Вырезано из оригинала». Там, где что-то вырезано, в \`source\` стоит «сокращённый перевод».
- **Частые ошибки** хранятся с флагом \`verified: false\` и в интерфейсе не показываются, пока вы их не проверите.
- **Отдых по умолчанию:** Б — 150 с, В — 90 с, пресс — 60 с. Основа — ACSM (2009): 2–3 мин для базовых с большим весом, 1–2 мин для вспомогательных. Для пресса 60 с — эвристика.
- **Шаг веса** (эвристика, меняется в карточке): штанга 2,5 кг, гантели 2 кг, тренажёр и блок 5 кг.

## Проверки

**Облегчённые альтернативы.** Правило: альтернатива вспомогательная, или неструктурная, или на тренажёре/блоке, и у неё есть общая основная мышца с исходным упражнением. ${
  lighterViolations.length
    ? `Нарушения:\n\n${lighterViolations.map((v) => `- ${v}`).join("\n")}`
    : "Нарушений нет."
}

**Покрытие дельт.** Нужно минимум 2 упражнения, где пучок — основная мышца, и хотя бы одно из них на тренажёре или блоке.

| Пучок | Упражнения (основная мышца) | Тренажёр/блок | ОК |
|---|---|---|---|
${coverage.map((c) => `| ${MUSCLES[c.m]} | ${c.list.map((e) => e.nameRu).join("; ")} | ${c.machine.map((e) => e.nameRu).join("; ") || "—"} | ${c.ok ? "да" : "**нет**"} |`).join("\n")}

## Решения по прошлой версии

1. Паттерны «кор» и «перенос» добавлены.
2. Спорные советы не возвращаются. Полный список вырезанного — ниже.
3. Структурность выпадов, сплит-приседа, зашагиваний и жимов сидя — «да» с пометкой «требует проверки».
4. Мышцы становой тяги изменены (поясница + ягодичные + задняя поверхность бедра), в \`source\` есть пометка.

Также при сверке с оригиналом в переводы вернулись безобидные фрагменты, которые раньше потерялись при сокращении: «вверху выпрямите руки и задержитесь», «сократите мышцы спины», направление вращения в жиме Арнольда и т. п.
`;

GROUPS.forEach(([title], gi) => {
  const a = starts[gi];
  const b = starts[gi + 1] ?? seed.length;
  md += `\n## ${title}\n\n| # | Упражнение | Мышцы: основные / вспомогательные | Кат. | Стр. | Обор. | Паттерн | Запись | Облегчённые альтернативы | Пометки |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  seed.slice(a, b).forEach((e, i) => {
    const alts =
      e.lighterAlternatives.map((id) => nameOf.get(id)).join("; ") || "—";
    const n = e.reviewNotes.map(esc).join("<br>");
    md += `| ${a + i + 1} | **${esc(e.nameRu)}**<br><sub>${esc(e.nameEn)}</sub> | ${ru(e.primaryMuscles)} / ${ru(e.secondaryMuscles)} | ${e.category === "core" ? "Б" : "В"} | ${e.isStructural ? "да" : "—"} | ${EQTYPE[e.equipmentType]} | ${PATTERN[e.movementPattern]} | ${TRACK[e.trackingType]}${e.isUnilateral ? ", одностор." : ""} | ${esc(alts)} | ${n} |\n`;
  });
});

md += `\n## Вырезано из оригинала\n\nДословные фрагменты \`instructions\` из базы, которых нет в переводе, с причиной.\nСлужебные фразы о повторениях («Repeat for the recommended amount of repetitions» и подобные) — тоже здесь.\n`;
for (const e of seed) {
  const r = e._review;
  md += `\n### ${a(e)}\n\n`;
  if (!r.removed.length) {
    md += "Ничего не вырезано.\n";
    continue;
  }
  for (const x of r.removed)
    md += `- «${esc(x.orig)}» — ${x.reasonText}${x.note ? `; ${x.note}` : ""}\n`;
}
function a(e) {
  return `${e.nameRu} (${e.sourceId})`;
}

md += `\nПолная техника каждого упражнения — в \`src/data/seed/exercises.json\`.\n`;
writeFileSync(join(root, "docs/exercises-review.md"), md);

console.log(
  `Готово: ${seed.length} упражнений; сокращённый перевод: ${seed.filter((e) => e._review.removed.length).length}; мышцы изменены: ${seed.filter((e) => e._review.musclesChanged).length}.`,
);
for (const c of coverage)
  console.log(`${c.m}: ${c.list.length} (тренажёр/блок ${c.machine.length})`);
if (errors.length) {
  console.log("Ошибки проверок:");
  for (const p of errors) console.log(" - " + p);
  process.exit(1);
}
