import { getCurrencyLabel, isMoneyOutFund } from '../config';
import { formatValueWithUnit, todayIso } from './utils';
import type { Currency, HalabRemittanceFields, Transaction } from '../types';

export const HALAB_REMITTANCE_LABELS: { key: keyof HalabRemittanceFields; label: string }[] = [
  { key: 'transferDate', label: 'تاريخ الحوالة' },
  { key: 'companyName', label: 'اسم الشركة' },
  { key: 'publicNumber', label: 'الرقم العام' },
  { key: 'sender', label: 'المرسل' },
  { key: 'beneficiary', label: 'المستفيد' },
  { key: 'beneficiaryPhone', label: 'هاتف المستفيد' },
  { key: 'deliveryAmount', label: 'مبلغ التسليم' },
  { key: 'destination', label: 'الوجهة' },
];

export const HALAB_REMITTANCE_EDITOR_FIELDS = HALAB_REMITTANCE_LABELS.filter(
  ({ key }) => key !== 'deliveryAmount',
);

interface HalabRemittanceMeta {
  td?: string;
  cn?: string;
  pn?: string;
  sn?: string;
  bf?: string;
  bp?: string;
  da?: string;
  dc?: string;
  ds?: string;
}

export interface HalabDeliverySource {
  amount: number;
  currency: Currency;
}

export function defaultHalabRemittanceFields(): HalabRemittanceFields {
  return {
    transferDate: todayIso(),
    companyName: '',
    publicNumber: '',
    sender: '',
    beneficiary: '',
    beneficiaryPhone: '',
    deliveryAmount: '',
    deliveryCurrency: undefined,
    destination: '',
  };
}

export function halabRemittanceFromTransaction(tx: Transaction | undefined): HalabRemittanceFields {
  if (!tx?.halabRemittance) return defaultHalabRemittanceFields();
  return { ...defaultHalabRemittanceFields(), ...tx.halabRemittance };
}

export function resolveHalabDeliverySource(input: {
  isExchange?: boolean;
  exchangeReceivedAmount?: number;
  exchangeReceivedCurrency?: Currency;
  lines?: { amount: number; currency: Currency }[];
}): HalabDeliverySource | null {
  if (input.isExchange && input.exchangeReceivedAmount && input.exchangeReceivedCurrency) {
    return { amount: input.exchangeReceivedAmount, currency: input.exchangeReceivedCurrency };
  }
  const first = input.lines?.[0];
  if (first && first.amount > 0) return first;
  return null;
}

export function formatHalabDeliveryDisplay(fields: HalabRemittanceFields): string | undefined {
  const raw = fields.deliveryAmount?.trim();
  if (!raw) return undefined;
  const amount = Number(raw.replace(/,/g, ''));
  if (!amount) return undefined;
  const currency = fields.deliveryCurrency ?? 'USD';
  return `${formatValueWithUnit(amount, currency)} (${getCurrencyLabel(currency)})`;
}

export function deliveryDiffersFromSource(
  fields: HalabRemittanceFields,
  source: HalabDeliverySource | null | undefined,
): boolean {
  if (!source) return !!fields.deliveryAmount?.trim() || !!fields.deliveryCurrency;
  const amount = fields.deliveryAmount?.trim();
  if (!amount) return false;
  const currency = fields.deliveryCurrency ?? source.currency;
  return amount !== String(source.amount) || currency !== source.currency;
}

export function applyHalabDeliverySource(
  fields: HalabRemittanceFields,
  source: HalabDeliverySource | null | undefined,
): HalabRemittanceFields {
  if (!source) return fields;
  return {
    ...fields,
    deliveryAmount: String(source.amount),
    deliveryCurrency: source.currency,
  };
}

export function encodeHalabRemittanceMeta(fields: HalabRemittanceFields | undefined): HalabRemittanceMeta | undefined {
  if (!fields || !hasHalabRemittanceContent(fields)) return undefined;
  const meta: HalabRemittanceMeta = {};
  if (fields.transferDate?.trim()) meta.td = fields.transferDate.trim();
  if (fields.companyName?.trim()) meta.cn = fields.companyName.trim();
  if (fields.publicNumber?.trim()) meta.pn = fields.publicNumber.trim();
  if (fields.sender?.trim()) meta.sn = fields.sender.trim();
  if (fields.beneficiary?.trim()) meta.bf = fields.beneficiary.trim();
  if (fields.beneficiaryPhone?.trim()) meta.bp = fields.beneficiaryPhone.trim();
  if (fields.deliveryAmount?.trim()) meta.da = fields.deliveryAmount.trim();
  if (fields.deliveryCurrency) meta.dc = fields.deliveryCurrency;
  if (fields.destination?.trim()) meta.ds = fields.destination.trim();
  return Object.keys(meta).length ? meta : undefined;
}

export function decodeHalabRemittanceMeta(meta?: HalabRemittanceMeta): HalabRemittanceFields | undefined {
  if (!meta) return undefined;
  const fields: HalabRemittanceFields = {
    transferDate: meta.td ?? '',
    companyName: meta.cn ?? '',
    publicNumber: meta.pn ?? '',
    sender: meta.sn ?? '',
    beneficiary: meta.bf ?? '',
    beneficiaryPhone: meta.bp ?? '',
    deliveryAmount: meta.da ?? '',
    deliveryCurrency: meta.dc as Currency | undefined,
    destination: meta.ds ?? '',
  };
  return hasHalabRemittanceContent(fields) ? fields : undefined;
}

export function hasHalabRemittanceContent(fields: HalabRemittanceFields): boolean {
  if (fields.deliveryAmount?.trim()) return true;
  return HALAB_REMITTANCE_EDITOR_FIELDS.some(({ key }) => fields[key]?.trim());
}

export function stampHalabRemittance<T extends Transaction | Transaction[]>(
  payload: T,
  fields: HalabRemittanceFields | undefined,
): T {
  const apply = (tx: Transaction) => {
    if (!isMoneyOutFund(tx.fundId)) return tx;
    if (!fields || !hasHalabRemittanceContent(fields)) {
      const { halabRemittance: _, ...rest } = tx;
      return rest as Transaction;
    }
    const compact: HalabRemittanceFields = {};
    for (const { key } of HALAB_REMITTANCE_EDITOR_FIELDS) {
      const v = fields[key]?.trim();
      if (v) compact[key as Exclude<keyof HalabRemittanceFields, 'deliveryCurrency'>] = v;
    }
    if (fields.deliveryAmount?.trim()) compact.deliveryAmount = fields.deliveryAmount.trim();
    if (fields.deliveryCurrency) compact.deliveryCurrency = fields.deliveryCurrency;
    return { ...tx, halabRemittance: compact };
  };
  if (Array.isArray(payload)) return payload.map(apply) as T;
  return apply(payload) as T;
}

export function halabRemittanceSummaryLines(fields: HalabRemittanceFields | undefined): string[] {
  if (!fields) return [];
  const lines = HALAB_REMITTANCE_EDITOR_FIELDS
    .map(({ key, label }) => {
      const value = fields[key]?.trim();
      return value ? `${label}: ${value}` : null;
    })
    .filter((line): line is string => !!line);
  const delivery = formatHalabDeliveryDisplay(fields);
  if (delivery) lines.push(`مبلغ التسليم: ${delivery}`);
  return lines;
}

export type { HalabRemittanceMeta };
