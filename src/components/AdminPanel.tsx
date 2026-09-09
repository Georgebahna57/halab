import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Coins, Loader2, MessageCircle, Save, Shield } from 'lucide-react';
import { FUNDS, isCentersFund } from '../config';
import { fetchFundWhatsAppPhones, saveFundWhatsAppPhones, type FundWhatsAppMap } from '../lib/fundSettings';
import { destinationsToText, parseWhatsAppDestinations } from '../lib/whatsapp';
import { ValuationRatesEditor } from './ValuationRatesEditor';
import { BackupSection } from './BackupSection';
import { FundDataDiagnostic } from './FundDataDiagnostic';
import { HalabBulkImportSection } from './HalabBulkImportSection';
import { OpeningBalanceSection } from './OpeningBalanceSection';
import type { ValuationRates } from '../lib/valuationRates';
import type { AppBackup } from '../lib/backup';
import type { AppState, Transaction } from '../types';
import {
  fetchAllPermissions,
  fetchAllProfiles,
  saveUserFundPermissions,
  setUserAccountsOnly,
  setUserAdmin,
  setUserCanEditPast,
  updateDisplayName,
} from '../lib/profile';
import {
  PERMISSION_LABELS,
  type FundAccess,
  type UserProfile,
} from '../lib/permissions';
import type { FundId } from '../types';
import { AuditLogSection } from './AuditLogSection';
import { MessageTemplatesSection } from './MessageTemplatesSection';
import { TrialBalanceImportSection } from './TrialBalanceImportSection';
import type { TrialBalanceImportAccount } from '../lib/trialBalanceImport';

interface Props {
  onBack: () => void;
  onWhatsAppSaved?: () => void;
  valuationRates: ValuationRates;
  onSaveValuationRates: (rates: ValuationRates) => void | Promise<void>;
  savingValuationRates?: boolean;
  appState: AppState;
  onRestoreBackup: (backup: AppBackup, mode: 'merge' | 'replace') => Promise<void>;
  onAddOpeningBalance: (tx: Transaction[]) => void | Promise<void>;
  onRepairHalab?: () => Promise<void>;
  onImportTrialBalance?: (accounts: TrialBalanceImportAccount[], fundId: FundId) => Promise<void>;
  importingTrialBalance?: boolean;
}

type FundWhatsAppTextMap = Partial<Record<FundId, string>>;

function whatsappMapToText(map: FundWhatsAppMap): FundWhatsAppTextMap {
  return Object.fromEntries(FUNDS.map(f => [f.id, destinationsToText(map[f.id])]));
}

function whatsappTextToMap(textMap: FundWhatsAppTextMap): FundWhatsAppMap {
  const map: FundWhatsAppMap = {};
  for (const fund of FUNDS) {
    const list = parseWhatsAppDestinations(textMap[fund.id] ?? '');
    if (list.length) map[fund.id] = list;
  }
  return map;
}

type PermissionMap = Record<string, Partial<Record<FundId, FundAccess>>>;

function buildPermissionMap(
  profiles: UserProfile[],
  rows: { userId: string; fundId: FundId; permission: 'edit' | 'view' }[],
): PermissionMap {
  const map: PermissionMap = {};
  for (const profile of profiles) {
    const userPerms: Partial<Record<FundId, FundAccess>> = {};
    if (profile.isAdmin) {
      for (const fund of FUNDS) userPerms[fund.id] = 'edit';
    } else {
      for (const fund of FUNDS) userPerms[fund.id] = 'hidden';
      for (const row of rows.filter(r => r.userId === profile.id)) {
        userPerms[row.fundId] = row.permission;
      }
    }
    map[profile.id] = userPerms;
  }
  return map;
}

