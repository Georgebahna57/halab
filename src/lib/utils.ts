import { CENTERS_FUND_ID, CURRENCIES, emptyBalances, emptyCustomerBalances, getCurrencyLabel, getCurrencySymbol, getFund, getFundAccountName, isFundAccountName, isHalabFleilatFund, isHalabFundPartyName, isHalabLinkedAccountName, isWeightCurrency } from '../config';
import { computeHalabAwareBalance } from './halabBalance';
import { normalizeSyrianTransaction, syrianBalanceAmount, syrianBalanceCurrency } from './syrianCurrency';
import { attachFeeFields, attachExtraFeeFields, parseStoredFee, ALL_FEE_ACCOUNTS, isFeeAccountName, isAutoFeeTransaction, adjustAccountItemsForFees, resolveFeeAccountName, SHAMEL_FEE_ACCOUNT, type ParsedFee } from './fees';
import { mergeAccountSummaries } from './accountMerge';
import { INVERSE_RATE_CURRENCIES } from './valuationRates';
import { safeSetItem } from './safeLocalStorage';
import type {
  AppState,
  Currency,
  Customer,
  CustomerBalances,
  CustomerSummary,
  FundBalances,
  FundId,
  Transaction,
  TransactionEditRecord,
  TransactionFilters,
  TransactionKind,
  TransactionLedger,
  TransactionStatus,
} from '../types';

const STORAGE_KEY = 'sandouk-nemr-v1';

/** أرقام إنجليزية (0–9) في كل الواجهة */
export const NUMBER_LOCALE = 'en-US';

export function formatIntermediary(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function formatFee(value?: string): string | undefined {
  const parsed = parseStoredFee(value);
  if (parsed?.display) return parsed.display;
  return value?.trim() || undefined;
}

export function parseMentions(text: string): string[] {
  const matches = text.match(/@([^\s@]+)/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(1).trim()).filter(Boolean))];
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { transactions: [], bills: [], customers: [] };
    const parsed = JSON.parse(raw) as AppState & { denominations?: unknown };
    return {
      transactions: normalizeTransactions(parsed.transactions ?? []),
      bills: parsed.bills ?? [],
      customers: (parsed.customers ?? []).map(c => ({
        ...c,
        fundId: c.fundId ?? 'nemr',
      })),
    };
  } catch {
    return { transactions: [], bills: [], customers: [] };
  }
}

export function saveState(state: AppState): boolean {
  return safeSetItem(STORAGE_KEY, JSON.stringify(state));
}

export function calcExchangeAmount(fromAmount: number, rate: number): number {
  if (!fromAmount || !rate) return 0;
  return Math.round(fromAmount * rate * 100) / 100;
}

/** مبلغ الدفع من مبلغ الاستلام والريت (مبلغ الدفع × الريت = الاستلام). */
export function calcExchangePaidAmount(receivedAmount: number, rate: number): number {
  if (!receivedAmount || !rate) return 0;
  return Math.round((receivedAmount / rate) * 100) / 100;
}

export function describeTransaction(tx: Transaction): string {
  const via = formatIntermediary(tx.intermediary);
  const viaSuffix = via ? ` بيد ${via}` : '';
  if (tx.kind === 'exchange' && tx.exchangeToCurrency && tx.exchangeToAmount && tx.exchangeRate) {
    return `تبديل — استلم ${formatValueWithUnit(tx.exchangeToAmount, tx.exchangeToCurrency)} · دفع ${formatValueWithUnit(tx.amount, tx.currency)}${viaSuffix}`;
  }
  if (tx.kind === 'exchange') return via ? `تبديل${viaSuffix}` : 'تبديل';
  if (tx.ledger === 'account' && !isFeeAccountName(tx.party)) {
    const other = tx.counterparty?.trim();
    if (tx.kind === 'payment') {
      return other ? `سحب → ${other}${viaSuffix}` : via ? `سحب${viaSuffix}` : 'سحب';
    }
    return other ? `إيداع ← ${other}${viaSuffix}` : via ? `إيداع${viaSuffix}` : 'إيداع';
  }
  const other = tx.counterparty?.trim();
  if (tx.kind === 'payment') {
    if (other) return `دفع لـ ${other}${viaSuffix}`;
    return via ? `دفع${viaSuffix}` : 'دفع';
  }
  if (via) return other ? `استلام من ${other} بيد ${via}` : `استلام بيد ${via}`;
  return other ? `استلام من ${other}` : (
    tx.ledger === 'account' || !isFundAccountName(tx.party) ? 'حركة حساب' : 'حركة صندوق'
  );
}

/** يكمّل «بيد» وغيرها من حركة الصندوق المربوطة للعرض */
export function enrichAccountTransactionForDisplay(tx: Transaction, all: Transaction[]): Transaction {
  if (tx.ledger !== 'account' || isAutoFeeTransaction(tx)) return tx;
  if (tx.intermediary?.trim()) return tx;
  if (!tx.linkId) return tx;
  const fundPeer = all.find(t => t.linkId === tx.linkId && t.ledger === 'fund');
  if (!fundPeer?.intermediary) return tx;
  return { ...tx, intermediary: fundPeer.intermediary };
}

export function enrichAccountTransactionsForDisplay(
  accountTxs: Transaction[],
  all: Transaction[],
): Transaction[] {
  return accountTxs.map(tx => enrichAccountTransactionForDisplay(tx, all));
}

/** يحوّل الحركات القديمة (party = الطرف) إلى النموذج الجديد */
export function normalizeTransaction(tx: Transaction): Transaction {
  const intermediary = formatIntermediary(tx.intermediary);
  const withFee = attachExtraFeeFields(attachFeeFields({ ...tx, intermediary }));
  const base = intermediary !== tx.intermediary || withFee.fee !== tx.fee || withFee.extraFee !== tx.extraFee
    ? withFee
    : tx;
  if (base.ledger === 'account') return base;

  const ledger = base.ledger ?? 'fund';
  if (ledger === 'fund') {
    if (!isFundAccountName(base.party) && isCustomerAccountName(base.party)) {
      return {
        ...base,
        ledger: 'fund',
        counterparty: base.counterparty ?? base.party,
        party: getFundAccountName(base.fundId),
      };
    }
    return { ...base, ledger: 'fund' };
  }

  if (!isFundAccountName(base.party) && isCustomerAccountName(base.party)) {
    return { ...base, ledger: 'account' };
  }
  if (isFundAccountName(base.party) || base.counterparty) {
    return { ...base, ledger: 'fund' };
  }
  return {
    ...base,
    ledger: 'fund',
    counterparty: base.party,
    party: getFundAccountName(base.fundId),
  };
}

