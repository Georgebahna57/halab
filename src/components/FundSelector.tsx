import type { Fund, FundId } from '../types';
import type { FundAccess } from '../lib/permissions';
import { PERMISSION_LABELS } from '../lib/permissions';

interface Props {
  funds: Fund[];
  active: FundId;
  fundAccess: Record<FundId, FundAccess>;
  onChange: (id: FundId) => void;
}

export function FundSelector({ funds, active, fundAccess, onChange }: Props) {
  if (funds.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-500">
        لا يوجد صناديق متاحة لك
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {funds.map(fund => {
        const selected = fund.id === active;
        const access = fundAccess[fund.id];
        const isViewOnly = access === 'view';
        return (
          <button
            key={fund.id}
            type="button"
            onClick={() => onChange(fund.id)}
            className="relative rounded-2xl border px-3 py-3 text-sm font-semibold transition"
            style={{
              borderColor: selected ? fund.accent : '#334155',
              background: selected ? `${fund.accent}22` : '#1e293b',
              color: selected ? fund.accent : '#94a3b8',
            }}
          >
            {fund.name}
            {isViewOnly && (
              <span className="absolute -top-1.5 left-1.5 rounded bg-slate-700 px-1 py-0.5 text-[9px] text-slate-400">
                {PERMISSION_LABELS.view}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
