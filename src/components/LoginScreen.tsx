import { useState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface Props {
  onSuccess: (user: User) => void;
}

export function LoginScreen({ onSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      if (!data.user) throw new Error('no user');
      onSuccess(data.user);
    } catch (err) {
      setError(
        err instanceof Error && err.message.toLowerCase().includes('invalid')
          ? 'البريد أو كلمة السر غير صحيحة'
          : 'فشل تسجيل الدخول — تواصل مع المسؤول',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-amber-400">حلب</h1>
        <p className="mt-2 text-sm text-slate-400">سجّل دخولك للمتابعة</p>
      </div>

      <form onSubmit={submit} className="rounded-2xl border border-slate-700 bg-slate-800/80 p-5 space-y-4">
        <input
          type="email"
          placeholder="البريد الإلكتروني"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm"
          required
          autoComplete="username"
          dir="ltr"
        />
        <input
          type="password"
          placeholder="كلمة السر"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm"
          required
          autoComplete="current-password"
          dir="ltr"
        />

        {error && (
          <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-60"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
          دخول
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-slate-500">
        الحسابات مُعدّة مسبقاً — للدعم تواصل مع المسؤول
      </p>
    </div>
  );
}
