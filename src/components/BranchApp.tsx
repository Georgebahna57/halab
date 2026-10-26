import { useEffect, useMemo, useState } from 'react';
import { Landmark, Loader2, LogOut, Settings } from 'lucide-react';
import { CURRENCIES, TREASURY_FUND_ID, getCurrencyLabel, getCurrencySymbol } from '../config';
import {
  TREASURY_WINDOW,
  WINDOW_CAPABILITIES,
  fetchCashWindows,
  grantWindowAccess,
  saveCashWindows,
  type CashWindow,
  type WindowCapability,
} from '../lib/cashWindows';
import {
  TRADE_CURRENCIES,
  fetchExchangeBoard,
  saveExchangeBoard,
  type ExchangeBoard,
} from '../lib/exchangeBoard';
import {
  fetchBranchMaster,
  saveBranchMaster,
  type BranchCompany,
  type BranchMaster,
  type ShamAccount,
} from '../lib/branchMaster';
import {
  buildCashReturn,
  buildCashTx,
  buildExchangeTx,
  buildOpsTx,
  buildShiftOpen,
  companyPosition,
  editableQuote,
  encodeBranch,
  listBranchOps,
  marketRateLabel,
  openShiftFor,
  paidFromEditableQuote,
  receiptNo,
  referenceTaken,
  shamBalance,
  shiftFrozen,
  type BranchOp,
  type ParsedOp,
} from '../lib/branchModel';
import { balanceOf } from '../lib/deskOps';
import { logAudit } from '../lib/auditLog';
import type { UserProfile } from '../lib/permissions';
import { computeBalances, createCustomer, formatAmount } from '../lib/utils';
import type { Currency, Customer, Transaction } from '../types';

interface Props {
  isAdmin: boolean;
  userId: string;
  displayName: string;
  profiles: UserProfile[];
  transactions: Transaction[];
  customers: Customer[];
  onAddTransactions: (tx: Transaction | Transaction[]) => Promise<void>;
  onUpdateTransaction: (id: string, patch: Partial<Transaction>) => Promise<void>;
  onAddCustomer: (customer: Customer) => Promise<void>;
  onDeleteCustomer: (id: string) => Promise<void>;
  onLogout: () => void;
  onOpenLegacy: () => void;
  onOpenAdmin: () => void;
}

type SectionId = 'daily' | 'treasury' | 'shifts' | 'exchange' | 'remittance' | 'sham' | 'companies' | 'inventory' | 'reports' | 'setup';

interface ReceiptView {
  title: string;
  rows: { label: string; value: string }[];
}

const fieldClass = 'w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-sm';
const labelClass = 'mb-1 block text-[10px] text-slate-400';

function money(amount: number, currency: Currency) {
  return `${formatAmount(Math.abs(amount), currency)} ${getCurrencySymbol(currency)}`;
}

function currencyOptions(list: Currency[]) {
  return list.map(id => {
    const asset = CURRENCIES.find(item => item.id === id);
    return <option key={id} value={id}>{asset ? `${asset.label}` : id}</option>;
  });
}

