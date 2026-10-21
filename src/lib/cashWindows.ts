import { TREASURY_FUND, TREASURY_FUND_ID, setDynamicFunds } from '../config';
import { supabase } from './supabase';
import type { FundId } from '../types';

export const WINDOW_CAPABILITIES = [
  { id: 'exchange', label: 'صرافة' },
  { id: 'remittance', label: 'حوالات' },
  { id: 'receiveDeliver', label: 'استلام وتسليم (مدفوعات ومقبوضات)' },
  { id: 'feedFund', label: 'تغذية صندوق' },
  { id: 'feedTreasury', label: 'تغذية خزنة (إعادة الفائض)' },
] as const;

export type WindowCapability = (typeof WINDOW_CAPABILITIES)[number]['id'];

export interface CashWindow {
  id: FundId;
  name: string;
  kind: 'treasury' | 'employee';
  employeeName?: string;
  userId?: string | null;
  capabilities: WindowCapability[];
}

const STORAGE_KEY = 'halab-cash-windows-v1';
const SETTINGS_KEY = 'cash_windows';

export const TREASURY_WINDOW: CashWindow = {
  id: TREASURY_FUND_ID,
  name: TREASURY_FUND.name,
  kind: 'treasury',
  capabilities: [],
};

function isCapability(value: string): value is WindowCapability {
  return WINDOW_CAPABILITIES.some(item => item.id === value);
}

function parseWindow(raw: unknown): CashWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<CashWindow>;
  if (typeof row.id !== 'string' || !row.id.trim()) return null;
  if (typeof row.name !== 'string' || !row.name.trim()) return null;
  const capabilities = Array.isArray(row.capabilities)
    ? row.capabilities.filter((item): item is WindowCapability => typeof item === 'string' && isCapability(item))
    : [];
  if (row.id === TREASURY_FUND_ID || row.kind === 'treasury') return { ...TREASURY_WINDOW };
  return {
    id: row.id,
    name: row.name.trim(),
    kind: 'employee',
    employeeName: (row.employeeName || row.name).trim(),
    userId: row.userId || null,
    capabilities,
  };
}

export function normalizeWindows(raw: unknown): CashWindow[] {
  const list = Array.isArray(raw)
    ? raw.map(parseWindow).filter((item): item is CashWindow => item !== null)
    : [];
  const employees = list.filter(item => item.kind === 'employee');
  return [TREASURY_WINDOW, ...employees];
}

function remember(windows: CashWindow[]) {
  setDynamicFunds(windows.map(window => ({
    id: window.id,
    name: window.name,
    shortName: window.name,
    accent: window.kind === 'treasury' ? TREASURY_FUND.accent : '#38bdf8',
  })));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(windows));
}

function loadLocal(): CashWindow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const windows = normalizeWindows(raw ? JSON.parse(raw) : []);
    remember(windows);
    return windows;
  } catch {
    remember([TREASURY_WINDOW]);
    return [TREASURY_WINDOW];
  }
}

export async function fetchCashWindows(): Promise<CashWindow[]> {
  if (!supabase) return loadLocal();

  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();

  if (error || !data?.value) return loadLocal();
  const windows = normalizeWindows(data.value);
  remember(windows);
  return windows;
}

export async function saveCashWindows(windows: CashWindow[]): Promise<void> {
  const normalized = normalizeWindows(windows);
  remember(normalized);
  if (!supabase) return;

  const { error } = await supabase.from('app_settings').upsert({
    key: SETTINGS_KEY,
    value: normalized,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** يمنح الموظف تعديل كوّته، وتعديل الخزنة إذا من صلاحياته التغذية */
export async function grantWindowAccess(window: CashWindow, previousUserId?: string | null) {
  if (!supabase || window.kind !== 'employee') return;

  if (previousUserId && previousUserId !== window.userId) {
    const { error } = await supabase
      .from('user_fund_permissions')
      .delete()
      .eq('user_id', previousUserId)
      .eq('fund_id', window.id);
    if (error) throw error;
  }

  if (!window.userId) return;

  const rows = [{ user_id: window.userId, fund_id: window.id, permission: 'edit' }];
  if (window.capabilities.includes('feedFund') || window.capabilities.includes('feedTreasury')) {
    rows.push({ user_id: window.userId, fund_id: TREASURY_FUND_ID, permission: 'edit' });
  }

  const { error } = await supabase.from('user_fund_permissions').upsert(rows);
  if (error) throw error;
}
