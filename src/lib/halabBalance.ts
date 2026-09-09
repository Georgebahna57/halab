import { isHalabLinkedAccountName, isMoneyOutFund } from '../config';
import type { Currency, FundId, Transaction } from '../types';
import type { OpeningBalanceSide } from './openingBalance';

/** سوري ودولار على حلب: الرصيد = دفع − استلام */
export function isHalabPaymentMinusReceiptCurrency(_currency: Currency): boolean {
  return true;
}

export function usesHalabReconciliationBalance(fundId: FundId): boolean {
  return isMoneyOutFund(fundId);
}

export function computeHalabAwareBalance(
  receipts: number,
  payments: number,
  fundId: FundId,
  _currency: Currency,
): number {
  if (usesHalabReconciliationBalance(fundId)) {
    return payments - receipts;
  }
  return receipts - payments;
}

/** هدف الرصيد الافتتاحي (موقّع) — دفع − استلام */
export function halabOpeningTargetBalance(
  amount: number,
  side: OpeningBalanceSide,
  currency: Currency,
): number {
  if (currency === 'USD') {
    return side === 'theirs' ? -amount : amount;
  }
  if (currency === 'SYP' || currency === 'NSYP') {
    return side === 'ours' ? amount : -amount;
  }
  return side === 'ours' ? amount : -amount;
}

export function openingBalanceKindForDelta(
  fundId: FundId,
  _currency: Currency,
  delta: number,
): 'receipt' | 'payment' {
  if (usesHalabReconciliationBalance(fundId)) {
    return delta > 0 ? 'payment' : 'receipt';
  }
  return delta > 0 ? 'receipt' : 'payment';
}

/** لنا / لهم — السوري: موجب=لنا · الدولار: سالب=لهم */
export function halabBalanceSideLabel(currency: Currency, balance: number): 'لنا' | 'لهم' | 'متعادل' {
  if (balance === 0) return 'متعادل';
  if (currency === 'USD') {
    return balance < 0 ? 'لهم' : 'لنا';
  }
  if (currency === 'SYP' || currency === 'NSYP') {
    return balance > 0 ? 'لنا' : 'لهم';
  }
  return balance > 0 ? 'لنا' : 'لهم';
}

export function halabBalanceIsSurplus(fundId: FundId, currency: Currency, balance: number): boolean {
  if (!usesHalabReconciliationBalance(fundId)) return balance > 0;
  return halabBalanceSideLabel(currency, balance) === 'لنا';
}

export function halabStatementBalanceDelta(
  fundId: FundId,
  _currency: Currency,
  kind: 'receipt' | 'payment',
  amount: number,
): number {
  if (usesHalabReconciliationBalance(fundId)) {
    return kind === 'payment' ? amount : -amount;
  }
  return kind === 'receipt' ? amount : -amount;
}

export function halabExchangePaidDelta(fundId: FundId, _currency: Currency, amount: number): number {
  if (usesHalabReconciliationBalance(fundId)) return amount;
  return -amount;
}

export function halabExchangeReceivedDelta(fundId: FundId, _currency: Currency, amount: number): number {
  if (usesHalabReconciliationBalance(fundId)) return -amount;
  return amount;
}

export function usesHalabStatementBalance(fundId: FundId, accountName: string): boolean {
  return usesHalabReconciliationBalance(fundId) && isHalabLinkedAccountName(accountName);
}

const OPENING_BALANCE_NOTE = 'رصيد افتتاحي';

/** إصلاح نوع حركة الافتتاح — سوري لنا: استلام→دفع · دولار لهم: دفع→استلام */
export function repairHalabOpeningBalanceKinds(transactions: Transaction[]): {
  transactions: Transaction[];
  changed: Transaction[];
} {
  const changed: Transaction[] = [];
  const next = transactions.map(tx => {
    if (!isMoneyOutFund(tx.fundId)) return tx;
    if ((tx.ledger ?? 'fund') !== 'fund') return tx;
    if (!tx.note?.includes(OPENING_BALANCE_NOTE)) return tx;
    if (tx.currency === 'SYP' || tx.currency === 'NSYP') {
      if (tx.kind !== 'receipt') return tx;
      const fixed: Transaction = { ...tx, kind: 'payment' };
      changed.push(fixed);
      return fixed;
    }
    if (tx.currency === 'USD') {
      if (tx.kind !== 'payment') return tx;
      const fixed: Transaction = { ...tx, kind: 'receipt' };
      changed.push(fixed);
      return fixed;
    }
    return tx;
  });
  return { transactions: next, changed };
}

export function getHalabCurrencyTotals(
  transactions: Transaction[],
  currency: Currency,
): { payments: number; receipts: number; balance: number; operationDelta: number } {
  let payments = 0;
  let receipts = 0;
  for (const tx of transactions) {
    if (!isMoneyOutFund(tx.fundId)) continue;
    if ((tx.ledger ?? 'fund') !== 'fund') continue;
    if (tx.status !== 'posted') continue;
    if (tx.currency !== currency && !(tx.kind === 'exchange' && tx.exchangeToCurrency === currency)) continue;
    if (tx.kind === 'exchange' && tx.exchangeToCurrency === currency && tx.exchangeToAmount) {
      receipts += tx.exchangeToAmount;
      continue;
    }
    if (tx.currency !== currency) continue;
    if (tx.kind === 'payment') payments += tx.amount;
    if (tx.kind === 'receipt') receipts += tx.amount;
  }
  const balance = computeHalabAwareBalance(receipts, payments, 'moneyOut', currency);
  const operationDelta = payments - receipts;
  return { payments, receipts, balance, operationDelta };
}

export type HalabUsdBreakdown = {
  openingPayments: number;
  openingReceipts: number;
  openingBalance: number;
  opsPayments: number;
  opsReceipts: number;
  opsDelta: number;
  totalBalance: number;
  openingTxCount: number;
};

export function getHalabUsdBalanceBreakdown(transactions: Transaction[]): HalabUsdBreakdown {
  let openingPayments = 0;
  let openingReceipts = 0;
  let opsPayments = 0;
  let opsReceipts = 0;
  let openingTxCount = 0;

  for (const tx of transactions) {
    if (!isMoneyOutFund(tx.fundId)) continue;
    if ((tx.ledger ?? 'fund') !== 'fund') continue;
    if (tx.status !== 'posted') continue;
    if (tx.currency !== 'USD') continue;
    if (tx.kind !== 'payment' && tx.kind !== 'receipt') continue;
    const isOpening = Boolean(tx.note?.includes(OPENING_BALANCE_NOTE));
    if (isOpening) openingTxCount += 1;
    if (tx.kind === 'payment') {
      if (isOpening) openingPayments += tx.amount;
      else opsPayments += tx.amount;
    } else {
      if (isOpening) openingReceipts += tx.amount;
      else opsReceipts += tx.amount;
    }
  }

  const openingBalance = openingPayments - openingReceipts;
  const opsDelta = opsPayments - opsReceipts;
  const totalBalance = computeHalabAwareBalance(
    openingReceipts + opsReceipts,
    openingPayments + opsPayments,
    'moneyOut',
    'USD',
  );

  return {
    openingPayments,
    openingReceipts,
    openingBalance,
    opsPayments,
    opsReceipts,
    opsDelta,
    totalBalance,
    openingTxCount,
  };
}

export function runAllHalabRepairs(transactions: Transaction[]): {
  transactions: Transaction[];
  changed: Transaction[];
} {
  return repairHalabOpeningBalanceKinds(transactions);
}
