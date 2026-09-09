import { getFundAccountName, isHalabFleilatFund, isHalabLinkedAccountName } from '../config';
import { halabBalanceSideLabel } from './halabBalance';
import { createAccountTransaction } from './utils';
import type { Currency, CustomerBalances, FundId, Transaction, TransactionKind } from '../types';
import { formatAmount, todayIso } from './utils';

const MONEY_OUT_RECON_CURRENCIES: { currency: Currency; label: string }[] = [
  { currency: 'USD', label: 'دولار' },
  { currency: 'SYP', label: 'سوري' },
  { currency: 'NSYP', label: 'سوري جديد' },
];

function mirrorKind(kind: TransactionKind): TransactionKind | null {
  if (kind === 'receipt') return 'payment';
  if (kind === 'payment') return 'receipt';
  return null;
}

export function halabMirrorAccountName(): string {
  return getFundAccountName('moneyOut');
}

export function shouldOfferHalabMirror(fundId: FundId, accountName?: string): boolean {
  if (!isHalabFleilatFund(fundId)) return false;
  if (accountName && isHalabLinkedAccountName(accountName)) return false;
  return true;
}

/** ينشئ حركات عكسية على حساب حلب لكل حركة حساب (غير حلب) */
export function appendHalabMirrorTransactions(
  payload: Transaction | Transaction[],
  enabled: boolean,
): Transaction[] {
  const list = Array.isArray(payload) ? payload : [payload];
  if (!enabled || !list.length || !isHalabFleilatFund(list[0].fundId)) return list;

  const halabAccount = halabMirrorAccountName();
  const result = [...list];

  for (const tx of list) {
    if (tx.feeSourceId) continue;
    if (!isHalabFleilatFund(tx.fundId)) continue;
    if ((tx.ledger ?? 'fund') !== 'account') continue;
    if (isHalabLinkedAccountName(tx.party)) continue;

    const opposite = mirrorKind(tx.kind);
    if (!opposite) continue;

    result.push(createAccountTransaction({
      fundId: tx.fundId,
      date: tx.date,
      currency: tx.currency,
      kind: opposite,
      amount: tx.amount,
      party: halabAccount,
      counterparty: tx.party,
      intermediary: tx.intermediary,
      note: tx.note,
      status: tx.status,
      batchId: tx.batchId,
      linkId: tx.linkId,
      orderedDate: tx.orderedDate,
    }));
  }

  return result;
}

function formatReconciliationDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function reconciliationSideLabel(currency: Currency, balance: number): 'لنا' | 'لكم' {
  const side = halabBalanceSideLabel(currency, balance);
  return side === 'لهم' ? 'لكم' : side === 'لنا' ? 'لنا' : 'لنا';
}

/** رسالة مطابقة أرصدة — شركة موني آوت (حساب حلب) */
export function buildMoneyOutReconciliationMessage(
  balances: CustomerBalances,
  dateIso?: string,
): string {
  const dateLine = formatReconciliationDate(dateIso ?? todayIso());
  const blocks: string[] = [];

  for (const { currency, label } of MONEY_OUT_RECON_CURRENCIES) {
    const b = balances[currency];
    if (!b || (b.receipts === 0 && b.payments === 0 && b.balance === 0)) continue;
    const side = reconciliationSideLabel(currency, b.balance);
    blocks.push(
      `*${label}.رصيد ${side}*`,
      '',
      `*${formatAmount(Math.abs(b.balance), currency)}*`,
      '',
    );
  }

  if (!blocks.length) {
    blocks.push('*لا يوجد رصيد للمطابقة*', '');
  }

  return [
    '*السلام عليكم ورحمة الله وبركاته*',
    '',
    '*📍مطابقة الأرصدة- شركة موني آوت*',
    '',
    '*تاريخ المطابقة🕐*',
    `*${dateLine}*`,
    '',
    ...blocks,
    '*يرجى الرد على المطابقة وتأكيدها*',
    '*مع فائق الاحترام والتقدير💙*',
  ].join('\n');
}

export function isMoneyOutReconciliationAccount(fundId: FundId, accountName: string): boolean {
  return isHalabFleilatFund(fundId) && isHalabLinkedAccountName(accountName);
}
