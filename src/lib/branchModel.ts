import { TREASURY_FUND_ID, getFundAccountName } from '../config';
import type { CashWindow } from './cashWindows';
import { buildFeed } from './deskOps';
import type { ExchangeBoard } from './exchangeBoard';
import { roundMoney } from './exchangeBoard';
import { createTransaction, todayIso } from './utils';
import type { Currency, FundId, Transaction } from '../types';

const MARK = '[[BR]]';

export type ShamStatus = 'draft' | 'pending' | 'success' | 'failed' | 'reversed';
export type ShamType = 'cash-out' | 'cash-in' | 'settle-in' | 'settle-out';

export interface CountLine {
  currency: Currency;
  expected: number;
  actual: number;
  reason?: string;
}

export interface OpeningLine {
  currency: Currency;
  amount: number;
}

export interface BranchOp {
  op: 'shift-open' | 'shift-close' | 'exchange' | 'remittance' | 'company' | 'sham' | 'inventory' | 'transfer';
  shiftId?: string;
  windowId?: string;
  employeeName?: string;
  userId?: string;
  receivedCurrency?: Currency;
  paidCurrency?: Currency;
  receivedAmount?: number;
  paidAmount?: number;
  baseRate?: number;
  appliedRate?: number;
  special?: boolean;
  reason?: string;
  customerName?: string;
  companyId?: string;
  reference?: string;
  beneficiary?: string;
  phone?: string;
  commission?: number;
  effect?: 'increase' | 'decrease';
  accountId?: string;
  shamType?: ShamType;
  shamStatus?: ShamStatus;
  fee?: number;
  cashTxId?: string;
  lines?: CountLine[];
  denominations?: string;
  inventoryStatus?: 'draft' | 'approved';
  approvedBy?: string;
  returned?: boolean;
  openedAt?: string;
  closedAt?: string;
  openingLines?: OpeningLine[];
}

export interface ParsedOp {
  tx: Transaction;
  op: BranchOp;
}

export function encodeBranch(op: BranchOp): string {
  return `${MARK}${JSON.stringify(op)}`;
}

