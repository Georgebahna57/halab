import type { SupabaseClient, User } from '@supabase/supabase-js';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** محاولة استعادة الجلسة — مفيد عند بطء/انقطاع الشبكة */
export async function recoverSessionUser(
  client: SupabaseClient,
  opts?: { attempts?: number; delayMs?: number },
): Promise<User | null> {
  const attempts = opts?.attempts ?? 4;
  const delayMs = opts?.delayMs ?? 2000;

  for (let i = 0; i < attempts; i++) {
    try {
      const { data, error } = await client.auth.getSession();
      if (data.session?.user) return data.session.user;
      if (!error) return null;
    } catch {
      // شبكة بطيئة أو مقطوعة — أعد المحاولة
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}
