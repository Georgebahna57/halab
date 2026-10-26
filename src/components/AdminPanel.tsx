import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, Shield } from 'lucide-react';
import { TREASURY_FUND_ID, getCurrencyLabel } from '../config';
import { TRADE_CURRENCIES, fetchExchangeBoard, saveExchangeBoard, type ExchangeBoard } from '../lib/exchangeBoard';
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
  fetchBranchMaster,
  saveBranchMaster,
  type BranchMaster,
  type ShamAccount,
} from '../lib/branchMaster';
import { fetchAllProfiles, setUserAdmin, updateDisplayName } from '../lib/profile';
import type { UserProfile } from '../lib/permissions';
import { createCustomer } from '../lib/utils';
import { logAudit } from '../lib/auditLog';
import { BackupSection } from './BackupSection';
import { AuditLogSection } from './AuditLogSection';
import type { AppBackup } from '../lib/backup';
import type { ValuationRates } from '../lib/valuationRates';
import type { AppState, Currency, Customer } from '../types';

interface Props {
  onBack: () => void;
  displayName: string;
  appState: AppState;
  valuationRates: ValuationRates;
  onRestoreBackup: (backup: AppBackup, mode: 'merge' | 'replace') => Promise<void>;
  onAddCustomer: (customer: Customer) => Promise<void>;
  onDeleteCustomer: (id: string) => Promise<void>;
}

const fieldClass = 'w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-sm';

