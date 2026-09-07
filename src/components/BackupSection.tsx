import { Clock, Download, HardDriveUpload, History, Loader2, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  backupSummary,
  buildAppBackup,
  downloadAppBackup,
  parseAppBackup,
  type AppBackup,
} from '../lib/backup';
import {
  downloadCloudBackup,
  listCloudDailyBackups,
  loadCloudDailyBackup,
  type CloudDailyBackupMeta,
} from '../lib/cloudBackup';
import {
  getLastDailySnapshotDate,
  getMirrorInfo,
  listSnapshots,
  loadSnapshot,
  saveManualSnapshot,
  snapshotReasonLabel,
  type SnapshotMeta,
} from '../lib/localMirror';
import type { AppState } from '../types';
import type { ValuationRates } from '../lib/valuationRates';
import { loadState } from '../lib/utils';

interface Props {
  appState: AppState;
  valuationRates: ValuationRates;
  isAdmin?: boolean;
  onRestore: (backup: AppBackup, mode: 'merge' | 'replace') => Promise<void>;
}

function formatSavedAt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ar-LB');
}

export function BackupSection({ appState, valuationRates, isAdmin = false, onRestore }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingBackup, setPendingBackup] = useState<AppBackup | null>(null);
  const [replaceConfirm, setReplaceConfirm] = useState('');
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>(() => listSnapshots());
  const [cloudBackups, setCloudBackups] = useState<CloudDailyBackupMeta[]>([]);
  const mirror = getMirrorInfo();
  const lastDailyLocal = getLastDailySnapshotDate();

  useEffect(() => {
    if (!isAdmin) return;
    listCloudDailyBackups()
      .then(setCloudBackups)
      .catch(() => setCloudBackups([]));
  }, [isAdmin]);

  function refreshSnapshots() {
    setSnapshots(listSnapshots());
  }

  function exportBackup() {
    setError(null);
    setSuccess(null);
    downloadAppBackup(buildAppBackup(appState, valuationRates));
    setSuccess('تم تنزيل النسخة الاحتياطية');
  }

  async function handleFile(file: File) {
    setError(null);
    setSuccess(null);
    setPendingBackup(null);
    try {
      const text = await file.text();
      const backup = parseAppBackup(text);
      setPendingBackup(backup);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل قراءة الملف');
    }
  }

  async function restore(mode: 'merge' | 'replace') {
    if (!pendingBackup) return;
    if (mode === 'replace' && replaceConfirm.trim() !== 'استبدال') {
      setError('اكتب «استبدال» للتأكيد');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await onRestore(pendingBackup, mode);
      setSuccess(mode === 'merge' ? 'تم دمج النسخة الاحتياطية' : 'تم استبدال البيانات');
      setPendingBackup(null);
      setReplaceConfirm('');
      refreshSnapshots();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الاسترجاع');
    } finally {
      setBusy(false);
    }
  }

  function loadBrowserBackup() {
    setError(null);
    setSuccess(null);
    const local = loadState();
    const count = local.transactions.length + local.customers.length + local.bills.length;
    if (!count) {
      setError('لا توجد نسخة محفوظة في هذا المتصفح');
      return;
    }
    setPendingBackup(buildAppBackup(local, valuationRates));
    setSuccess(`وُجدت نسخة محلية: ${backupSummary(buildAppBackup(local, valuationRates))}`);
  }

  function loadFromSnapshot(meta: SnapshotMeta) {
    setError(null);
    setSuccess(null);
    const backup = loadSnapshot(meta.id);
    if (!backup) {
      setError('تعذّر قراءة اللقطة — ربما حُذفت');
      refreshSnapshots();
      return;
    }
    setPendingBackup(backup);
    setSuccess(`لقطة ${snapshotReasonLabel(meta.reason)}: ${meta.transactions} حركة`);
  }

  function createManualSnapshot() {
    setError(null);
    setSuccess(null);
    const meta = saveManualSnapshot(appState);
    refreshSnapshots();
    if (!meta) {
      setError('تعذّر حفظ اللقطة — مساحة التخزين ممتلئة. جرّب حذف لقطات أو نسخ يومية قديمة.');
      return;
    }
    setSuccess(`تم حفظ لقطة يدوية — ${meta.transactions} حركة`);
  }

  async function downloadCloudDaily(date: string) {
    setBusy(true);
    setError(null);
    try {
      const backup = await loadCloudDailyBackup(date);
      downloadCloudBackup(backup, date);
      setSuccess(`تم تنزيل النسخة اليومية لـ ${date}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تنزيل النسخة اليومية');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <HardDriveUpload size={18} className="text-sky-400" />
        <div>
          <p className="font-medium text-slate-200">نسخ احتياطي واسترجاع</p>
          <p className="text-xs text-slate-500">
            حركات · حسابات · فواتير · أسعار التقييم — JSON
          </p>
        </div>
      </div>

      <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
        <div className="flex items-start gap-2">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-400" />
          <div className="min-w-0 text-xs">
            <p className="font-medium text-emerald-200">حماية تلقائية — مفعّلة</p>
            <p className="mt-1 text-slate-400">
              كل عملية تُنسَخ محلياً في هذا المتصفح بعد الحفظ.
              {lastDailyLocal && (
                <span className="block mt-1 text-emerald-300/90">
                  نسخة يومية محلية: {lastDailyLocal}
                </span>
              )}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Clock size={11} />
                آخر نسخ: {formatSavedAt(mirror.savedAt)}
              </span>
              <span>{mirror.transactions} حركة · {mirror.customers} حساب</span>
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={exportBackup}
          className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
        >
          <Download size={14} />
          تنزيل نسخة احتياطية
        </button>
        <button
          type="button"
          onClick={createManualSnapshot}
          className="flex items-center gap-2 rounded-xl border border-emerald-500/40 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-500/10"
        >
          <History size={14} />
          حفظ لقطة الآن
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          <Upload size={14} />
          اختيار ملف للاسترجاع
        </button>
        <button
          type="button"
          onClick={loadBrowserBackup}
          className="flex items-center gap-2 rounded-xl border border-amber-500/40 px-4 py-2 text-sm text-amber-200 hover:bg-amber-500/10"
        >
          استرجاع من المتصفح
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      <p className="mt-2 text-[10px] text-slate-500">
        السحابة: {appState.transactions.length} حركة · {appState.customers.length} حساب · {appState.bills.length} فاتورة
      </p>

      {isAdmin && cloudBackups.length > 0 && (
        <div className="mt-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
          <p className="mb-2 text-xs font-medium text-sky-200">نسخ يومية على السحابة ({cloudBackups.length})</p>
          <p className="mb-2 text-[10px] text-slate-500">
            تُحفظ تلقائياً مرة كل يوم — آخر 14 يوماً.
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {cloudBackups.map(meta => (
              <button
                key={meta.backupDate}
                type="button"
                disabled={busy}
                onClick={() => void downloadCloudDaily(meta.backupDate)}
                className="flex w-full items-center justify-between gap-2 rounded-lg bg-slate-900/60 px-2 py-1.5 text-left text-xs hover:bg-slate-800 disabled:opacity-50"
              >
                <span className="text-slate-200">{meta.backupDate}</span>
                <span className="text-slate-500">{meta.summary}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {snapshots.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/40 p-3">
          <p className="mb-2 text-xs font-medium text-slate-300">لقطات محلية ({snapshots.length})</p>
          <p className="mb-2 text-[10px] text-slate-500">
            تُحفظ تلقائياً قبل الحذف، وكل 5 حركات، وعند إغلاق الصفحة.
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {snapshots.map(meta => (
              <button
                key={meta.id}
                type="button"
                onClick={() => loadFromSnapshot(meta)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800"
              >
                <span>
                  {formatSavedAt(meta.savedAt)}
                  <span className="mr-2 text-slate-500">({snapshotReasonLabel(meta.reason)})</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {meta.transactions} حركة
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(error || success) && (
        <p className={`mt-3 text-xs ${error ? 'text-rose-400' : 'text-emerald-400'}`}>
          {error ?? success}
        </p>
      )}

      {pendingBackup && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
          <p className="text-sm text-amber-200">
            ملف: {backupSummary(pendingBackup)}
          </p>
          <p className="text-[10px] text-slate-500">
            تاريخ التصدير: {new Date(pendingBackup.exportedAt).toLocaleString('ar-LB')}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => restore('merge')}
              className="rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {busy ? <Loader2 className="mx-auto animate-spin" size={16} /> : 'دمج (إضافة/تحديث)'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => restore('replace')}
              className="rounded-xl border border-rose-500/50 py-2 text-sm font-semibold text-rose-400 hover:bg-rose-500/10 disabled:opacity-60"
            >
              استبدال كامل
            </button>
          </div>
          <div>
            <label className="mb-1 block text-[10px] text-rose-400">
              للاستبدال اكتب «استبدال» (يحذف كل البيانات الحالية!)
            </label>
            <input
              type="text"
              value={replaceConfirm}
              onChange={e => setReplaceConfirm(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-xs"
              placeholder="استبدال"
            />
          </div>
        </div>
      )}
    </div>
  );
}