export function normalizeTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.map(normalizeTransaction);
}

export function formatWeight(grams: number): string {
  return grams.toLocaleString(NUMBER_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatAmount(amount: number, currency: Currency): string {
  if (isWeightCurrency(currency)) return formatWeight(amount);
  const noDecimals = currency === 'LBP' || currency === 'SYP' || currency === 'NSYP';
  return amount.toLocaleString(NUMBER_LOCALE, {
    minimumFractionDigits: noDecimals ? 0 : 0,
    maximumFractionDigits: noDecimals ? 0 : 0,
  });
}

export function formatValueWithUnit(amount: number, currency: Currency): string {
  const formatted = formatAmount(amount, currency);
  if (isWeightCurrency(currency)) return `${formatted} غ`;
  return `${formatted} ${getCurrencySymbol(currency)}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatDateAr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d} - ${m} - ${y}`;
}

/** ملاحظة عندما نُفّذ الطلب بتاريخ مختلف عن إنشائه */
export function getOrderedDateNote(tx: Transaction): string | undefined {
  const ordered = tx.orderedDate ?? tx.createdAt?.slice(0, 10);
  if (!ordered || ordered === tx.date) return undefined;
  return `أُنشئ الطلب بتاريخ ${formatDateAr(ordered)}`;
}

export function filterByFund<T extends { fundId: FundId }>(items: T[], fundId: FundId): T[] {
  return items.filter(i => i.fundId === fundId);
}

export type FundTransactionStats = {
  total: number;
  fundLedger: number;
  accountLedger: number;
  pending: number;
  posted: number;
  visibleFundLedger: number;
  visiblePending: number;
  visiblePosted: number;
};

export function getFundTransactionStats(transactions: Transaction[], fundId: FundId): FundTransactionStats {
  const inFund = transactions.filter(t => t.fundId === fundId);
  return {
    total: inFund.length,
    fundLedger: inFund.filter(t => (t.ledger ?? 'fund') === 'fund').length,
    accountLedger: inFund.filter(t => t.ledger === 'account').length,
    pending: inFund.filter(t => t.status === 'pending').length,
    posted: inFund.filter(t => t.status === 'posted').length,
    visibleFundLedger: filterTransactions(inFund, fundId).length,
    visiblePending: filterTransactions(inFund, fundId, { status: 'pending' }).length,
    visiblePosted: filterTransactions(inFund, fundId, { status: 'posted' }).length,
  };
}

/** إصلاح حركات صندوق حلب المخزّنة بحساب الطرف بدل حساب الصندوق */
export function repairHalabFundTransactions(transactions: Transaction[]): {
  transactions: Transaction[];
  changed: Transaction[];
} {
  const changed: Transaction[] = [];
  const next = transactions.map(tx => {
    if (tx.fundId !== 'halabFleilat') return tx;
    const ledger = tx.ledger ?? 'fund';
    if (ledger !== 'fund') return tx;
    if (isHalabFundPartyName(tx.party)) return tx;
    const fixed: Transaction = {
      ...tx,
      ledger: 'fund',
      counterparty: tx.counterparty ?? (isCustomerAccountName(tx.party) ? tx.party : undefined),
      party: getFundAccountName('halabFleilat'),
    };
    changed.push(fixed);
    return fixed;
  });
  return { transactions: next, changed };
}

export function filterTransactions(
  transactions: Transaction[],
  fundId: FundId,
  opts?: { date?: string; status?: TransactionStatus; ledger?: TransactionLedger },
): Transaction[] {
  return transactions.filter(tx => {
    if (tx.fundId !== fundId) return false;
    const ledger = tx.ledger ?? 'fund';
    if (opts?.ledger && ledger !== opts.ledger) return false;
    if (!opts?.ledger && ledger !== 'fund') return false;
    if (ledger === 'fund' && !isHalabFleilatFund(fundId) && !isFundPartyForLedger(tx.party, fundId)) return false;
    if (opts?.date && tx.date !== opts.date) return false;
    if (opts?.status && tx.status !== opts.status) return false;
    return true;
  });
}

/** تبديل: العملة المدفوعة تنقص الرصيد، المستلمة تزيده (صندوق وحساب) — مع استثناء السوري على حلب. */
function applyExchangeToCurrencyBalances(
  balances: FundBalances | CustomerBalances,
  paidCurrency: Currency,
  paidAmount: number,
  receivedCurrency: Currency,
  receivedAmount: number,
  fundId?: FundId,
) {
  const paid = { currency: syrianBalanceCurrency(paidCurrency), amount: syrianBalanceAmount(paidCurrency, paidAmount) };
  const received = {
    currency: syrianBalanceCurrency(receivedCurrency),
    amount: syrianBalanceAmount(receivedCurrency, receivedAmount),
  };
  const paidBucket = balances[paid.currency];
  const receivedBucket = balances[received.currency];
  if (paidBucket) {
    paidBucket.payments += paid.amount;
    paidBucket.balance = fundId
      ? computeHalabAwareBalance(paidBucket.receipts, paidBucket.payments, fundId, paid.currency)
      : paidBucket.receipts - paidBucket.payments;
  }
  if (receivedBucket) {
    receivedBucket.receipts += received.amount;
    receivedBucket.balance = fundId
      ? computeHalabAwareBalance(receivedBucket.receipts, receivedBucket.payments, fundId, received.currency)
      : receivedBucket.receipts - receivedBucket.payments;
  }
}

function applyTransactionToFundBalance(balances: FundBalances, tx: Transaction, fundId: FundId) {
  if (tx.kind === 'exchange' && tx.exchangeToCurrency && tx.exchangeToAmount) {
    applyExchangeToCurrencyBalances(
      balances,
      tx.currency,
      tx.amount,
      tx.exchangeToCurrency,
      tx.exchangeToAmount,
      fundId,
    );
    return;
  }

  const currency = syrianBalanceCurrency(tx.currency);
  const amount = syrianBalanceAmount(tx.currency, tx.amount);
  const bucket = balances[currency];
  if (!bucket) return;
  if (tx.kind === 'receipt') {
    bucket.receipts += amount;
  } else {
    bucket.payments += amount;
  }
  bucket.balance = computeHalabAwareBalance(bucket.receipts, bucket.payments, fundId, currency);
}

function applyTransactionToCustomerBalance(balances: CustomerBalances, tx: Transaction) {
  if (tx.kind === 'exchange' && tx.exchangeToCurrency && tx.exchangeToAmount) {
    applyExchangeToCurrencyBalances(
      balances,
      tx.currency,
      tx.amount,
      tx.exchangeToCurrency,
      tx.exchangeToAmount,
    );
    return;
  }

  const currency = syrianBalanceCurrency(tx.currency);
  const amount = syrianBalanceAmount(tx.currency, tx.amount);
  const bucket = balances[currency];
  if (!bucket) return;
  if (tx.kind === 'receipt') {
    bucket.receipts += amount;
  } else {
    bucket.payments += amount;
  }
  bucket.balance = bucket.receipts - bucket.payments;
}

export function computeBalances(transactions: Transaction[], fundId: FundId): FundBalances {
  const balances = emptyBalances();
  const posted = filterTransactions(transactions, fundId, { status: 'posted', ledger: 'fund' });
  for (const tx of posted) applyTransactionToFundBalance(balances, tx, fundId);
  return balances;
}

/** رصيد الصندوق لو اعتُمدت كل العمليات المعلّقة */
export function computeProjectedFundBalances(transactions: Transaction[], fundId: FundId): FundBalances {
  const balances = emptyBalances();
  const fundTxs = filterTransactions(transactions, fundId, { ledger: 'fund' }).filter(
    tx => tx.status === 'posted' || tx.status === 'pending',
  );
  for (const tx of fundTxs) applyTransactionToFundBalance(balances, tx, fundId);
  return balances;
}

export function isFundPartyForLedger(party: string, fundId: FundId): boolean {
  const trimmed = party.trim();
  if (fundId === 'halabFleilat') return isHalabFundPartyName(trimmed);
  return trimmed === getFundAccountName(fundId);
}

export function transactionAffectsAccountView(
  tx: Transaction,
  fundId: FundId,
  accountName: string,
  _allTransactions?: Transaction[],
): boolean {
  if (tx.fundId !== fundId) return false;
  if (isHalabLinkedAccountName(accountName) && isHalabFleilatFund(fundId)) {
    const ledger = tx.ledger ?? 'fund';
    return ledger === 'fund' && isHalabFundPartyName(tx.party);
  }
  const ledger = tx.ledger ?? 'fund';
  if (ledger === 'account' && tx.party === accountName) return true;
  return false;
}

export function filterAccountViewTransactions(
  transactions: Transaction[],
  fundId: FundId,
  accountName: string,
): Transaction[] {
  return transactions.filter(tx => transactionAffectsAccountView(tx, fundId, accountName, transactions));
}

/** حركات حساب مجمّع عبر عدة صناديق */
export function filterMergedAccountTransactions(
  transactions: Transaction[],
  summary: Pick<CustomerSummary, 'name' | 'aliases' | 'fundIds' | 'fundId'>,
): Transaction[] {
  const fundIds = summary.fundIds ?? (summary.fundId ? [summary.fundId] : []);
  if (!fundIds.length) return [];

  const names = new Set<string>(summary.aliases ?? []);
  names.add(summary.name);

  const seen = new Set<string>();
  const out: Transaction[] = [];

  for (const fundId of fundIds) {
    for (const name of names) {
      for (const tx of filterAccountViewTransactions(transactions, fundId, name)) {
        if (!seen.has(tx.id)) {
          seen.add(tx.id);
          out.push(tx);
        }
      }
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export function computeAccountBalances(
  transactions: Transaction[],
  fundId: FundId,
  accountName: string,
): CustomerBalances {
  if (isHalabLinkedAccountName(accountName) && isHalabFleilatFund(fundId)) {
    return { ...computeBalances(transactions, fundId) } as CustomerBalances;
  }
  const balances = emptyCustomerBalances();
  const posted = transactions.filter(
    tx => tx.status === 'posted'
      && transactionAffectsAccountView(tx, fundId, accountName, transactions),
  );
  for (const tx of posted) applyTransactionToCustomerBalance(balances, tx);
  return balances;
}

export function isAccountInFund(customer: Customer, fundId: FundId): boolean {
  return customer.fundId === fundId || (customer.sharedFundIds?.includes(fundId) ?? false);
}

export function accountFundScope(homeFundId: FundId, sharedFundIds?: FundId[]): Set<FundId> {
  return new Set([homeFundId, ...(sharedFundIds ?? [])]);
}

export function findCustomerForAccount(
  customers: Customer[],
  name: string,
  fundId: FundId,
): Customer | undefined {
  const trimmed = name.trim();
  return customers.find(c => c.name === trimmed && isAccountInFund(c, fundId));
}

/** حسابات هذا الصندوق + الحسابات المشتركة معه */
export function getAvailableAccountNames(customers: Customer[], fundId: FundId): string[] {
  const names = new Set<string>();
  if (isHalabFleilatFund(fundId)) {
    names.add(getFundAccountName(fundId));
  }
  for (const c of customers) {
    if (!isCustomerAccountName(c.name)) continue;
    if (isAccountInFund(c, fundId)) names.add(c.name.trim());
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'ar'));
}

export function accountExistsInFund(
  customers: Customer[],
  fundId: FundId,
  name: string,
  excludeCustomerId?: string,
): boolean {
  const trimmed = name.trim();
  if (!isCustomerAccountName(trimmed)) return false;
  return customers.some(c => (
    c.id !== excludeCustomerId
    && c.name === trimmed
    && isAccountInFund(c, fundId)
  ));
}

/** تحديث اسم الحساب في الحركات المرتبطة */
export function applyCustomerRename(
  transactions: Transaction[],
  oldName: string,
  newName: string,
  homeFundId: FundId,
  sharedFundIds?: FundId[],
): { transactions: Transaction[]; changed: Transaction[] } {
  const scope = accountFundScope(homeFundId, sharedFundIds);
  const changed: Transaction[] = [];
  const updated = transactions.map(tx => {
    if (!scope.has(tx.fundId)) return tx;
    let next = tx;
    if ((tx.ledger ?? 'fund') === 'account' && tx.party === oldName) {
      next = { ...next, party: newName };
    }
    if ((tx.ledger ?? 'fund') === 'fund' && tx.counterparty === oldName) {
      next = { ...next, counterparty: newName };
    }
    if (next !== tx) changed.push(next);
    return next;
  });
  return { transactions: updated, changed };
}

/** نقل الحساب بين الصناديق/المراكز — يحدّث fundId للحركات المرتبطة */
export function inferAccountTransactionFund(
  transactions: Transaction[],
  accountName: string,
  hintFundId?: FundId,
): FundId {
  const trimmed = accountName.trim();
  const counts = new Map<FundId, number>();
  for (const tx of transactions) {
    if ((tx.ledger ?? 'fund') === 'account' && tx.party === trimmed) {
      counts.set(tx.fundId, (counts.get(tx.fundId) ?? 0) + 1);
    }
  }
  if (!counts.size) return hintFundId ?? CENTERS_FUND_ID;
  if (hintFundId && counts.has(hintFundId)) return hintFundId;
  let best = hintFundId ?? CENTERS_FUND_ID;
  let bestCount = 0;
  for (const [fid, count] of counts) {
    if (count > bestCount) {
      best = fid;
      bestCount = count;
    }
  }
  return best;
}

export function applyCustomerFundMove(
  transactions: Transaction[],
  accountName: string,
  oldFundId: FundId,
  newFundId: FundId,
): { transactions: Transaction[]; changed: Transaction[] } {
  if (oldFundId === newFundId) return { transactions, changed: [] };
  const trimmed = accountName.trim();
  const changed: Transaction[] = [];
  const movedParentIds = new Set<string>();

  let updated = transactions.map(tx => {
    if (tx.fundId !== oldFundId) return tx;
    const ledger = tx.ledger ?? 'fund';
    const affectsAccount = ledger === 'account' && tx.party === trimmed;
    const affectsCounterparty = ledger === 'fund' && tx.counterparty === trimmed;
    if (!affectsAccount && !affectsCounterparty) return tx;
    const next = { ...tx, fundId: newFundId };
    changed.push(next);
    if (affectsAccount) movedParentIds.add(tx.id);
    return next;
  });

  updated = updated.map(tx => {
    if (tx.fundId !== oldFundId) return tx;
    if (!tx.feeSourceId || !movedParentIds.has(tx.feeSourceId)) return tx;
    const next = { ...tx, fundId: newFundId };
    changed.push(next);
    return next;
  });

  return { transactions: updated, changed };
}

/** تجهيز سجل الحساب بعد النقل — إزالة الصندوق الجديد من المشاركة */
export function prepareCustomerFundMove(customer: Customer, newFundId: FundId): Customer {
  const shared = customer.sharedFundIds?.filter(id => id !== newFundId);
  return {
    ...customer,
    fundId: newFundId,
    sharedFundIds: shared?.length ? shared : undefined,
  };
}

export function isCustomerAccountName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (isHalabLinkedAccountName(trimmed)) return true;
  if (isFundAccountName(trimmed)) return false;
  return true;
}

export function buildAccountSummaries(
  transactions: Transaction[],
  customers: Customer[],
  fundId: FundId,
): CustomerSummary[] {
  const names = new Set<string>();
  const relevantCustomers = customers.filter(c => isAccountInFund(c, fundId));

  if (isHalabFleilatFund(fundId)) {
    names.add(getFundAccountName(fundId));
  }

  for (const c of relevantCustomers) {
    if (isCustomerAccountName(c.name)) names.add(c.name.trim());
  }
  for (const feeAccount of ALL_FEE_ACCOUNTS) names.add(feeAccount);
  for (const tx of transactions) {
    if (
      (tx.ledger ?? 'fund') === 'account'
      && tx.fundId === fundId
      && isCustomerAccountName(tx.party)
    ) {
      names.add(tx.party.trim());
    }
  }

  const summaries = [...names].sort((a, b) => a.localeCompare(b, 'ar')).map(name => {
    const balances = computeAccountBalances(transactions, fundId, name);
    const hasActivity = CURRENCIES.some(c => {
      const b = balances[c.id];
      return b && (b.receipts !== 0 || b.payments !== 0 || b.balance !== 0);
    });
    const customer = findCustomerForAccount(customers, name, fundId)
      ?? relevantCustomers.find(c => c.name === name);
    return {
      name,
      customerId: customer?.id,
      accountNumber: customer?.accountNumber,
      fundId,
      sharedFundIds: customer?.sharedFundIds,
      reconciliation: customer?.reconciliation,
      balances,
      hasActivity,
    };
  });

  const halabAccountName = isHalabFleilatFund(fundId) ? getFundAccountName(fundId) : null;
  return summaries.filter(s => (
    s.hasActivity
    || s.customerId
    || isFeeAccountName(s.name)
    || (halabAccountName !== null && s.name === halabAccountName)
  ));
}

/** حسابات الزبائن من كل الصناديق — دمج الحسابات بنفس الاسم */
export function buildCustomerAccountsAcrossFunds(
  transactions: Transaction[],
  customers: Customer[],
  boxFundIds: FundId[],
): CustomerSummary[] {
  const all: CustomerSummary[] = [];
  for (const id of boxFundIds) {
    all.push(...buildAccountSummaries(transactions, customers, id));
  }
  return mergeAccountSummaries(all);
}

/** @deprecated use computeAccountBalances */
export function computeCustomerBalances(
  transactions: Transaction[],
  fundId: FundId,
  party: string,
): CustomerBalances {
  return computeAccountBalances(transactions, fundId, party);
}

/** @deprecated use buildAccountSummaries */
export function buildCustomerSummaries(
  transactions: Transaction[],
  customers: Customer[],
  fundId: FundId,
): CustomerSummary[] {
  return buildAccountSummaries(transactions, customers, fundId);
}

/** حركات حساب غير مطابقة (بعد تاريخ المطابقة أو كلها إذا لم تُطابق) */
export function countUnreconciledAccountTransactions(
  transactions: Transaction[],
  fundId: FundId,
  accountName: string,
  throughDate?: string,
): number {
  const posted = filterAccountViewTransactions(transactions, fundId, accountName)
    .filter(t => t.status === 'posted');
  if (!throughDate) return posted.length;
  return posted.filter(t => t.date > throughDate).length;
}

export function accountNeedsReconciliation(
  transactions: Transaction[],
  fundId: FundId,
  summary: CustomerSummary,
): boolean {
  const fundIds = summary.fundIds ?? (summary.fundId ? [summary.fundId] : [fundId]);
  const names = [...new Set([summary.name, ...(summary.aliases ?? [])])];
  const through = summary.reconciliation?.throughDate;

  for (const fid of fundIds) {
    for (const name of names) {
      if (countUnreconciledAccountTransactions(transactions, fid, name, through) > 0) {
        return true;
      }
    }
  }
  return false;
}

/** عدد الحسابات بحاجة مطابقة عبر المراكز + زبائن مجمّعين */
export function countAccountsNeedingReconciliation(
  transactions: Transaction[],
  customers: Customer[],
  boxFundIds: FundId[],
  includeCenters: boolean,
): number {
  let count = 0;
  if (includeCenters) {
    const centerSummaries = buildAccountSummaries(transactions, customers, 'marakiz');
    count += centerSummaries.filter(s => accountNeedsReconciliation(transactions, 'marakiz', s)).length;
  }
  if (boxFundIds.length > 0) {
    const merged = buildCustomerAccountsAcrossFunds(transactions, customers, boxFundIds);
    const fallbackFund = boxFundIds[0];
    count += merged.filter(s => accountNeedsReconciliation(transactions, s.fundId ?? fallbackFund, s)).length;
  }
  return count;
}

export function createTransaction(input: Omit<Transaction, 'id' | 'createdAt'>): Transaction {
  const normalized = normalizeSyrianTransaction(input);
  return {
    ...normalized,
    ledger: normalized.ledger ?? 'fund',
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
}

export function createAccountTransaction(input: Omit<Transaction, 'id' | 'createdAt' | 'ledger'>): Transaction {
  return createTransaction({ ...input, ledger: 'account' });
}

type TxBase = Omit<Transaction, 'id' | 'createdAt' | 'currency' | 'amount' | 'batchId'>;

export function createTransactionBatch(
  base: TxBase,
  items: { currency: Currency; amount: number }[],
  opts?: { batchId?: string; linkId?: string },
): Transaction[] {
  if (!items.length) return [];
  const batchId = opts?.batchId ?? (items.length > 1 ? crypto.randomUUID() : undefined);
  const createdAt = new Date().toISOString();
  return items.map(item => {
    const normalized = normalizeSyrianTransaction({ ...base, ...item });
    return {
      ...normalized,
      ledger: normalized.ledger ?? 'fund',
      id: crypto.randomUUID(),
      createdAt,
      batchId,
      linkId: opts?.linkId,
      currency: normalized.currency!,
      amount: normalized.amount!,
    };
  });
}

/** حركة صندوق + حركة حساب مربوطة */
function createLinkedFundAccountPair(
  shared: Omit<TxBase, 'kind' | 'party' | 'ledger' | 'counterparty'>,
  accountName: string,
  fundKind: TransactionKind,
  accountKind: TransactionKind,
  items: { currency: Currency; amount: number }[],
  counterparty?: string,
  customerFees?: (ParsedFee | undefined)[],
  accountFundId?: FundId,
): Transaction[] {
  const linkId = crypto.randomUUID();
  const fundFundId = shared.fundId;
  const acctFundId = accountFundId ?? fundFundId;
  const fundAccount = getFundAccountName(fundFundId);
  const multi = items.length > 1;
  const accountItems = adjustAccountItemsForFees(items, customerFees ?? []);

  const fundTxs = createTransactionBatch(
    {
      ...shared,
      fundId: fundFundId,
      ledger: 'fund',
      party: fundAccount,
      kind: fundKind,
      counterparty: counterparty || accountName,
    },
    items,
    { batchId: multi ? crypto.randomUUID() : undefined, linkId },
  );

  const accountTxs = createTransactionBatch(
    {
      ...shared,
      fundId: acctFundId,
      ledger: 'account',
      party: accountName,
      kind: accountKind,
      counterparty: undefined,
      fee: undefined,
      feeMode: undefined,
      feeRate: undefined,
      feeSide: undefined,
      feeAmount: undefined,
      feeCurrency: undefined,
      extraFee: undefined,
      extraFeeMode: undefined,
      extraFeeRate: undefined,
      extraFeeSide: undefined,
      extraFeeAmount: undefined,
      extraFeeCurrency: undefined,
    },
    accountItems,
    { batchId: multi ? crypto.randomUUID() : undefined, linkId },
  );

  return [...fundTxs, ...accountTxs];
}

/** حركة صندوق + حركة حساب — من منظور الصندوق */
export function createLinkedFundAccountOperation(
  shared: Omit<TxBase, 'kind' | 'party' | 'ledger' | 'counterparty'>,
  accountName: string,
  direction: 'in' | 'out',
  items: { currency: Currency; amount: number }[],
  counterparty?: string,
  accountDirection?: 'in' | 'out',
  customerFees?: (ParsedFee | undefined)[],
): Transaction[] {
  const fundKind = inferKind(direction, false);
  const accountKind = inferKind(accountDirection ?? direction, false);
  return createLinkedFundAccountPair(
    shared,
    accountName,
    fundKind,
    accountKind,
    items,
    counterparty || accountName,
    customerFees,
  );
}

/** حركة حساب + صندوق — الاتجاه من منظور الحساب */
export function createLinkedAccountFundOperation(
  shared: Omit<TxBase, 'kind' | 'party' | 'ledger' | 'counterparty'>,
  accountName: string,
  accountDirection: 'in' | 'out',
  items: { currency: Currency; amount: number }[],
  fundDirection?: 'in' | 'out',
  customerFees?: (ParsedFee | undefined)[],
  accountFundId?: FundId,
): Transaction[] {
  const accountKind = inferKind(accountDirection, false);
  const fundKind = inferKind(fundDirection ?? accountDirection, false);
  return createLinkedFundAccountPair(
    shared,
    accountName,
    fundKind,
    accountKind,
    items,
    accountName,
    customerFees,
    accountFundId,
  );
}

/** ترحيل بين حسابين — حركات حساب فقط (بدون صندوق أو مرآة حلب) */
function clearCustomerFeeFields<T extends Omit<TxBase, 'kind' | 'party' | 'ledger' | 'counterparty'>>(
  base: T,
): T {
  return {
    ...base,
    fee: undefined,
    feeMode: undefined,
    feeRate: undefined,
    feeSide: undefined,
    feeAmount: undefined,
    feeCurrency: undefined,
    extraFee: undefined,
    extraFeeMode: undefined,
    extraFeeRate: undefined,
    extraFeeSide: undefined,
    extraFeeAmount: undefined,
    extraFeeCurrency: undefined,
  };
}

export function createLinkedAccountAccountOperation(
  shared: Omit<TxBase, 'kind' | 'party' | 'ledger' | 'counterparty'>,
  fromAccount: string,
  toAccount: string,
  fromDirection: 'in' | 'out',
  items: { currency: Currency; amount: number }[],
  toDirection?: 'in' | 'out',
  customerFees?: (ParsedFee | undefined)[],
): Transaction[] {
  const targetDirection = toDirection ?? (fromDirection === 'in' ? 'out' : 'in');
  const linkId = crypto.randomUUID();
  const multi = items.length > 1;
  const fromKind = inferKind(fromDirection, false);
  const toKind = inferKind(targetDirection, false);
  const fromItems = adjustAccountItemsForFees(items, customerFees ?? []);

  const fromTxs = createTransactionBatch(
    {
      ...shared,
      ledger: 'account',
      party: fromAccount,
      kind: fromKind,
      counterparty: toAccount,
    },
    fromItems,
    { batchId: multi ? crypto.randomUUID() : undefined, linkId },
  );

  const toTxs = createTransactionBatch(
    clearCustomerFeeFields({
      ...shared,
      ledger: 'account',
      party: toAccount,
      kind: toKind,
      counterparty: fromAccount,
    }),
    items,
    { batchId: multi ? crypto.randomUUID() : undefined, linkId },
  );

  return [...fromTxs, ...toTxs];
}

/** تبديل داخل الحساب مع نفس التبديل على الصندوق */
export function createLinkedAccountFundExchange(
  shared: Omit<TxBase, 'kind' | 'party' | 'ledger' | 'counterparty' | 'currency' | 'amount'>,
  accountName: string,
  fromCurrency: Currency,
  fromAmount: number,
  toCurrency: Currency,
  rate: number,
  toAmount: number,
  accountFundId?: FundId,
): Transaction[] {
  const linkId = crypto.randomUUID();
  const fundFundId = shared.fundId;
  const acctFundId = accountFundId ?? fundFundId;
  const fundAccount = getFundAccountName(fundFundId);
  const base = {
    ...shared,
    kind: 'exchange' as const,
    currency: fromCurrency,
    amount: fromAmount,
    exchangeToCurrency: toCurrency,
    exchangeRate: rate,
    exchangeToAmount: toAmount,
    linkId,
  };

  return [
    createTransaction({
      ...base,
      fundId: fundFundId,
      ledger: 'fund',
      party: fundAccount,
      counterparty: accountName,
    }),
    createTransaction({
      ...base,
      fundId: acctFundId,
      ledger: 'account',
      party: accountName,
      counterparty: undefined,
      intermediary: undefined,
      fee: undefined,
    }),
  ];
}

/** تحويل بين صندوقين — صادر من المصدر ووارد على الوجهة */
export function createLinkedFundTransfer(
  shared: Omit<TxBase, 'kind' | 'party' | 'ledger' | 'counterparty' | 'currency' | 'amount'>,
  fromFundId: FundId,
  toFundId: FundId,
  currency: Currency,
  amount: number,
): Transaction[] {
  const linkId = crypto.randomUUID();
  const fromAccount = getFundAccountName(fromFundId);
  const toAccount = getFundAccountName(toFundId);

  return [
    createTransaction({
      ...shared,
      fundId: fromFundId,
      ledger: 'fund',
      party: fromAccount,
      kind: 'payment',
      currency,
      amount,
      counterparty: `→ ${getFund(toFundId).name}`,
      linkId,
      note: shared.note ?? `تحويل إلى ${getFund(toFundId).name}`,
    }),
    createTransaction({
      ...shared,
      fundId: toFundId,
      ledger: 'fund',
      party: toAccount,
      kind: 'receipt',
      currency,
      amount,
      counterparty: `← ${getFund(fromFundId).name}`,
      linkId,
      note: shared.note ?? `تحويل من ${getFund(fromFundId).name}`,
    }),
  ];
}

export function getOperationGroupIds(transactions: Transaction[], id: string): string[] {
  const target = transactions.find(tx => tx.id === id);
  if (!target) return [id];

  if (target.linkId) {
    const linked = transactions.filter(tx => tx.linkId === target.linkId).map(tx => tx.id);
    if (linked.length) return linked;
  }

  if (target.batchId) {
    const batched = transactions.filter(tx => tx.batchId === target.batchId).map(tx => tx.id);
    if (batched.length) return batched;
  }

  return [id];
}

function collectOrphanFeesForAccountDelete(
  transactions: Transaction[],
  id: string,
  groupIds: string[],
): string[] {
  const target = transactions.find(t => t.id === id);
  if (!target || target.ledger !== 'account' || isFeeAccountName(target.party)) return [];

  const hasFundPeer = target.linkId
    ? transactions.some(t => t.linkId === target.linkId && t.ledger === 'fund')
    : false;
  if (hasFundPeer) return [];

  const groupTxs = transactions.filter(t => groupIds.includes(t.id) && t.ledger === 'account');
  const feeAccounts = [resolveFeeAccountName(target.party), SHAMEL_FEE_ACCOUNT];
  const dates = new Set(groupTxs.map(t => t.date));

  return transactions
    .filter(t =>
      isAutoFeeTransaction(t)
      && feeAccounts.includes(t.party)
      && t.feeSourceId
      && !transactions.some(f => f.id === t.feeSourceId)
      && dates.has(t.date),
    )
    .map(t => t.id);
}

/** حذف العملية + المربوطة بالحساب + أجور «لنا» التلقائية */
export function getDeletionGroupIds(transactions: Transaction[], id: string): string[] {
  const groupIds = getOperationGroupIds(transactions, id);
  const feeIds = collectAutoFeeRemovalIds(transactions, groupIds);
  const orphanFeeIds = collectOrphanFeesForAccountDelete(transactions, id, groupIds);
  return [...new Set([...groupIds, ...feeIds, ...orphanFeeIds])];
}

/** عمليات حساب/أجور بقيت بعد حذف حركة الصندوق المربوطة */
export function findOrphanedLinkedTransactionIds(transactions: Transaction[]): string[] {
  const fundLinkIds = new Set(
    transactions.filter(t => t.ledger === 'fund' && t.linkId).map(t => t.linkId!),
  );
  const fundIds = new Set(transactions.filter(t => t.ledger === 'fund').map(t => t.id));
  const orphanIds: string[] = [];

  for (const tx of transactions) {
    if (tx.ledger !== 'account') continue;
    if (tx.linkId && !fundLinkIds.has(tx.linkId)) {
      const linkGroup = transactions.filter(t => t.linkId === tx.linkId);
      const isAccountOnlyTransfer = linkGroup.length >= 2
        && linkGroup.every(t => t.ledger === 'account');
      if (!isAccountOnlyTransfer) orphanIds.push(tx.id);
      continue;
    }
    if (isAutoFeeTransaction(tx) && tx.feeSourceId && !fundIds.has(tx.feeSourceId)) {
      orphanIds.push(tx.id);
    }
  }

  return [...new Set(orphanIds)];
}

export function purgeOrphanedLinkedTransactions(transactions: Transaction[]): {
  transactions: Transaction[];
  removeIds: string[];
} {
  const removeIds = findOrphanedLinkedTransactionIds(transactions);
  if (!removeIds.length) return { transactions, removeIds };
  const drop = new Set(removeIds);
  return {
    transactions: transactions.filter(tx => !drop.has(tx.id)),
    removeIds,
  };
}

/** يحدّث حركات الحساب القديمة لتنسخ «بيد» من الصندوق المربوط */
export function backfillLinkedAccountFields(transactions: Transaction[]): {
  transactions: Transaction[];
  changed: Transaction[];
} {
  const fundByLink = new Map<string, Transaction>();
  for (const t of transactions) {
    if (t.ledger === 'fund' && t.linkId && t.intermediary?.trim()) {
      if (!fundByLink.has(t.linkId)) fundByLink.set(t.linkId, t);
    }
  }

  const changed: Transaction[] = [];
  const next = transactions.map(tx => {
    if (tx.ledger !== 'account' || tx.feeSourceId || isFeeAccountName(tx.party)) return tx;
    if (tx.intermediary?.trim() || !tx.linkId) return tx;
    const fund = fundByLink.get(tx.linkId);
    if (!fund?.intermediary) return tx;
    const updated = { ...tx, intermediary: fund.intermediary };
    changed.push(updated);
    return updated;
  });

  return { transactions: next, changed };
}

export function collectAutoFeeRemovalIds(
  transactions: Transaction[],
  deletedIds: string[],
): string[] {
  const leadIds = new Set<string>();
  for (const id of deletedIds) {
    for (const opId of getOperationGroupIds(transactions, id)) {
      const tx = transactions.find(t => t.id === opId);
      if (!tx || tx.kind === 'exchange') continue;
      if (tx.ledger === 'fund') {
        leadIds.add(tx.id);
        continue;
      }
      if (
        tx.ledger === 'account'
        && !isFeeAccountName(tx.party)
        && !tx.feeSourceId
      ) {
        const opIds = getOperationGroupIds(transactions, tx.id);
        const hasFund = transactions.some(t => opIds.includes(t.id) && t.ledger === 'fund');
        if (!hasFund) leadIds.add(tx.id);
      }
    }
  }
  return transactions
    .filter(t => isAutoFeeTransaction(t) && t.feeSourceId && leadIds.has(t.feeSourceId))
    .map(t => t.id);
}

/** @deprecated use getOperationGroupIds */
export function getTransactionGroupIds(transactions: Transaction[], id: string): string[] {
  return getOperationGroupIds(transactions, id);
}

export function appendEditHistory(
  tx: Transaction,
  summary: string,
  actor?: { displayName: string; email: string },
): Transaction {
  const record: TransactionEditRecord = {
    at: new Date().toISOString(),
    byName: actor?.displayName,
    byEmail: actor?.email,
    summary,
  };
  return {
    ...tx,
    lastEditedAt: record.at,
    lastEditedByName: actor?.displayName,
    lastEditedByEmail: actor?.email,
    editHistory: [...(tx.editHistory ?? []), record],
  };
}

export function transactionMatchesQuery(tx: Transaction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const textParts = [
    tx.party,
    tx.counterparty,
    tx.note,
    tx.intermediary,
    tx.createdByName,
    tx.createdByEmail,
    tx.halabRemittance?.companyName,
    tx.halabRemittance?.publicNumber,
    tx.halabRemittance?.sender,
    tx.halabRemittance?.beneficiary,
    tx.halabRemittance?.beneficiaryPhone,
    tx.halabRemittance?.deliveryAmount,
    tx.halabRemittance?.destination,
    tx.halabRemittance?.transferDate,
    String(tx.amount),
    tx.exchangeToAmount != null ? String(tx.exchangeToAmount) : '',
  ];
  const hay = textParts.filter(Boolean).join(' ').toLowerCase();
  if (hay.includes(q)) return true;

  const qDigits = q.replace(/[^\d]/g, '');
  if (qDigits) {
    const digitHay = [tx.amount, tx.exchangeToAmount, tx.halabRemittance?.deliveryAmount]
      .filter(v => v != null && v !== '')
      .map(v => String(v).replace(/[^\d]/g, ''))
      .filter(Boolean);
    if (digitHay.some(d => d.includes(qDigits))) return true;
  }

  return false;
}

export function applyTransactionFilters(
  transactions: Transaction[],
  filters: TransactionFilters,
): Transaction[] {
  const q = filters.query?.trim();
  return transactions.filter(tx => {
    if (filters.dateFrom && tx.date < filters.dateFrom) return false;
    if (filters.dateTo && tx.date > filters.dateTo) return false;
    if (filters.currency && tx.currency !== filters.currency) return false;
    if (q && !transactionMatchesQuery(tx, q)) return false;
    return true;
  });
}

/** يوسّع النتائج لتشمل كل بنود الدفعة أو العملية المرتبطة */
export function expandFilteredTransactions(
  all: Transaction[],
  filtered: Transaction[],
): Transaction[] {
  const ids = new Set<string>();
  for (const tx of filtered) {
    for (const id of getOperationGroupIds(all, tx.id)) ids.add(id);
  }
  return all.filter(tx => ids.has(tx.id));
}

export type TransactionDisplayItem =
  | { kind: 'single'; transaction: Transaction }
  | { kind: 'batch'; transactions: Transaction[] };

export type PendingAmountRow = {
  currency: Currency;
  receipts: number;
  payments: number;
};

/** مجموع مبالغ العمليات بقيد الانتظار — حسب العملة */
export function summarizePendingAmounts(transactions: Transaction[]): PendingAmountRow[] {
  const totals = new Map<Currency, { receipts: number; payments: number }>();

  function bump(currency: Currency, field: 'receipts' | 'payments', amount: number) {
    if (!amount) return;
    const resolved = syrianBalanceCurrency(currency);
    const resolvedAmount = syrianBalanceAmount(currency, amount);
    const bucket = totals.get(resolved) ?? { receipts: 0, payments: 0 };
    bucket[field] += resolvedAmount;
    totals.set(resolved, bucket);
  }

  for (const tx of transactions) {
    if (tx.kind === 'exchange' && tx.exchangeToCurrency && tx.exchangeToAmount != null) {
      bump(tx.currency, 'payments', tx.amount);
      bump(tx.exchangeToCurrency, 'receipts', tx.exchangeToAmount);
      continue;
    }
    if (tx.kind === 'receipt') bump(tx.currency, 'receipts', tx.amount);
    else if (tx.kind === 'payment') bump(tx.currency, 'payments', tx.amount);
  }

  return CURRENCIES
    .map(c => {
      const t = totals.get(c.id);
      if (!t || (t.receipts === 0 && t.payments === 0)) return null;
      return { currency: c.id, receipts: t.receipts, payments: t.payments };
    })
    .filter((row): row is PendingAmountRow => row != null);
}

/** يعرض العمليات متعددة البنود كبطاقة واحدة */
export function groupTransactionsForDisplay(transactions: Transaction[]): TransactionDisplayItem[] {
  const seen = new Set<string>();
  const items: TransactionDisplayItem[] = [];

  for (const tx of transactions) {
    if (!tx.batchId) {
      items.push({ kind: 'single', transaction: tx });
      continue;
    }
    if (seen.has(tx.batchId)) continue;
    seen.add(tx.batchId);
    const group = transactions.filter(t => t.batchId === tx.batchId);
    items.push(group.length > 1 ? { kind: 'batch', transactions: group } : { kind: 'single', transaction: tx });
  }

  return items;
}

/** معرّفات العمليات المعلّقة بالصندوق — عملية واحدة لكل بطاقة عرض */
export function getPendingFundOperationLeads(transactions: Transaction[], fundId: FundId): string[] {
  const pending = filterTransactions(transactions, fundId, { status: 'pending' });
  return groupTransactionsForDisplay(pending).map(item =>
    item.kind === 'batch' ? item.transactions[0].id : item.transaction.id,
  );
}

export function createCustomer(input: Omit<Customer, 'id' | 'createdAt'>): Customer {
  return {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
}

export function inferKind(
  direction: 'in' | 'out',
  isExchange: boolean,
): TransactionKind {
  if (isExchange) return 'exchange';
  return direction === 'in' ? 'receipt' : 'payment';
}

export function formatExecutor(tx: Transaction): string | undefined {
  if (tx.createdByName) return tx.createdByName;
  if (tx.createdByEmail) return tx.createdByEmail;
  return undefined;
}

export function exchangeRateLabel(paid: Currency, received: Currency): string {
  if (paid === 'USD' || received === 'USD') {
    const other = paid === 'USD' ? received : paid;
    if (INVERSE_RATE_CURRENCIES.has(other)) {
      return `1 $ = ؟ ${getCurrencySymbol(other)}`;
    }
    if (isWeightCurrency(other)) {
      return `1 غ ${getCurrencyLabel(other)} = ؟ $`;
    }
    return `1 ${getCurrencyLabel(other)} = ؟ $`;
  }
  const fromLabel = isWeightCurrency(paid) ? `1 غ ${getCurrencyLabel(paid)}` : `1 ${getCurrencyLabel(paid)}`;
  const toLabel = isWeightCurrency(received) ? `غ ${getCurrencyLabel(received)}` : getCurrencyLabel(received);
  return `${fromLabel} = ؟ ${toLabel}`;
}

/** الريت المعروض للمستخدم — بالدولار عند وجود USD في التبديل */
export function internalRateToDisplayRate(
  paid: Currency,
  received: Currency,
  internalRate: number,
): number {
  if (!internalRate) return 0;
  if (paid === 'USD' || received === 'USD') {
    const other = paid === 'USD' ? received : paid;
    if (INVERSE_RATE_CURRENCIES.has(other)) {
      return paid === 'USD' ? internalRate : 1 / internalRate;
    }
    return paid === 'USD' ? 1 / internalRate : internalRate;
  }
  return internalRate;
}

/** تحويل ريت العرض إلى الريت الداخلي (استلام = دفع × ريت) */
export function displayRateToInternalRate(
  paid: Currency,
  received: Currency,
  displayRate: number,
): number {
  if (!displayRate) return 0;
  if (paid === 'USD' || received === 'USD') {
    const other = paid === 'USD' ? received : paid;
    if (INVERSE_RATE_CURRENCIES.has(other)) {
      return paid === 'USD' ? displayRate : 1 / displayRate;
    }
    return paid === 'USD' ? 1 / displayRate : displayRate;
  }
  return displayRate;
}

export function formatExchangeRateDisplay(
  paid: Currency,
  received: Currency,
  internalRate: number,
): string {
  const display = internalRateToDisplayRate(paid, received, internalRate);
  if (!display) return '—';
  if (paid === 'USD' || received === 'USD') {
    const other = paid === 'USD' ? received : paid;
    if (INVERSE_RATE_CURRENCIES.has(other)) {
      return `1 $ = ${formatAmount(display, other)} ${getCurrencySymbol(other)}`;
    }
    if (isWeightCurrency(other)) {
      return `1 غ ${getCurrencyLabel(other)} = ${formatAmount(display, 'USD')} $`;
    }
    return `1 ${getCurrencyLabel(other)} = ${formatAmount(display, 'USD')} $`;
  }
  const fromLabel = isWeightCurrency(paid) ? `1 غ ${getCurrencyLabel(paid)}` : `1 ${getCurrencyLabel(paid)}`;
  const toSym = isWeightCurrency(received) ? `غ ${getCurrencyLabel(received)}` : getCurrencySymbol(received);
  return `${fromLabel} = ${formatAmount(display, received)} ${toSym}`;
}
