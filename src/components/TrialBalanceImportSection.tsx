import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { useState } from 'react';
import { BOX_FUNDS } from '../config';
import {
  parseTrialBalanceWorkbook,
  type TrialBalanceImportAccount,
} from '../lib/trialBalanceImport';
import type { FundId } from '../types';

interface Props {
  onImport: (accounts: TrialBalanceImportAccount[], fundId: FundId) => Promise<void>;
  busy?: boolean;
}

export function TrialBalanceImportSection({ onImport, busy = false }: Props) {
  const [fundId, setFundId] = useState<FundId>('steelMax');
  const [preview, setPreview] = useState<TrialBalanceImportAccount[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setSuccess(null);
    setParsing(true);
    setFileName(file.name);
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const accounts = parseTrialBalanceWorkbook(
        wb.SheetNames,
        name => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) as unknown[][],
      );
      setPreview(accounts);
      if (accounts.length === 0) {
        setError('ما لقينا حسابات في الملف');
      }
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'فشل قراءة الملف');
    } finally {
      setParsing(false);
    }
  }

  async function runImport() {
    if (!preview?.length) return;
    setError(null);
    setSuccess(null);
    try {
      await onImport(preview, fundId);
      setSuccess(`تم استيراد ${preview.length} حساب مع أرصدتهم`);
      setPreview(null);
      setFileName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الاستيراد');
    }
  }

  const txEstimate = preview?.reduce((sum, a) => {
    let n = 0;
    for (const row of Object.values(a.currencies)) {
      if (!row) continue;
      if (row.credit > 0) n++;
      if (row.debit > 0) n++;
      const opening = row.balance - (row.debit - row.credit);
      if (opening > 0) n++;
      if (opening < 0) n++;
    }
    return sum + n;
  }, 0) ?? 0;

  return (
    <div className="mb-4 rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <FileSpreadsheet size={18} className="text-violet-400" />
        <div>
          <p className="font-medium text-slate-200">استيراد ميزان مراجعة (Excel)</p>
          <p className="text-xs text-slate-500">
            Trial_Balance_By_Currency — حسابات + أرصدة كل العملات
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={fundId}
          onChange={e => setFundId(e.target.value as FundId)}
          className="rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
        >
          {BOX_FUNDS.map(f => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:border-violet-500/50">
          <Upload size={16} />
          {parsing ? 'جاري القراءة...' : 'اختر ملف Excel'}
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={parsing || busy}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {fileName && (
        <p className="mb-2 text-xs text-slate-500">الملف: {fileName}</p>
      )}

      {preview && (
        <div className="mb-3 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
          <p>{preview.length} حساب · تقريب {txEstimate} حركة</p>
          <p className="mt-1 text-slate-500">
            عينة: {preview.slice(0, 3).map(a => a.name).join(' · ')}
          </p>
        </div>
      )}

      {(error || success) && (
        <div className={`mb-3 rounded-xl px-3 py-2 text-xs ${
          error ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
        }`}>
          {error ?? success}
        </div>
      )}

      {preview && preview.length > 0 && (
        <button
          type="button"
          onClick={runImport}
          disabled={busy || parsing}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          استيراد {preview.length} حساب
        </button>
      )}

      <p className="mt-2 text-[10px] text-slate-500">
        يحذف حركات الاستيراد السابقة لنفس الحسابات ثم يضيف الأرصدة من الملف
      </p>
    </div>
  );
}