export function AdminPanel({ onBack, onWhatsAppSaved, valuationRates, onSaveValuationRates, savingValuationRates = false, appState, onRestoreBackup, onAddOpeningBalance, onRepairHalab, onImportTrialBalance, importingTrialBalance = false }: Props) {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [permissionMap, setPermissionMap] = useState<PermissionMap>({});
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({});
  const [whatsappEdits, setWhatsappEdits] = useState<FundWhatsAppTextMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const nonAdminProfiles = useMemo(
    () => profiles.filter(p => !p.isAdmin),
    [profiles],
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [allProfiles, allPerms, whatsappPhones] = await Promise.all([
        fetchAllProfiles(),
        fetchAllPermissions(),
        fetchFundWhatsAppPhones(),
      ]);
      setProfiles(allProfiles);
      setPermissionMap(buildPermissionMap(allProfiles, allPerms));
      setNameEdits(Object.fromEntries(allProfiles.map(p => [p.id, p.displayName])));
      setWhatsappEdits(whatsappMapToText(whatsappPhones));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function setPermission(userId: string, fundId: FundId, access: FundAccess) {
    setPermissionMap(prev => ({
      ...prev,
      [userId]: { ...prev[userId], [fundId]: access },
    }));
  }

  async function saveUser(userId: string) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await saveUserFundPermissions(userId, permissionMap[userId] ?? {});
      setSuccess('تم حفظ أسعار التقييم — تنطبق على كل الحسابات');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  }

  async function saveDisplayName(userId: string) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateDisplayName(userId, nameEdits[userId] ?? '');
      await load();
      setSuccess('تم حفظ الاسم');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل حفظ الاسم');
    } finally {
      setSaving(false);
    }
  }

  async function saveWhatsAppNumbers() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const map = whatsappTextToMap(whatsappEdits);
      await saveFundWhatsAppPhones(map);
      onWhatsAppSaved?.();
      setSuccess(`تم حفظ ${Object.keys(map).length} صندوق/صناديق`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل حفظ أرقام واتساب');
    } finally {
      setSaving(false);
    }
  }

  async function toggleAdmin(userId: string, isAdmin: boolean) {
    setSaving(true);
    setError(null);
    try {
      await setUserAdmin(userId, isAdmin);
      await load();
      setSuccess(isAdmin ? 'تم تعيين مسؤول' : 'تم إلغاء المسؤول');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل التحديث');
    } finally {
      setSaving(false);
    }
  }

  async function saveValuationRatesHandler(rates: ValuationRates) {
    setError(null);
    setSuccess(null);
    try {
      await onSaveValuationRates(rates);
      setSuccess('تم حفظ أسعار التقييم — تنطبق على كل الحسابات');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل حفظ الأسعار');
      throw err;
    }
  }

  async function toggleAccountsOnly(userId: string, accountsOnly: boolean) {
    setSaving(true);
    setError(null);
    try {
      await setUserAccountsOnly(userId, accountsOnly);
      await load();
      setSuccess(accountsOnly ? 'تم تفعيل حسابات فقط' : 'تم إلغاء حسابات فقط');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل التحديث');
    } finally {
      setSaving(false);
    }
  }

  async function toggleCanEditPast(userId: string, canEditPast: boolean) {
    setSaving(true);
    setError(null);
    try {
      await setUserCanEditPast(userId, canEditPast);
      await load();
      setSuccess(canEditPast ? 'تم تفعيل تعديل الحركات السابقة' : 'تم إلغاء تعديل الحركات السابقة');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل التحديث');
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
            <h1 className="text-xl font-bold">إدارة المستخدمين</h1>
            <p className="text-xs text-slate-500">صلاحيات الصناديق لكل مستخدم</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:text-white"
        >
          <ArrowRight size={14} />
          رجوع
        </button>
      </header>

      <div className="mb-4 rounded-xl border border-slate-700 bg-slate-800/60 p-4 text-sm text-slate-400">
        <p className="font-medium text-slate-300">إضافة مستخدم جديد</p>
        <p className="mt-1 text-xs">
          من Supabase → Authentication → Users → Add user → Create new user
        </p>
        <p className="mt-2 text-xs">بعد أول دخول، يظهر هون لتحديد صلاحياته.</p>
      </div>

      {(error || success) && (
        <div className={`mb-4 rounded-xl px-3 py-2 text-xs ${error ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
          {error ?? success}
        </div>
      )}

      <FundDataDiagnostic appState={appState} onRepairHalab={onRepairHalab} />

      <BackupSection
        appState={appState}
        valuationRates={valuationRates}
        isAdmin
        onRestore={onRestoreBackup}
      />

      <OpeningBalanceSection appState={appState} onAdd={onAddOpeningBalance} />

      <HalabBulkImportSection onImport={onAddOpeningBalance} />

      <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Coins size={18} className="text-amber-400" />
          <div>
            <p className="font-medium text-slate-200">أسعار التقييم — لكل المشروع</p>
            <p className="text-xs text-slate-500">
              عدّلها هون مرة كل فترة — كل الحسابات بكل الصناديق تستخدم نفس الأسعار
            </p>
          </div>
        </div>
        <ValuationRatesEditor
          rates={valuationRates}
          onSave={saveValuationRatesHandler}
          saving={savingValuationRates}
        />
      </div>

      <MessageTemplatesSection />

      {onImportTrialBalance && (
        <TrialBalanceImportSection
          onImport={onImportTrialBalance}
          busy={importingTrialBalance}
        />
      )}

      <AuditLogSection />

      <div className="mb-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="mb-3 flex items-center gap-2">
          <MessageCircle size={18} className="text-emerald-400" />
          <div>
            <p className="font-medium text-slate-200">واتساب قيد الانتظار</p>
            <p className="text-xs text-slate-500">
              سطر لكل كروب أو رقم — اضغط Enter لسطر جديد
            </p>
          </div>
        </div>
        <div className="space-y-3">
          {FUNDS.map(fund => (
            <div key={fund.id} className="rounded-xl bg-slate-900/50 px-3 py-2 space-y-1">
              <span className="text-sm font-medium">
                {isCentersFund(fund.id) ? 'مراكز (حسابات)' : fund.name}
              </span>
              <textarea
                dir="ltr"
                rows={4}
                value={whatsappEdits[fund.id] ?? ''}
                onChange={e => setWhatsappEdits(prev => ({
                  ...prev,
                  [fund.id]: e.target.value,
                }))}
                placeholder={'https://chat.whatsapp.com/...\nhttps://chat.whatsapp.com/...\n96170123456'}
                className="w-full resize-y rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs font-mono leading-relaxed"
              />
              {parseWhatsAppDestinations(whatsappEdits[fund.id] ?? '').length > 0 && (
                <p className="text-[10px] text-emerald-400">
                  {parseWhatsAppDestinations(whatsappEdits[fund.id] ?? '').length} وجهة/كروب
                </p>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={saveWhatsAppNumbers}
          disabled={saving}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          <Save size={14} />
          حفظ وجهات واتساب
        </button>
      </div>

      <div className="space-y-4">
        {profiles.map(profile => {
          const isAdmin = profile.isAdmin;
          const perms = permissionMap[profile.id] ?? {};

          return (
            <div key={profile.id} className="rounded-2xl border border-slate-700 bg-slate-800/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs text-slate-500" dir="ltr">{profile.email}</p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={nameEdits[profile.id] ?? profile.displayName}
                      onChange={e => setNameEdits(prev => ({ ...prev, [profile.id]: e.target.value }))}
                      placeholder="اسم المستخدم"
                      className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => saveDisplayName(profile.id)}
                      disabled={saving}
                      className="rounded-xl border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:border-amber-500/50 hover:text-amber-400 disabled:opacity-60"
                    >
                      حفظ الاسم
                    </button>
                  </div>
                  {isAdmin && (
                    <span className="mt-1 inline-block rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400">
                      مسؤول — كل الصناديق
                    </span>
                  )}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={isAdmin}
                    onChange={e => toggleAdmin(profile.id, e.target.checked)}
                    disabled={saving}
                  />
                  مسؤول
                </label>
                {!isAdmin && (
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={profile.accountsOnly}
                      onChange={e => toggleAccountsOnly(profile.id, e.target.checked)}
                      disabled={saving}
                    />
                    حسابات فقط
                  </label>
                )}
                {!isAdmin && (
                  <label className="flex items-center gap-2 text-xs text-slate-400" title="تعديل حركات أقدم من اليوم الحالي">
                    <input
                      type="checkbox"
                      checked={profile.canEditPast}
                      onChange={e => toggleCanEditPast(profile.id, e.target.checked)}
                      disabled={saving}
                    />
                    تعديل حركات سابقة
                  </label>
                )}
              </div>

              {!isAdmin && (
                <>
                  <div className="mt-4 space-y-2">
                    {FUNDS.map(fund => {
                      const access = perms[fund.id] ?? 'hidden';
                      return (
                        <div key={fund.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-900/50 px-3 py-2">
                          <span className="text-sm">
                            {isCentersFund(fund.id) ? 'مراكز (حسابات)' : fund.name}
                          </span>
                          <select
                            value={access}
                            onChange={e => setPermission(profile.id, fund.id, e.target.value as FundAccess)}
                            className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-xs"
                          >
                            {(['edit', 'view', 'hidden'] as FundAccess[]).map(p => (
                              <option key={p} value={p}>{PERMISSION_LABELS[p]}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => saveUser(profile.id)}
                    disabled={saving}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-60"
                  >
                    <Save size={14} />
                    حفظ صلاحيات {profile.displayName}
                  </button>
                </>
              )}
            </div>
          );
        })}

        {nonAdminProfiles.length === 0 && profiles.length > 0 && (
          <p className="text-center text-sm text-slate-500">كل المستخدمين مسؤولين</p>
        )}

        {profiles.length === 0 && (
          <p className="text-center text-sm text-slate-500">لا يوجد مستخدمين بعد — أضفهم من Supabase</p>
        )}
      </div>
    </div>
  );
}
