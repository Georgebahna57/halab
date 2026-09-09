import type { AppState, Bill, Customer, Transaction } from '../types';
import type { ValuationRates } from './valuationRates';

export const BACKUP_VERSION = 1;

export interface AppBackup {
  version: number;
  app: 'sandouk-halab';
  exportedAt: string;
  transactions: Transaction[];
  customers: Customer[];
  bills: Bill[];
  valuationRates?: ValuationRates;
}

export function buildAppBackup(state: AppState, valuationRates?: ValuationRates): AppBackup {
  return {
    version: BACKUP_VERSION,
    app: 'sandouk-halab',
    exportedAt: new Date().toISOString(),
    transactions: state.transactions,
    customers: state.customers,
    bills: state.bills,
    valuationRates,
  };
}

export function downloadAppBackup(backup: AppBackup): void {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = backup.exportedAt.slice(0, 10);
  a.download = `sandouk-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseAppBackup(raw: string): AppBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('الملف ليس JSON صالح');
  }
  if (!isRecord(parsed)) throw new Error('صيغة النسخة الاحتياطية غير صالحة');
  if (parsed.app !== 'sandouk-halab') throw new Error('هذا الملف ليس نسخة احتياطية من صناديق');
  if (!Array.isArray(parsed.transactions) || !Array.isArray(parsed.customers) || !Array.isArray(parsed.bills)) {
    throw new Error('النسخة الاحتياطية ناقصة (حركات / حسابات / فواتير)');
  }
  return parsed as unknown as AppBackup;
}

export function backupSummary(backup: AppBackup): string {
  return `${backup.transactions.length} حركة · ${backup.customers.length} حساب · ${backup.bills.length} فاتورة`;
}
