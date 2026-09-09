import { Info, MessageCircle, Users, Wallet, X } from 'lucide-react';
import { useMemo } from 'react';
import { CURRENCIES, getFund } from '../config';
import { isBalanceDisplayCurrency } from '../lib/syrianCurrency';
import { formatAmount, formatDateAr, getFundTransactionStats } from '../lib/utils';
import type { Customer, FundBalances, FundId, Transaction } from '../types';

interface Props {
  fundId: FundId;
  balances: FundBalances;
  customers: Customer[];
  transactions: Transaction[];
  billsCount: number;
  todayPostedCount: number;
  whatsappDestinations?: string[];
  date: string;
  onClose: () => void;
}

export function FundDetailsModal({
  fundId,
  balances,
  customers,
  transactions,
  billsCount,
  todayPostedCount,
  whatsappDestinations,
  date,
  onClose,
}: Props) {
  const fund = getFund(fundId);
  const stats = useMemo(
    () => getFundTransactionStats(transactions, fundId),
    [transactions, fundId],
  );

  const accountCount = useMemo(
    () => customers.filter(c => c.fundId === fundId || c.sharedFundIds?.includes(fundId)).length,
    [customers, fundId],
  );

  const activeBalances = CURRENCIES.filter(c => {
    if (!isBalanceDisplayCurrency(c.id)) return false;
    return balances[c.id].balance !== 0;
  });

  const whatsappList = (whatsappDestinations ?? []).filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl border border-slate-600 bg-slate-900 shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-slate-700 p-4">
          <div>
            <div className="flex items-center gap-2" style={{ color: fund.accent }}>
              <Info size={16} />
              <h3 className="font-semibold">تفاصيل {fund.name}</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">{formatDateAr(date)}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          <div
            className="rounded-xl border px-3 py-2.5"
            style={{ borderColor: `${fund.accent}55`, background: `${fund.accent}11` }}
          >
            <p className="text-sm font-semibold" style={{ color: fund.accent }}>{fund.name}</p>
            <p className="text-xs text-slate-400">الاختصار: {fund.shortName}</p>
          </div>

          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-400">
              <Wallet size={13} />
              الأرصدة الحالية
            </p>
            {activeBalances.length === 0 ? (
              <p className="text-xs text-slate-500">لا يوجد رصيد</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {activeBalances.map(c => {
                  const bal = balances[c.id].balance;
                  const positive = bal > 0;
                  return (
                    <div
                      key={c.id}
                      className={`rounded-xl border px-2.5 py-2 text-xs ${
                        positive
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                      }`}
                    >
                      <p className="text-slate-400">{c.label}</p>
                      <p className="mt-0.5 font-semibold tabular-nums">
                        {formatAmount(Math.abs(bal), c.id)} {c.symbol}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 px-3 py-2.5">
              <p className="flex items-center gap-1 text-slate-500">
                <Users size={12} />
                الحسابات
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-200">{accountCount}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 px-3 py-2.5">
              <p className="text-slate-500">فواتير</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-200">{billsCount}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 px-3 py-2.5">
              <p className="text-slate-500">حركات اليوم</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-200">{todayPostedCount}</p>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
              <p className="text-amber-300/80">قيد الانتظار</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-amber-200">{stats.pending}</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-3 py-2.5 text-xs text-slate-500">
            <p>إجمالي الحركات المخزّنة: <span className="tabular-nums text-slate-300">{stats.total}</span></p>
            <p className="mt-1">حركات الصندوق: <span className="tabular-nums text-slate-300">{stats.fundLedger}</span></p>
            <p className="mt-1">حركات الحسابات: <span className="tabular-nums text-slate-300">{stats.accountLedger}</span></p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-3 py-2.5 text-xs">
            <p className="flex items-center gap-1.5 font-medium text-slate-400">
              <MessageCircle size={13} />
              واتساب الصندوق
            </p>
            {whatsappList.length > 0 ? (
              <ul className="mt-2 space-y-1 text-slate-300">
                {whatsappList.map(dest => (
                  <li key={dest} className="tabular-nums" dir="ltr">{dest}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-slate-500">لم يُضبط — من الإدارة</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
