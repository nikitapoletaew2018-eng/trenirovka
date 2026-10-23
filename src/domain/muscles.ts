import type { Equipment, EquipmentType, MovementPattern, MuscleId, TrackingType } from './types';

/** Мышечные группы для подсчёта объёма. Названия — по анатомической номенклатуре (рус + лат). */
export const MUSCLES: Record<MuscleId, { ru: string; lat: string }> = {
  chest: { ru: 'Большая грудная', lat: 'm. pectoralis major' },
  front_delts: { ru: 'Передние дельты', lat: 'm. deltoideus, pars clavicularis' },
  side_delts: { ru: 'Средние дельты', lat: 'm. deltoideus, pars acromialis' },
  rear_delts: { ru: 'Задние дельты', lat: 'm. deltoideus, pars spinalis' },
  lats: { ru: 'Широчайшая спины', lat: 'm. latissimus dorsi' },
  upper_traps: { ru: 'Трапециевидная, верх', lat: 'm. trapezius, pars descendens' },
  mid_back: { ru: 'Ромбовидные и ср. трапеция', lat: 'mm. rhomboidei, m. trapezius pars transversa' },
  lower_back: { ru: 'Разгибатели спины', lat: 'm. erector spinae' },
  biceps: { ru: 'Бицепс и плечевая', lat: 'm. biceps brachii, m. brachialis' },
  triceps: { ru: 'Трицепс', lat: 'm. triceps brachii' },
  forearms: { ru: 'Предплечья', lat: 'mm. antebrachii' },
  abs: { ru: 'Мышцы живота', lat: 'm. rectus abdominis, mm. obliqui abdominis' },
  glutes: { ru: 'Большая ягодичная', lat: 'm. gluteus maximus' },
  abductors: { ru: 'Средняя и малая ягодичные', lat: 'm. gluteus medius, m. gluteus minimus' },
  quads: { ru: 'Квадрицепс', lat: 'm. quadriceps femoris' },
  hamstrings: { ru: 'Задняя поверхность бедра', lat: 'm. biceps femoris, m. semitendinosus, m. semimembranosus' },
  adductors: { ru: 'Приводящие мышцы бедра', lat: 'mm. adductores' },
  calves: { ru: 'Икроножная и камбаловидная', lat: 'm. gastrocnemius, m. soleus' },
};

export const MUSCLE_IDS = Object.keys(MUSCLES) as MuscleId[];

export const EQUIPMENT: Record<Equipment, string> = {
  barbell: 'Штанга',
  dumbbell: 'Гантели',
  kettlebell: 'Гиря',
  machine: 'Тренажёр',
  cable: 'Блок',
  bodyweight: 'Без оборудования',
  bench: 'Скамья',
  pullup_bar: 'Турник',
  dip_bars: 'Брусья',
  ez_bar: 'EZ-гриф',
  band: 'Резина',
  other: 'Другое',
};

export const EQUIPMENT_TYPES: Record<EquipmentType, string> = {
  free_weight: 'Свободный вес',
  machine: 'Тренажёр',
  cable: 'Блок',
  bodyweight: 'Собственный вес',
};

export const PATTERNS: Record<MovementPattern, string> = {
  squat: 'Присед',
  hinge: 'Наклон / тяга бедром',
  lunge: 'Выпад',
  horizontal_push: 'Горизонтальный жим',
  vertical_push: 'Вертикальный жим',
  horizontal_pull: 'Горизонтальная тяга',
  vertical_pull: 'Вертикальная тяга',
  isolation: 'Изоляция',
  core: 'Кор',
  carry: 'Перенос',
};

export const TRACKING: Record<TrackingType, string> = {
  weight_reps: 'Вес × повторы',
  bodyweight_reps: 'Собственный вес × повторы',
  reps: 'Только повторы',
  time: 'Время',
  weight_time: 'Вес × время',
};
