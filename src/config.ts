import type { Currency, CustomerBalances, Fund, FundBalances, FundId } from './types';

export type AssetKind = 'money' | 'weight';

export interface AssetConfig {
  id: Currency;
  label: string;
  symbol: string;
  kind: AssetKind;
  unit: string;
}

/** الصناديق النقدية الأساسية — كل صندوق يدعم جميع العملات */
export const FUNDS: Fund[] = [
  { id: 'steelMax', name: 'ستيل ماكس', shortName: 'ستيل ماكس', accent: '#f59e0b' },
  { id: 'georgeAbuAyyoun', name: 'جورج ابو عيون', shortName: 'جورج', accent: '#3b82f6' },
  { id: 'moneyOut', name: 'موني آوت', shortName: 'موني آوت', accent: '#e11d48' },
  { id: 'halabJadida', name: 'حلب الجديدة', shortName: 'حلب الجديدة', accent: '#10b981' },
  { id: 'marakiz', name: 'مراكز', shortName: 'مراكز', accent: '#06b6d4' },
];

/** معرّف فرع المراكز — ليس صندوقاً نقدياً */
export const CENTERS_FUND_ID: FundId = 'marakiz';

/** صناديق نقدية فقط (بدون مراكز) */
export const BOX_FUNDS: Fund[] = FUNDS.filter(f => f.id !== CENTERS_FUND_ID);

export const DEFAULT_FUND_ID: FundId = 'steelMax';

export function getFund(id: FundId) {
  return FUNDS.find(f => f.id === id) ?? FUNDS[0];
}

export function isBoxFund(fundId: FundId): boolean {
  return fundId !== CENTERS_FUND_ID;
}

export function isCentersFund(fundId: FundId): boolean {
  return fundId === CENTERS_FUND_ID;
}

export function isMoneyOutFund(fundId: FundId): boolean {
  return fundId === 'moneyOut';
}

/** @deprecated */
export function isHalabFleilatFund(fundId: FundId): boolean {
  return isMoneyOutFund(fundId);
}

export function isMoneyOutLinkedAccountName(name: string): boolean {
  return name.trim() === 'موني آوت';
}

/** @deprecated */
export function isHalabLinkedAccountName(name: string): boolean {
  return isMoneyOutLinkedAccountName(name);
}

export function isMoneyOutFundPartyName(party: string): boolean {
  const trimmed = party.trim();
  return trimmed === 'موني آوت' || trimmed === getFund('moneyOut').name;
}

/** @deprecated */
export function isHalabFundPartyName(party: string): boolean {
  return isMoneyOutFundPartyName(party);
}

export function canRegisterCustomerName(name: string, fundId: FundId): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (isMoneyOutFund(fundId) && isMoneyOutLinkedAccountName(trimmed)) return true;
  return !isFundAccountName(trimmed);
}

export function getFundAccountName(fundId: FundId): string {
  const fund = getFund(fundId);
  if (isMoneyOutFund(fundId)) return 'موني آوت';
  return fund.name;
}

export function defaultCounterpartyForFund(fundId: FundId, accountNames: readonly string[]): string {
  if (!isMoneyOutFund(fundId)) return '';
  const preferred = 'موني آوت';
  return accountNames.includes(preferred) ? preferred : '';
}

const FUND_ACCOUNT_NAMES = new Set(
  FUNDS.flatMap(f => {
    if (f.id === 'moneyOut') return [f.name, 'موني آوت', f.shortName];
    if (f.id === 'marakiz') return [f.name, 'صندوق مراكز'];
    return [f.name, f.shortName];
  }),
);

export function isFundAccountName(name: string): boolean {
  return FUND_ACCOUNT_NAMES.has(name.trim());
}

export const CURRENCIES: AssetConfig[] = [
  { id: 'USD', label: 'دولار أمريكي', symbol: '$', kind: 'money', unit: 'مبلغ' },
  { id: 'EUR', label: 'يورو', symbol: '€', kind: 'money', unit: 'مبلغ' },
  { id: 'GBP', label: 'جنيه استرليني', symbol: '£', kind: 'money', unit: 'مبلغ' },
  { id: 'CAD', label: 'دولار كندي', symbol: 'C$', kind: 'money', unit: 'مبلغ' },
  { id: 'SAR', label: 'ريال سعودي', symbol: 'ر.س', kind: 'money', unit: 'مبلغ' },
  { id: 'QAR', label: 'ريال قطري', symbol: 'ر.ق', kind: 'money', unit: 'مبلغ' },
  { id: 'KWD', label: 'دينار كويتي', symbol: 'د.ك', kind: 'money', unit: 'مبلغ' },
  { id: 'JOD', label: 'دينار أردني', symbol: 'د.أ', kind: 'money', unit: 'مبلغ' },
  { id: 'AED', label: 'درهم إماراتي', symbol: 'د.إ', kind: 'money', unit: 'مبلغ' },
  { id: 'SYP', label: 'ليرة سورية', symbol: 'ل.س', kind: 'money', unit: 'مبلغ' },
  { id: 'NSYP', label: 'ليرة سورية جديدة', symbol: 'ل.س ج', kind: 'money', unit: 'مبلغ' },
  { id: 'LBP', label: 'ليرة لبنانية', symbol: 'ل.ل.', kind: 'money', unit: 'مبلغ' },
  { id: 'GOLD', label: 'ذهب', symbol: 'غ', kind: 'weight', unit: 'غرام' },
  { id: 'SILVER', label: 'فضة', symbol: 'غ', kind: 'weight', unit: 'غرام' },
];

/** كل الصناديق النقدية تدعم جميع العملات (نقد + ذهب/فضة) */
export function getFundCurrencies(_fundId: FundId): Currency[] {
  return CURRENCIES.map(c => c.id);
}

export function getAsset(currency: Currency) {
  return CURRENCIES.find(c => c.id === currency);
}

export function isWeightCurrency(currency: Currency): boolean {
  return getAsset(currency)?.kind === 'weight';
}

export function getCurrencyLabel(currency: Currency) {
  return getAsset(currency)?.label ?? currency;
}

export function getCurrencySymbol(currency: Currency) {
  return getAsset(currency)?.symbol ?? currency;
}

export function getValueInputLabel(currency: Currency): string {
  const asset = getAsset(currency);
  if (asset?.kind === 'weight') return `الوزن (${asset.unit})`;
  return 'المبلغ';
}

export function emptyBalances(): FundBalances {
  const zero = { receipts: 0, payments: 0, balance: 0 };
  return Object.fromEntries(CURRENCIES.map(c => [c.id, { ...zero }])) as FundBalances;
}

export function emptyCustomerBalances(): CustomerBalances {
  const zero = { receipts: 0, payments: 0, balance: 0 };
  return Object.fromEntries(CURRENCIES.map(c => [c.id, { ...zero }])) as CustomerBalances;
}
