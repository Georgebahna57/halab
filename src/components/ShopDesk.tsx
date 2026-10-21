import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Landmark, Loader2, Plus, Trash2 } from 'lucide-react';
import { CURRENCIES, TREASURY_FUND_ID, getCurrencyLabel, getCurrencySymbol, isWeightCurrency } from '../config';
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
  currenciesForQuote,
  fetchExchangeBoard,
  quoteAmountFor,
  rateFor,
  saveExchangeBoard,
  type ExchangeBoard,
  type QuoteCurrency,
  type ShopSide,
} from '../lib/exchangeBoard';
import { balanceOf, buildCashMovement, buildFeed, buildShopExchange } from '../lib/deskOps';
import { computeBalances, createCustomer, formatAmount } from '../lib/utils';
import type { UserProfile } from '../lib/permissions';
import type { Currency, Customer, FundBalances, Transaction } from '../types';

interface Props {
  isAdmin: boolean;
  userId: string;
  displayName: string;
  profiles: UserProfile[];
  transactions: Transaction[];
  customers: Customer[];
  onAddTransactions: (tx: Transaction | Transaction[]) => Promise<void>;
  onAddCustomer: (customer: Customer) => Promise<void>;
  onDeleteCustomer: (id: string) => Promise<void>;
}

type AdminTab = 'treasury' | 'windows' | 'customers' | 'rates' | 'operate';

const fieldClass = 'w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-sm';
const labelClass = 'mb-1 block text-[10px] text-slate-400';

