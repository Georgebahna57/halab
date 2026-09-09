import { Pencil, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getFundAccountName, isHalabFleilatFund } from '../config';
import { halabRemittanceFromTransaction, resolveHalabDeliverySource, stampHalabRemittance } from '../lib/halabRemittance';
import { buildPendingWhatsAppMessage } from '../lib/whatsapp';
import { formatDateAr, formatFee, formatIntermediary, inferKind, getOperationGroupIds } from '../lib/utils';
import { feeEditorFromParsed, buildFeeFromEditor, FeeEditor } from './FeeEditor';
import { previewFundBalanceAfterEdit } from '../lib/fundBalancePreview';
import {
  accountAmountAfterFee,
  accountGrossAmount,
  extraFeeFieldsFromParsed,
  feeFieldsFromParsed,
  formatExtraFee,
  isShamelFeeEligible,
  resolveTransactionExtraFee,
  resolveTransactionFee,
  sumAmountForCurrency,
} from '../lib/fees';
import type { HalabRemittanceFields, Transaction } from '../types';
import { FundBalanceImpactPreview } from './FundBalanceImpactPreview';
import { HalabRemittanceFieldsEditor } from './HalabRemittanceFields';
import { AmountLinesEditor, createDefaultLines, parseAmountLines } from './AmountLinesEditor';
import type { AmountLine } from './AmountLinesEditor';
import {
  ExchangeFields,
  exchangeFieldValuesFromTransaction,
  parseExchangeFieldValues,
  type ExchangeFieldValues,
} from './ExchangeFields';

interface Props {
  leadId: string;
  allTransactions: Transaction[];
  onSave: (updated: Transaction[], summary: string) => void;
  onClose: () => void;
}

function txsToLines(txs: Transaction[]): AmountLine[] {
  return txs.map(tx => ({
    id: tx.id,
    currency: tx.currency,
    amount: String(tx.amount),
  }));
}

