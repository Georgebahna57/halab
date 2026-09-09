import { getFund } from '../config';
import {
  formatFundBalanceImpactLine,
  type FundBalanceImpact,
} from '../lib/fundBalancePreview';

interface Props {
  impact: FundBalanceImpact | null;
}

export function FundBalanceImpactPreview({ impact }: Props) {
  if (!impact) return null;

  const fund = getFund(impact.fundId);
  const changed = impact.currencies.filter(
    c => Math.abs(impact.before[c].balance - impact.after[c].balance) > 1e-9,
  );
  const displayCurrencies = changed.length > 0 ? changed : impact.currencies;

  return (
    <div
      className="rounded-xl border px-3 py-2.5 text-xs space-y-1.5"
      style={{ borderColor: `${fund.accent}44`, background: `${fund.accent}0d` }}
    >
      <p className="font-medium" style={{ color: fund.accent }}>
        تأثير التعديل على رصيد {fund.shortName}
      </p>
      {displayCurrencies.length > 0 ? displayCurrencies.map(currency => (
        <p key={currency} className="text-slate-300 tabular-nums">
          {formatFundBalanceImpactLine(
            currency,
            impact.before[currency].balance,
            impact.after[currency].balance,
          )}
        </p>
      )) : (
        <p className="text-slate-500">لا تغيير متوقّع على رصيد الصندوق</p>
      )}
    </div>
  );
}
