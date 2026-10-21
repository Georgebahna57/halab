import { getFundAccountName } from '../config';
import { quoteAmountFor, roundMoney, type QuoteCurrency, type ShopSide } from './exchangeBoard';
import { createLinkedFundTransfer, createTransaction, todayIso } from './utils';
import type { CashWindow } from './cashWindows';
import type { Currency, FundBalances, FundId, HalabRemittanceFields, Transaction } from '../types';

function fundExchange(input: {
  fundId: FundId;
  party: string;
  paidCurrency: Currency;
  paidAmount: number;
  receivedCurrency: Currency;
  receivedAmount: number;
  note: string;
  counterparty?: string;
  halabRemittance?: HalabRemittanceFields;
}): Transaction {
  const paidAmount = roundMoney(input.paidAmount, input.paidCurrency);
  const receivedAmount = roundMoney(input.receivedAmount, input.receivedCurrency);
  return createTransaction({
    fundId: input.fundId,
    ledger: 'fund',
    date: todayIso(),
    currency: input.paidCurrency,
    kind: 'exchange',
    amount: paidAmount,
    party: input.party,
    counterparty: input.counterparty,
    note: input.note,
    status: 'posted',
    exchangeToCurrency: input.receivedCurrency,
    exchangeToAmount: receivedAmount,
    exchangeRate: paidAmount > 0 ? receivedAmount / paidAmount : 0,
    halabRemittance: input.halabRemittance,
  });
}

export function buildShopExchange(input: {
  window: CashWindow;
  side: ShopSide;
  traded: Currency;
  quote: QuoteCurrency;
  tradedAmount: number;
  rate: number;
  customerName?: string;
}): Transaction {
  const quoteCurrency: Currency = input.quote === 'SYP' ? 'SYP' : 'USD';
  const quoteAmount = quoteAmountFor(input.traded, input.quote, input.tradedAmount, input.rate);
  const shopBuys = input.side === 'buy';
  const paidCurrency = shopBuys ? quoteCurrency : input.traded;
  const paidAmount = shopBuys ? quoteAmount : roundMoney(input.tradedAmount, input.traded);
  const receivedCurrency = shopBuys ? input.traded : quoteCurrency;
  const receivedAmount = shopBuys ? roundMoney(input.tradedAmount, input.traded) : quoteAmount;
  const sideLabel = shopBuys ? 'شراء' : 'مبيع';
  return fundExchange({
    fundId: input.window.id,
    party: getFundAccountName(input.window.id),
    paidCurrency,
    paidAmount,
    receivedCurrency,
    receivedAmount,
    counterparty: input.customerName,
    note: `${sideLabel} ${input.traded} مقابل ${quoteCurrency} — سعر ${input.rate}`,
  });
}

export function buildFeed(input: {
  fromId: FundId;
  toId: FundId;
  currency: Currency;
  amount: number;
  note: string;
}): Transaction[] {
  return createLinkedFundTransfer(
    { fundId: input.fromId, date: todayIso(), status: 'posted', note: input.note },
    input.fromId,
    input.toId,
    input.currency,
    roundMoney(input.amount, input.currency),
  );
}

export function buildCashMovement(input: {
  window: CashWindow;
  direction: 'in' | 'out';
  currency: Currency;
  amount: number;
  customerName?: string;
  note?: string;
  halabRemittance?: HalabRemittanceFields;
}): Transaction {
  const incoming = input.direction === 'in';
  return createTransaction({
    fundId: input.window.id,
    ledger: 'fund',
    date: todayIso(),
    currency: input.currency,
    kind: incoming ? 'receipt' : 'payment',
    amount: roundMoney(input.amount, input.currency),
    party: getFundAccountName(input.window.id),
    counterparty: input.customerName,
    note: input.note,
    status: 'posted',
    halabRemittance: input.halabRemittance,
  });
}

export function balanceOf(balances: FundBalances, currency: Currency): number {
  return balances[currency]?.balance ?? 0;
}
