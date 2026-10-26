import type { ExchangeBoard } from './exchangeBoard';
import { supabase } from './supabase';
import type { Currency } from '../types';

export interface BranchCompany {
  id: string;
  name: string;
  phone?: string;
}

export interface ShamAccount {
  id: string;
  name: string;
  owner: string;
  currency: Currency;
  active: boolean;
}

export interface RateSnapshot {
  at: string;
  by: string;
  board: ExchangeBoard;
}

export interface BranchMaster {
  companies: BranchCompany[];
  shamAccounts: ShamAccount[];
  rateHistory: RateSnapshot[];
}

const STORAGE_KEY = 'halab-branch-master-v1';
const SETTINGS_KEY = 'branch_master';

export function emptyBranchMaster(): BranchMaster {
  return { companies: [], shamAccounts: [], rateHistory: [] };
}

function clean(raw: unknown): BranchMaster {
  const base = emptyBranchMaster();
  if (!raw || typeof raw !== 'object') return base;
  const row = raw as Partial<BranchMaster>;
  if (Array.isArray(row.companies)) {
    base.companies = row.companies.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string');
  }
  if (Array.isArray(row.shamAccounts)) {
    base.shamAccounts = row.shamAccounts.filter(item =>
      item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.currency === 'string',
    ).map(item => ({ ...item, active: item.active !== false, owner: item.owner || item.name }));
  }
  if (Array.isArray(row.rateHistory)) {
    base.rateHistory = row.rateHistory.filter(item => item && typeof item.at === 'string' && item.board).slice(0, 30);
  }
  return base;
}

export async function fetchBranchMaster(): Promise<BranchMaster> {
  try {
    const localRaw = localStorage.getItem(STORAGE_KEY);
    const local = clean(localRaw ? JSON.parse(localRaw) : null);
    if (!supabase) return local;
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
    if (error || !data?.value) return local;
    const master = clean(data.value);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(master));
    return master;
  } catch {
    return emptyBranchMaster();
  }
}

export async function saveBranchMaster(master: BranchMaster): Promise<void> {
  const next = clean(master);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  if (!supabase) return;
  const { error } = await supabase.from('app_settings').upsert({
    key: SETTINGS_KEY,
    value: next,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
