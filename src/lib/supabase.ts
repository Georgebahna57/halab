import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        // تحديث الرمز مطلوب لطلبات API — تسجيل الخروج يُمنع عبر الجلسة الثابتة في AuthGate
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: localStorage,
        storageKey: 'halab-auth-v1',
      },
    })
  : null;
