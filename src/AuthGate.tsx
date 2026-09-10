import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import App from './App';
import { LoginScreen } from './components/LoginScreen';
import {
  cacheAuthUser,
  clearCachedAuthUser,
  readCachedAuthUser,
  recoverSessionUser,
} from './lib/sessionRecovery';
import { isSupabaseConfigured, supabase } from './lib/supabase';

function SetupRequired() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 text-center">
      <h1 className="text-xl font-bold text-amber-400">حلب</h1>
      <p className="mt-4 text-sm text-slate-400">
        السحابة غير مُعدّة بعد. أضف مفاتيح Supabase في ملف <code className="text-amber-300">.env</code>
      </p>
      <pre className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4 text-left text-xs text-slate-300" dir="ltr">
{`VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...`}
      </pre>
    </div>
  );
}

function SessionLoader({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <Loader2 className="animate-spin text-amber-400" size={32} />
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}

export function AuthGate() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionWarning, setSessionWarning] = useState(false);
  const explicitLogoutRef = useRef(false);

  function adoptUser(next: User | null) {
    if (!next) return;
    setUser(next);
    cacheAuthUser(next);
    setSessionWarning(false);
  }

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      const recovered = await recoverSessionUser(supabase!, {
        attempts: 6,
        delayMs: 2000,
        patient: true,
      });
      if (cancelled) return;

      if (recovered) {
        adoptUser(recovered);
      } else {
        const cached = readCachedAuthUser();
        if (cached) {
          setUser(cached);
          setSessionWarning(true);
        }
      }
      setChecking(false);
    }

    void bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (explicitLogoutRef.current) return;
      if (session?.user) adoptUser(session.user);
      // لا تسجّل خروج تلقائي — أحداث Supabase الوهمية شائعة على شبكات بطيئة
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    explicitLogoutRef.current = true;
    if (supabase) await supabase.auth.signOut();
    clearCachedAuthUser();
    setUser(null);
    setSessionWarning(false);
    explicitLogoutRef.current = false;
  }

  if (!isSupabaseConfigured) return <SetupRequired />;

  if (checking && !user) {
    return <SessionLoader message="جاري الاتصال بالسحابة..." />;
  }

  if (!user) {
    return (
      <LoginScreen
        onSuccess={adoptUser}
      />
    );
  }

  return (
    <>
      {sessionWarning && (
        <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-slate-900/95 px-4 py-2 text-xs text-amber-300 shadow-lg">
          <Loader2 size={14} className="animate-spin" />
          اتصال ضعيف — جاري استعادة الجلسة
        </div>
      )}
      <App user={user} onLogout={handleLogout} />
    </>
  );
}
