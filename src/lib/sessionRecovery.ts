import type { SupabaseClient, User } from '@supabase/supabase-js';

const STICKY_KEY = 'halab-sticky-session-v1';
const STICKY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type StickySession = {
  id: string;
  email: string;
  savedAt: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toUser(sticky: StickySession): User {
  return { id: sticky.id, email: sticky.email } as User;
}

/** جلسة محلية ثابتة — لا تعتمد على Supabase (مهم لسوريا وانقطاع الشبكة) */
export function saveStickySession(user: User): void {
  try {
    const payload: StickySession = {
      id: user.id,
      email: user.email ?? '',
      savedAt: Date.now(),
    };
    localStorage.setItem(STICKY_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function clearStickySession(): void {
  try {
    localStorage.removeItem(STICKY_KEY);
  } catch {
    // ignore
  }
}

export function loadStickySession(): User | null {
  try {
    const raw = localStorage.getItem(STICKY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StickySession;
    if (!parsed?.id || !parsed.email) return null;
    if (Date.now() - parsed.savedAt > STICKY_TTL_MS) {
      localStorage.removeItem(STICKY_KEY);
      return null;
    }
    return toUser(parsed);
  } catch {
    return null;
  }
}

/** @deprecated استخدم saveStickySession */
export function cacheAuthUser(user: User): void {
  saveStickySession(user);
}

/** @deprecated استخدم clearStickySession */
export function clearCachedAuthUser(): void {
  clearStickySession();
}

/** @deprecated استخدم loadStickySession */
export function readCachedAuthUser(): User | null {
  return loadStickySession();
}

/** محاولة استعادة جلسة Supabase — في الخلفية فقط */
export async function recoverSessionUser(
  client: SupabaseClient,
  opts?: { attempts?: number; delayMs?: number; patient?: boolean },
): Promise<User | null> {
  const attempts = opts?.attempts ?? 4;
  const delayMs = opts?.delayMs ?? 2000;
  const patient = opts?.patient ?? false;

  for (let i = 0; i < attempts; i++) {
    try {
      const { data, error } = await client.auth.getSession();
      if (data.session?.user) return data.session.user;
      if (!error && !patient) return null;
    } catch {
      // شبكة بطيئة أو مقطوعة
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

/** محاولة تحديث جلسة Supabase بدون التأثير على واجهة المستخدم */
export function refreshSessionInBackground(client: SupabaseClient): void {
  void recoverSessionUser(client, { attempts: 3, delayMs: 3000, patient: true }).then(user => {
    if (user) saveStickySession(user);
  });
}