export function readBranch(tx: Transaction): BranchOp | null {
  const note = tx.note?.trim();
  if (!note?.startsWith(MARK)) return null;
  try {
    const parsed = JSON.parse(note.slice(MARK.length)) as BranchOp;
    if (!parsed || typeof parsed.op !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function listBranchOps(transactions: Transaction[]): ParsedOp[] {
  return transactions
    .map(tx => {
      const op = readBranch(tx);
      return op ? { tx, op } : null;
    })
    .filter((row): row is ParsedOp => row !== null)
    .sort((a, b) => b.tx.createdAt.localeCompare(a.tx.createdAt));
}

export function openShiftFor(ops: ParsedOp[], windowId: string): ParsedOp | null {
  const closed = new Set(
    ops.filter(row => row.op.op === 'shift-close' && row.op.shiftId).map(row => row.op.shiftId),
  );
  return ops.find(row =>
    row.op.op === 'shift-open'
    && row.op.windowId === windowId
    && row.op.shiftId
    && !closed.has(row.op.shiftId),
  ) ?? null;
}

export function shiftFrozen(ops: ParsedOp[], shiftId: string): boolean {
  return ops.some(row => row.op.op === 'inventory' && row.op.shiftId === shiftId);
}

export function exchangeQuote(board: ExchangeBoard, received: Currency, paid: Currency): number {
  if (received === paid) return 0;
  const syp = board.againstSyp;
  const usd = board.againstUsd;

  if (paid === 'SYP' && received !== 'SYP') return syp[received]?.buy ?? 0;
  if (received === 'SYP' && paid !== 'SYP') {
    const per = syp[paid]?.sell ?? 0;
    return per ? 1 / per : 0;
  }
  if (paid === 'USD' && received !== 'USD') {
    if (received === 'SYP') {
      const per = syp.USD?.sell ?? 0;
      return per ? 1 / per : 0;
    }
    return usd[received]?.buy ?? 0;
  }
  if (received === 'USD' && paid !== 'USD') {
    const per = usd[paid]?.sell ?? 0;
    return per ? 1 / per : 0;
  }
  const buyUsd = usd[received]?.buy ?? 0;
  const sellUsd = usd[paid]?.sell ?? 0;
  if (!buyUsd || !sellUsd) return 0;
  return buyUsd / sellUsd;
}

export function paidAmountFor(receivedAmount: number, rate: number, paid: Currency): number {
  return roundMoney(receivedAmount * rate, paid);
}

export function marketRateLabel(received: Currency, paid: Currency): string {
  if (paid === 'SYP' || received === 'SYP') {
    const foreign = paid === 'SYP' ? received : paid;
    return `ليرة لكل 1 ${foreign}`;
  }
  if (paid === 'USD' || received === 'USD') {
    const other = paid === 'USD' ? received : paid;
    return `دولار لكل 1 ${other}`;
  }
  return `${paid} لكل 1 ${received}`;
}

/** السعر الذي يحرّره الموظف: ليرة/دولار لكل وحدة أجنبية عند وجودها */
export function editableQuote(board: ExchangeBoard, received: Currency, paid: Currency): number {
  if ((paid === 'SYP' && received !== 'SYP') || (received === 'SYP' && paid !== 'SYP')) {
    const foreign = paid === 'SYP' ? received : paid;
    const side = paid === 'SYP' ? 'buy' : 'sell';
    return board.againstSyp[foreign]?.[side] ?? 0;
  }
  if ((paid === 'USD' && received !== 'USD' && received !== 'SYP') || (received === 'USD' && paid !== 'USD' && paid !== 'SYP')) {
    const foreign = paid === 'USD' ? received : paid;
    const side = paid === 'USD' ? 'buy' : 'sell';
    return board.againstUsd[foreign]?.[side] ?? 0;
  }
  return exchangeQuote(board, received, paid);
}

export function paidFromEditableQuote(
  received: Currency,
  paid: Currency,
  receivedAmount: number,
  quote: number,
): number {
  if (!receivedAmount || !quote) return 0;
  if (received === 'SYP' && paid !== 'SYP') return roundMoney(receivedAmount / quote, paid);
  if (received === 'USD' && paid !== 'USD' && paid !== 'SYP') return roundMoney(receivedAmount / quote, paid);
  return roundMoney(receivedAmount * quote, paid);
}

export function buildExchangeTx(input: {
  window: CashWindow;
  shiftId: string;
  employeeName: string;
  received: Currency;
  paid: Currency;
  receivedAmount: number;
  paidAmount: number;
  baseRate: number;
  appliedRate: number;
  special: boolean;
  pending: boolean;
  reason?: string;
  customerName?: string;
}): Transaction {
  const op: BranchOp = {
    op: 'exchange',
    shiftId: input.shiftId,
    windowId: input.window.id,
    employeeName: input.employeeName,
    receivedCurrency: input.received,
    paidCurrency: input.paid,
    receivedAmount: input.receivedAmount,
    paidAmount: input.paidAmount,
    baseRate: input.baseRate,
    appliedRate: input.appliedRate,
    special: input.special,
    reason: input.reason,
    customerName: input.customerName,
  };
  return createTransaction({
    fundId: input.window.id,
    ledger: 'fund',
    date: todayIso(),
    currency: input.paid,
    kind: 'exchange',
    amount: input.paidAmount,
    party: getFundAccountName(input.window.id),
    counterparty: input.customerName,
    note: encodeBranch(op),
    status: input.pending ? 'pending' : 'posted',
    exchangeToCurrency: input.received,
    exchangeToAmount: input.receivedAmount,
    exchangeRate: input.paidAmount > 0 ? input.receivedAmount / input.paidAmount : 0,
  });
}

export function buildShiftOpen(input: {
  window: CashWindow;
  employeeName: string;
  userId?: string | null;
  lines: OpeningLine[];
}): Transaction[] {
  const shiftId = crypto.randomUUID();
  const transfers = input.lines
    .filter(line => line.amount > 0)
    .flatMap(line => buildFeed({
      fromId: TREASURY_FUND_ID,
      toId: input.window.id,
      currency: line.currency,
      amount: line.amount,
      note: encodeBranch({
        op: 'transfer',
        shiftId,
        windowId: input.window.id,
        employeeName: input.employeeName,
      }),
    }));
  const record = createTransaction({
    fundId: input.window.id,
    ledger: 'ops',
    date: todayIso(),
    currency: 'USD',
    kind: 'receipt',
    amount: 0,
    party: 'تشغيل الفرع',
    note: encodeBranch({
      op: 'shift-open',
      shiftId,
      windowId: input.window.id,
      employeeName: input.employeeName,
      userId: input.userId ?? undefined,
      openedAt: new Date().toISOString(),
      openingLines: input.lines.filter(line => line.amount > 0),
    }),
    status: 'posted',
  });
  return [record, ...transfers];
}

export function buildCashReturn(input: {
  window: CashWindow;
  shiftId: string;
  lines: { currency: Currency; amount: number }[];
}): Transaction[] {
  return input.lines
    .filter(line => line.amount > 0)
    .flatMap(line => buildFeed({
      fromId: input.window.id,
      toId: TREASURY_FUND_ID,
      currency: line.currency,
      amount: line.amount,
      note: encodeBranch({
        op: 'transfer',
        shiftId: input.shiftId,
        windowId: input.window.id,
        returned: true,
      }),
    }));
}

export function buildOpsTx(fundId: FundId, currency: Currency, amount: number, op: BranchOp, status: Transaction['status'] = 'posted'): Transaction {
  return createTransaction({
    fundId,
    ledger: 'ops',
    date: todayIso(),
    currency,
    kind: 'receipt',
    amount,
    party: 'تشغيل الفرع',
    note: encodeBranch(op),
    status,
  });
}

export function buildCashTx(input: {
  fundId: FundId;
  currency: Currency;
  amount: number;
  direction: 'in' | 'out';
  note: string;
  counterparty?: string;
}): Transaction {
  return createTransaction({
    fundId: input.fundId,
    ledger: 'fund',
    date: todayIso(),
    currency: input.currency,
    kind: input.direction === 'in' ? 'receipt' : 'payment',
    amount: roundMoney(input.amount, input.currency),
    party: getFundAccountName(input.fundId),
    counterparty: input.counterparty,
    note: input.note,
    status: 'posted',
  });
}

export function companyPosition(ops: ParsedOp[], companyId: string, currency: Currency): number {
  let total = 0;
  for (const row of ops) {
    if (row.tx.status !== 'posted' || row.op.companyId !== companyId || row.tx.currency !== currency) continue;
    if (row.op.op === 'remittance') total += row.tx.amount;
    if (row.op.op === 'company') total += row.op.effect === 'decrease' ? -row.tx.amount : row.tx.amount;
    if (row.op.op === 'sham' && row.op.shamStatus === 'success' && row.op.shamType === 'settle-in') total -= row.tx.amount;
    if (row.op.op === 'sham' && row.op.shamStatus === 'success' && row.op.shamType === 'settle-out') total += row.tx.amount;
    if (row.op.op === 'remittance' && row.op.commission) total += row.op.commission;
  }
  return total;
}

export function shamBalance(ops: ParsedOp[], accountId: string): number {
  let total = 0;
  for (const row of ops) {
    if (row.op.op !== 'sham' || row.op.accountId !== accountId || row.op.shamStatus !== 'success') continue;
    const amount = row.tx.amount;
    if (row.op.shamType === 'cash-out' || row.op.shamType === 'settle-in') total += amount;
    if (row.op.shamType === 'cash-in' || row.op.shamType === 'settle-out') total -= amount;
  }
  return total;
}

export function referenceTaken(ops: ParsedOp[], reference: string, accountId?: string): boolean {
  const key = reference.trim().toLowerCase();
  if (!key) return false;
  return ops.some(row =>
    row.op.op === 'sham'
    && row.op.reference?.trim().toLowerCase() === key
    && (!accountId || row.op.accountId === accountId)
    && (row.op.shamStatus === 'pending' || row.op.shamStatus === 'success'),
  );
}

export function receiptNo(tx: Transaction): string {
  return tx.id.replace(/-/g, '').slice(0, 8).toUpperCase();
}
