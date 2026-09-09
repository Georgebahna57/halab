import { Loader2, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BOX_FUNDS, isMoneyOutFund } from '../config';
import {
  getHalabUsdBalanceBreakdown,
  halabBalanceSideLabel,
} from '../lib/halabBalance';
import { computeBalances, formatValueWithUnit, getFundTransactionStats } from '../lib/utils';
import type { AppState } from '../types';

interface Props {
  appState: AppState;
  onRepairHalab?: () => Promise<void>;
}

export function FundDataDiagnostic({ appState, onRepairHalab }: Props) {
  const [busy, setBusy] = useState(false);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);

  const rows = BOX_FUNDS.map(fund => ({
    fund,
    stats: getFundTransactionStats(appState.transactions, fund.id),
  }));

  const moneyOut = rows.find(r => r.fund.id === 'moneyOut');
  const moneyOutBalances = moneyOut
    ? computeBalances(appState.transactions, 'moneyOut')
    : null;
  const usdBreakdown = useMemo(
    () => getHalabUsdBalanceBreakdown(appState.transactions),
    [appState.transactions],
  );

  const moneyOutHidden = rows
    .filter(r => isMoneyOutFund(r.fund.id))
    .reduce((sum, r) => sum + (r.stats.fundLedger - r.stats.visibleFundLedger), 0);

  async function runRepair() {
    if (!onRepairHalab) return;
    setBusy(true);
    setRepairMsg(null);
    try {
      await onRepairHalab();
      setRepairMsg('تم تطبيق إصلاح موني آوت — حدّث الرصيد');
    } catch {
      setRepairMsg('فشل الإصلاح');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
      <p className="mb-2 font-medium text-rose-200">تشخيص البيانات — كل الصناديق</p>
      <p className="mb-3 text-[10px] text-slate-500">
        إذا «المخزّن» أكبر من «الظاهر»، الحركات موجودة لكن كانت مخفية — يُصلَح تلقائياً عند التحميل.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="py-1 pr-2 font-medium">الصندوق</th>
              <th className="py-1 px-1 font-medium">المخزّن</th>
              <th className="py-1 px-1 font-medium">صندوق</th>
              <th className="py-1 px-1 font-medium">حساب</th>
              <th className="py-1 px-1 font-medium">انتظار</th>
              <th className="py-1 px-1 font-medium">ظاهر</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ fund, stats }) => (
              <tr key={fund.id} className="border-t border-slate-800/80 text-slate-300">
                <td className="py-1.5 pr-2 font-medium">{fund.shortName}</td>
                <td className="py-1.5 px-1 tabular-nums">{stats.total}</td>
                <td className="py-1.5 px-1 tabular-nums">{stats.fundLedger}</td>
                <td className="py-1.5 px-1 tabular-nums">{stats.accountLedger}</td>
                <td className="py-1.5 px-1 tabular-nums">{stats.pending}</td>
                <td className="py-1.5 px-1 tabular-nums">{stats.visibleFundLedger}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {moneyOutHidden > 0 && (
        <p className="mt-3 text-xs text-amber-300">
          وُجد {moneyOutHidden} حركة صندوق لموني آوت كانت مخفية — يفترض أن تظهر بعد التحديث.
        </p>
      )}

      {moneyOutBalances && (
        <div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-slate-300 space-y-1">
          <p className="font-medium text-sky-200">موني آوت</p>
          {moneyOutBalances.USD.balance !== 0 && (
            <p>
              دولار: {formatValueWithUnit(Math.abs(moneyOutBalances.USD.balance), 'USD')} · {halabBalanceSideLabel('USD', moneyOutBalances.USD.balance)}
            </p>
          )}
          {moneyOutBalances.SYP.balance !== 0 && (
            <p>
              سوري: {formatValueWithUnit(Math.abs(moneyOutBalances.SYP.balance), 'SYP')} · {halabBalanceSideLabel('SYP', moneyOutBalances.SYP.balance)}
            </p>
          )}
          <div className="mt-2 border-t border-slate-700/60 pt-2 text-[10px] text-slate-500 space-y-0.5">
            <p>افتتاح دولار: {formatValueWithUnit(usdBreakdown.openingBalance, 'USD')} ({usdBreakdown.openingTxCount} حركة)</p>
            <p>عمليات: {formatValueWithUnit(usdBreakdown.opsDelta, 'USD')}</p>
          </div>
        </div>
      )}

      {onRepairHalab && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void runRepair()}
          className="mt-3 flex items-center gap-2 rounded-xl border border-sky-500/40 px-3 py-2 text-xs text-sky-200 hover:bg-sky-500/10 disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
          إصلاح أرصدة موني آوت الآن
        </button>
      )}
      {repairMsg && (
        <p className="mt-2 text-xs text-emerald-400">{repairMsg}</p>
      )}
    </div>
  );
}
