import { Loader2, Scale, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CURRENCIES, BOX_FUNDS } from '../config';
import {
  buildOpeningBalanceTransactions,
  computeOpeningBalanceCurrent,
  openingBalanceTargetLabel,
  type OpeningBalanceLine,
  type OpeningBalanceSide,
} from '../lib/openingBalance';
import { formatValueWithUnit, todayIso } from '../lib/utils';
import type { AppState, Currency, FundId, Transaction } from '../types';

interface LineDraft {
  id: string;
  currency: Currency;
  amount: string;
  side: OpeningBalanceSide;
}

interface Props {
  appState: AppState;
  onAdd: (tx: Transaction[]) => void | Promise<void>;
}

function newLine(currency: Currency = 'USD', amount = '', side: OpeningBalanceSide = 'ours'): LineDraft {
  return { id: crypto.randomUUID(), currency, amount, side };
}

function parseLines(drafts: LineDraft[]): OpeningBalanceLine[] {
  return drafts
    .map(line => ({
      currency: line.currency,
      amount: Number(line.amount.replace(/,/g, '')) || 0,
      side: line.side,
    }))
    .filter(line => line.amount > 0);
}

function assetLabel(currency: Currency): string {
  const c = CURRENCIES.find(x => x.id === currency);
  return c ? `${c.label} (${c.symbol})` : currency;
}

export function OpeningBalanceSection({ appState, onAdd }: Props) {
  const [fundId, setFundId] = useState<FundId>('moneyOut');
  const [date, setDate] = useState(todayIso());
  const [lines, setLines] = useState<LineDraft[]>([
    newLine('SYP', '343211200', 'ours'),
    newLine('USD', '245542', 'theirs'),
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const targetLabel = openingBalanceTargetLabel(fundId);

  const currentBalances = useMemo(
    () => computeOpeningBalanceCurrent(appState.transactions, fundId),
    [appState.transactions, fundId],
  );

  const parsed = useMemo(() => parseLines(lines), [lines]);

  const preview = useMemo(
    () => buildOpeningBalanceTransactions(fundId, date, parsed, currentBalances),
    [fundId, date, parsed, currentBalances],
  );

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines(prev => prev.map(line => (line.id === id ? { ...line, ...patch } : line)));
  }

  async function submit() {
    setError(null);
    setSuccess(null);
    if (!parsed.length) {
      setError('أدخل مبلغاً واحداً على الأقل');
      return;
    }
    if (!preview.length) {
      setError('الرصيد الحالي يطابق المطلوب — لا حاجة لحركة جديدة');
      return;
    }
    setBusy(true);
    try {
      await onAdd(preview);
      setSuccess(`تم تسجيل ${preview.length} حركة افتتاحية`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل التسجيل');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Scale size={18} className="text-sky-400" />
        <div>
          <p className="font-medium text-slate-200">رصيد افتتاحي</p>
          <p className="text-xs text-slate-500">
            سجّل الرصيد قبل البرنامج — لنا = زايد، لهم = ناقص
            {fundId === 'moneyOut' && (
              <span className="block mt-1 text-sky-400/90">
                حلب: دفع يزيد النقص واستلام ينقصه (سوري ودولار) — الرصيد = دفع − استلام
            <span className="block mt-0.5 text-slate-500">دولار لهم: افتتاح «استلام» · سوري لنا: افتتاح «دفع»</span>
              </span>
            )}
          </p>
        </div>
      </div>

      <p className="mb-3 rounded-lg bg-slate-900/50 px-3 py-2 text-xs text-slate-400">
        يُسجَّل على: <span className="font-medium text-sky-300">{targetLabel}</span>
      </p>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs text-slate-500">الصندوق</span>
          <select
            value={fundId}
            onChange={e => setFundId(e.target.value as FundId)}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-sm"
          >
            {BOX_FUNDS.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-slate-500">تاريخ الرصيد</span>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-sm"
          />
        </label>
      </div>

      <div className="space-y-2">
        {lines.map(line => {
          const current = currentBalances[line.currency]?.balance ?? 0;
          return (
            <div key={line.id} className="rounded-xl bg-slate-900/50 p-2 space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[140px] flex-1 space-y-1">
                  <span className="text-[10px] text-slate-500">العملة</span>
                  <select
                    value={line.currency}
                    onChange={e => updateLine(line.id, { currency: e.target.value as Currency })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
                  >
                    {CURRENCIES.map(c => (
                      <option key={c.id} value={c.id}>{assetLabel(c.id)}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-[120px] flex-[2] space-y-1">
                  <span className="text-[10px] text-slate-500">المبلغ</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    value={line.amount}
                    onChange={e => updateLine(line.id, { amount: e.target.value })}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm tabular-nums"
                  />
                </label>
                <label className="min-w-[100px] space-y-1">
                  <span className="text-[10px] text-slate-500">الاتجاه</span>
                  <select
                    value={line.side}
                    onChange={e => updateLine(line.id, { side: e.target.value as OpeningBalanceSide })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
                  >
                    <option value="ours">لنا</option>
                    <option value="theirs">لهم</option>
                  </select>
                </label>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines(prev => prev.filter(l => l.id !== line.id))}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-rose-400"
                    aria-label="حذف السطر"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              {current !== 0 && (
                <p className="text-[10px] text-slate-500">
                  الرصيد الحالي: {formatValueWithUnit(current, line.currency)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setLines(prev => [...prev, newLine()])}
        className="mt-2 flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
      >
        <Plus size={12} /> عملة أخرى
      </button>

      {preview.length > 0 && (
        <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900/40 p-3 text-xs text-slate-400 space-y-1">
          <p className="font-medium text-slate-300">سيُسجَّل:</p>
          {preview.map(tx => (
            <p key={tx.id}>
              {tx.kind === 'receipt' ? 'وارد' : 'صادر'}{' '}
              {formatValueWithUnit(tx.amount, tx.currency)}
              {tx.party ? ` · ${tx.party}` : ''}
            </p>
          ))}
        </div>
      )}

      {(error || success) && (
        <p className={`mt-3 text-xs ${error ? 'text-rose-400' : 'text-emerald-400'}`}>
          {error ?? success}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !preview.length}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : null}
        تسجيل الرصيد الافتتاحي
      </button>
    </div>
  );
}