function printReceipt(receipt: ReceiptView) {
  const rows = receipt.rows.map(row => `<tr><td>${row.label}</td><td>${row.value}</td></tr>`).join('');
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) return;
  popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${receipt.title}</title>
    <style>body{font-family:sans-serif;padding:24px;color:#111}h1{font-size:18px}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #ddd}</style>
    </head><body><h1>${receipt.title}</h1><table>${rows}</table></body></html>`);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function BranchApp(props: Props) {
  const [section, setSection] = useState<SectionId>('daily');
  const [windows, setWindows] = useState<CashWindow[]>([TREASURY_WINDOW]);
  const [board, setBoard] = useState<ExchangeBoard>({ againstSyp: {}, againstUsd: {} });
  const [master, setMaster] = useState<BranchMaster>({ companies: [], shamAccounts: [], rateHistory: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deskId, setDeskId] = useState('');
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCashWindows(), fetchExchangeBoard(), fetchBranchMaster()])
      .then(([nextWindows, nextBoard, nextMaster]) => {
        if (cancelled) return;
        setWindows(nextWindows);
        setBoard(nextBoard);
        setMaster(nextMaster);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'فشل تحميل بيانات الفرع');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const employees = windows.filter(window => window.kind === 'employee');
  const myWindow = employees.find(window => window.userId === props.userId)
    ?? employees.find(window => window.employeeName === props.displayName);
  const activeWindow = props.isAdmin
    ? employees.find(window => window.id === deskId) ?? myWindow ?? null
    : myWindow ?? null;

  const ops = useMemo(() => listBranchOps(props.transactions), [props.transactions]);
  const shift = activeWindow ? openShiftFor(ops, activeWindow.id) : null;
  const frozen = shift?.op.shiftId ? shiftFrozen(ops, shift.op.shiftId) : false;
  const treasuryBalances = useMemo(
    () => computeBalances(props.transactions, TREASURY_FUND_ID),
    [props.transactions],
  );
  const windowBalances = useMemo(
    () => activeWindow ? computeBalances(props.transactions, activeWindow.id) : null,
    [props.transactions, activeWindow],
  );

  const sections: { id: SectionId; label: string; admin?: boolean }[] = [
    { id: 'daily', label: 'اليوم' },
    { id: 'treasury', label: 'الخزنة', admin: true },
    { id: 'shifts', label: 'الورديات', admin: true },
    { id: 'exchange', label: 'الصرافة' },
    { id: 'remittance', label: 'الحوالات' },
    { id: 'sham', label: 'شام كاش' },
    { id: 'companies', label: 'الشركات' },
    { id: 'inventory', label: 'الجرد' },
    { id: 'reports', label: 'التقارير' },
    { id: 'setup', label: 'الإعداد', admin: true },
  ];

  function allowed(cap: WindowCapability) {
    if (props.isAdmin) return true;
    return !!activeWindow?.capabilities.includes(cap);
  }

  async function run(task: () => Promise<void>, ok: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await task();
      setNotice(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تنفيذ العملية');
    } finally {
      setBusy(false);
    }
  }

  function pendingMessage(special: boolean) {
    return special && !props.isAdmin ? 'أُرسل السعر الخاص لاعتماد المسؤول' : 'تم تسجيل الصرافة';
  }

  function ensureShift() {
    if (!activeWindow) throw new Error('ما في كوة مربوطة بهالمستخدم');
    if (!shift?.op.shiftId) throw new Error('ما في وردية مفتوحة على هالكوة');
    if (frozen) throw new Error('الوردية متوقفة للجرد');
    if (!props.isAdmin && shift.op.userId && shift.op.userId !== props.userId) {
      throw new Error('هالوردية لموظف تاني');
    }
    return { window: activeWindow, shiftId: shift.op.shiftId, employeeName: shift.op.employeeName || activeWindow.name };
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="animate-spin text-amber-400" size={28} />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-amber-500/20 p-3">
            <Landmark className="text-amber-400" size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold">حلب</h1>
            <p className="text-xs text-slate-500">{props.displayName} — {props.isAdmin ? 'مسؤول الفرع' : 'موظف'}</p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {props.isAdmin && (
            <button type="button" onClick={props.onOpenLegacy} className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-400">السجل السابق</button>
          )}
          {props.isAdmin && (
            <button type="button" onClick={props.onOpenAdmin} className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-400">
              <Settings size={14} className="inline" /> إدارة
            </button>
          )}
          <button type="button" onClick={props.onLogout} className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-rose-300">
            <LogOut size={14} className="inline" /> خروج
          </button>
        </div>
      </header>

      {(error || notice) && (
        <div className={`mb-3 rounded-xl px-3 py-2 text-xs ${error ? 'bg-rose-500/10 text-rose-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
          {error ?? notice}
        </div>
      )}

      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-slate-700 bg-slate-800/50 p-1">
        {sections.filter(item => !item.admin || props.isAdmin).map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSection(item.id)}
            className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium ${section === item.id ? 'bg-slate-700 text-amber-400' : 'text-slate-400'}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {props.isAdmin && section !== 'setup' && section !== 'treasury' && section !== 'reports' && (
        <label className="mb-4 block text-xs text-slate-400">
          الكوة العاملة
          <select value={deskId} onChange={event => setDeskId(event.target.value)} className={`${fieldClass} mt-1`}>
            <option value="">اختر كوة</option>
            {employees.map(window => <option key={window.id} value={window.id}>{window.name}</option>)}
          </select>
        </label>
      )}

      {section === 'daily' && (
        <DailySection
          isAdmin={props.isAdmin}
          window={activeWindow}
          shift={shift}
          frozen={frozen}
          board={board}
          master={master}
          balances={windowBalances}
        />
      )}
      {section === 'treasury' && props.isAdmin && (
        <TreasurySection balances={treasuryBalances} employees={employees} ops={ops} />
      )}
      {section === 'shifts' && props.isAdmin && (
        <ShiftSection
          employees={employees}
          ops={ops}
          balances={treasuryBalances}
          busy={busy}
          onOpen={(window, lines) => run(async () => {
            if (openShiftFor(ops, window.id)) throw new Error('في وردية مفتوحة على هالكوة');
            const missing = lines.find(line => balanceOf(treasuryBalances, line.currency) < line.amount);
            if (missing) throw new Error(`رصيد الخزنة من ${getCurrencyLabel(missing.currency)} ما يكفي`);
            await props.onAddTransactions(buildShiftOpen({
              window,
              employeeName: window.employeeName || window.name,
              userId: window.userId,
              lines,
            }));
            void logAudit({
              userId: props.userId,
              userName: props.displayName,
              action: 'transaction_edit',
              entityType: 'shift',
              fundId: window.id,
              details: `فتح وردية ${window.name}`,
            });
          }, 'تم فتح الوردية وتسليم الرصيد')}
        />
      )}
      {section === 'exchange' && (
        <ExchangeSection
          allowed={allowed('exchange')}
          busy={busy}
          board={board}
          balances={windowBalances}
          customers={props.customers.filter(customer => customer.fundId === TREASURY_FUND_ID)}
          pending={ops.filter(row => row.op.op === 'exchange' && row.tx.status === 'pending')}
          isAdmin={props.isAdmin}
          onSubmit={(input) => run(async () => {
            const ctx = ensureShift();
            if (!allowed('exchange')) throw new Error('ما عندك صلاحية صرافة');
            if (!windowBalances || balanceOf(windowBalances, input.paid) < input.paidAmount) {
              throw new Error('رصيد الكوة ما يكفي للعملة المدفوعة');
            }
            const pending = input.special && !props.isAdmin;
            const tx = buildExchangeTx({
              window: ctx.window,
              shiftId: ctx.shiftId,
              employeeName: ctx.employeeName,
              received: input.received,
              paid: input.paid,
              receivedAmount: input.receivedAmount,
              paidAmount: input.paidAmount,
              baseRate: input.baseRate,
              appliedRate: input.appliedRate,
              special: input.special,
              pending,
              reason: input.reason,
              customerName: input.customerName,
            });
            await props.onAddTransactions(tx);
            if (!pending) {
              setReceipt({
                title: 'إيصال صرافة',
                rows: [
                  { label: 'رقم العملية', value: receiptNo(tx) },
                  { label: 'التاريخ', value: tx.date },
                  { label: 'الموظف', value: ctx.employeeName },
                  { label: 'مستلم', value: money(input.receivedAmount, input.received) },
                  { label: 'مدفوع', value: money(input.paidAmount, input.paid) },
                  { label: 'السعر', value: String(input.appliedRate) },
                  { label: 'السعر الأساسي', value: String(input.baseRate) },
                ],
              });
            }
          }, pendingMessage(input.special))}
          onApprove={(row) => run(async () => {
            await props.onUpdateTransaction(row.tx.id, {
              status: 'posted',
              approvedByName: props.displayName,
              approvedAt: new Date().toISOString(),
            });
            void logAudit({
              userId: props.userId,
              userName: props.displayName,
              action: 'transaction_edit',
              entityType: 'exchange',
              entityId: row.tx.id,
              details: `اعتماد سعر خاص. السبب: ${row.op.reason || '—'}`,
            });
          }, 'تم اعتماد السعر الخاص')}
        />
      )}
      {section === 'remittance' && (
        <RemittanceSection
          allowed={allowed('remittance')}
          busy={busy}
          companies={master.companies}
          balances={windowBalances}
          onSubmit={(input) => run(async () => {
            const ctx = ensureShift();
            if (!allowed('remittance')) throw new Error('ما عندك صلاحية حوالات');
            if (!input.reference.trim() || !input.beneficiary.trim()) throw new Error('المرجع والمستفيد مطلوبان');
            if (!windowBalances || balanceOf(windowBalances, input.currency) < input.amount) {
              throw new Error('رصيد الكوة ما يكفي لتسليم الحوالة');
            }
            const op: BranchOp = {
              op: 'remittance',
              shiftId: ctx.shiftId,
              windowId: ctx.window.id,
              employeeName: ctx.employeeName,
              companyId: input.companyId,
              reference: input.reference.trim(),
              beneficiary: input.beneficiary.trim(),
              phone: input.phone.trim() || undefined,
              commission: input.commission || undefined,
            };
            const record = buildOpsTx(ctx.window.id, input.currency, input.amount, op);
            const cash = buildCashTx({
              fundId: ctx.window.id,
              currency: input.currency,
              amount: input.amount,
              direction: 'out',
              counterparty: input.beneficiary.trim(),
              note: `تسليم حوالة ${input.reference.trim()}`,
            });
            await props.onAddTransactions([record, cash]);
            setReceipt({
              title: 'إيصال تسليم حوالة',
              rows: [
                { label: 'رقم الإيصال', value: receiptNo(record) },
                { label: 'مرجع الحوالة', value: input.reference.trim() },
                { label: 'المستفيد', value: input.beneficiary.trim() },
                { label: 'المبلغ', value: money(input.amount, input.currency) },
                { label: 'العمولة', value: input.commission ? money(input.commission, input.currency) : '—' },
                { label: 'الموظف', value: ctx.employeeName },
                { label: 'التاريخ', value: record.date },
              ],
            });
          }, 'تم تسليم الحوالة وتسجيلها على الشركة')}
        />
      )}
      {section === 'sham' && (
        <ShamSection
          allowed={allowed('sham')}
          busy={busy}
          isAdmin={props.isAdmin}
          accounts={master.shamAccounts.filter(account => account.active)}
          companies={master.companies}
          ops={ops}
          balances={windowBalances}
          onCreate={(input) => run(async () => {
            const ctx = input.touchesCash ? ensureShift() : { window: activeWindow, shiftId: shift?.op.shiftId, employeeName: props.displayName };
            if (!ctx.window && input.touchesCash) throw new Error('ما في كوة');
            if (!allowed('sham')) throw new Error('ما عندك صلاحية شام كاش');
            if (input.shamType === 'cash-out' && input.shamStatus === 'success' && (!windowBalances || balanceOf(windowBalances, input.currency) < input.amount)) {
              throw new Error('رصيد الكوة ما يكفي للدفع النقدي');
            }
            if (referenceTaken(ops, input.reference, input.accountId)) throw new Error('رقم المرجع مستخدم لعملية لم تُغلق');
            const account = master.shamAccounts.find(item => item.id === input.accountId);
            if (!account) throw new Error('حساب شام كاش غير موجود');
            if (input.currency !== account.currency) throw new Error('عملة العملية لازم تطابق عملة الحساب');
            const status = input.shamStatus;
            const op: BranchOp = {
              op: 'sham',
              shiftId: ctx.shiftId,
              windowId: ctx.window?.id,
              employeeName: ctx.employeeName,
              accountId: input.accountId,
              companyId: input.companyId,
              shamType: input.shamType,
              shamStatus: status,
              reference: input.reference.trim(),
              fee: input.fee || undefined,
            };
            const fundId = ctx.window?.id ?? TREASURY_FUND_ID;
            const record = buildOpsTx(fundId, input.currency, input.amount, op, 'posted');
            await props.onAddTransactions(record);
            if (status === 'success' && input.touchesCash && ctx.window) {
              const cash = buildCashTx({
                fundId: ctx.window.id,
                currency: input.currency,
                amount: input.amount,
                direction: input.shamType === 'cash-out' ? 'out' : 'in',
                note: `شام كاش ${input.reference.trim()}`,
              });
              op.cashTxId = cash.id;
              await props.onUpdateTransaction(record.id, { note: encodeBranch(op) });
              await props.onAddTransactions(cash);
            }
            setReceipt({
              title: 'إيصال حركة شام كاش',
              rows: [
                { label: 'النوع', value: input.shamType },
                { label: 'الحالة', value: status },
                { label: 'المرجع', value: input.reference.trim() },
                { label: 'الحساب', value: account.name },
                { label: 'المبلغ', value: money(input.amount, input.currency) },
                { label: 'الرسوم', value: input.fee ? money(input.fee, input.currency) : '—' },
              ],
            });
          }, 'تم تسجيل حركة شام كاش')}
          onStatus={(row, status) => run(async () => {
            const next: BranchOp = { ...row.op, shamStatus: status, approvedBy: props.displayName };
            if (status === 'success' && (row.op.shamType === 'cash-out' || row.op.shamType === 'cash-in') && row.op.windowId) {
              const cash = buildCashTx({
                fundId: row.op.windowId,
                currency: row.tx.currency,
                amount: row.tx.amount,
                direction: row.op.shamType === 'cash-out' ? 'out' : 'in',
                note: `شام كاش ${row.op.reference || ''}`,
              });
              next.cashTxId = cash.id;
              await props.onAddTransactions(cash);
            }
            if (status === 'reversed' && row.op.cashTxId && row.op.windowId) {
              const cash = buildCashTx({
                fundId: row.op.windowId,
                currency: row.tx.currency,
                amount: row.tx.amount,
                direction: row.op.shamType === 'cash-out' ? 'in' : 'out',
                note: `عكس شام كاش ${row.op.reference || ''}`,
              });
              await props.onAddTransactions(cash);
            }
            await props.onUpdateTransaction(row.tx.id, { note: encodeBranch(next) });
            void logAudit({
              userId: props.userId,
              userName: props.displayName,
              action: 'transaction_edit',
              entityType: 'sham',
              entityId: row.tx.id,
              details: `حالة شام كاش صارت ${status}. المرجع ${row.op.reference || ''}`,
            });
          }, 'تم تحديث حالة شام كاش')}
        />
      )}
      {section === 'companies' && (
        <CompaniesSection
          companies={master.companies}
          ops={ops}
          isAdmin={props.isAdmin}
          busy={busy}
          balances={windowBalances}
          onSettle={(input) => run(async () => {
            const ctx = ensureShift();
            if (input.direction === 'out' && (!windowBalances || balanceOf(windowBalances, input.currency) < input.amount)) {
              throw new Error('رصيد الكوة ما يكفي');
            }
            const record = buildOpsTx(ctx.window.id, input.currency, input.amount, {
              op: 'company',
              shiftId: ctx.shiftId,
              windowId: ctx.window.id,
              companyId: input.companyId,
              effect: input.direction === 'in' ? 'decrease' : 'increase',
              reference: input.reference,
            });
            const cash = buildCashTx({
              fundId: ctx.window.id,
              currency: input.currency,
              amount: input.amount,
              direction: input.direction,
              note: input.direction === 'in' ? 'قبض من شركة' : 'دفع لشركة',
            });
            await props.onAddTransactions([record, cash]);
          }, 'تم تسجيل التسوية')}
        />
      )}
      {section === 'inventory' && (
        <InventorySection
          window={activeWindow}
          shift={shift}
          balances={windowBalances}
          ops={ops}
          isAdmin={props.isAdmin}
          busy={busy}
          onSave={(existing, lines, denominations) => run(async () => {
            if (!activeWindow || !shift?.op.shiftId) throw new Error('ما في وردية مفتوحة');
            const op: BranchOp = {
              op: 'inventory',
              shiftId: shift.op.shiftId,
              windowId: activeWindow.id,
              employeeName: shift.op.employeeName,
              lines,
              denominations,
              inventoryStatus: 'draft',
            };
            if (existing) await props.onUpdateTransaction(existing.tx.id, { note: encodeBranch(op) });
            else await props.onAddTransactions(buildOpsTx(activeWindow.id, 'USD', 0, op));
          }, 'تم حفظ مسودة الجرد')}
          onApprove={(row) => run(async () => {
            await props.onUpdateTransaction(row.tx.id, {
              note: encodeBranch({ ...row.op, inventoryStatus: 'approved', approvedBy: props.displayName }),
              approvedByName: props.displayName,
              approvedAt: new Date().toISOString(),
            });
            void logAudit({
              userId: props.userId,
              userName: props.displayName,
              action: 'transaction_edit',
              entityType: 'inventory',
              entityId: row.tx.id,
              details: 'اعتماد محضر الجرد بدون تعديل الحركات الأصلية',
            });
          }, 'تم اعتماد الجرد')}
          onReturn={(row) => run(async () => {
            if (!activeWindow) throw new Error('ما في كوة');
            const lines = (row.op.lines ?? [])
              .map(line => ({ currency: line.currency, amount: Math.min(line.actual, Math.max(line.expected, 0)) }))
              .filter(line => line.amount > 0);
            if (lines.length) {
              await props.onAddTransactions(buildCashReturn({ window: activeWindow, shiftId: row.op.shiftId || '', lines }));
            }
            await props.onUpdateTransaction(row.tx.id, { note: encodeBranch({ ...row.op, returned: true }) });
          }, 'تم إرجاع النقد المعدود إلى الخزنة')}
          onClose={(row) => run(async () => {
            if (!row.op.returned) throw new Error('أرجع النقد للخزنة قبل الإغلاق');
            await props.onAddTransactions(buildOpsTx(row.tx.fundId, 'USD', 0, {
              op: 'shift-close',
              shiftId: row.op.shiftId,
              windowId: row.op.windowId,
              closedAt: new Date().toISOString(),
              approvedBy: props.displayName,
            }));
            void logAudit({
              userId: props.userId,
              userName: props.displayName,
              action: 'transaction_edit',
              entityType: 'shift',
              entityId: row.op.shiftId,
              details: 'إغلاق الوردية بعد الجرد والإرجاع',
            });
          }, 'تم إغلاق الوردية')}
        />
      )}
      {section === 'reports' && (
        <ReportsSection ops={ops} windows={employees} companies={master.companies} accounts={master.shamAccounts} transactions={props.transactions} />
      )}
      {section === 'setup' && props.isAdmin && (
        <SetupSection
          windows={employees}
          profiles={props.profiles}
          board={board}
          master={master}
          customers={props.customers.filter(customer => customer.fundId === TREASURY_FUND_ID)}
          busy={busy}
          onSaveWindow={(window, previousUserId) => run(async () => {
            const next = [TREASURY_WINDOW, ...employees.filter(item => item.id !== window.id), window];
            await saveCashWindows(next);
            setWindows(next);
            await grantWindowAccess(window, previousUserId);
          }, 'تم حفظ الكوة')}
          onDeleteWindow={(window) => run(async () => {
            const next = [TREASURY_WINDOW, ...employees.filter(item => item.id !== window.id)];
            await saveCashWindows(next);
            setWindows(next);
          }, 'تم حذف الكوة')}
          onSaveBoard={async (next) => run(async () => {
            const history = [{ at: new Date().toISOString(), by: props.displayName, board }, ...master.rateHistory].slice(0, 30);
            await saveExchangeBoard(next);
            const saved = { ...master, rateHistory: history };
            await saveBranchMaster(saved);
            setBoard(next);
            setMaster(saved);
            void logAudit({
              userId: props.userId,
              userName: props.displayName,
              action: 'transaction_edit',
              entityType: 'rates',
              details: 'تحديث أسعار الصرافة مع حفظ السعر السابق',
            });
          }, 'تم حفظ الأسعار')}
          onSaveMaster={(next) => run(async () => {
            await saveBranchMaster(next);
            setMaster(next);
          }, 'تم حفظ الإعداد')}
          onAddCustomer={(name, phone) => run(async () => {
            await props.onAddCustomer(createCustomer({ fundId: TREASURY_FUND_ID, name, phone }));
          }, 'تم تعريف العميل')}
          onDeleteCustomer={(id) => run(async () => {
            await props.onDeleteCustomer(id);
          }, 'تم حذف العميل')}
        />
      )}

      {receipt && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4">
            <h3 className="mb-3 font-semibold">{receipt.title}</h3>
            <dl className="space-y-1 text-sm">
              {receipt.rows.map(row => (
                <div key={row.label} className="flex justify-between gap-3 border-b border-slate-800 py-1">
                  <dt className="text-slate-500">{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => printReceipt(receipt)} className="flex-1 rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-950">طباعة</button>
              <button type="button" onClick={() => setReceipt(null)} className="rounded-xl border border-slate-600 px-4 text-sm">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DailySection({
  isAdmin,
  window,
  shift,
  frozen,
  board,
  master,
  balances,
}: {
  isAdmin: boolean;
  window: CashWindow | null;
  shift: ParsedOp | null;
  frozen: boolean;
  board: ExchangeBoard;
  master: BranchMaster;
  balances: ReturnType<typeof computeBalances> | null;
}) {
  const ratesReady = Object.values(board.againstSyp).some(pair => (pair?.buy ?? 0) > 0 || (pair?.sell ?? 0) > 0);
  const steps = [
    { ok: ratesReady, label: 'أسعار الصرافة محمّلة' },
    { ok: master.companies.length > 0, label: 'شركات الحوالات معرفة' },
    { ok: master.shamAccounts.some(account => account.active), label: 'حسابات شام كاش جاهزة' },
    { ok: !!shift, label: 'وردية مفتوحة ورصيدها مسلّم' },
    { ok: !frozen, label: frozen ? 'الجرد بدأ — الحركات متوقفة' : 'الكوة جاهزة للعمليات' },
  ];
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">الدورة اليومية</h2>
      <ul className="space-y-2">
        {steps.map(step => (
          <li key={step.label} className="rounded-xl border border-slate-700 px-3 py-2 text-sm">
            <span className={step.ok ? 'text-emerald-400' : 'text-amber-300'}>{step.ok ? 'جاهز' : 'ناقص'}</span>
            <span className="mr-2 text-slate-300">{step.label}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        {window ? `الكوة: ${window.name}` : isAdmin ? 'اختر كوة عاملة من الأعلى.' : 'ما في كوة مربوطة بحسابك.'}
        {shift?.op.openedAt ? ` — فُتحت ${new Date(shift.op.openedAt).toLocaleString('ar')}` : ''}
      </p>
      {balances && <BalanceGrid balances={balances} />}
    </section>
  );
}

function BalanceGrid({ balances }: { balances: ReturnType<typeof computeBalances> }) {
  const rows = TRADE_CURRENCIES.filter(currency => (balances[currency]?.balance ?? 0) !== 0);
  if (!rows.length) return <p className="text-xs text-slate-500">ما في رصيد ظاهر.</p>;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {rows.map(currency => {
        const balance = balances[currency]?.balance ?? 0;
        return (
          <div key={currency} className="rounded-2xl border border-slate-700 p-3">
            <p className="text-xs text-slate-400">{getCurrencyLabel(currency)}</p>
            <p className={`mt-1 font-bold ${balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{money(balance, currency)}</p>
          </div>
        );
      })}
    </div>
  );
}

function TreasurySection({
  balances,
  employees,
  ops,
}: {
  balances: ReturnType<typeof computeBalances>;
  employees: CashWindow[];
  ops: ParsedOp[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-amber-300">الخزنة</h2>
      <p className="text-xs text-slate-500">مرجع النقد. كل تحويل داخلي بينقص من محل وبيزيد بمحل تاني بنفس العملة، ومو إيراد ولا مصروف.</p>
      <BalanceGrid balances={balances} />
      <div className="space-y-2">
        {employees.map(window => {
          const open = openShiftFor(ops, window.id);
          return (
            <p key={window.id} className="rounded-xl bg-slate-900/50 px-3 py-2 text-sm">
              {window.name}: {open ? 'وردية مفتوحة' : 'بدون وردية'}
            </p>
          );
        })}
      </div>
    </section>
  );
}

function ShiftSection({
  employees,
  ops,
  balances,
  busy,
  onOpen,
}: {
  employees: CashWindow[];
  ops: ParsedOp[];
  balances: ReturnType<typeof computeBalances>;
  busy: boolean;
  onOpen: (window: CashWindow, lines: { currency: Currency; amount: number }[]) => void;
}) {
  const [windowId, setWindowId] = useState(employees[0]?.id ?? '');
  const [amounts, setAmounts] = useState<Partial<Record<Currency, string>>>({});
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">فتح وردية وتسليم الرصيد</h2>
      <form
        className="space-y-2 rounded-2xl border border-slate-700 p-3"
        onSubmit={event => {
          event.preventDefault();
          const window = employees.find(item => item.id === windowId);
          if (!window) return;
          const lines = TRADE_CURRENCIES
            .map(currency => ({ currency, amount: Number((amounts[currency] || '').replace(/,/g, '')) || 0 }))
            .filter(line => line.amount > 0);
          onOpen(window, lines);
        }}
      >
        <select value={windowId} onChange={event => setWindowId(event.target.value)} className={fieldClass}>
          {employees.map(window => <option key={window.id} value={window.id}>{window.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          {TRADE_CURRENCIES.map(currency => (
            <label key={currency} className="text-[11px] text-slate-400">
              {getCurrencyLabel(currency)} — بالخزنة {money(balanceOf(balances, currency), currency)}
              <input
                value={amounts[currency] ?? ''}
                onChange={event => setAmounts(prev => ({ ...prev, [currency]: event.target.value }))}
                inputMode="decimal"
                className={`${fieldClass} mt-1`}
                placeholder="0"
              />
            </label>
          ))}
        </div>
        <button type="submit" disabled={busy || !employees.length} className="w-full rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
          فتح الوردية وتسليم المبلغ
        </button>
      </form>
      <ul className="space-y-2 text-sm">
        {ops.filter(row => row.op.op === 'shift-open').slice(0, 8).map(row => (
          <li key={row.tx.id} className="rounded-xl border border-slate-800 px-3 py-2">
            {row.op.employeeName} — {openShiftFor(ops, row.op.windowId || '')?.tx.id === row.tx.id ? 'مفتوحة' : 'مغلقة'}
            <span className="mt-1 block text-[11px] text-slate-500">
              {(row.op.openingLines ?? []).map(line => money(line.amount, line.currency)).join(' · ') || 'بدون رصيد افتتاحي'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExchangeSection({
  allowed,
  busy,
  board,
  balances,
  customers,
  pending,
  isAdmin,
  onSubmit,
  onApprove,
}: {
  allowed: boolean;
  busy: boolean;
  board: ExchangeBoard;
  balances: ReturnType<typeof computeBalances> | null;
  customers: Customer[];
  pending: ParsedOp[];
  isAdmin: boolean;
  onSubmit: (input: {
    received: Currency;
    paid: Currency;
    receivedAmount: number;
    paidAmount: number;
    baseRate: number;
    appliedRate: number;
    special: boolean;
    reason?: string;
    customerName?: string;
  }) => void;
  onApprove: (row: ParsedOp) => void;
}) {
  const [received, setReceived] = useState<Currency>('USD');
  const [paid, setPaid] = useState<Currency>('SYP');
  const [amount, setAmount] = useState('');
  const [special, setSpecial] = useState(false);
  const [quote, setQuote] = useState('');
  const [reason, setReason] = useState('');
  const [customerName, setCustomerName] = useState('');
  const base = editableQuote(board, received, paid);
  const applied = special ? (Number(quote.replace(/,/g, '')) || 0) : base;
  const receivedAmount = Number(amount.replace(/,/g, '')) || 0;
  const paidAmount = paidFromEditableQuote(received, paid, receivedAmount, applied);

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">صرافة</h2>
      {!allowed && <p className="text-xs text-amber-300">صلاحية الصرافة مو معطاة لهالكوة.</p>}
      <form
        className="space-y-2"
        onSubmit={event => {
          event.preventDefault();
          if (!allowed || receivedAmount <= 0 || received === paid) return;
          onSubmit({
            received,
            paid,
            receivedAmount,
            paidAmount,
            baseRate: base,
            appliedRate: applied,
            special,
            reason: reason.trim() || undefined,
            customerName: customerName || undefined,
          });
          setAmount('');
          setReason('');
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className={labelClass}>العملة المستلمة
            <select value={received} onChange={event => setReceived(event.target.value as Currency)} className={fieldClass}>{currencyOptions(TRADE_CURRENCIES)}</select>
          </label>
          <label className={labelClass}>العملة المدفوعة
            <select value={paid} onChange={event => setPaid(event.target.value as Currency)} className={fieldClass}>{currencyOptions(TRADE_CURRENCIES)}</select>
          </label>
        </div>
        <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="المبلغ المستلم" className={fieldClass} />
        <select value={customerName} onChange={event => setCustomerName(event.target.value)} className={fieldClass}>
          <option value="">بدون عميل</option>
          {customers.map(customer => <option key={customer.id} value={customer.name}>{customer.name}</option>)}
        </select>
        <p className="text-[11px] text-slate-400">
          السعر المعتمد ({marketRateLabel(received, paid)}): {base || 'غير محدد'}
          {balances ? ` — رصيد المدفوع ${money(balanceOf(balances, paid), paid)}` : ''}
        </p>
        {receivedAmount > 0 && applied > 0 && (
          <p className="text-sm text-amber-200">المقابل: {money(paidAmount, paid)}</p>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={special} onChange={event => setSpecial(event.target.checked)} />
          طلب سعر خاص
        </label>
        {special && (
          <>
            <input value={quote} onChange={event => setQuote(event.target.value)} inputMode="decimal" placeholder="السعر الخاص" className={fieldClass} />
            <input value={reason} onChange={event => setReason(event.target.value)} placeholder="سبب الاستثناء" className={fieldClass} />
          </>
        )}
        <button type="submit" disabled={busy || !allowed} className="w-full rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">تنفيذ</button>
      </form>
      {isAdmin && pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">أسعار خاصة بانتظار الاعتماد</h3>
          {pending.map(row => (
            <div key={row.tx.id} className="rounded-xl border border-amber-500/30 p-3 text-sm">
              <p>{row.op.employeeName}: استلام {money(row.op.receivedAmount || 0, row.op.receivedCurrency || 'USD')} مقابل {money(row.op.paidAmount || 0, row.op.paidCurrency || 'SYP')}</p>
              <p className="text-[11px] text-slate-400">أساسي {row.op.baseRate} — خاص {row.op.appliedRate} — {row.op.reason}</p>
              <button type="button" onClick={() => onApprove(row)} className="mt-2 rounded-lg bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950">اعتماد</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RemittanceSection({
  allowed,
  busy,
  companies,
  balances,
  onSubmit,
}: {
  allowed: boolean;
  busy: boolean;
  companies: BranchCompany[];
  balances: ReturnType<typeof computeBalances> | null;
  onSubmit: (input: { companyId: string; reference: string; beneficiary: string; phone: string; currency: Currency; amount: number; commission: number }) => void;
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [reference, setReference] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [phone, setPhone] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [amount, setAmount] = useState('');
  const [commission, setCommission] = useState('');
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">تسليم حوالة</h2>
      <p className="text-xs text-slate-500">الإدخال اليدوي ما بيعني التحقق من الحوالة. التحقق والصرف بيبقوا عند الشركة أو عند التكامل إذا توفر.</p>
      {!allowed && <p className="text-xs text-amber-300">صلاحية الحوالات مو معطاة.</p>}
      <form
        className="space-y-2"
        onSubmit={event => {
          event.preventDefault();
          onSubmit({
            companyId,
            reference,
            beneficiary,
            phone,
            currency,
            amount: Number(amount.replace(/,/g, '')) || 0,
            commission: Number(commission.replace(/,/g, '')) || 0,
          });
          setReference('');
          setBeneficiary('');
          setPhone('');
          setAmount('');
          setCommission('');
        }}
      >
        <select value={companyId} onChange={event => setCompanyId(event.target.value)} className={fieldClass}>
          {companies.length === 0 && <option value="">عرّف شركة من الإعداد</option>}
          {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
        <input value={reference} onChange={event => setReference(event.target.value)} placeholder="رقم مرجع الحوالة" className={fieldClass} />
        <input value={beneficiary} onChange={event => setBeneficiary(event.target.value)} placeholder="المستفيد" className={fieldClass} />
        <input value={phone} onChange={event => setPhone(event.target.value)} placeholder="هاتف المستفيد" dir="ltr" className={fieldClass} />
        <div className="grid grid-cols-2 gap-2">
          <select value={currency} onChange={event => setCurrency(event.target.value as Currency)} className={fieldClass}>{currencyOptions(TRADE_CURRENCIES)}</select>
          <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="المبلغ" className={fieldClass} />
        </div>
        <input value={commission} onChange={event => setCommission(event.target.value)} inputMode="decimal" placeholder="عمولة بنفس العملة، إن وجدت" className={fieldClass} />
        {balances && <p className="text-[11px] text-slate-500">رصيد الكوة: {money(balanceOf(balances, currency), currency)}</p>}
        <button type="submit" disabled={busy || !allowed || !companies.length} className="w-full rounded-xl bg-violet-500 py-2 text-sm font-semibold text-white disabled:opacity-50">تأكيد الصرف</button>
      </form>
    </section>
  );
}

const SHAM_LABELS: Record<string, string> = {
  'cash-out': 'استلام إلكتروني ودفع نقد',
  'cash-in': 'قبض نقد وإرسال إلكتروني',
  'settle-in': 'تحصيل ذمة شركة عبر شام كاش',
  'settle-out': 'تسديد لشركة عبر شام كاش',
  draft: 'قيد الإنشاء',
  pending: 'بانتظار التأكيد',
  success: 'ناجحة',
  failed: 'فاشلة',
  reversed: 'معكوسة',
};

function ShamSection({
  allowed,
  busy,
  isAdmin,
  accounts,
  companies,
  ops,
  balances,
  onCreate,
  onStatus,
}: {
  allowed: boolean;
  busy: boolean;
  isAdmin: boolean;
  accounts: ShamAccount[];
  companies: BranchCompany[];
  ops: ParsedOp[];
  balances: ReturnType<typeof computeBalances> | null;
  onCreate: (input: {
    accountId: string;
    companyId?: string;
    shamType: 'cash-out' | 'cash-in' | 'settle-in' | 'settle-out';
    shamStatus: 'pending' | 'success';
    reference: string;
    currency: Currency;
    amount: number;
    fee: number;
    touchesCash: boolean;
  }) => void;
  onStatus: (row: ParsedOp, status: 'success' | 'failed' | 'reversed') => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [shamType, setShamType] = useState<'cash-out' | 'cash-in' | 'settle-in' | 'settle-out'>('cash-out');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('');
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const account = accounts.find(item => item.id === accountId);
  const touchesCash = shamType === 'cash-out' || shamType === 'cash-in';
  const rows = ops.filter(row => row.op.op === 'sham').slice(0, 12);

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">شام كاش</h2>
      <p className="text-xs text-slate-500">الرصيد الإلكتروني منفصل عن نقد الكوة. رقم العميل وحده ما بيثبت نجاح التحويل، والعملية ما بتنزل على النقد قبل ما تصير ناجحة.</p>
      {!allowed && <p className="text-xs text-amber-300">صلاحية شام كاش مو معطاة.</p>}
      <form
        className="space-y-2"
        onSubmit={event => {
          event.preventDefault();
          if (!account) return;
          onCreate({
            accountId,
            companyId: touchesCash ? undefined : companyId,
            shamType,
            shamStatus: confirmed || !touchesCash ? 'success' : 'pending',
            reference,
            currency: account.currency,
            amount: Number(amount.replace(/,/g, '')) || 0,
            fee: Number(fee.replace(/,/g, '')) || 0,
            touchesCash,
          });
          setReference('');
          setAmount('');
          setFee('');
          setConfirmed(false);
        }}
      >
        <select value={accountId} onChange={event => setAccountId(event.target.value)} className={fieldClass}>
          {accounts.length === 0 && <option value="">عرّف حساباً من الإعداد</option>}
          {accounts.map(item => <option key={item.id} value={item.id}>{item.name} — {item.currency}</option>)}
        </select>
        <p className="text-[11px] text-slate-400">الرصيد الإلكتروني: {account ? money(shamBalance(ops, account.id), account.currency) : '—'}</p>
        <select value={shamType} onChange={event => setShamType(event.target.value as typeof shamType)} className={fieldClass}>
          {Object.entries(SHAM_LABELS).filter(([key]) => key.includes('-') || key.includes('settle') || key.startsWith('cash')).slice(0, 4).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        {!touchesCash && (
          <select value={companyId} onChange={event => setCompanyId(event.target.value)} className={fieldClass}>
            {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        )}
        <input value={reference} onChange={event => setReference(event.target.value)} placeholder="مرجع فريد" className={fieldClass} />
        <div className="grid grid-cols-2 gap-2">
          <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="المبلغ" className={fieldClass} />
          <input value={fee} onChange={event => setFee(event.target.value)} inputMode="decimal" placeholder="رسوم" className={fieldClass} />
        </div>
        {touchesCash && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
            تأكدت من نجاح التحويل بمستند، مو من رقم العميل فقط
          </label>
        )}
        {balances && account && touchesCash && <p className="text-[11px] text-slate-500">نقد الكوة: {money(balanceOf(balances, account.currency), account.currency)}</p>}
        <button disabled={busy || !allowed || !accounts.length} className="w-full rounded-xl bg-sky-500 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">تسجيل</button>
      </form>
      <ul className="space-y-2">
        {rows.map(row => (
          <li key={row.tx.id} className="rounded-xl border border-slate-800 px-3 py-2 text-sm">
            <p>{SHAM_LABELS[row.op.shamType || ''] || row.op.shamType} — {SHAM_LABELS[row.op.shamStatus || '']}</p>
            <p className="text-[11px] text-slate-500">{row.op.reference} — {money(row.tx.amount, row.tx.currency)}</p>
            {isAdmin && row.op.shamStatus === 'pending' && (
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => onStatus(row, 'success')} className="rounded-lg bg-emerald-500 px-2 py-1 text-xs text-slate-950">تأكيد النجاح</button>
                <button type="button" onClick={() => onStatus(row, 'failed')} className="rounded-lg bg-rose-500/80 px-2 py-1 text-xs">فاشلة</button>
              </div>
            )}
            {isAdmin && row.op.shamStatus === 'success' && (
              <button type="button" onClick={() => onStatus(row, 'reversed')} className="mt-2 rounded-lg border border-slate-600 px-2 py-1 text-xs">عكس</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CompaniesSection({
  companies,
  ops,
  isAdmin,
  busy,
  balances,
  onSettle,
}: {
  companies: BranchCompany[];
  ops: ParsedOp[];
  isAdmin: boolean;
  busy: boolean;
  balances: ReturnType<typeof computeBalances> | null;
  onSettle: (input: { companyId: string; currency: Currency; amount: number; direction: 'in' | 'out'; reference: string }) => void;
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [reference, setReference] = useState('');
  const position = companyId ? companyPosition(ops, companyId, currency) : 0;
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">حسابات الشركات</h2>
      <p className="text-xs text-slate-500">الرصيد الموجب يعني المبلغ الذي ما زال على الشركة لصالح الفرع. ما في مقاصة تلقائية.</p>
      <select value={companyId} onChange={event => setCompanyId(event.target.value)} className={fieldClass}>
        {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select>
      <select value={currency} onChange={event => setCurrency(event.target.value as Currency)} className={fieldClass}>{currencyOptions(TRADE_CURRENCIES)}</select>
      <p className="text-sm">الرصيد: {money(position, currency)} {position >= 0 ? 'على الشركة' : 'للشركة'}</p>
      {isAdmin && (
        <form
          className="space-y-2"
          onSubmit={event => {
            event.preventDefault();
            onSettle({ companyId, currency, amount: Number(amount.replace(/,/g, '')) || 0, direction, reference });
            setAmount('');
            setReference('');
          }}
        >
          <select value={direction} onChange={event => setDirection(event.target.value as 'in' | 'out')} className={fieldClass}>
            <option value="in">قبض نقدي من الشركة</option>
            <option value="out">دفع نقدي للشركة</option>
          </select>
          <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="المبلغ" className={fieldClass} />
          <input value={reference} onChange={event => setReference(event.target.value)} placeholder="مرجع" className={fieldClass} />
          {balances && <p className="text-[11px] text-slate-500">نقد الكوة: {money(balanceOf(balances, currency), currency)}</p>}
          <button disabled={busy || !companies.length} className="w-full rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">تسجيل التسوية</button>
        </form>
      )}
    </section>
  );
}

function InventorySection({
  window,
  shift,
  balances,
  ops,
  isAdmin,
  busy,
  onSave,
  onApprove,
  onReturn,
  onClose,
}: {
  window: CashWindow | null;
  shift: ParsedOp | null;
  balances: ReturnType<typeof computeBalances> | null;
  ops: ParsedOp[];
  isAdmin: boolean;
  busy: boolean;
  onSave: (existing: ParsedOp | null, lines: { currency: Currency; expected: number; actual: number; reason?: string }[], denominations: string) => void;
  onApprove: (row: ParsedOp) => void;
  onReturn: (row: ParsedOp) => void;
  onClose: (row: ParsedOp) => void;
}) {
  const existing = ops.find(row => row.op.op === 'inventory' && row.op.shiftId === shift?.op.shiftId) ?? null;
  const [actuals, setActuals] = useState<Partial<Record<Currency, string>>>({});
  const [reasons, setReasons] = useState<Partial<Record<Currency, string>>>({});
  const [denominations, setDenominations] = useState(existing?.op.denominations ?? '');
  const currencies = TRADE_CURRENCIES.filter(currency => (balances?.[currency]?.balance ?? 0) !== 0 || (existing?.op.lines ?? []).some(line => line.currency === currency));

  if (!window || !shift) return <p className="text-sm text-slate-500">الجرد بيبلّش على وردية مفتوحة.</p>;

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">جرد الوردية</h2>
      <p className="text-xs text-slate-500">الجرد بيفرق بين المسجّل والفعلي بدون ما يعدّل الحركات الأصلية. نقد شام كاش ما بيندمج مع هالجرد.</p>
      <form
        className="space-y-2"
        onSubmit={event => {
          event.preventDefault();
          const lines = currencies.map(currency => {
            const expected = balances?.[currency]?.balance ?? 0;
            const typed = actuals[currency];
            const actual = typed == null || typed === '' ? expected : (Number(typed.replace(/,/g, '')) || 0);
            return { currency, expected, actual, reason: reasons[currency]?.trim() || undefined };
          });
          onSave(existing && existing.op.inventoryStatus !== 'approved' ? existing : null, lines, denominations.trim());
        }}
      >
        {currencies.map(currency => {
          const expected = balances?.[currency]?.balance ?? 0;
          return (
            <div key={currency} className="grid grid-cols-3 gap-2 text-xs">
              <span className="self-center">{getCurrencyLabel(currency)}<br />مسجّل {money(expected, currency)}</span>
              <input value={actuals[currency] ?? ''} onChange={event => setActuals(prev => ({ ...prev, [currency]: event.target.value }))} placeholder="الفعلي" className={fieldClass} />
              <input value={reasons[currency] ?? ''} onChange={event => setReasons(prev => ({ ...prev, [currency]: event.target.value }))} placeholder="سبب الفرق" className={fieldClass} />
            </div>
          );
        })}
        <input value={denominations} onChange={event => setDenominations(event.target.value)} placeholder="فئات نقدية، إن لزم" className={fieldClass} />
        {existing?.op.inventoryStatus !== 'approved' && (
          <button disabled={busy} className="w-full rounded-xl bg-slate-200 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">حفظ الجرد</button>
        )}
      </form>
      {existing && (
        <div className="space-y-2 rounded-2xl border border-slate-700 p-3 text-sm">
          <p>حالة المحضر: {existing.op.inventoryStatus === 'approved' ? `معتمد من ${existing.op.approvedBy || ''}` : 'مسودة'}</p>
          {(existing.op.lines ?? []).filter(line => line.actual !== line.expected).map(line => (
            <p key={line.currency} className="text-xs text-amber-200">
              {getCurrencyLabel(line.currency)}: فرق {money(line.actual - line.expected, line.currency)} {line.reason || ''}
            </p>
          ))}
          {isAdmin && existing.op.inventoryStatus !== 'approved' && (
            <button type="button" disabled={busy} onClick={() => onApprove(existing)} className="w-full rounded-xl bg-emerald-500 py-2 text-sm font-semibold text-slate-950">اعتماد المحضر</button>
          )}
          {isAdmin && existing.op.inventoryStatus === 'approved' && !existing.op.returned && (
            <button type="button" disabled={busy} onClick={() => onReturn(existing)} className="w-full rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-950">إرجاع النقد المعدود للخزنة</button>
          )}
          {isAdmin && existing.op.returned && (
            <button type="button" disabled={busy} onClick={() => onClose(existing)} className="w-full rounded-xl border border-rose-400 py-2 text-sm text-rose-200">إغلاق الوردية</button>
          )}
        </div>
      )}
    </section>
  );
}

function ReportsSection({
  ops,
  windows,
  companies,
  accounts,
  transactions,
}: {
  ops: ParsedOp[];
  windows: CashWindow[];
  companies: BranchCompany[];
  accounts: ShamAccount[];
  transactions: Transaction[];
}) {
  const [kind, setKind] = useState('all');
  const [windowId, setWindowId] = useState('');
  const rows = ops.filter(row => {
    if (kind !== 'all' && row.op.op !== kind) return false;
    if (windowId && row.op.windowId !== windowId) return false;
    return true;
  }).slice(0, 40);
  const treasury = computeBalances(transactions, TREASURY_FUND_ID);
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">التقارير</h2>
      <div className="grid grid-cols-2 gap-2">
        <select value={kind} onChange={event => setKind(event.target.value)} className={fieldClass}>
          <option value="all">كل العمليات</option>
          <option value="exchange">الصرافة</option>
          <option value="remittance">الحوالات</option>
          <option value="sham">شام كاش</option>
          <option value="company">الشركات</option>
          <option value="inventory">الجرد</option>
          <option value="shift-open">الورديات</option>
        </select>
        <select value={windowId} onChange={event => setWindowId(event.target.value)} className={fieldClass}>
          <option value="">كل الكوات</option>
          {windows.map(window => <option key={window.id} value={window.id}>{window.name}</option>)}
        </select>
      </div>
      <div>
        <h3 className="mb-1 text-sm text-slate-300">أرصدة الخزنة</h3>
        <BalanceGrid balances={treasury} />
      </div>
      <ul className="space-y-1 text-xs">
        {rows.map(row => (
          <li key={row.tx.id} className="rounded-lg bg-slate-900/60 px-3 py-2">
            {row.tx.date} — {row.op.op} — {row.op.employeeName || '—'} — {row.tx.status} — {money(row.tx.amount, row.tx.currency)}
            {row.op.special ? ` — سعر خاص ${row.op.appliedRate} بدل ${row.op.baseRate}` : ''}
          </li>
        ))}
      </ul>
      <div className="space-y-1 text-xs text-slate-400">
        {companies.map(company => (
          <p key={company.id}>{company.name}: {TRADE_CURRENCIES.filter(currency => companyPosition(ops, company.id, currency) !== 0).map(currency => `${money(companyPosition(ops, company.id, currency), currency)}`).join(' · ') || 'بدون رصيد'}</p>
        ))}
        {accounts.map(account => (
          <p key={account.id}>شام كاش {account.name}: {money(shamBalance(ops, account.id), account.currency)}</p>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">تقرير الأرباح يظل معلقاً إلى أن تُعتمد طريقة تكلفة العملات والرسوم. الظاهر هنا هو حجم العمليات وفروق السعر الخاص.</p>
    </section>
  );
}

function SetupSection({
  windows,
  profiles,
  board,
  master,
  customers,
  busy,
  onSaveWindow,
  onDeleteWindow,
  onSaveBoard,
  onSaveMaster,
  onAddCustomer,
  onDeleteCustomer,
}: {
  windows: CashWindow[];
  profiles: UserProfile[];
  board: ExchangeBoard;
  master: BranchMaster;
  customers: Customer[];
  busy: boolean;
  onSaveWindow: (window: CashWindow, previousUserId?: string | null) => void;
  onDeleteWindow: (window: CashWindow) => void;
  onSaveBoard: (board: ExchangeBoard) => void;
  onSaveMaster: (master: BranchMaster) => void;
  onAddCustomer: (name: string, phone: string) => void;
  onDeleteCustomer: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [userId, setUserId] = useState('');
  const [caps, setCaps] = useState<WindowCapability[]>(['exchange', 'remittance']);
  const [editing, setEditing] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [shamName, setShamName] = useState('');
  const [shamOwner, setShamOwner] = useState('');
  const [shamCurrency, setShamCurrency] = useState<Currency>('USD');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [draft, setDraft] = useState(board);

  useEffect(() => setDraft(board), [board]);

  function toggle(id: WindowCapability) {
    setCaps(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h2 className="font-semibold">الكوات والموظفون</h2>
        <input value={name} onChange={event => setName(event.target.value)} placeholder="اسم الموظف / الكوة" className={fieldClass} />
        <select value={userId} onChange={event => setUserId(event.target.value)} className={fieldClass}>
          <option value="">بدون حساب دخول</option>
          {profiles.filter(profile => !profile.isAdmin).map(profile => (
            <option key={profile.id} value={profile.id}>{profile.displayName}</option>
          ))}
        </select>
        <div className="space-y-1">
          {WINDOW_CAPABILITIES.map(item => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={caps.includes(item.id)} onChange={() => toggle(item.id)} />
              {item.label}
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => {
            const previous = windows.find(window => window.id === editing);
            onSaveWindow({
              id: previous?.id ?? `win_${crypto.randomUUID()}`,
              name: name.trim(),
              kind: 'employee',
              employeeName: name.trim(),
              userId: userId || null,
              capabilities: caps,
            }, previous?.userId);
            setName('');
            setUserId('');
            setEditing(null);
          }}
          className="w-full rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
        >
          {editing ? 'حفظ الكوة' : 'إنشاء كوة'}
        </button>
        <ul className="space-y-1 text-sm">
          {windows.map(window => (
            <li key={window.id} className="flex items-center justify-between rounded-lg bg-slate-900/50 px-3 py-2">
              <span>{window.name}</span>
              <span className="flex gap-2 text-xs">
                <button type="button" onClick={() => { setEditing(window.id); setName(window.name); setUserId(window.userId || ''); setCaps(window.capabilities); }}>تعديل</button>
                <button type="button" onClick={() => onDeleteWindow(window)} className="text-rose-300">حذف</button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h2 className="font-semibold">أسعار الشراء والمبيع</h2>
        {TRADE_CURRENCIES.filter(currency => currency !== 'SYP').map(currency => (
          <div key={currency} className="grid grid-cols-3 items-center gap-2 text-xs">
            <span>{getCurrencyLabel(currency)} / ليرة</span>
            <input value={draft.againstSyp[currency]?.buy || ''} onChange={event => setDraft(prev => ({ ...prev, againstSyp: { ...prev.againstSyp, [currency]: { buy: Number(event.target.value) || 0, sell: prev.againstSyp[currency]?.sell ?? 0 } } }))} placeholder="شراء" className={fieldClass} />
            <input value={draft.againstSyp[currency]?.sell || ''} onChange={event => setDraft(prev => ({ ...prev, againstSyp: { ...prev.againstSyp, [currency]: { sell: Number(event.target.value) || 0, buy: prev.againstSyp[currency]?.buy ?? 0 } } }))} placeholder="مبيع" className={fieldClass} />
          </div>
        ))}
        {TRADE_CURRENCIES.filter(currency => currency !== 'SYP' && currency !== 'USD').map(currency => (
          <div key={`${currency}-usd`} className="grid grid-cols-3 items-center gap-2 text-xs">
            <span>{getCurrencyLabel(currency)} / دولار</span>
            <input value={draft.againstUsd[currency]?.buy || ''} onChange={event => setDraft(prev => ({ ...prev, againstUsd: { ...prev.againstUsd, [currency]: { buy: Number(event.target.value) || 0, sell: prev.againstUsd[currency]?.sell ?? 0 } } }))} placeholder="شراء" className={fieldClass} />
            <input value={draft.againstUsd[currency]?.sell || ''} onChange={event => setDraft(prev => ({ ...prev, againstUsd: { ...prev.againstUsd, [currency]: { sell: Number(event.target.value) || 0, buy: prev.againstUsd[currency]?.buy ?? 0 } } }))} placeholder="مبيع" className={fieldClass} />
          </div>
        ))}
        <button type="button" disabled={busy} onClick={() => onSaveBoard(draft)} className="w-full rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-950">حفظ الأسعار</button>
        {master.rateHistory[0] && <p className="text-[11px] text-slate-500">آخر تحديث محفوظ: {new Date(master.rateHistory[0].at).toLocaleString('ar')} — {master.rateHistory[0].by}</p>}
      </div>

      <div className="space-y-2">
        <h2 className="font-semibold">شركات الحوالات</h2>
        <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (!companyName.trim()) return; onSaveMaster({ ...master, companies: [...master.companies, { id: crypto.randomUUID(), name: companyName.trim() }] }); setCompanyName(''); }}>
          <input value={companyName} onChange={event => setCompanyName(event.target.value)} placeholder="اسم الشركة" className={fieldClass} />
          <button className="rounded-xl bg-slate-200 px-3 text-sm text-slate-950">إضافة</button>
        </form>
        {master.companies.map(company => (
          <p key={company.id} className="flex justify-between text-sm"><span>{company.name}</span><button type="button" className="text-rose-300" onClick={() => onSaveMaster({ ...master, companies: master.companies.filter(item => item.id !== company.id) })}>حذف</button></p>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="font-semibold">حسابات شام كاش</h2>
        <input value={shamName} onChange={event => setShamName(event.target.value)} placeholder="اسم الحساب" className={fieldClass} />
        <input value={shamOwner} onChange={event => setShamOwner(event.target.value)} placeholder="المالك" className={fieldClass} />
        <select value={shamCurrency} onChange={event => setShamCurrency(event.target.value as Currency)} className={fieldClass}>{currencyOptions(TRADE_CURRENCIES)}</select>
        <button
          type="button"
          disabled={!shamName.trim()}
          onClick={() => {
            const account: ShamAccount = { id: crypto.randomUUID(), name: shamName.trim(), owner: shamOwner.trim() || shamName.trim(), currency: shamCurrency, active: true };
            onSaveMaster({ ...master, shamAccounts: [...master.shamAccounts, account] });
            setShamName('');
            setShamOwner('');
          }}
          className="w-full rounded-xl bg-sky-500 py-2 text-sm font-semibold text-slate-950"
        >
          إضافة الحساب
        </button>
        {master.shamAccounts.map(account => (
          <p key={account.id} className="flex justify-between text-sm">
            <span>{account.name} — {account.owner} — {account.currency}</span>
            <button type="button" className="text-rose-300" onClick={() => onSaveMaster({ ...master, shamAccounts: master.shamAccounts.filter(item => item.id !== account.id) })}>حذف</button>
          </p>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="font-semibold">العملاء</h2>
        <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={event => { event.preventDefault(); if (!customerName.trim() || !customerPhone.trim()) return; onAddCustomer(customerName.trim(), customerPhone.trim()); setCustomerName(''); setCustomerPhone(''); }}>
          <input value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="الاسم" className={fieldClass} />
          <input value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} placeholder="الهاتف" dir="ltr" className={fieldClass} />
          <button className="rounded-xl bg-slate-200 px-3 text-sm text-slate-950">إضافة</button>
        </form>
        {customers.map(customer => (
          <p key={customer.id} className="flex justify-between text-sm"><span>{customer.name} — {customer.phone}</span><button type="button" className="text-rose-300" onClick={() => onDeleteCustomer(customer.id)}>حذف</button></p>
        ))}
      </div>
    </section>
  );
}
