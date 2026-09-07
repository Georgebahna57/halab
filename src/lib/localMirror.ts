import type { AppState } from '../types';
import { buildAppBackup, type AppBackup } from './backup';
import { safeSetItem } from './safeLocalStorage';
import { saveState } from './utils';
import { todayIso } from './utils';

const SNAPSHOT_INDEX_KEY = 'sandouk-nemr-snapshots-v1';
const DAILY_PREFIX = 'sandouk-nemr-daily-';
const LAST_DAILY_KEY = 'sandouk-last-daily-date';
const MAX_SNAPSHOTS = 4;
const MAX_DAILY_SNAPSHOTS = 3;

export type SnapshotReason = 'auto' | 'pre-delete' | 'pre-replace' | 'pre-import' | 'manual';

export type SnapshotMeta = {
  id: string;
  savedAt: string;
  reason: SnapshotReason;
  transactions: number;
  customers: number;
  bills: number;
};

export type MirrorInfo = {
  savedAt: string | null;
  transactions: number;
  customers: number;
  bills: number;
};

function snapshotKey(id: string): string {
  return `sandouk-nemr-snapshot-${id}`;
}

function readIndex(): SnapshotMeta[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SnapshotMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(index: SnapshotMeta[]): void {
  safeSetItem(SNAPSHOT_INDEX_KEY, JSON.stringify(index));
}

function pruneSnapshots(index: SnapshotMeta[]): SnapshotMeta[] {
  const kept = index.slice(0, MAX_SNAPSHOTS);
  for (const removed of index.slice(MAX_SNAPSHOTS)) {
    localStorage.removeItem(snapshotKey(removed.id));
  }
  return kept;
}

function pruneDailySnapshots(keep = MAX_DAILY_SNAPSHOTS - 1): void {
  for (const old of listDailySnapshotDates().slice(keep)) {
    localStorage.removeItem(`${DAILY_PREFIX}${old}`);
  }
}

/** آخر نسخة محلية — تُحدَّث بعد كل حفظ ناجح */
export function mirrorAppState(state: AppState): MirrorInfo {
  saveState(state);
  const info: MirrorInfo = {
    savedAt: new Date().toISOString(),
    transactions: state.transactions.length,
    customers: state.customers.length,
    bills: state.bills.length,
  };
  safeSetItem('sandouk-nemr-mirror-meta', JSON.stringify(info));
  return info;
}

export function getMirrorInfo(): MirrorInfo {
  try {
    const raw = localStorage.getItem('sandouk-nemr-mirror-meta');
    if (!raw) return { savedAt: null, transactions: 0, customers: 0, bills: 0 };
    return JSON.parse(raw) as MirrorInfo;
  } catch {
    return { savedAt: null, transactions: 0, customers: 0, bills: 0 };
  }
}

/** لقطة قبل عملية خطرة (حذف / استبدال) */
export function savePreDestructiveSnapshot(
  state: AppState,
  reason: Exclude<SnapshotReason, 'auto' | 'manual'>,
): SnapshotMeta | null {
  return pushSnapshot(state, reason);
}

/** لقطة يدوية أو دورية */
export function saveManualSnapshot(state: AppState): SnapshotMeta | null {
  return pushSnapshot(state, 'manual');
}

function pushSnapshot(state: AppState, reason: SnapshotReason): SnapshotMeta | null {
  const id = crypto.randomUUID();
  const savedAt = new Date().toISOString();
  const backup = buildAppBackup(state);
  const meta: SnapshotMeta = {
    id,
    savedAt,
    reason,
    transactions: state.transactions.length,
    customers: state.customers.length,
    bills: state.bills.length,
  };

  pruneSnapshots(readIndex());
  if (!safeSetItem(snapshotKey(id), JSON.stringify(backup))) return null;

  const next = pruneSnapshots([meta, ...readIndex()]);
  writeIndex(next);
  return meta;
}

/** لقطة تلقائية — فقط إذا تغيّر عدد الحركات (تجنّب التكرار) */
let lastAutoSnapshotCount = -1;

export function maybeAutoSnapshot(state: AppState): void {
  const count = state.transactions.length;
  if (count === lastAutoSnapshotCount) return;
  if (count > 0 && count % 5 === 0) {
    pushSnapshot(state, 'auto');
    lastAutoSnapshotCount = count;
  }
}

/** لقطة يومية محلية — مرة واحدة كل يوم */
export function maybeDailySnapshot(state: AppState): boolean {
  const today = todayIso();
  if (localStorage.getItem(LAST_DAILY_KEY) === today) return false;
  if (state.transactions.length + state.customers.length + state.bills.length === 0) return false;

  pruneDailySnapshots();
  if (!safeSetItem(`${DAILY_PREFIX}${today}`, JSON.stringify(buildAppBackup(state)))) return false;

  safeSetItem(LAST_DAILY_KEY, today);
  for (const old of listDailySnapshotDates().slice(MAX_DAILY_SNAPSHOTS)) {
    localStorage.removeItem(`${DAILY_PREFIX}${old}`);
  }
  return true;
}

export function listDailySnapshotDates(): string[] {
  const dates: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(DAILY_PREFIX)) {
      dates.push(key.slice(DAILY_PREFIX.length));
    }
  }
  return dates.sort((a, b) => b.localeCompare(a));
}

export function loadDailySnapshot(date: string): AppBackup | null {
  try {
    const raw = localStorage.getItem(`${DAILY_PREFIX}${date}`);
    if (!raw) return null;
    return JSON.parse(raw) as AppBackup;
  } catch {
    return null;
  }
}

export function getLastDailySnapshotDate(): string | null {
  return localStorage.getItem(LAST_DAILY_KEY);
}

export function listSnapshots(): SnapshotMeta[] {
  return readIndex();
}

export function loadSnapshot(id: string): AppBackup | null {
  try {
    const raw = localStorage.getItem(snapshotKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as AppBackup;
  } catch {
    return null;
  }
}

export function recoverFromLocalMirror(): { state: AppState; savedAt: string } | null {
  const info = getMirrorInfo();
  if (!info.savedAt || info.transactions + info.customers + info.bills === 0) return null;
  try {
    const raw = localStorage.getItem('sandouk-nemr-v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    return { state: parsed, savedAt: info.savedAt };
  } catch {
    return null;
  }
}

const REASON_LABELS: Record<SnapshotReason, string> = {
  auto: 'تلقائي',
  'pre-delete': 'قبل حذف',
  'pre-replace': 'قبل استبدال',
  'pre-import': 'قبل استيراد',
  manual: 'يدوي',
};

export function snapshotReasonLabel(reason: SnapshotReason): string {
  return REASON_LABELS[reason];
}