function AllBalances({ balances }: { balances: FundBalances }) {
  const rows = CURRENCIES.filter(c => c.kind === 'money' && c.id !== 'NSYP');
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {rows.map(c => {
        const balance = balances[c.id]?.balance ?? 0;
        const positive = balance >= 0;
        return (
          <div
            key={c.id}
            className={`rounded-2xl border p-3 ${positive ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10'}`}
          >
            <p className="text-xs text-slate-400">{c.label}</p>
            <p className={`mt-1 text-lg font-bold tabular-nums ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
              {formatAmount(Math.abs(balance), c.id)} <span className="text-sm">{c.symbol}</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

function currencyOptions(list: Currency[]) {
  return list.map(id => {
    const asset = CURRENCIES.find(c => c.id === id);
    return (
      <option key={id} value={id}>
        {asset ? `${asset.label} (${asset.symbol})` : id}
      </option>
    );
  });
}

export function ShopDesk({
  isAdmin,
  userId,
  displayName,
  profiles,
  transactions,
  customers,
  onAddTransactions,
  onAddCustomer,
  onDeleteCustomer,
}: Props) {
  const [windows, setWindows] = useState<CashWindow[]>([TREASURY_WINDOW]);
  const [board, setBoard] = useState<ExchangeBoard>({ againstSyp: {}, againstUsd: {} });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>('treasury');
  const [activeWindowId, setActiveWindowId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCashWindows(), fetchExchangeBoard()])
      .then(([nextWindows, nextBoard]) => {
        if (cancelled) return;
        setWindows(nextWindows);
        setBoard(nextBoard);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'فشل تحميل الكوة');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const employees = windows.filter(w => w.kind === 'employee');
  const myWindow = employees.find(w => w.userId === userId)
    ?? employees.find(w => w.employeeName === displayName);

  const treasuryBalances = useMemo(
    () => computeBalances(transactions, TREASURY_FUND_ID),
    [transactions],
  );
  const shopCustomers = customers.filter(c => c.fundId === TREASURY_FUND_ID);

  async function persistWindows(next: CashWindow[], message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveCashWindows(next);
      setWindows(next);
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل حفظ الكوات');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-amber-400" size={28} />
      </div>
    );
  }

  const operateWindow = isAdmin
    ? employees.find(w => w.id === activeWindowId) ?? null
    : myWindow ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-amber-500/20 p-3">
          <Landmark size={22} className="text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold">الكوة</h2>
          <p className="text-xs text-slate-500">
            {isAdmin ? 'الخزنة، كوات الموظفين، الزبائن، وسعر الصرف' : (myWindow?.name ?? 'كوة الصندوق')}
          </p>
        </div>
      </div>

      {(error || notice) && (
        <div className={`rounded-xl px-3 py-2 text-xs ${error ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
          {error ?? notice}
        </div>
      )}

      {isAdmin && (
        <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-700 bg-slate-800/50 p-1">
          {([
            ['treasury', 'الخزنة'],
            ['windows', 'كوات الموظفين'],
            ['customers', 'الزبائن'],
            ['rates', 'سعر الصرف'],
            ['operate', 'تشغيل كوة'],
          ] as [AdminTab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium ${tab === id ? 'bg-slate-700 text-amber-400' : 'text-slate-400'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {isAdmin && tab === 'treasury' && (
        <TreasuryPanel
          balances={treasuryBalances}
          employees={employees}
          busy={busy}
          onFeed={async (windowId, currency, amount) => {
            const target = employees.find(w => w.id === windowId);
            if (!target) return;
            if (balanceOf(treasuryBalances, currency) < amount) {
              setError('رصيد الخزنة ما يكفي لهالتغذية');
              return;
            }
            setBusy(true);
            setError(null);
            try {
              await onAddTransactions(buildFeed({
                fromId: TREASURY_FUND_ID,
                toId: target.id,
                currency,
                amount,
                note: `تغذية صندوق ${target.name}`,
              }));
              setNotice(`تم تغذية ${target.name}`);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'فشل التغذية');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {isAdmin && tab === 'windows' && (
        <WindowsPanel
          employees={employees}
          profiles={profiles}
          busy={busy}
          onSave={async (window, previousUserId) => {
            const duplicate = employees.some(w => w.id !== window.id && w.name === window.name);
            if (duplicate) {
              setError('في كوة بهالاسم');
              return;
            }
            const next = [
              TREASURY_WINDOW,
              ...employees.filter(w => w.id !== window.id),
              window,
            ];
            await persistWindows(next, 'تم حفظ الكوة');
            try {
              await grantWindowAccess(window, previousUserId);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'تم حفظ الكوة، وفشل حفظ صلاحية الدخول');
            }
          }}
          onDelete={async window => {
            await persistWindows(
              [TREASURY_WINDOW, ...employees.filter(w => w.id !== window.id)],
              'تم حذف الكوة',
            );
          }}
        />
      )}

      {isAdmin && tab === 'customers' && (
        <CustomersPanel
          customers={shopCustomers}
          busy={busy}
          onAdd={async (name, phone) => {
            setBusy(true);
            setError(null);
            try {
              await onAddCustomer(createCustomer({
                fundId: TREASURY_FUND_ID,
                name,
                phone,
              }));
              setNotice('تم تعريف الزبون');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'فشل حفظ الزبون');
            } finally {
              setBusy(false);
            }
          }}
          onDelete={async id => {
            setBusy(true);
            setError(null);
            try {
              await onDeleteCustomer(id);
              setNotice('تم حذف الزبون');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'فشل الحذف');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {isAdmin && tab === 'rates' && (
        <RatesPanel
          board={board}
          busy={busy}
          onSave={async next => {
            setBusy(true);
            setError(null);
            try {
              await saveExchangeBoard(next);
              setBoard(next);
              setNotice('تم حفظ سعر الصرف');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'فشل حفظ السعر');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {((isAdmin && tab === 'operate') || !isAdmin) && (
        <>
          {isAdmin && employees.length > 0 && (
            <label className="block text-xs text-slate-400">
              الكوة
              <select
                value={activeWindowId}
                onChange={e => setActiveWindowId(e.target.value)}
                className={`${fieldClass} mt-1`}
              >
                <option value="">اختر كوة الموظف</option>
                {employees.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
          )}
          {operateWindow ? (
            <WindowOperations
              window={operateWindow}
              balances={computeBalances(transactions, operateWindow.id)}
              treasuryBalances={treasuryBalances}
              board={board}
              customers={shopCustomers}
              allowAll={isAdmin}
              busy={busy}
              recent={transactions.filter(tx => tx.fundId === operateWindow.id && (tx.ledger ?? 'fund') === 'fund').slice(0, 6)}
              onRun={async (make, okMessage) => {
                setBusy(true);
                setError(null);
                try {
                  await onAddTransactions(make());
                  setNotice(okMessage);
                  return true;
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'فشل تسجيل العملية');
                  return false;
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-500">
              {isAdmin ? 'اختر كوة موظف، أو أنشئ واحدة من تبويب الكوات.' : 'ما في كوة مربوطة بحسابك. راجع المسؤول.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TreasuryPanel({
  balances,
  employees,
  busy,
  onFeed,
}: {
  balances: FundBalances;
  employees: CashWindow[];
  busy: boolean;
  onFeed: (windowId: string, currency: Currency, amount: number) => Promise<void>;
}) {
  const [windowId, setWindowId] = useState(employees[0]?.id ?? '');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [amount, setAmount] = useState('');

  return (
    <section className="space-y-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div>
        <h3 className="font-semibold text-amber-300">الخزنة</h3>
        <p className="text-xs text-slate-500">الكوة الرئيسية — كل أرصدة العملات</p>
      </div>
      <AllBalances balances={balances} />
      <form
        className="space-y-2 rounded-xl border border-slate-700 bg-slate-900/40 p-3"
        onSubmit={async e => {
          e.preventDefault();
          const parsed = Number(amount.replace(/,/g, '')) || 0;
          if (!windowId || parsed <= 0) return;
          await onFeed(windowId, currency, parsed);
          setAmount('');
        }}
      >
        <p className="text-xs font-medium text-slate-300">تغذية صندوق موظف من الخزنة</p>
        <select value={windowId} onChange={e => setWindowId(e.target.value)} className={fieldClass}>
          {employees.length === 0 && <option value="">لا يوجد موظفون</option>}
          {employees.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className={fieldClass}>
            {currencyOptions(TRADE_CURRENCIES)}
          </select>
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="المبلغ" className={fieldClass} />
        </div>
        <button type="submit" disabled={busy || !employees.length} className="w-full rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50">
          تغذية الصندوق
        </button>
      </form>
    </section>
  );
}

function WindowsPanel({
  employees,
  profiles,
  busy,
  onSave,
  onDelete,
}: {
  employees: CashWindow[];
  profiles: UserProfile[];
  busy: boolean;
  onSave: (window: CashWindow, previousUserId?: string | null) => Promise<void>;
  onDelete: (window: CashWindow) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [userId, setUserId] = useState('');
  const [capabilities, setCapabilities] = useState<WindowCapability[]>([]);

  function load(window?: CashWindow) {
    setEditingId(window?.id ?? null);
    setName(window?.employeeName || window?.name || '');
    setUserId(window?.userId ?? '');
    setCapabilities(window?.capabilities ?? []);
  }

  function toggle(id: WindowCapability) {
    setCapabilities(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-700 bg-slate-800/40 p-4">
      <h3 className="font-semibold">كوات الموظفين</h3>
      <form
        className="space-y-2"
        onSubmit={async e => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          const previous = employees.find(w => w.id === editingId);
          await onSave({
            id: previous?.id ?? `win_${crypto.randomUUID()}`,
            name: trimmed,
            kind: 'employee',
            employeeName: trimmed,
            userId: userId || null,
            capabilities,
          }, previous?.userId);
          load();
        }}
      >
        <label className={labelClass}>اسم الموظف</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="اسم الموظف" className={fieldClass} />
        <label className={labelClass}>حساب الدخول (اختياري)</label>
        <select value={userId} onChange={e => setUserId(e.target.value)} className={fieldClass}>
          <option value="">بدون ربط</option>
          {profiles.filter(p => !p.isAdmin).map(p => (
            <option key={p.id} value={p.id}>{p.displayName} — {p.email}</option>
          ))}
        </select>
        <div className="space-y-1 rounded-xl border border-slate-700 p-2">
          {WINDOW_CAPABILITIES.map(item => (
            <label key={item.id} className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={capabilities.includes(item.id)}
                onChange={() => toggle(item.id)}
              />
              {item.label}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50">
            <Plus size={14} />
            {editingId ? 'حفظ التعديل' : 'إنشاء الكوة'}
          </button>
          {editingId && (
            <button type="button" onClick={() => load()} className="rounded-xl border border-slate-600 px-3 text-xs text-slate-300">
              إلغاء
            </button>
          )}
        </div>
      </form>

      <ul className="space-y-2">
        {employees.map(window => (
          <li key={window.id} className="rounded-xl border border-slate-700 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{window.name}</p>
                <p className="text-[11px] text-slate-500">
                  {window.capabilities.length
                    ? window.capabilities.map(id => WINDOW_CAPABILITIES.find(item => item.id === id)?.label).join(' · ')
                    : 'بدون صلاحيات'}
                </p>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => load(window)} className="rounded-lg px-2 py-1 text-[11px] text-amber-300">تعديل</button>
                <button type="button" onClick={() => onDelete(window)} className="rounded-lg p-1 text-rose-400" aria-label="حذف">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </li>
        ))}
        {employees.length === 0 && <li className="text-xs text-slate-500">لم تُنشأ كوات بعد.</li>}
      </ul>
    </section>
  );
}

function CustomersPanel({
  customers,
  busy,
  onAdd,
  onDelete,
}: {
  customers: Customer[];
  busy: boolean;
  onAdd: (name: string, phone: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  return (
    <section className="space-y-3 rounded-2xl border border-slate-700 bg-slate-800/40 p-4">
      <h3 className="font-semibold">تعريف الزبائن</h3>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={async e => {
          e.preventDefault();
          if (!name.trim() || !phone.trim()) return;
          await onAdd(name.trim(), phone.trim());
          setName('');
          setPhone('');
        }}
      >
        <input value={name} onChange={e => setName(e.target.value)} placeholder="الاسم" className={fieldClass} />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="رقم الهاتف" dir="ltr" className={fieldClass} />
        <button type="submit" disabled={busy} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50">
          إضافة
        </button>
      </form>
      <ul className="space-y-1">
        {customers.map(customer => (
          <li key={customer.id} className="flex items-center justify-between rounded-lg bg-slate-900/50 px-3 py-2 text-sm">
            <span>{customer.name} <span className="text-slate-500" dir="ltr">{customer.phone}</span></span>
            <button type="button" onClick={() => onDelete(customer.id)} className="text-rose-400" aria-label="حذف">
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {customers.length === 0 && <li className="text-xs text-slate-500">لا يوجد زبائن بعد.</li>}
      </ul>
    </section>
  );
}

function RatesPanel({
  board,
  busy,
  onSave,
}: {
  board: ExchangeBoard;
  busy: boolean;
  onSave: (board: ExchangeBoard) => Promise<void>;
}) {
  const [draft, setDraft] = useState(board);
  useEffect(() => setDraft(board), [board]);

  function setRate(table: 'againstSyp' | 'againstUsd', currency: Currency, side: 'buy' | 'sell', raw: string) {
    const value = Number(raw.replace(/,/g, '')) || 0;
    setDraft(prev => ({
      ...prev,
      [table]: {
        ...prev[table],
        [currency]: { buy: 0, sell: 0, ...prev[table][currency], [side]: value },
      },
    }));
  }

  const sypCurrencies = TRADE_CURRENCIES.filter(c => c !== 'SYP');
  const usdCurrencies = TRADE_CURRENCIES.filter(c => c !== 'SYP' && c !== 'USD');

  return (
    <section className="space-y-4 rounded-2xl border border-slate-700 bg-slate-800/40 p-4">
      <div>
        <h3 className="font-semibold">سعر الصرف</h3>
        <p className="text-xs text-slate-500">شراء = سعر شراء المحل للعملة. مبيع = سعر مبيع المحل.</p>
      </div>
      <RateTable
        title="مقابل الليرة السورية — كم ليرة لكل 1"
        currencies={sypCurrencies}
        table="againstSyp"
        draft={draft}
        onChange={setRate}
      />
      <RateTable
        title="مقابل الدولار — كم دولار لكل 1"
        currencies={usdCurrencies}
        table="againstUsd"
        draft={draft}
        onChange={setRate}
      />
      <p className="text-[11px] text-slate-500">الليرة مقابل الدولار تُحسب من سعر الدولار في جدول الليرة.</p>
      <button type="button" disabled={busy} onClick={() => onSave(draft)} className="w-full rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50">
        حفظ سعر الصرف
      </button>
    </section>
  );
}

function RateTable({
  title,
  currencies,
  table,
  draft,
  onChange,
}: {
  title: string;
  currencies: Currency[];
  table: 'againstSyp' | 'againstUsd';
  draft: ExchangeBoard;
  onChange: (table: 'againstSyp' | 'againstUsd', currency: Currency, side: 'buy' | 'sell', raw: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-slate-300">{title}</p>
      <div className="space-y-2">
        {currencies.map(currency => {
          const pair = draft[table][currency];
          return (
            <div key={currency} className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2">
              <span className="text-xs">{getCurrencyLabel(currency)}</span>
              <input
                value={pair?.buy ? String(pair.buy) : ''}
                onChange={e => onChange(table, currency, 'buy', e.target.value)}
                inputMode="decimal"
                placeholder="شراء"
                className={fieldClass}
              />
              <input
                value={pair?.sell ? String(pair.sell) : ''}
                onChange={e => onChange(table, currency, 'sell', e.target.value)}
                inputMode="decimal"
                placeholder="مبيع"
                className={fieldClass}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WindowOperations({
  window,
  balances,
  treasuryBalances,
  board,
  customers,
  allowAll,
  busy,
  recent,
  onRun,
}: {
  window: CashWindow;
  balances: FundBalances;
  treasuryBalances: FundBalances;
  board: ExchangeBoard;
  customers: Customer[];
  allowAll: boolean;
  busy: boolean;
  recent: Transaction[];
  onRun: (make: () => Transaction | Transaction[], okMessage: string) => Promise<boolean>;
}) {
  const can = (id: WindowCapability) => allowAll || window.capabilities.includes(id);
  const [side, setSide] = useState<ShopSide>('buy');
  const [quote, setQuote] = useState<QuoteCurrency>('SYP');
  const tradable = useMemo(() => currenciesForQuote(quote), [quote]);
  const [traded, setTraded] = useState<Currency>(tradable[0] ?? 'USD');
  const [tradedAmount, setTradedAmount] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [moveCurrency, setMoveCurrency] = useState<Currency>('USD');
  const [moveAmount, setMoveAmount] = useState('');
  const [moveDirection, setMoveDirection] = useState<'in' | 'out'>('in');
  const [feedCurrency, setFeedCurrency] = useState<Currency>('USD');
  const [feedAmount, setFeedAmount] = useState('');
  const [returnCurrency, setReturnCurrency] = useState<Currency>('USD');
  const [returnAmount, setReturnAmount] = useState('');
  const [sender, setSender] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [beneficiaryPhone, setBeneficiaryPhone] = useState('');
  const [destination, setDestination] = useState('');
  const [remitDirection, setRemitDirection] = useState<'in' | 'out'>('out');
  const [remitCurrency, setRemitCurrency] = useState<Currency>('USD');
  const [remitAmount, setRemitAmount] = useState('');

  useEffect(() => {
    if (!tradable.includes(traded)) setTraded(tradable[0] ?? 'USD');
  }, [quote, tradable, traded]);

  const amount = Number(tradedAmount.replace(/,/g, '')) || 0;
  const rate = rateFor(board, traded, quote, side);
  const quoteAmount = quoteAmountFor(traded, quote, amount, rate);
  const quoteCurrency: Currency = quote === 'SYP' ? 'SYP' : 'USD';
  const pays = side === 'buy' ? quoteCurrency : traded;
  const paysAmount = side === 'buy' ? quoteAmount : amount;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-semibold text-sky-300">{window.name}</h3>
        <p className="text-xs text-slate-500">كوة الصندوق — استقبال الأرصدة من الخزنة، وشراء ومبيع العملات</p>
      </div>
      <AllBalances balances={balances} />

      {can('feedFund') && (
        <OperationCard title="استقبال رصيد من الخزنة">
          <form
            className="grid grid-cols-2 gap-2"
            onSubmit={async e => {
              e.preventDefault();
              const parsed = Number(feedAmount.replace(/,/g, '')) || 0;
              if (parsed <= 0) return;
              const ok = await onRun(
                () => {
                  if (balanceOf(treasuryBalances, feedCurrency) < parsed) throw new Error('رصيد الخزنة ما يكفي');
                  return buildFeed({
                    fromId: TREASURY_FUND_ID,
                    toId: window.id,
                    currency: feedCurrency,
                    amount: parsed,
                    note: `تغذية صندوق ${window.name}`,
                  });
                },
                'تم استقبال الرصيد من الخزنة',
              );
              if (ok) setFeedAmount('');
            }}
          >
            <select value={feedCurrency} onChange={e => setFeedCurrency(e.target.value as Currency)} className={fieldClass}>
              {currencyOptions(TRADE_CURRENCIES)}
            </select>
            <input value={feedAmount} onChange={e => setFeedAmount(e.target.value)} inputMode="decimal" placeholder="المبلغ" className={fieldClass} />
            <button type="submit" disabled={busy} className="col-span-2 rounded-xl bg-sky-500 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
              استقبال من الخزنة
            </button>
          </form>
        </OperationCard>
      )}

      {can('feedTreasury') && (
        <OperationCard title="إعادة الفائض إلى الخزنة">
          <form
            className="grid grid-cols-2 gap-2"
            onSubmit={async e => {
              e.preventDefault();
              const parsed = Number(returnAmount.replace(/,/g, '')) || 0;
              if (parsed <= 0) return;
              const ok = await onRun(
                () => {
                  if (balanceOf(balances, returnCurrency) < parsed) throw new Error('رصيد الكوة ما يكفي');
                  return buildFeed({
                    fromId: window.id,
                    toId: TREASURY_FUND_ID,
                    currency: returnCurrency,
                    amount: parsed,
                    note: `إعادة فائض ${window.name} إلى الخزنة`,
                  });
                },
                'تم إرجاع الفائض إلى الخزنة',
              );
              if (ok) setReturnAmount('');
            }}
          >
            <select value={returnCurrency} onChange={e => setReturnCurrency(e.target.value as Currency)} className={fieldClass}>
              {currencyOptions(TRADE_CURRENCIES)}
            </select>
            <input value={returnAmount} onChange={e => setReturnAmount(e.target.value)} inputMode="decimal" placeholder="المبلغ" className={fieldClass} />
            <button type="submit" disabled={busy} className="col-span-2 rounded-xl border border-amber-500/40 py-2 text-sm font-semibold text-amber-300 disabled:opacity-50">
              تغذية الخزنة
            </button>
          </form>
        </OperationCard>
      )}

      {can('exchange') && (
        <OperationCard title="صرافة — شراء ومبيع">
          <form
            className="space-y-2"
            onSubmit={async e => {
              e.preventDefault();
              if (amount <= 0) return;
              const ok = await onRun(
                () => {
                  if (rate <= 0) throw new Error('حدّد سعر الصرف أولاً من الإدارة');
                  if (balanceOf(balances, pays) < paysAmount) throw new Error(`رصيد ${getCurrencyLabel(pays)} بالكوة ما يكفي`);
                  return buildShopExchange({
                    window,
                    side,
                    traded,
                    quote,
                    tradedAmount: amount,
                    rate,
                    customerName: customerName || undefined,
                  });
                },
                side === 'buy' ? 'تم شراء العملة' : 'تم مبيع العملة',
              );
              if (ok) setTradedAmount('');
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <select value={side} onChange={e => setSide(e.target.value as ShopSide)} className={fieldClass}>
                <option value="buy">شراء</option>
                <option value="sell">مبيع</option>
              </select>
              <select value={quote} onChange={e => setQuote(e.target.value as QuoteCurrency)} className={fieldClass}>
                <option value="SYP">مقابل الليرة السورية</option>
                <option value="USD">مقابل الدولار</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={traded} onChange={e => setTraded(e.target.value as Currency)} className={fieldClass}>
                {currencyOptions(tradable)}
              </select>
              <input value={tradedAmount} onChange={e => setTradedAmount(e.target.value)} inputMode="decimal" placeholder="كمية العملة" className={fieldClass} />
            </div>
            <select value={customerName} onChange={e => setCustomerName(e.target.value)} className={fieldClass}>
              <option value="">بدون زبون</option>
              {customers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <p className="text-[11px] text-slate-400">
              السعر: {rate > 0 ? formatAmount(rate, quote === 'SYP' || traded === 'SYP' ? 'SYP' : 'USD') : 'غير محدد'}
              {amount > 0 && rate > 0 && (
                <> — المقابل {formatAmount(quoteAmount, quoteCurrency)} {getCurrencySymbol(quoteCurrency)}</>
              )}
            </p>
            <button type="submit" disabled={busy} className="w-full rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50">
              تنفيذ {side === 'buy' ? 'الشراء' : 'المبيع'}
            </button>
          </form>
        </OperationCard>
      )}

      {can('receiveDeliver') && (
        <OperationCard title="استلام وتسليم">
          <form
            className="space-y-2"
            onSubmit={async e => {
              e.preventDefault();
              const parsed = Number(moveAmount.replace(/,/g, '')) || 0;
              if (parsed <= 0) return;
              const ok = await onRun(
                () => {
                  if (moveDirection === 'out' && balanceOf(balances, moveCurrency) < parsed) {
                    throw new Error('رصيد الكوة ما يكفي للتسليم');
                  }
                  return buildCashMovement({
                    window,
                    direction: moveDirection,
                    currency: moveCurrency,
                    amount: parsed,
                    customerName: customerName || undefined,
                    note: moveDirection === 'in' ? 'مقبوضات' : 'مدفوعات',
                  });
                },
                moveDirection === 'in' ? 'تم تسجيل المقبوضات' : 'تم تسجيل المدفوعات',
              );
              if (ok) setMoveAmount('');
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <select value={moveDirection} onChange={e => setMoveDirection(e.target.value as 'in' | 'out')} className={fieldClass}>
                <option value="in">مقبوضات — استلام</option>
                <option value="out">مدفوعات — تسليم</option>
              </select>
              <select value={moveCurrency} onChange={e => setMoveCurrency(e.target.value as Currency)} className={fieldClass}>
                {currencyOptions(TRADE_CURRENCIES)}
              </select>
            </div>
            <input value={moveAmount} onChange={e => setMoveAmount(e.target.value)} inputMode="decimal" placeholder="المبلغ" className={fieldClass} />
            <button type="submit" disabled={busy} className="w-full rounded-xl bg-emerald-500 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
              تسجيل
            </button>
          </form>
        </OperationCard>
      )}

      {can('remittance') && (
        <OperationCard title="حوالات">
          <form
            className="space-y-2"
            onSubmit={async e => {
              e.preventDefault();
              const parsed = Number(remitAmount.replace(/,/g, '')) || 0;
              if (parsed <= 0 || !beneficiary.trim()) return;
              const ok = await onRun(
                () => {
                  if (remitDirection === 'out' && balanceOf(balances, remitCurrency) < parsed) {
                    throw new Error('رصيد الكوة ما يكفي لتسليم الحوالة');
                  }
                  return buildCashMovement({
                    window,
                    direction: remitDirection,
                    currency: remitCurrency,
                    amount: parsed,
                    customerName: beneficiary.trim(),
                    note: 'حوالة',
                    halabRemittance: {
                      sender: sender.trim() || undefined,
                      beneficiary: beneficiary.trim(),
                      beneficiaryPhone: beneficiaryPhone.trim() || undefined,
                      destination: destination.trim() || undefined,
                      deliveryAmount: String(parsed),
                      deliveryCurrency: remitCurrency,
                    },
                  });
                },
                'تم تسجيل الحوالة',
              );
              if (ok) {
                setRemitAmount('');
                setSender('');
                setBeneficiary('');
                setBeneficiaryPhone('');
                setDestination('');
              }
            }}
          >
            <select value={remitDirection} onChange={e => setRemitDirection(e.target.value as 'in' | 'out')} className={fieldClass}>
              <option value="out">تسليم حوالة</option>
              <option value="in">استلام حوالة</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select value={remitCurrency} onChange={e => setRemitCurrency(e.target.value as Currency)} className={fieldClass}>
                {currencyOptions(TRADE_CURRENCIES)}
              </select>
              <input value={remitAmount} onChange={e => setRemitAmount(e.target.value)} inputMode="decimal" placeholder="المبلغ" className={fieldClass} />
            </div>
            <input value={sender} onChange={e => setSender(e.target.value)} placeholder="المرسل" className={fieldClass} />
            <input value={beneficiary} onChange={e => setBeneficiary(e.target.value)} placeholder="المستفيد" className={fieldClass} />
            <input value={beneficiaryPhone} onChange={e => setBeneficiaryPhone(e.target.value)} placeholder="هاتف المستفيد" dir="ltr" className={fieldClass} />
            <input value={destination} onChange={e => setDestination(e.target.value)} placeholder="الوجهة" className={fieldClass} />
            <button type="submit" disabled={busy} className="w-full rounded-xl bg-violet-500 py-2 text-sm font-semibold text-white disabled:opacity-50">
              تسجيل الحوالة
            </button>
          </form>
        </OperationCard>
      )}

      {recent.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-slate-500">آخر الحركات</p>
          {recent.map(tx => (
            <p key={tx.id} className="rounded-lg bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
              {tx.note || tx.kind} — {formatAmount(tx.amount, tx.currency)} {isWeightCurrency(tx.currency) ? 'غ' : getCurrencySymbol(tx.currency)}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function OperationCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-2xl border border-slate-700 bg-slate-800/40 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}
