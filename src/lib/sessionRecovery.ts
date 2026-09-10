import type { SupabaseClient, User } from '@supabase/supabase-js';

const CACHE_KEY = 'halab-auth-user-v1';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type CachedAuthUser = Pick<User, 'id' | 'email'>;

export function cacheAuthUser(user: User): void {
  try {
    const payload: CachedAuthUser = { id: user.id, email: user.email ?? '' };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function clearCachedAuthUser(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

export function readCachedAuthUser(): User | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAuthUser;
    if (!parsed?.id || !parsed.email) return null;
    return parsed as User;
  } catch {
    return null;
  }
}

/** محاولة استعادة الجلسة — مفيد عند بطء/انقطاع الشبكة */
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
      // شبكة بطيئة أو مقطوعة — أعد المحاولة
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}