export function AdminPanel({
  onBack,
  displayName,
  appState,
  valuationRates,
  onRestoreBackup,
  onAddCustomer,
  onDeleteCustomer,
}: Props) {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [windows, setWindows] = useState<CashWindow[]>([TREASURY_WINDOW]);
  const [board, setBoard] = useState<ExchangeBoard>({ againstSyp: {}, againstUsd: {} });
  const [draft, setDraft] = useState<ExchangeBoard>({ againstSyp: {}, againstUsd: {} });
  const [master, setMaster] = useState<BranchMaster>({ companies: [], shamAccounts: [], rateHistory: [] });
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const employees = windows.filter(window => window.kind === 'employee');
  const customers = appState.customers.filter(customer => customer.fundId === TREASURY_FUND_ID);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [allProfiles, nextWindows, nextBoard, nextMaster] = await Promise.all([
        fetchAllProfiles(),
        fetchCashWindows(),
        fetchExchangeBoard(),
        fetchBranchMaster(),
      ]);
      setProfiles(allProfiles);
      setNameEdits(Object.fromEntries(allProfiles.map(profile => [profile.id, profile.displayName])));
      setWindows(nextWindows);
      setBoard(nextBoard);
      setDraft(nextBoard);
      setMaster(nextMaster);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function run(task: () => Promise<void>, ok: string) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await task();
      setSuccess(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="animate-spin text-amber-400" size={32} />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-amber-500/20 p-3">
            <Shield size={24} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">إدارة الفرع</h1>
            <p className="text-xs text-slate-500">الموظفون، الكوات، الأسعار، الشركات، وشام كاش</p>
          </div>
        </div>
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-400">
          <ArrowRight size={14} />
          رجوع
        </button>
      </header>

      {(error || success) && (
        <div className={`mb-4 rounded-xl px-3 py-2 text-xs ${error ? 'bg-rose-500/10 text-rose-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
          {error ?? success}
        </div>
      )}

      <section className="mb-6 space-y-3">
        <h2 className="font-semibold">الموظفون</h2>
        <p className="text-xs text-slate-500">
          الحسابات تُنشأ من Supabase ثم يظهر الموظف هنا. المسؤول يعتمد الأسعار الخاصة والجرد وإغلاق الوردية. الموظف ينفّذ من كوّته حسب الصلاحيات.
        </p>
        {profiles.map(profile => {
          const linked = employees.find(window => window.userId === profile.id);
          return (
            <div key={profile.id} className="rounded-2xl border border-slate-700 bg-slate-800/60 p-4">
              <p className="text-xs text-slate-500" dir="ltr">{profile.email}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={nameEdits[profile.id] ?? profile.displayName}
                  onChange={event => setNameEdits(prev => ({ ...prev, [profile.id]: event.target.value }))}
                  className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => run(() => updateDisplayName(profile.id, nameEdits[profile.id] ?? '').then(load), 'تم حفظ الاسم')}
                  className="rounded-xl border border-slate-600 px-3 py-2 text-xs"
                >
                  حفظ الاسم
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-400">{linked ? `كوّته: ${linked.name}` : 'بدون كوة'}</span>
                <label className="flex items-center gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    checked={profile.isAdmin}
                    disabled={saving}
                    onChange={event => run(() => setUserAdmin(profile.id, event.target.checked).then(load), event.target.checked ? 'تم تعيين مسؤول الفرع' : 'تم إلغاء المسؤول')}
                  />
                  مسؤول الفرع
                </label>
              </div>
            </div>
          );
        })}
      </section>

      <WindowsAdmin
        employees={employees}
        profiles={profiles}
        saving={saving}
        onSave={(window, previousUserId) => run(async () => {
          const next = [TREASURY_WINDOW, ...employees.filter(item => item.id !== window.id), window];
          await saveCashWindows(next);
          setWindows(next);
          await grantWindowAccess(window, previousUserId);
        }, 'تم حفظ الكوة')}
        onDelete={window => run(async () => {
          const next = [TREASURY_WINDOW, ...employees.filter(item => item.id !== window.id)];
          await saveCashWindows(next);
          setWindows(next);
          await grantWindowAccess({ ...window, userId: null }, window.userId);
        }, 'تم حذف الكوة')}
      />

      <section className="mb-6 space-y-2">
        <h2 className="font-semibold">أسعار الشراء والمبيع</h2>
        <p className="text-xs text-slate-500">السعر المحفوظ هنا هو السعر الأساسي. أي سعر خاص على عملية يبقى مسجلاً مع سبب الاستثناء.</p>
        {TRADE_CURRENCIES.filter(currency => currency !== 'SYP').map(currency => (
          <RateRow
            key={currency}
            label={`${getCurrencyLabel(currency)} / ليرة`}
            buy={draft.againstSyp[currency]?.buy}
            sell={draft.againstSyp[currency]?.sell}
            onBuy={value => setDraft(prev => ({ ...prev, againstSyp: { ...prev.againstSyp, [currency]: { buy: value, sell: prev.againstSyp[currency]?.sell ?? 0 } } }))}
            onSell={value => setDraft(prev => ({ ...prev, againstSyp: { ...prev.againstSyp, [currency]: { sell: value, buy: prev.againstSyp[currency]?.buy ?? 0 } } }))}
          />
        ))}
        {TRADE_CURRENCIES.filter(currency => currency !== 'SYP' && currency !== 'USD').map(currency => (
          <RateRow
            key={`${currency}-usd`}
            label={`${getCurrencyLabel(currency)} / دولار`}
            buy={draft.againstUsd[currency]?.buy}
            sell={draft.againstUsd[currency]?.sell}
            onBuy={value => setDraft(prev => ({ ...prev, againstUsd: { ...prev.againstUsd, [currency]: { buy: value, sell: prev.againstUsd[currency]?.sell ?? 0 } } }))}
            onSell={value => setDraft(prev => ({ ...prev, againstUsd: { ...prev.againstUsd, [currency]: { sell: value, buy: prev.againstUsd[currency]?.buy ?? 0 } } }))}
          />
        ))}
        <button
          type="button"
          disabled={saving}
          onClick={() => run(async () => {
            const history = [{ at: new Date().toISOString(), by: displayName, board }, ...master.rateHistory].slice(0, 30);
            await saveExchangeBoard(draft);
            const saved = { ...master, rateHistory: history };
            await saveBranchMaster(saved);
            setBoard(draft);
            setMaster(saved);
            void logAudit({
              userName: displayName,
              action: 'transaction_edit',
              entityType: 'rates',
              details: 'تحديث أسعار الصرافة من الإدارة',
            });
          }, 'تم حفظ أسعار الصرافة')}
          className="w-full rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
        >
          حفظ الأسعار
        </button>
        {master.rateHistory[0] && (
          <p className="text-[11px] text-slate-500">آخر تحديث: {new Date(master.rateHistory[0].at).toLocaleString('ar')} — {master.rateHistory[0].by}</p>
        )}
      </section>

      <CompaniesAdmin
        master={master}
        saving={saving}
        onSave={next => run(async () => {
          await saveBranchMaster(next);
          setMaster(next);
        }, 'تم حفظ الشركات وحسابات شام كاش')}
      />

      <CustomersAdmin
        customers={customers}
        saving={saving}
        onAdd={(name, phone) => run(() => onAddCustomer(createCustomer({ fundId: TREASURY_FUND_ID, name, phone })), 'تم تعريف العميل')}
        onDelete={id => run(() => onDeleteCustomer(id), 'تم حذف العميل')}
      />

      <BackupSection appState={appState} valuationRates={valuationRates} isAdmin onRestore={onRestoreBackup} />
      <AuditLogSection />
    </div>
  );
}

function RateRow({
  label,
  buy,
  sell,
  onBuy,
  onSell,
}: {
  label: string;
  buy?: number;
  sell?: number;
  onBuy: (value: number) => void;
  onSell: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 items-center gap-2 text-xs">
      <span>{label}</span>
      <input value={buy || ''} onChange={event => onBuy(Number(event.target.value) || 0)} placeholder="شراء" inputMode="decimal" className={fieldClass} />
      <input value={sell || ''} onChange={event => onSell(Number(event.target.value) || 0)} placeholder="مبيع" inputMode="decimal" className={fieldClass} />
    </div>
  );
}

function WindowsAdmin({
  employees,
  profiles,
  saving,
  onSave,
  onDelete,
}: {
  employees: CashWindow[];
  profiles: UserProfile[];
  saving: boolean;
  onSave: (window: CashWindow, previousUserId?: string | null) => void;
  onDelete: (window: CashWindow) => void;
}) {
  const [name, setName] = useState('');
  const [userId, setUserId] = useState('');
  const [caps, setCaps] = useState<WindowCapability[]>(['exchange', 'remittance']);
  const [editing, setEditing] = useState<string | null>(null);

  function toggle(id: WindowCapability) {
    setCaps(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  }

  return (
    <section className="mb-6 space-y-2">
      <h2 className="font-semibold">الكوات وصلاحياتها</h2>
      <p className="text-xs text-slate-500">كل كوة باسم الموظف. الصلاحية تحدد ما يستطيع تنفيذه خلال ورديته.</p>
      <input value={name} onChange={event => setName(event.target.value)} placeholder="اسم الموظف" className={fieldClass} />
      <select value={userId} onChange={event => setUserId(event.target.value)} className={fieldClass}>
        <option value="">بدون حساب دخول</option>
        {profiles.filter(profile => !profile.isAdmin).map(profile => (
          <option key={profile.id} value={profile.id}>{profile.displayName}</option>
        ))}
      </select>
      <div className="space-y-1 rounded-xl border border-slate-700 p-3">
        {WINDOW_CAPABILITIES.map(item => (
          <label key={item.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={caps.includes(item.id)} onChange={() => toggle(item.id)} />
            {item.label}
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={saving || !name.trim()}
        onClick={() => {
          const previous = employees.find(window => window.id === editing);
          onSave({
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
        {employees.map(window => (
          <li key={window.id} className="rounded-lg bg-slate-900/50 px-3 py-2">
            <div className="flex items-center justify-between">
              <span>{window.name}</span>
              <span className="flex gap-2 text-xs">
                <button type="button" onClick={() => { setEditing(window.id); setName(window.name); setUserId(window.userId || ''); setCaps(window.capabilities); }}>تعديل</button>
                <button type="button" className="text-rose-300" onClick={() => onDelete(window)}>حذف</button>
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {window.capabilities.map(id => WINDOW_CAPABILITIES.find(item => item.id === id)?.label).filter(Boolean).join(' · ') || 'بدون صلاحيات'}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CompaniesAdmin({
  master,
  saving,
  onSave,
}: {
  master: BranchMaster;
  saving: boolean;
  onSave: (master: BranchMaster) => void;
}) {
  const [companyName, setCompanyName] = useState('');
  const [shamName, setShamName] = useState('');
  const [shamOwner, setShamOwner] = useState('');
  const [shamCurrency, setShamCurrency] = useState<Currency>('USD');

  return (
    <>
      <section className="mb-6 space-y-2">
        <h2 className="font-semibold">شركات الحوالات</h2>
        <form className="flex gap-2" onSubmit={event => {
          event.preventDefault();
          if (!companyName.trim()) return;
          onSave({ ...master, companies: [...master.companies, { id: crypto.randomUUID(), name: companyName.trim() }] });
          setCompanyName('');
        }}>
          <input value={companyName} onChange={event => setCompanyName(event.target.value)} placeholder="اسم الشركة" className={fieldClass} />
          <button disabled={saving} className="rounded-xl bg-slate-200 px-3 text-sm text-slate-950">إضافة</button>
        </form>
        {master.companies.map(company => (
          <p key={company.id} className="flex justify-between text-sm">
            <span>{company.name}</span>
            <button type="button" className="text-rose-300" onClick={() => onSave({ ...master, companies: master.companies.filter(item => item.id !== company.id) })}>حذف</button>
          </p>
        ))}
      </section>
      <section className="mb-6 space-y-2">
        <h2 className="font-semibold">حسابات شام كاش</h2>
        <p className="text-xs text-slate-500">كل حساب إلكتروني مستقل عن نقد الكوة: الاسم، المالك، والعملة.</p>
        <input value={shamName} onChange={event => setShamName(event.target.value)} placeholder="اسم الحساب" className={fieldClass} />
        <input value={shamOwner} onChange={event => setShamOwner(event.target.value)} placeholder="المالك" className={fieldClass} />
        <select value={shamCurrency} onChange={event => setShamCurrency(event.target.value as Currency)} className={fieldClass}>
          {TRADE_CURRENCIES.map(currency => <option key={currency} value={currency}>{getCurrencyLabel(currency)}</option>)}
        </select>
        <button
          type="button"
          disabled={saving || !shamName.trim()}
          onClick={() => {
            const account: ShamAccount = {
              id: crypto.randomUUID(),
              name: shamName.trim(),
              owner: shamOwner.trim() || shamName.trim(),
              currency: shamCurrency,
              active: true,
            };
            onSave({ ...master, shamAccounts: [...master.shamAccounts, account] });
            setShamName('');
            setShamOwner('');
          }}
          className="w-full rounded-xl bg-sky-500 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
        >
          إضافة الحساب
        </button>
        {master.shamAccounts.map(account => (
          <p key={account.id} className="flex justify-between text-sm">
            <span>{account.name} — {account.owner} — {getCurrencyLabel(account.currency)}</span>
            <button type="button" className="text-rose-300" onClick={() => onSave({ ...master, shamAccounts: master.shamAccounts.filter(item => item.id !== account.id) })}>حذف</button>
          </p>
        ))}
      </section>
    </>
  );
}

function CustomersAdmin({
  customers,
  saving,
  onAdd,
  onDelete,
}: {
  customers: Customer[];
  saving: boolean;
  onAdd: (name: string, phone: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  return (
    <section className="mb-6 space-y-2">
      <h2 className="font-semibold">العملاء</h2>
      <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={event => {
        event.preventDefault();
        if (!name.trim() || !phone.trim()) return;
        onAdd(name.trim(), phone.trim());
        setName('');
        setPhone('');
      }}>
        <input value={name} onChange={event => setName(event.target.value)} placeholder="الاسم" className={fieldClass} />
        <input value={phone} onChange={event => setPhone(event.target.value)} placeholder="الهاتف" dir="ltr" className={fieldClass} />
        <button disabled={saving} className="rounded-xl bg-slate-200 px-3 text-sm text-slate-950">إضافة</button>
      </form>
      {customers.map(customer => (
        <p key={customer.id} className="flex justify-between text-sm">
          <span>{customer.name} — {customer.phone}</span>
          <button type="button" className="text-rose-300" onClick={() => onDelete(customer.id)}>حذف</button>
        </p>
      ))}
    </section>
  );
}
