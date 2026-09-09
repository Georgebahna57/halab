import { getFundAccountName } from '../config';
import type { Currency, Transaction, TransactionKind, TransactionStatus } from '../types';
import { createTransaction, todayIso } from './utils';

export type HalabImportDraft = {
  date: string;
  kind: TransactionKind;
  amount: number;
  currency: Currency;
  counterparty?: string;
  note?: string;
  status: TransactionStatus;
  line: number;
  raw: string;
};

const CURRENCY_ALIASES: Record<string, Currency> = {
  usd: 'USD',
  '$': 'USD',
  دولار: 'USD',
  eur: 'EUR',
  يورو: 'EUR',
  gbp: 'GBP',
  cad: 'CAD',
  كندي: 'CAD',
  sar: 'SAR',
  qar: 'QAR',
  kwd: 'KWD',
  jod: 'JOD',
  aed: 'AED',
  syp: 'SYP',
  nsyp: 'NSYP',
  سوري: 'SYP',
  'ل.س': 'SYP',
  lbp: 'LBP',
  ليرة: 'LBP',
  'ل.ل': 'LBP',
  gold: 'GOLD',
  ذهب: 'GOLD',
  silver: 'SILVER',
  فضة: 'SILVER',
};

const KIND_ALIASES: Record<string, TransactionKind> = {
  receipt: 'receipt',
  payment: 'payment',
  استلام: 'receipt',
  وارد: 'receipt',
  دفع: 'payment',
  صادر: 'payment',
};

const STATUS_ALIASES: Record<string, TransactionStatus> = {
  posted: 'posted',
  pending: 'pending',
  معلّق: 'pending',
  معلق: 'pending',
  انتظار: 'pending',
  مرحّل: 'posted',
  مرحل: 'posted',
};

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function parseCurrency(raw: string): Currency | null {
  const key = normalizeToken(raw);
  if (key in CURRENCY_ALIASES) return CURRENCY_ALIASES[key];
  const upper = raw.trim().toUpperCase();
  if (upper in CURRENCY_ALIASES) return CURRENCY_ALIASES[upper];
  if (/^[A-Z]{2,5}$/.test(upper)) return upper as Currency;
  return null;
}

function parseKind(raw: string): TransactionKind | null {
  const key = normalizeToken(raw);
  return KIND_ALIASES[key] ?? null;
}

function parseStatus(raw?: string): TransactionStatus {
  if (!raw?.trim()) return 'posted';
  const key = normalizeToken(raw);
  return STATUS_ALIASES[key] ?? 'posted';
}

function splitLine(line: string): string[] {
  if (line.includes('|')) return line.split('|').map(p => p.trim());
  if (line.includes('\t')) return line.split('\t').map(p => p.trim());
  return line.split(',').map(p => p.trim());
}

function parseTextLine(line: string, lineNo: number): HalabImportDraft {
  const raw = line.trim();
  if (!raw || raw.startsWith('#')) {
    throw new Error(`سطر ${lineNo}: فارغ`);
  }
  const parts = splitLine(raw);
  if (parts.length < 4) {
    throw new Error(`سطر ${lineNo}: الصيغة: تاريخ | نوع | مبلغ | عملة | طرف (اختياري) | حالة (اختياري)`);
  }
  const [date, kindRaw, amountRaw, currencyRaw, counterparty, statusRaw, note] = parts;
  const kind = parseKind(kindRaw);
  if (!kind || kind === 'exchange') {
    throw new Error(`سطر ${lineNo}: النوع يجب أن يكون «دفع» أو «استلام»`);
  }
  const currency = parseCurrency(currencyRaw);
  if (!currency) throw new Error(`سطر ${lineNo}: عملة غير معروفة «${currencyRaw}»`);
  const amount = Number(amountRaw.replace(/,/g, ''));
  if (!amount || amount <= 0) throw new Error(`سطر ${lineNo}: مبلغ غير صالح`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    throw new Error(`سطر ${lineNo}: التاريخ بصيغة YYYY-MM-DD`);
  }
  return {
    date: date.trim(),
    kind,
    amount,
    currency,
    counterparty: counterparty?.trim() || undefined,
    note: note?.trim() || undefined,
    status: parseStatus(statusRaw),
    line: lineNo,
    raw,
  };
}

export function parseHalabImportText(text: string): HalabImportDraft[] {
  const lines = text.split(/\r?\n/);
  const drafts: HalabImportDraft[] = [];
  const errors: string[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    try {
      drafts.push(parseTextLine(line, index + 1));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `سطر ${index + 1}: خطأ`);
    }
  });
  if (errors.length) throw new Error(errors.join('\n'));
  if (!drafts.length) throw new Error('لا توجد أسطر للاستيراد');
  return drafts;
}

function isHalabImportRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseHalabImportJson(raw: string): HalabImportDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('JSON غير صالح');
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const drafts: HalabImportDraft[] = [];
  rows.forEach((row, index) => {
    if (!isHalabImportRecord(row)) throw new Error(`سطر ${index + 1}: كائن غير صالح`);
    const kind = parseKind(String(row.kind ?? row.type ?? ''));
    if (!kind || kind === 'exchange') throw new Error(`سطر ${index + 1}: kind/type مطلوب`);
    const currency = parseCurrency(String(row.currency ?? ''));
    if (!currency) throw new Error(`سطر ${index + 1}: currency مطلوب`);
    const amount = Number(row.amount);
    if (!amount || amount <= 0) throw new Error(`سطر ${index + 1}: amount غير صالح`);
    const date = String(row.date ?? todayIso()).trim();
    drafts.push({
      date,
      kind,
      amount,
      currency,
      counterparty: row.counterparty ? String(row.counterparty).trim() : undefined,
      note: row.note ? String(row.note).trim() : undefined,
      status: parseStatus(row.status ? String(row.status) : undefined),
      line: index + 1,
      raw: JSON.stringify(row),
    });
  });
  if (!drafts.length) throw new Error('لا توجد عمليات في JSON');
  return drafts;
}

export function halabDraftsToTransactions(drafts: HalabImportDraft[]): Transaction[] {
  const party = getFundAccountName('moneyOut');
  return drafts.map(draft =>
    createTransaction({
      fundId: 'moneyOut',
      ledger: 'fund',
      date: draft.date,
      currency: draft.currency,
      kind: draft.kind,
      amount: draft.amount,
      party,
      counterparty: draft.counterparty,
      note: draft.note ?? 'استيراد جماعي — حلب',
      status: draft.status,
    }),
  );
}

export const HALAB_IMPORT_EXAMPLE = `# سطر لكل عملية — تاريخ | نوع | مبلغ | عملة | طرف | حالة
2026-08-01 | دفع | 1000 | USD | كندا
2026-08-01 | استلام | 5000000 | SYP | موني آوت
2026-08-02 | دفع | 250000 | سوري | زبون | انتظار`;
