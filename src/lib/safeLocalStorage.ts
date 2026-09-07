const DAILY_PREFIX = 'sandouk-nemr-daily-';
const SNAPSHOT_PREFIX = 'sandouk-nemr-snapshot-';
const SNAPSHOT_INDEX_KEY = 'sandouk-nemr-snapshots-v1';

export function isQuotaExceededError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === 'QuotaExceededError' || err.code === 22;
  }
  if (err instanceof Error) {
    return /quota/i.test(err.message);
  }
  return false;
}

function collectKeys(prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/** حذف النسخ الاحتياطية القديمة لتوفير مساحة — البيانات الأساسية (sandouk-nemr-v1) تبقى */
export function freeLocalStorageSpace(level: 'daily' | 'snapshots'): void {
  if (level === 'daily') {
    for (const key of collectKeys(DAILY_PREFIX)) {
      localStorage.removeItem(key);
    }
    return;
  }

  for (const key of collectKeys(SNAPSHOT_PREFIX)) {
    localStorage.removeItem(key);
  }
  localStorage.removeItem(SNAPSHOT_INDEX_KEY);
}

/** setItem آمن — يحرّر مساحة تلقائياً عند امتلاء التخزين */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err;
  }

  freeLocalStorageSpace('daily');
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err;
  }

  freeLocalStorageSpace('snapshots');
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
