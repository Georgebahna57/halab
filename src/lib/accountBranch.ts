import { CENTERS_FUND_ID, DEFAULT_FUND_ID, isBoxFund, isMoneyOutFund } from '../config';
import type { AccountBranchId, Customer, CustomerSummary, Fund, FundId, Transaction } from '../types';
import { mergeAccountSummaries } from './accountMerge';
import {
  applyCustomerFundMove,
  buildAccountSummaries,
  buildCustomerAccountsAcrossFunds,
  findCustomerForAccount,
} from './utils';

export const ACCOUNT_BRANCH_LABELS: Record<AccountBranchId, string> = {
  centers: 'مراكز',
  customers: 'زبائن',
};

/** صندوق الحركات الداخلي لقسم الزبائن — لا يُعرض كتبعيّة للحساب */
export function getCustomersLedgerFundId(boxFunds: Fund[]): FundId {
  const f = boxFunds.find(b => b.id !== CENTERS_FUND_ID && !isMoneyOutFund(b.id));
  return f?.id ?? DEFAULT_FUND_ID;
}

export function customerBoxFundIds(boxFundIds: FundId[]): FundId[] {
  return boxFundIds.filter(id => id !== CENTERS_FUND_ID && !isMoneyOutFund(id));
}

export function getCustomerAccountBranch(customer: Customer): AccountBranchId {
  if (customer.accountBranch) return customer.accountBranch;
  if (customer.fundId === CENTERS_FUND_ID) return 'centers';
  return 'customers';
}

export function inferAccountBranch(
  transactions: Transaction[],
  accountName: string,
  customer?: Customer,
): AccountBranchId {
  if (customer) return getCustomerAccountBranch(customer);

  const trimmed = accountName.trim();
  let onCenters = false;
  let onCustomers = false;

  for (const tx of transactions) {
    if ((tx.ledger ?? 'fund') !== 'account' || tx.party !== trimmed) continue;
    if (tx.fundId === CENTERS_FUND_ID) onCenters = true;
    else if (isBoxFund(tx.fundId) && !isMoneyOutFund(tx.fundId)) onCustomers = true;
  }

  if (onCenters && !onCustomers) return 'centers';
  if (onCustomers) return 'customers';
  return 'centers';
}

export function branchLedgerFundId(
  branch: AccountBranchId,
  customersLedgerFundId: FundId,
): FundId {
  return branch === 'centers' ? CENTERS_FUND_ID : customersLedgerFundId;
}

export function accountExistsInBranch(
  customers: Customer[],
  branch: AccountBranchId,
  name: string,
  excludeCustomerId?: string,
): boolean {
  const trimmed = name.trim();
  return customers.some(c => (
    c.id !== excludeCustomerId
    && c.name === trimmed
    && getCustomerAccountBranch(c) === branch
  ));
}

export function prepareCustomerForBranch(
  customer: Customer,
  branch: AccountBranchId,
  customersLedgerFundId: FundId,
): Customer {
  return {
    ...customer,
    fundId: branchLedgerFundId(branch, customersLedgerFundId),
    accountBranch: branch,
    sharedFundIds: undefined,
  };
}

/** نقل الحساب بين مراكز ↔ زبائن — يجمع الحركات من كل الصناديق ثم ينقلها */
export function applyAccountBranchMove(
  transactions: Transaction[],
  accountName: string,
  toBranch: AccountBranchId,
  customersLedgerFundId: FundId,
): { transactions: Transaction[]; changed: Transaction[] } {
  const targetFundId = branchLedgerFundId(toBranch, customersLedgerFundId);
  const trimmed = accountName.trim();
  const sourceFunds = new Set<FundId>();

  for (const tx of transactions) {
    if ((tx.ledger ?? 'fund') === 'account' && tx.party === trimmed) {
      sourceFunds.add(tx.fundId);
    }
  }

  let updated = transactions;
  const changedMap = new Map<string, Transaction>();

  for (const sourceFund of sourceFunds) {
    if (sourceFund === targetFundId) continue;
    const result = applyCustomerFundMove(updated, trimmed, sourceFund, targetFundId);
    updated = result.transactions;
    for (const tx of result.changed) changedMap.set(tx.id, tx);
  }

  return { transactions: updated, changed: [...changedMap.values()] };
}

