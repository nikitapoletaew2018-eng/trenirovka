import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { WEEKDAY_SHORT, addDays, formatDayMonth, weekDays, weekStart } from '../../domain/dates';
import type { PlannedItem, TemplateItem, WorkoutTemplate } from '../../domain/types';
import { db } from '../../data/db';
import { deleteTemplate, listTemplates, newTemplate, planWorkout, saveTemplate } from '../../data/planRepo';
import { Empty, Page, Sheet, confirmDelete } from '../components';
import { ItemsEditor } from '../ItemsEditor';
import { today, useSettings } from '../hooks';
import { navigate } from '../router';

export function TemplatesScreen() {
  const templates = useLiveQuery(() => listTemplates(), []);
  return (
    <Page
      title="Шаблоны"
      onBack
      actions={
        <button
          className="btn sm"
          onClick={() => {
            const t = newTemplate('Новый шаблон');
            void saveTemplate(t).then(() => navigate(`/template/${t.id}`));
          }}
        >
          + Шаблон
        </button>
      }
    >
      <p className="small muted">
        Шаблон — набор упражнений с подходами, повторами и отдыхом. Его можно поставить в день недели или начать тренировку по нему.
      </p>
      {templates?.length === 0 && <Empty>Шаблонов пока нет.</Empty>}
      {templates?.map((t) => (
        <button key={t.id} className="list-btn" onClick={() => navigate(`/template/${t.id}`)}>
          <span className="grow">
            <b>{t.name}</b>
            <span className="small muted" style={{ display: 'block' }}>
              Упражнений: {t.items.length}
            </span>
          </span>
          ›
        </button>
      ))}
    </Page>
  );
}

const toPlanned = (it: TemplateItem): PlannedItem => ({
  exerciseId: it.exerciseId,
  sets: it.targetSets,
  repMin: it.repMin,
  repMax: it.repMax,
  targetRir: it.targetRir ?? null,
  restSec: it.restSec ?? null,
  supersetGroup: it.supersetGroup ?? null,
  suggestedWeightKg: null,
  reason: null,
});

const toTemplate = (it: PlannedItem, order: number): TemplateItem => ({
  exerciseId: it.exerciseId,
  order,
  targetSets: it.sets,
  repMin: it.repMin,
  repMax: it.repMax,
  targetRir: it.targetRir ?? null,
  restSec: it.restSec ?? null,
  supersetGroup: it.supersetGroup ?? null,
});

export function TemplateEditor({ id }: { id: string }) {
  const stored = useLiveQuery(() => db.templates.get(id), [id]);
  const settings = useSettings();
  const [draft, setDraft] = useState<WorkoutTemplate | null>(null);
  const [placing, setPlacing] = useState(false);
  useEffect(() => {
    if (stored && !draft) setDraft(stored);
  }, [stored, draft]);
  if (stored === undefined || !draft) return <main className="page" />;
  if (!stored || stored.deletedAt) return <Page title="Шаблон" onBack><Empty>Шаблон удалён.</Empty></Page>;
  // Сравниваем только редактируемые поля: updatedAt меняется при каждом сохранении.
  const dirty = JSON.stringify([draft.name, draft.items]) !== JSON.stringify([stored.name, stored.items]);
  const save = () => saveTemplate(draft);

  return (
    <Page title="Шаблон" onBack>
      <label className="field">
        <span>Название</span>
        <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <ItemsEditor
        items={[...draft.items].sort((a, b) => a.order - b.order).map(toPlanned)}
        onChange={(items) => setDraft({ ...draft, items: items.map(toTemplate) })}
        settings={settings}
        withWeight={false}
      />
      <div className="stack" style={{ marginTop: 16 }}>
        <button className="btn primary block big" disabled={!dirty || !draft.name.trim()} onClick={() => void save()}>
          {dirty ? 'Сохранить' : 'Сохранено'}
        </button>
        <button
          className="btn block"
          disabled={draft.items.length === 0}
          onClick={() => {
            void save().then(() => setPlacing(true));
          }}
        >
          Поставить в день недели
        </button>
        <button
          className="btn danger block"
          onClick={() => {
            void confirmDelete(`шаблон «${draft.name}»`).then((ok): unknown => ok && deleteTemplate(id).then(() => navigate('/templates')));
          }}
        >
          Удалить шаблон
        </button>
      </div>
      {placing && <PlaceSheet template={draft} onClose={() => setPlacing(false)} />}
    </Page>
  );
}

/** Выбор дня на этой или следующей неделе. */
function PlaceSheet({ template, onClose }: { template: WorkoutTemplate; onClose: () => void }) {
  const d = today();
  const [week, setWeek] = useState(weekStart(d));
  const [placed, setPlaced] = useState<string[]>([]);
  return (
    <Sheet title={`Поставить «${template.name}»`} onClose={onClose}>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn sm" onClick={() => setWeek(addDays(week, -7))} aria-label="Предыдущая неделя">
          ‹
        </button>
        <span className="grow" style={{ textAlign: 'center' }}>
          {formatDayMonth(week)} — {formatDayMonth(addDays(week, 6))}
        </span>
        <button className="btn sm" onClick={() => setWeek(addDays(week, 7))} aria-label="Следующая неделя">
          ›
        </button>
      </div>
      <div className="stack">
        {weekDays(week).map((day, i) => (
          <button
            key={day}
            className={`btn block ${placed.includes(day) ? 'primary' : ''}`}
            onClick={() => void planWorkout(day, template).then(() => setPlaced([...placed, day]))}
          >
            {WEEKDAY_SHORT[i]}, {formatDayMonth(day)}
            {day === d ? ' (сегодня)' : ''}
            {placed.includes(day) ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <p className="small muted">Можно выбрать несколько дней. Каждое нажатие добавляет тренировку в план.</p>
    </Sheet>
  );
}
