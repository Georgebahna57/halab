import { CURRENCIES } from '../config';
import { supabase } from './supabase';
import type { Currency } from '../types';

/** عملات التداول النقدي — بدون الليرة الجديدة لأنها تُحوَّل للقديمة عند الحفظ */
export const TRADE_CURRENCIES: Currency[] = CURRENCIES
  .filter(c => c.kind === 'money' && c.id !== 'NSYP')
  .map(c => c.id);

export interface RatePair {
  buy: number;
  sell: number;
}

/** buy = سعر شراء المحل للعملة، sell = سعر مبيع المحل */
export interface ExchangeBoard {
  /** كم ليرة سورية لكل 1 من العملة */
  againstSyp: Partial<Record<Currency, RatePair>>;
  /** كم دولار لكل 1 من العملة (ما عدا الدولار والليرة) */
  againstUsd: Partial<Record<Currency, RatePair>>;
}

const STORAGE_KEY = 'halab-exchange-board-v1';
const SETTINGS_KEY = 'exchange_board';

export function emptyExchangeBoard(): ExchangeBoard {
  return { againstSyp: {}, againstUsd: {} };
}

function pairFrom(raw: unknown): RatePair | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const buy = Number((raw as RatePair).buy);
  const sell = Number((raw as RatePair).sell);
  const pair: RatePair = {
    buy: Number.isFinite(buy) && buy > 0 ? buy : 0,
    sell: Number.isFinite(sell) && sell > 0 ? sell : 0,
  };
  if (!pair.buy && !pair.sell) return undefined;
  return pair;
}

export function normalizeExchangeBoard(raw: unknown): ExchangeBoard {
  const board = emptyExchangeBoard();
  if (!raw || typeof raw !== 'object') return board;
  const source = raw as Partial<ExchangeBoard>;
  for (const currency of TRADE_CURRENCIES) {
    if (currency === 'SYP') continue;
    const syp = pairFrom(source.againstSyp?.[currency]);
    if (syp) board.againstSyp[currency] = syp;
    if (currency === 'USD') continue;
    const usd = pairFrom(source.againstUsd?.[currency]);
    if (usd) board.againstUsd[currency] = usd;
  }
  return board;
}

function loadLocal(): ExchangeBoard {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyExchangeBoard();
    return normalizeExchangeBoard(JSON.parse(raw));
  } catch {
    return emptyExchangeBoard();
  }
}

function saveLocal(board: ExchangeBoard) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
}

export async function fetchExchangeBoard(): Promise<ExchangeBoard> {
  const local = loadLocal();
  if (!supabase) return local;

  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();

  if (error || !data?.value) return local;
  const board = normalizeExchangeBoard(data.value);
  saveLocal(board);
  return board;
}

export async function saveExchangeBoard(board: ExchangeBoard): Promise<void> {
  const normalized = normalizeExchangeBoard(board);
  saveLocal(normalized);
  if (!supabase) return;

  const { error } = await supabase.from('app_settings').upsert({
    key: SETTINGS_KEY,
    value: normalized,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export type QuoteCurrency = 'SYP' | 'USD';
export type ShopSide = 'buy' | 'sell';

export function currenciesForQuote(quote: QuoteCurrency): Currency[] {
  if (quote === 'SYP') return TRADE_CURRENCIES.filter(c => c !== 'SYP');
  return TRADE_CURRENCIES.filter(c => c !== 'USD');
}

/** السعر المعتمد: شراء أو مبيع. الليرة مقابل الدولار تُقرأ من سعر الدولار بالليرة. */
export function rateFor(
  board: ExchangeBoard,
  traded: Currency,
  quote: QuoteCurrency,
  side: ShopSide,
): number {
  if (traded === 'SYP' && quote === 'USD') {
    const pair = board.againstSyp.USD;
    return pair?.[side] ?? 0;
  }
  const table = quote === 'SYP' ? board.againstSyp : board.againstUsd;
  return table[traded]?.[side] ?? 0;
}

/**
 * مبلغ عملة التسعير المقابل لمبلغ العملة المتداوَلة.
 * الليرة مقابل الدولار: السعر = ليرة لكل دولار، فالمبلغ بالدولار = الليرات ÷ السعر.
 */
export function quoteAmountFor(
  traded: Currency,
  quote: QuoteCurrency,
  tradedAmount: number,
  rate: number,
): number {
  if (!tradedAmount || !rate) return 0;
  const raw = traded === 'SYP' && quote === 'USD'
    ? tradedAmount / rate
    : tradedAmount * rate;
  const quoteCurrency: Currency = quote === 'SYP' ? 'SYP' : 'USD';
  return roundMoney(raw, quoteCurrency);
}

export function roundMoney(amount: number, currency: Currency): number {
  if (currency === 'SYP' || currency === 'LBP') return Math.round(amount);
  return Math.round(amount * 100) / 100;
}
