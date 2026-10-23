// Типы сущностей. Внутри: вес в кг, время в секундах, даты — ISO 8601 UTC.
// Конвертация единиц — только при отображении (см. units.ts).

export type UUID = string;
export type ISODateTime = string; // 2026-10-23T12:00:00.000Z
export type ISODate = string; // 2026-10-23 (локальная календарная дата пользователя)

export interface BaseEntity {
  id: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime | null;
}

export type MuscleId =
  | 'chest'
  | 'front_delts'
  | 'side_delts'
  | 'rear_delts'
  | 'lats'
  | 'upper_traps'
  | 'mid_back'
  | 'lower_back'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'abs'
  | 'glutes'
  | 'abductors'
  | 'quads'
  | 'hamstrings'
  | 'adductors'
  | 'calves';

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'kettlebell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'bench'
  | 'pullup_bar'
  | 'dip_bars'
  | 'ez_bar'
  | 'band'
  | 'other';

export type TrackingType = 'weight_reps' | 'bodyweight_reps' | 'reps' | 'time' | 'weight_time';

export type Category = 'core' | 'assistance';

export type EquipmentType = 'free_weight' | 'machine' | 'cable' | 'bodyweight';

export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'isolation';

export interface Exercise extends BaseEntity {
  nameRu: string;
  nameEn: string;
  primaryMuscles: MuscleId[];
  secondaryMuscles: MuscleId[];
  equipment: Equipment[];
  trackingType: TrackingType;
  isUnilateral: boolean;
  category: Category;
  isStructural: boolean;
  equipmentType: EquipmentType;
  movementPattern: MovementPattern;
  lighterAlternatives: UUID[];
  instructions: string[];
  commonMistakes: string[];
  defaultRestSec: number;
  weightStepKg: number;
  source: string;
  /** Пометки «требует проверки» и т. п. */
  reviewNotes?: string[];
  isCustom: boolean;
  isFavorite?: boolean;
}

export interface TemplateItem {
  exerciseId: UUID;
  order: number;
  targetSets: number;
  repMin: number;
  repMax: number;
  targetRir?: number | null;
  restSec?: number | null;
  supersetGroup?: string | null;
}

export interface WorkoutTemplate extends BaseEntity {
  name: string;
  items: TemplateItem[];
}

export type PlannedStatus = 'planned' | 'done' | 'partial' | 'skipped' | 'moved';

export interface PlannedItem {
  exerciseId: UUID;
  sets: number;
  repMin: number;
  repMax: number;
  targetRir?: number | null;
  suggestedWeightKg?: number | null;
  restSec?: number | null;
  supersetGroup?: string | null;
  reason?: string | null;
}

export interface PlannedWorkout extends BaseEntity {
  date: ISODate;
  name: string;
  templateId?: UUID | null;
  plannedItems: PlannedItem[];
  status: PlannedStatus;
  workoutId?: UUID | null;
  /** Куда перенесена (для status = moved) */
  movedTo?: ISODate | null;
}

export interface WeekPlan extends BaseEntity {
  weekStart: ISODate; // понедельник
  isDeload: boolean;
}

export interface Workout extends BaseEntity {
  plannedWorkoutId?: UUID | null;
  name: string;
  startedAt: ISODateTime;
  finishedAt?: ISODateTime | null;
  timeZone: string;
  notes?: string;
  wellbeing?: number | null; // 1–5
  bodyWeightKg?: number | null;
  isLightVersion: boolean;
}

export interface WorkoutExercise extends BaseEntity {
  workoutId: UUID;
  exerciseId: UUID;
  order: number;
  supersetGroup?: string | null;
  replacedFromExerciseId?: UUID | null;
  restSec?: number | null;
  notes?: string;
  /** Снимок плана на сегодня для этого упражнения */
  plan?: PlannedItem | null;
}

export type SetType = 'warmup' | 'working' | 'dropset' | 'failure';

export interface WorkoutSet extends BaseEntity {
  workoutExerciseId: UUID;
  workoutId: UUID;
  order: number;
  setType: SetType;
  weightKg?: number | null;
  /** Для bodyweight_reps: доп. вес (>0) или ассистирование (<0) */
  addedWeightKg?: number | null;
  reps?: number | null;
  durationSec?: number | null;
  rir?: number | null;
  rpe?: number | null;
  side?: 'left' | 'right' | null;
  notes?: string;
  completed: boolean;
  completedAt?: ISODateTime | null;
  /** true, пока значения из автозаполнения и пользователь их не правил */
  autofilled?: boolean;
}

export interface RestTimer {
  id: 'current';
  workoutExerciseId: UUID | null;
  startedAt: ISODateTime;
  endsAt: ISODateTime;
}

export type WeightUnit = 'kg' | 'lb';
export type EffortScale = 'rir' | 'rpe';

export interface Settings {
  id: 'settings';
  unit: WeightUnit;
  barWeightKg: number;
  effortScale: EffortScale;
  defaultRestSec: number;
  secondaryMuscleFactor: number;
  includeBodyweightInTonnage: boolean;
  bodyWeightKg?: number | null;
  e1rmFormula: 'epley' | 'brzycki';
  stableThresholdPct: number;
  stagnationWeeks: number;
  volumeJumpPct: number;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  lastBackupAt?: ISODateTime | null;
  backupReminderDismissedAt?: ISODateTime | null;
  persistGranted?: boolean | null;
  installHintDismissed?: boolean;
}
