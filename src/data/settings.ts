import type { Settings } from '../domain/types';
import { db } from './db';

/** Значения по умолчанию. Пороги сигналов — эвристики из ТЗ (разделы 5.1–5.2), настраиваются. */
export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  unit: 'kg',
  barWeightKg: 20,
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
