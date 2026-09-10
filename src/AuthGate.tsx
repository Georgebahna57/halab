import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AuthChangeEvent, User } from '@supabase/supabase-js';
import App from './App';
import { LoginScreen } from './components/LoginScreen';
import { recoverSessionUser } from './lib/sessionRecovery';
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
  const [reconnecting, setReconnecting] = useState(false);
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      const recovered = await recoverSessionUser(supabase!, { attempts: 5, delayMs: 2000 });
      if (!cancelled) {
        setUser(recovered);
        setChecking(false);
      }
    }

    void bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session) => {
      if (session?.user) {
        setUser(session.user);
        setReconnecting(false);
        return;
      }

      // لا تسجّل خروج فوراً — انقطاع الشبكة أو تحديث التوكن قد يمرّ بلحظة بلا جلسة
      const hadUser = userRef.current !== null;
      if (!hadUser && (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT')) {
        setUser(null);
        setReconnecting(false);
        return;
      }

      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        setReconnecting(true);
        void recoverSessionUser(supabase!, { attempts: 3, delayMs: 2000 }).then(recovered => {
          if (cancelled) return;
          setUser(recovered);
          setReconnecting(false);
        });
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setReconnecting(false);
  }

  if (!isSupabaseConfigured) return <SetupRequired />;

  if (checking || reconnecting) {
    return (
      <SessionLoader
        message={reconnecting ? 'جاري استعادة الجلسة — انتظر قليلاً' : 'جاري الاتصال بالسحابة...'}
      />
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onSuccess={() => {
          void recoverSessionUser(supabase!, { attempts: 2, delayMs: 500 }).then(setUser);
        }}
      />
    );
  }

  return <App user={user} onLogout={handleLogout} />;
}
