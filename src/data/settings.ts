import type { Settings } from '../domain/types';
import { db } from './db';

/** Значения по умолчанию. Пороги сигналов — эвристики из ТЗ (разделы 5.1–5.2), настраиваются. */
export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  unit: 'kg',
  barWeightKg: 20,
  showEffort: false,
  effortScale: 'rir',
  defaultRestSec: 120,
  secondaryMuscleFactor: 0.5,
  includeBodyweightInTonnage: false,
  bodyWeightKg: null,
  e1rmFormula: 'epley',
  stableThresholdPct: 2,
  stagnationWeeks: 3,
  volumeJumpPct: 20,
  soundEnabled: true,
  vibrationEnabled: true,
  rirTolerance: 1,
  fatigueWellbeing: 2,
  lowerBoundFailSessions: 2,
  progressionRule: 'double',
  // Разгрузка по умолчанию — ТЗ, раздел 5.4 (практические значения, не строгая норма)
  deloadSetsFactor: 0.5,
  deloadWeightFactor: 1,
  deloadMinRir: 3,
  warmupPercents: [40, 60, 80],
  warmupReps: [8, 5, 3],
  platesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
  platesLb: [45, 35, 25, 10, 5, 2.5],
  // Модуль «Цикл» выключен по умолчанию (ТЗ, 6.4)
  cycleEnabled: false,
  cyclePinEnabled: false,
  cycleOfferDismissed: false,
  // Облегчённая версия (ТЗ, 6.3): −30–50% подходов → по умолчанию −40%, целевой RIR +2
  lightSetsFactor: 0.6,
  lightRirPlus: 2,
  reminderTime: '18:00',
  reminderMinutesBefore: 60,
  measurementReminderWeekday: null,
  lastBackupAt: null,
  backupReminderDismissedAt: null,
  persistGranted: null,
  installHintDismissed: false,
};

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('settings');
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  const cur = await getSettings();
  await db.settings.put({ ...cur, ...patch, id: 'settings' });
}
