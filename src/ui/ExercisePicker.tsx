import { useMemo, useState, type ReactNode } from "react";
import { EQUIPMENT_TYPES, MUSCLES, MUSCLE_IDS } from "../domain/muscles";
import type { EquipmentType, Exercise, MuscleId } from "../domain/types";
import {
  filterExercises,
  newCustomExercise,
  replacementCandidates,
  saveCustomExercise,
} from "../data/exerciseRepo";
import { Sheet } from "./components";
import { useExercises, useVisibleArea } from "./hooks";

export function ExerciseFilters({
  query,
  setQuery,
  muscle,
  setMuscle,
  eqType,
  setEqType,
  favOnly,
  setFavOnly,
}: {
  query: string;
  setQuery: (s: string) => void;
  muscle: MuscleId | null;
  setMuscle: (m: MuscleId | null) => void;
  eqType: EquipmentType | null;
  setEqType: (m: EquipmentType | null) => void;
  favOnly: boolean;
  setFavOnly: (b: boolean) => void;
}) {
  // Пока открыта клавиатура, фильтры-кнопки прячутся (если ни один не выбран), чтобы было видно результаты поиска.
  const { keyboard } = useVisibleArea();
  const showChips = !keyboard || favOnly || muscle !== null || eqType !== null;
  return (
    <div className="stack">
      <input
        className="input"
        type="search"
        placeholder="Поиск: рус. или англ."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Поиск упражнения"
      />
      {showChips && (
        <>
          <div className="chips" role="group" aria-label="Мышцы">
            <button
              className="chip"
              aria-pressed={favOnly}
              onClick={() => setFavOnly(!favOnly)}
            >
              ★ Избранное
            </button>
            {MUSCLE_IDS.map((m) => (
              <button
                key={m}
                className="chip"
                aria-pressed={muscle === m}
                onClick={() => setMuscle(muscle === m ? null : m)}
              >
                {MUSCLES[m].ru}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Оборудование">
            {(Object.keys(EQUIPMENT_TYPES) as EquipmentType[]).map((t) => (
              <button
                key={t}
                className="chip"
                aria-pressed={eqType === t}
                onClick={() => setEqType(eqType === t ? null : t)}
              >
                {EQUIPMENT_TYPES[t]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ExerciseRow({
  e,
  onClick,
  right,
}: {
  e: Exercise;
  onClick: () => void;
  right?: ReactNode;
}) {
  return (
    <button className="list-btn" onClick={onClick}>
      <span className="grow">
        <span style={{ display: "block", fontWeight: 600 }}>
          {e.isFavorite ? "★ " : ""}
          {e.nameRu}
        </span>
        <span className="small muted">
          {e.primaryMuscles.map((m) => MUSCLES[m].ru).join(", ") ||
            "мышцы не указаны"}{" "}
          · {EQUIPMENT_TYPES[e.equipmentType]}
        </span>
      </span>
      {right}
    </button>
  );
}

export function useExerciseFilter() {
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<MuscleId | null>(null);
  const [eqType, setEqType] = useState<EquipmentType | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  return {
    query,
    setQuery,
    muscle,
    setMuscle,
    eqType,
    setEqType,
    favOnly,
    setFavOnly,
  };
}

/** Лист выбора упражнения. В режиме замены сначала показываются облегчённые альтернативы и аналоги. */
export function ExercisePicker({
  title,
  onPick,
  onClose,
  replacing,
}: {
  title: string;
  onPick: (e: Exercise) => void;
  onClose: () => void;
  replacing?: Exercise | null;
}) {
  const all = useExercises() ?? [];
  const f = useExerciseFilter();
  const list = useMemo(
    () =>
      filterExercises(all, {
        query: f.query,
        muscle: f.muscle,
        equipmentType: f.eqType,
        favoritesOnly: f.favOnly,
      }),
    [all, f.query, f.muscle, f.eqType, f.favOnly],
  );
  const repl = replacing ? replacementCandidates(replacing, all) : null;
  const filtering = f.query !== "" || f.muscle || f.eqType || f.favOnly;

  return (
    <Sheet title={title} onClose={onClose}>
      <ExerciseFilters {...f} />
      {repl && !filtering && (
        <>
          <h3>Облегчённые альтернативы</h3>
          {repl.lighter.length === 0 && (
            <p className="small muted">
              В карточке упражнения альтернатив нет.
            </p>
          )}
          {repl.lighter.map((e) => (
            <ExerciseRow key={e.id} e={e} onClick={() => onPick(e)} />
          ))}
          <h3>На те же основные мышцы</h3>
          {repl.similar.map((e) => (
            <ExerciseRow key={e.id} e={e} onClick={() => onPick(e)} />
          ))}
        </>
      )}
      {(!repl || filtering) && (
        <div style={{ marginTop: 10 }}>
          {list.length === 0 && <p className="muted">Ничего не найдено.</p>}
          {list.map((e) => (
            <ExerciseRow key={e.id} e={e} onClick={() => onPick(e)} />
          ))}
          <QuickCustomExercise
            name={f.query}
            muscle={f.muscle}
            onCreated={onPick}
          />
        </div>
      )}
    </Sheet>
  );
}

/** Своё упражнение прямо из поиска: название и основная мышца, остальное можно дописать в «Упражнениях». */
function QuickCustomExercise({
  name,
  muscle,
  onCreated,
}: {
  name: string;
  muscle: MuscleId | null;
  onCreated: (e: Exercise) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(name);
  const [primary, setPrimary] = useState<MuscleId | null>(muscle);
  if (!open)
    return (
      <button
        className="btn"
        style={{ marginTop: 10, width: "100%" }}
        onClick={() => {
          setTitle(name.trim());
          setPrimary(muscle);
          setOpen(true);
        }}
      >
        + Своё упражнение{name.trim() ? ` «${name.trim()}»` : ""}
      </button>
    );
  const valid = title.trim().length > 0 && primary !== null;
  return (
    <div className="card stack" style={{ marginTop: 10 }}>
      <h3 style={{ margin: 0 }}>Своё упражнение</h3>
      <label className="field">
        <span>Название</span>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <span className="small muted">Основная мышца</span>
      <div className="chips" role="group" aria-label="Основная мышца">
        {MUSCLE_IDS.map((m) => (
          <button
            key={m}
            className="chip"
            aria-pressed={primary === m}
            onClick={() => setPrimary(m)}
          >
            {MUSCLES[m].ru}
          </button>
        ))}
      </div>
      <p className="small muted">
        Технику, заметки и оборудование можно дописать потом: «Ещё» →
        «Упражнения».
      </p>
      <div className="row">
        <button className="btn" onClick={() => setOpen(false)}>
          Отмена
        </button>
        <button
          className="btn primary grow"
          disabled={!valid}
          onClick={() => {
            if (!primary) return;
            const e = {
              ...newCustomExercise(title.trim()),
              primaryMuscles: [primary],
            };
            void saveCustomExercise(e).then(() => onCreated(e));
          }}
        >
          Создать и добавить
        </button>
      </div>
    </div>
  );
}
