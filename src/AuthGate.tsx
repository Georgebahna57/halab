import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import App from './App';
import { LoginScreen } from './components/LoginScreen';
import {
  clearStickySession,
  loadStickySession,
  refreshSessionInBackground,
  saveStickySession,
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
  const [user, setUser] = useState<User | null>(() => loadStickySession());
  const [checking, setChecking] = useState(() => !loadStickySession());
  const [offlineMode, setOfflineMode] = useState(false);
  const explicitLogoutRef = useRef(false);

  function adoptUser(next: User) {
    setUser(next);
    saveStickySession(next);
    setOfflineMode(false);
    if (supabase) refreshSessionInBackground(supabase);
  }

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }

    const sticky = loadStickySession();
    if (sticky) {
      setUser(sticky);
      setChecking(false);
      refreshSessionInBackground(supabase);
    } else {
      setChecking(false);
    }

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (explicitLogoutRef.current) return;
      if (session?.user) {
        setUser(session.user);
        saveStickySession(session.user);
        setOfflineMode(false);
      }
    });

    const onlineTimer = window.setInterval(() => {
      if (!loadStickySession()) return;
      if (!navigator.onLine) {
        setOfflineMode(true);
        return;
      }
      setOfflineMode(false);
      if (supabase) refreshSessionInBackground(supabase);
    }, 60_000);

    return () => {
      listener.subscription.unsubscribe();
      window.clearInterval(onlineTimer);
    };
  }, []);

  async function handleLogout() {
    explicitLogoutRef.current = true;
    clearStickySession();
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setOfflineMode(false);
    explicitLogoutRef.current = false;
  }

  if (!isSupabaseConfigured) return <SetupRequired />;

  if (checking && !user) {
    return <SessionLoader message="جاري التحميل..." />;
  }

  if (!user) {
    return <LoginScreen onSuccess={adoptUser} />;
  }

  return (
    <>
      {offlineMode && (
        <div className="fixed inset-x-0 top-0 z-[100] bg-amber-500/15 px-4 py-2 text-center text-xs text-amber-200">
          اتصال ضعيف — التطبيق يعمل من الجلسة المحفوظة
        </div>
      )}
      <App user={user} onLogout={handleLogout} />
    </>
  );
}