export function findCustomerForSummary(
  summary: CustomerSummary,
  customers: Customer[],
): Customer | undefined {
  if (summary.customerId) {
    const byId = customers.find(c => c.id === summary.customerId);
    if (byId) return byId;
  }
  const fundIds = summary.fundIds ?? (summary.fundId ? [summary.fundId] : []);
  for (const fid of fundIds) {
    const c = findCustomerForAccount(customers, summary.name, fid);
    if (c) return c;
  }
  return customers.find(c => c.name === summary.name);
}

function allBoxLedgerFundIds(boxFunds: Fund[]): FundId[] {
  const ids = new Set<FundId>([CENTERS_FUND_ID]);
  for (const id of customerBoxFundIds(boxFunds.map(f => f.id))) ids.add(id);
  return [...ids];
}

/** يضيف كل الصناديق التي فيها حركات حساب فعلية */
export function enrichSummaryFundScope(
  transactions: Transaction[],
  summary: CustomerSummary,
  allowedFundIds: FundId[],
): CustomerSummary {
  const trimmed = summary.name.trim();
  const ids = new Set<FundId>(
    summary.fundIds ?? (summary.fundId ? [summary.fundId] : []),
  );

  for (const tx of transactions) {
    if (
      (tx.ledger ?? 'fund') === 'account'
      && tx.party === trimmed
      && allowedFundIds.includes(tx.fundId)
    ) {
      ids.add(tx.fundId);
    }
  }

  const fundIds = [...ids];
  if (!fundIds.length) return summary;

  return {
    ...summary,
    fundIds,
    fundId: summary.fundId ?? fundIds[0],
    merged: fundIds.length > 1 || (summary.aliases?.length ?? 0) > 1 || summary.merged,
  };
}

function enrichSummariesFundScope(
  transactions: Transaction[],
  summaries: CustomerSummary[],
  boxFunds: Fund[],
): CustomerSummary[] {
  const allowed = allBoxLedgerFundIds(boxFunds);
  return summaries.map(s => enrichSummaryFundScope(transactions, s, allowed));
}

/** حسابات قسم واحد (مراكز أو زبائن) مجمّعة من كل صناديق الصندوق */
export function buildBranchAccountSummaries(
  transactions: Transaction[],
  customers: Customer[],
  branch: AccountBranchId,
  boxFunds: Fund[],
): CustomerSummary[] {
  const boxFundIds = boxFunds.map(f => f.id);
  let summaries: CustomerSummary[] = [];

  if (branch === 'centers') {
    const fundIds = allBoxLedgerFundIds(boxFunds);
    const perFund: CustomerSummary[] = [];
    for (const fid of fundIds) {
      perFund.push(...buildAccountSummaries(transactions, customers, fid));
    }
    summaries = mergeAccountSummaries(perFund);
  } else {
    const ledgerIds = customerBoxFundIds(boxFundIds);
    if (ledgerIds.length > 0) {
      summaries = buildCustomerAccountsAcrossFunds(transactions, customers, ledgerIds);
    }
  }

  return enrichSummariesFundScope(
    transactions,
    summaries.filter(s => {
      const customer = findCustomerForSummary(s, customers);
      return inferAccountBranch(transactions, s.name, customer) === branch;
    }),
    boxFunds,
  );
}

/** كل الحسابات (مراكز + زبائن) من كل الصناديق — للعرض في أي صندوق */
export function buildFundSectionAccountSummaries(
  transactions: Transaction[],
  customers: Customer[],
  boxFunds: Fund[],
  includeCenters: boolean,
): CustomerSummary[] {
  const customersList = buildBranchAccountSummaries(transactions, customers, 'customers', boxFunds);
  const centersList = includeCenters
    ? buildBranchAccountSummaries(transactions, customers, 'centers', boxFunds)
    : [];
  return enrichSummariesFundScope(
    transactions,
    [...centersList, ...customersList].sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    boxFunds,
  );
}

/** ميزان مراجعة / قائمة موحّدة لقسم الحسابات عبر كل الصناديق */
export function buildAccountsSectionSummaries(
  transactions: Transaction[],
  customers: Customer[],
  branch: AccountBranchId,
  boxFunds: Fund[],
): CustomerSummary[] {
  return buildBranchAccountSummaries(transactions, customers, branch, boxFunds);
}