export function EditTransactionModal({ leadId, allTransactions, onSave, onClose }: Props) {
  const clicked = useMemo(
    () => allTransactions.find(t => t.id === leadId),
    [allTransactions, leadId],
  );

  const isExchange = clicked?.kind === 'exchange';

  const exchangeTxs = useMemo(() => {
    if (!clicked || !isExchange) return [];
    const opIds = new Set(getOperationGroupIds(allTransactions, leadId));
    return allTransactions.filter(t => opIds.has(t.id) && t.kind === 'exchange');
  }, [allTransactions, leadId, clicked, isExchange]);

  const exchangeFundTx = useMemo(
    () => exchangeTxs.find(t => (t.ledger ?? 'fund') === 'fund'),
    [exchangeTxs],
  );

  const [exchangeFields, setExchangeFields] = useState<ExchangeFieldValues>(() => (
    clicked?.kind === 'exchange'
      ? exchangeFieldValuesFromTransaction(clicked)
      : { paidCurrency: 'USD', paidAmount: '', receivedCurrency: 'EUR', receivedAmount: '', rate: '', amountEntry: 'paid' as const }
  ));

  const fundTxs = useMemo(() => {
    if (!clicked) return [];
    const opIds = new Set(getOperationGroupIds(allTransactions, leadId));
    return allTransactions.filter(
      t => opIds.has(t.id) && (t.ledger ?? 'fund') === 'fund' && t.kind !== 'exchange',
    );
  }, [allTransactions, leadId, clicked]);

  const lead = fundTxs[0];
  const linkedAccountTxs = useMemo(() => {
    const anchor = lead ?? clicked;
    if (!anchor) return [];
    const opIds = new Set(getOperationGroupIds(allTransactions, anchor.id));
    return allTransactions.filter(
      t => opIds.has(t.id) && t.ledger === 'account' && !t.feeSourceId,
    );
  }, [allTransactions, lead, clicked]);

  const isAccountOnly = !lead && clicked?.ledger === 'account' && !clicked.feeSourceId;

  const isPending = (lead ?? clicked)?.status === 'pending';
  const displayTx = lead ?? clicked!;
  const [direction, setDirection] = useState<'in' | 'out'>(() => (
    lead?.kind === 'payment' ? 'out' : 'in'
  ));
  const [accountDirection, setAccountDirection] = useState<'in' | 'out'>(() => {
    const linked = linkedAccountTxs[0];
    return linked?.kind === 'payment' ? 'out' : 'in';
  });
  const [counterparty, setCounterparty] = useState(() => {
    const tx = allTransactions.find(t => t.id === leadId);
    if (!tx) return '';
    if (tx.kind === 'exchange') {
      const opIds = new Set(getOperationGroupIds(allTransactions, leadId));
      const fundEx = allTransactions.find(
        t => opIds.has(t.id) && t.kind === 'exchange' && (t.ledger ?? 'fund') === 'fund',
      );
      return fundEx?.counterparty ?? '';
    }
    const opIds = new Set(getOperationGroupIds(allTransactions, leadId));
    const fundLead = allTransactions.find(
      t => opIds.has(t.id) && (t.ledger ?? 'fund') === 'fund' && t.kind !== 'exchange',
    );
    return fundLead?.counterparty ?? tx.party ?? '';
  });
  const [intermediary, setIntermediary] = useState(lead?.intermediary ?? clicked?.intermediary ?? '');
  const [feeEditor, setFeeEditor] = useState(() => feeEditorFromParsed(resolveTransactionFee(lead ?? clicked)));
  const [extraFeeEditor, setExtraFeeEditor] = useState(() => feeEditorFromParsed(resolveTransactionExtraFee(lead ?? clicked)));
  const [note, setNote] = useState(lead?.note ?? clicked?.note ?? '');
  const showHalabFields = isHalabFleilatFund((lead ?? clicked)?.fundId ?? 'steelMax');
  const [halabRemittance, setHalabRemittance] = useState<HalabRemittanceFields>(() => (
    halabRemittanceFromTransaction(clicked)
  ));
  const [lines, setLines] = useState(() => {
    if (fundTxs.length) return txsToLines(fundTxs);
    if (clicked && isAccountOnly) {
      const fees = [resolveTransactionFee(clicked), resolveTransactionExtraFee(clicked)];
      const gross = accountGrossAmount(clicked.amount, fees, clicked.currency);
      return [{ id: clicked.id, currency: clicked.currency, amount: String(gross) }];
    }
    return createDefaultLines();
  });

  const lineCurrencies = useMemo(
    () => [...new Set(parseAmountLines(lines).map(item => item.currency))],
    [lines],
  );

  const exchangeDeliverySource = useMemo(() => {
    if (!isExchange) return null;
    const parsed = parseExchangeFieldValues(exchangeFields);
    return resolveHalabDeliverySource({
      isExchange: true,
      exchangeReceivedAmount: parsed.receivedAmount,
      exchangeReceivedCurrency: exchangeFields.receivedCurrency,
    });
  }, [isExchange, exchangeFields]);

  const regularDeliverySource = useMemo(() => {
    if (isExchange) return null;
    return resolveHalabDeliverySource({ lines: parseAmountLines(lines) });
  }, [isExchange, lines]);

  const shamelEligible = isShamelFeeEligible(
    linkedAccountTxs[0]?.party ?? (isAccountOnly ? clicked?.party : undefined) ?? counterparty.trim() ?? lead?.counterparty,
  );

  const fundBalanceImpact = useMemo(() => {
    if (!lead || isAccountOnly || isPending) return null;
    const parsed = parseAmountLines(lines);
    if (!parsed.length) return null;
    const fundKind = inferKind(direction, false);
    const draftFund = fundTxs.map((tx, i) => {
      const item = parsed[i];
      if (!item) return tx;
      return { ...tx, kind: fundKind, currency: item.currency, amount: item.amount };
    });
    return previewFundBalanceAfterEdit(allTransactions, lead.fundId, draftFund);
  }, [lead, isAccountOnly, isPending, lines, direction, fundTxs, allTransactions]);

  const exchangeBalanceImpact = useMemo(() => {
    if (!isExchange || !exchangeFundTx || isPending) return null;
    const parsed = parseExchangeFieldValues(exchangeFields);
    if (!parsed.valid) return null;
    const draft = exchangeTxs.map(tx => {
      if ((tx.ledger ?? 'fund') !== 'fund') return tx;
      return {
        ...tx,
        currency: exchangeFields.paidCurrency,
        amount: parsed.paidAmount,
        exchangeToCurrency: exchangeFields.receivedCurrency,
        exchangeToAmount: parsed.receivedAmount,
      };
    });
    return previewFundBalanceAfterEdit(allTransactions, exchangeFundTx.fundId, draft);
  }, [isExchange, exchangeFundTx, isPending, exchangeFields, exchangeTxs, allTransactions]);

  if (!clicked) return null;

  if (isExchange) {
    const displayExchange = exchangeFundTx ?? clicked;
    const hasLinkedAccount = exchangeTxs.some(t => t.ledger === 'account');

    function submitExchange(e: React.FormEvent) {
      e.preventDefault();
      const parsed = parseExchangeFieldValues(exchangeFields);
      if (!parsed.valid) return;

      const summaryParts: string[] = [];
      if (
        displayExchange.currency !== exchangeFields.paidCurrency
        || displayExchange.amount !== parsed.paidAmount
        || displayExchange.exchangeToCurrency !== exchangeFields.receivedCurrency
        || displayExchange.exchangeToAmount !== parsed.receivedAmount
      ) {
        summaryParts.push('تعديل تبديل');
      }
      if ((note || '') !== (displayExchange.note || '')) summaryParts.push('تعديل ملاحظة');
      if (exchangeFundTx && (counterparty || '') !== (exchangeFundTx.counterparty || '')) {
        summaryParts.push(`طرف: ${exchangeFundTx.counterparty || '—'} → ${counterparty || '—'}`);
      }

      const updated = exchangeTxs.map(tx => ({
        ...tx,
        currency: exchangeFields.paidCurrency,
        amount: parsed.paidAmount,
        exchangeToCurrency: exchangeFields.receivedCurrency,
        exchangeToAmount: parsed.receivedAmount,
        exchangeRate: parsed.rate,
        note: note.trim() || undefined,
        counterparty: tx.ledger === 'account'
          ? tx.counterparty
          : counterparty.trim() || undefined,
      }));

      onSave(
        stampHalabRemittance(updated, showHalabFields ? halabRemittance : undefined),
        summaryParts.join(' | ') || 'تعديل تبديل',
      );
    }

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
        <form
          onSubmit={submitExchange}
          className="w-full max-w-md rounded-2xl border border-slate-600 bg-slate-900 p-4 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-violet-400">
              <Pencil size={16} />
              <h3 className="font-semibold">تعديل التبديل</h3>
            </div>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
              <X size={18} />
            </button>
          </div>

          <p className="text-xs text-slate-500">{getFundAccountName(displayExchange.fundId)}</p>
          {hasLinkedAccount && (
            <p className="text-xs text-emerald-400/80">مرتبط بحساب — التعديل ينعكس على الصندوق والحساب</p>
          )}
          <p className="text-xs text-slate-500">تاريخ الحركة: {formatDateAr(displayExchange.date)}</p>

          <ExchangeFields values={exchangeFields} onChange={setExchangeFields} />

          {exchangeFundTx && (
            <input
              type="text"
              placeholder="طرف التبديل (اختياري)"
              value={counterparty}
              onChange={e => setCounterparty(e.target.value)}
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-sm"
            />
          )}

          {showHalabFields && (
            <HalabRemittanceFieldsEditor
              values={halabRemittance}
              onChange={setHalabRemittance}
              deliverySource={exchangeDeliverySource}
            />
          )}

          <input
            type="text"
            placeholder="ملاحظة (اختياري)"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-sm"
          />

          {displayExchange.editHistory && displayExchange.editHistory.length > 0 && (
            <div className="rounded-xl bg-slate-800/80 p-3 text-xs text-slate-500 space-y-1">
              <p className="font-medium text-slate-400">سجل التعديلات</p>
              {[...displayExchange.editHistory].reverse().slice(0, 5).map((h, i) => (
                <p key={i}>
                  {formatDateAr(h.at.slice(0, 10))} — {h.byName ?? h.byEmail ?? '؟'}: {h.summary}
                </p>
              ))}
            </div>
          )}

          <FundBalanceImpactPreview impact={exchangeBalanceImpact} />

          <button type="submit" className="w-full rounded-xl bg-amber-500 py-2.5 font-semibold text-slate-900 hover:bg-amber-400">
            حفظ التعديل
          </button>
        </form>
      </div>
    );
  }

  if (!lead && !isAccountOnly) return null;

  function accountNetAmount(
    gross: number,
    currency: Transaction['currency'],
    fees: (ReturnType<typeof buildFeeFromEditor> | undefined)[],
  ): number {
    return fees.reduce(
      (amount, fee) => accountAmountAfterFee(amount, fee, currency),
      gross,
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseAmountLines(lines);
    if (!parsed.length) return;

    if (isAccountOnly && clicked) {
      const item = parsed[0];
      const feeBaseAmount = sumAmountForCurrency(parsed, feeEditor.currency);
      const extraFeeBaseAmount = sumAmountForCurrency(parsed, extraFeeEditor.currency);
      const parsedFee = buildFeeFromEditor(feeEditor, feeBaseAmount);
      const parsedExtraFee = shamelEligible ? buildFeeFromEditor(extraFeeEditor, extraFeeBaseAmount) : undefined;
      const feeFields = feeFieldsFromParsed(parsedFee);
      const extraFeeFields = extraFeeFieldsFromParsed(parsedExtraFee);
      const formattedFee = formatFee(feeFields.fee);
      const formattedExtraFee = formatExtraFee(extraFeeFields.extraFee);
      const grossAmount = item?.amount ?? clicked.amount;
      const netAmount = accountNetAmount(
        grossAmount,
        item?.currency ?? clicked.currency,
        [parsedFee, parsedExtraFee],
      );
      const summaryParts: string[] = [];
      if (item && (clicked.amount !== netAmount || clicked.currency !== item.currency)) {
        summaryParts.push(`${clicked.currency}: ${clicked.amount} → ${netAmount}`);
      }
      if ((note || '') !== (clicked.note || '')) summaryParts.push('تعديل ملاحظة');
      if ((formattedFee || '') !== (formatFee(clicked.fee) || '')) summaryParts.push('تعديل أجور/عمولة');
      if ((formattedExtraFee || '') !== (formatExtraFee(clicked.extraFee) || '')) summaryParts.push('تعديل عمولات شاملة');
      onSave(
        stampHalabRemittance([{
          ...clicked,
          note: note.trim() || undefined,
          currency: item?.currency ?? clicked.currency,
          amount: netAmount,
          ...feeFields,
          ...extraFeeFields,
        }], showHalabFields ? halabRemittance : undefined),
        summaryParts.join(' | ') || 'تعديل',
      );
      return;
    }

    if (!lead) return;

    const feeBaseAmount = sumAmountForCurrency(parsed, feeEditor.currency);
    const extraFeeBaseAmount = sumAmountForCurrency(parsed, extraFeeEditor.currency);
    const parsedFee = buildFeeFromEditor(feeEditor, feeBaseAmount);
    const parsedExtraFee = shamelEligible ? buildFeeFromEditor(extraFeeEditor, extraFeeBaseAmount) : undefined;
    const feeFields = feeFieldsFromParsed(parsedFee);
    const extraFeeFields = extraFeeFieldsFromParsed(parsedExtraFee);
    const formattedFee = formatFee(feeFields.fee);
    const formattedExtraFee = formatExtraFee(extraFeeFields.extraFee);

    const summaryParts: string[] = [];
    const fundKind = inferKind(direction, false);
    const accountKind = linkedAccountTxs.length
      ? inferKind(accountDirection, false)
      : fundKind;
    const formattedIntermediary = formatIntermediary(intermediary);

    if (lead.kind !== fundKind) {
      summaryParts.push(`${lead.kind === 'payment' ? 'دفع' : 'استلام'} → ${fundKind === 'payment' ? 'دفع' : 'استلام'}`);
    }
    if ((counterparty || '') !== (lead.counterparty || '')) {
      summaryParts.push(`طرف: ${lead.counterparty || '—'} → ${counterparty || '—'}`);
    }
    if ((note || '') !== (lead.note || '')) summaryParts.push('تعديل ملاحظة');
    if ((formattedIntermediary || '') !== (lead.intermediary || '')) summaryParts.push('تعديل بيد');
    if ((formattedFee || '') !== (formatFee(lead.fee) || '')) summaryParts.push('تعديل أجور/عمولة');
    if ((formattedExtraFee || '') !== (formatExtraFee(lead.extraFee) || '')) summaryParts.push('تعديل عمولات شاملة');

    const updated: Transaction[] = [];

    for (let i = 0; i < fundTxs.length; i++) {
      const tx = fundTxs[i];
      const item = parsed[i];
      if (!item) continue;
      if (tx.amount !== item.amount || tx.currency !== item.currency) {
        summaryParts.push(`${tx.currency}: ${tx.amount} → ${item.amount}`);
      }
      updated.push({
        ...tx,
        kind: fundKind,
        counterparty: counterparty.trim() || undefined,
        intermediary: formattedIntermediary,
        ...feeFields,
        ...extraFeeFields,
        note: note.trim() || undefined,
        currency: item.currency,
        amount: item.amount,
      });
    }

    for (const atx of linkedAccountTxs) {
      const idx = fundTxs.findIndex(f => f.currency === atx.currency);
      const item = idx >= 0 ? parsed[idx] : parsed[0];
      if (!item) continue;
      const accountAmount = accountNetAmount(
        item.amount,
        item.currency,
        [parsedFee, parsedExtraFee],
      );
      updated.push({
        ...atx,
        kind: accountKind,
        intermediary: formattedIntermediary,
        note: note.trim() || undefined,
        amount: accountAmount,
        currency: item.currency,
      });
    }

    if (isPending) {
      const fundGroup = updated.filter(t => t.ledger === 'fund');
      const fundLead = fundGroup[0];
      if (fundLead) {
        const message = buildPendingWhatsAppMessage(
          fundLead.fundId,
          fundGroup,
          fundLead.createdByName,
        );
        const leadIdx = updated.findIndex(t => t.id === fundLead.id);
        if (leadIdx >= 0) {
          updated[leadIdx] = { ...updated[leadIdx], pendingWhatsAppMessage: message };
        }
      }
    }

    onSave(
      stampHalabRemittance(updated, showHalabFields ? halabRemittance : undefined),
      summaryParts.join(' | ') || 'تعديل',
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-600 bg-slate-900 p-4 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-400">
            <Pencil size={16} />
            <h3 className="font-semibold">تعديل العملية</h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-slate-500">{getFundAccountName(displayTx.fundId)}</p>
        {lead?.linkId && (
          <p className="text-xs text-emerald-400/80">مرتبطة بحساب — التعديل ينعكس على الصندوق والحساب</p>
        )}

        <p className="text-xs text-slate-500">تاريخ الحركة: {formatDateAr(displayTx.date)}</p>

        {isPending && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDirection('in')}
              className={`rounded-xl py-2 text-sm font-medium ${direction === 'in' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'}`}
            >
              استلام
            </button>
            <button
              type="button"
              onClick={() => setDirection('out')}
              className={`rounded-xl py-2 text-sm font-medium ${direction === 'out' ? 'bg-rose-600 text-white' : 'bg-slate-700 text-slate-300'}`}
            >
              دفع
            </button>
          </div>
        )}

        {isPending && linkedAccountTxs.length > 0 && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
            <p className="text-xs font-medium text-emerald-300/90">على الحساب:</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAccountDirection('in')}
                className={`rounded-xl py-2 text-sm font-medium ${accountDirection === 'in' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'}`}
              >
                إيداع
              </button>
              <button
                type="button"
                onClick={() => setAccountDirection('out')}
                className={`rounded-xl py-2 text-sm font-medium ${accountDirection === 'out' ? 'bg-rose-600 text-white' : 'bg-slate-700 text-slate-300'}`}
              >
                سحب
              </button>
            </div>
          </div>
        )}

        <AmountLinesEditor lines={lines} onChange={setLines} />

        {!isAccountOnly && (
          <input
            type="text"
            placeholder="الطرف (اختياري)"
            value={counterparty}
            onChange={e => setCounterparty(e.target.value)}
            className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-sm"
          />
        )}

        {!isAccountOnly && (
          <input
            type="text"
            placeholder="بيد (اختياري)"
            value={intermediary}
            onChange={e => setIntermediary(e.target.value)}
            className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-sm"
          />
        )}

        <FeeEditor
          value={feeEditor}
          onChange={setFeeEditor}
          baseAmount={sumAmountForCurrency(parseAmountLines(lines), feeEditor.currency)}
          availableCurrencies={lineCurrencies.length ? lineCurrencies : undefined}
          compact
        />
        {shamelEligible && (
          <FeeEditor
            value={extraFeeEditor}
            onChange={setExtraFeeEditor}
            baseAmount={sumAmountForCurrency(parseAmountLines(lines), extraFeeEditor.currency)}
            availableCurrencies={lineCurrencies.length ? lineCurrencies : undefined}
            compact
            title="عمولات شاملة"
            hintOurs="تُخصم من مبلغ حساب الزبون وتُسجَّل على حساب «عمولات شاملة»"
            hintCustomer="تُضاف على مبلغ حساب الزبون فقط — ما بتروح لـ «عمولات شاملة»"
          />
        )}

        {showHalabFields && (
          <HalabRemittanceFieldsEditor
            values={halabRemittance}
            onChange={setHalabRemittance}
            deliverySource={regularDeliverySource}
          />
        )}

        <input
          type="text"
          placeholder="ملاحظة (اختياري)"
          value={note}
          onChange={e => setNote(e.target.value)}
          className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-sm"
        />

        {displayTx.editHistory && displayTx.editHistory.length > 0 && (
          <div className="rounded-xl bg-slate-800/80 p-3 text-xs text-slate-500 space-y-1">
            <p className="font-medium text-slate-400">سجل التعديلات</p>
            {[...displayTx.editHistory].reverse().slice(0, 5).map((h, i) => (
              <p key={i}>
                {formatDateAr(h.at.slice(0, 10))} — {h.byName ?? h.byEmail ?? '؟'}: {h.summary}
              </p>
            ))}
          </div>
        )}

        <FundBalanceImpactPreview impact={fundBalanceImpact} />

        <button type="submit" className="w-full rounded-xl bg-amber-500 py-2.5 font-semibold text-slate-900 hover:bg-amber-400">
          حفظ التعديل
        </button>
      </form>
    </div>
  );
}
