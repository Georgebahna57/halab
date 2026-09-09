import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import App from './App';
import { LoginScreen } from './components/LoginScreen';
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

export function AuthGate() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setChecking(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
  }

  if (!isSupabaseConfigured) return <SetupRequired />;

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="animate-spin text-amber-400" size={32} />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onSuccess={() => supabase?.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))} />;
  }

  return <App user={user} onLogout={handleLogout} />;
}
