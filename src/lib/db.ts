import { supabase } from './supabase';
import type { AppState, Bill, Customer, FundId, Transaction, TransactionComment, TransactionEditRecord, TransactionLedger } from '../types';
import type { DataFingerprint } from './remoteSync';
import { formatDbError } from './dbErrors';
import { decodeNoteMeta, encodeNoteMeta } from './txMeta';
import { feeToDbValue, extraFeeToDbValue } from './fees';
import { formatIntermediary, normalizeTransaction } from './utils';
import { decodeCustomerNote, encodeCustomerNote } from './customerMeta';

function requireClient() {
  if (!supabase) throw new Error('Supabase غير مُعدّ');
  return supabase;
}

function isMissingColumnError(error: { message?: string; code?: string }): boolean {
  const msg = (error.message ?? '').toLowerCase();
  return (
    error.code === 'PGRST204'
    || msg.includes('ledger')
    || msg.includes('counterparty')
    || msg.includes('batch_id')
    || msg.includes('link_id')
    || msg.includes('created_by')
    || msg.includes('comments')
    || msg.includes('claimed_by')
    || msg.includes('fee')
    || msg.includes('shared_fund_ids')
    || msg.includes('could not find')
  );
}

function parseEditHistory(raw: unknown): TransactionEditRecord[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw as TransactionEditRecord[];
  return undefined;
}

function parseComments(raw: unknown): TransactionComment[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw as TransactionComment[];
  return undefined;
}

function resolveTransactionLedger(
  rowLedger: unknown,
  decodedLedger?: TransactionLedger,
): TransactionLedger {
  if (decodedLedger === 'account' || decodedLedger === 'ops') return decodedLedger;
  if (rowLedger === 'account' || rowLedger === 'fund' || rowLedger === 'ops') return rowLedger;
  return decodedLedger ?? 'fund';
}

function mapTransaction(row: Record<string, unknown>): Transaction {
  const rawNote = (row.note as string) || undefined;
  const decoded = decodeNoteMeta(rawNote);

  return normalizeTransaction({
    id: row.id as string,
    fundId: row.fund_id as Transaction['fundId'],
    ledger: resolveTransactionLedger(row.ledger, decoded.ledger),
    date: row.date as string,
    currency: row.currency as Transaction['currency'],
    kind: row.kind as Transaction['kind'],
    amount: Number(row.amount),
    party: row.party as string,
    counterparty: (row.counterparty as string) || decoded.counterparty || undefined,
    intermediary: formatIntermediary(row.intermediary as string | undefined),
    fee: (row.fee as string) || undefined,
    extraFee: decoded.extraFee || undefined,
    note: decoded.userNote,
    feeSourceId: decoded.feeSourceId || undefined,
    status: row.status as Transaction['status'],
    createdAt: row.created_at as string,
    batchId: (row.batch_id as string) || decoded.batchId || undefined,
    linkId: (row.link_id as string) || decoded.linkId || undefined,
    createdByUserId: (row.created_by_id as string) || decoded.createdByUserId || undefined,
    createdByEmail: (row.created_by_email as string) || decoded.createdByEmail || undefined,
    createdByName: (row.created_by_name as string) || decoded.createdByName || undefined,
    lastEditedAt: (row.last_edited_at as string) || undefined,
    lastEditedByName: (row.last_edited_by_name as string) || undefined,
    lastEditedByEmail: (row.last_edited_by_email as string) || undefined,
    editHistory: parseEditHistory(row.edit_history),
    exchangeToCurrency: (row.exchange_to_currency as Transaction['exchangeToCurrency']) || undefined,
    exchangeRate: row.exchange_rate != null ? Number(row.exchange_rate) : undefined,
    exchangeToAmount: row.exchange_to_amount != null ? Number(row.exchange_to_amount) : undefined,
    pendingWhatsAppMessage: (row.pending_whatsapp_message as string) || decoded.pendingWhatsAppMessage || undefined,
    approvalDetails: (row.approval_details as string) || decoded.approvalDetails || undefined,
    approvedByName: (row.approved_by_name as string) || decoded.approvedByName || undefined,
    approvedByEmail: (row.approved_by_email as string) || decoded.approvedByEmail || undefined,
    approvedAt: (row.approved_at as string) || decoded.approvedAt || undefined,
    orderedDate: (row.ordered_date as string) || decoded.orderedDate || undefined,
    halabRemittance: decoded.halabRemittance,
    claimedByUserId: (row.claimed_by_id as string) || undefined,
    claimedByName: (row.claimed_by_name as string) || undefined,
    claimedAt: (row.claimed_at as string) || undefined,
    comments: parseComments(row.comments),
  });
}

function mapBill(row: Record<string, unknown>): Bill {
  return {
    id: row.id as string,
    fundId: row.fund_id as Bill['fundId'],
    invoiceNo: (row.invoice_no as string) || '',
    description: row.description as string,
    amount: row.amount != null ? Number(row.amount) : undefined,
    currency: (row.currency as Bill['currency']) || undefined,
    paidAt: (row.paid_at as string) || undefined,
    createdAt: row.created_at as string,
  };
}

function parseSharedFundIds(row: Record<string, unknown>): FundId[] | undefined {
  const raw = row.shared_fund_ids;
  if (Array.isArray(raw)) {
    const ids = raw.filter((id): id is FundId => typeof id === 'string' && id.length > 0);
    return ids.length ? ids : undefined;
  }
  return undefined;
}

function mapCustomer(row: Record<string, unknown>): Customer | null {
  if (!row.fund_id) return null;
  const rawNote = (row.note as string) || undefined;
  const decoded = decodeCustomerNote(rawNote);
  return {
    id: row.id as string,
    fundId: row.fund_id as Customer['fundId'],
    name: row.name as string,
    accountNumber: decoded.accountNumber,
    phone: (row.phone as string) || undefined,
    note: decoded.userNote,
    reconciliation: decoded.reconciliation,
    accountBranch: decoded.accountBranch,
    sharedFundIds: parseSharedFundIds(row),
    createdAt: row.created_at as string,
  };
}

function txNoteMeta(tx: Transaction) {
  return {
    ledger: tx.ledger !== 'fund' ? tx.ledger : undefined,
    counterparty: tx.counterparty,
    batchId: tx.batchId,
    linkId: tx.linkId,
    feeSourceId: tx.feeSourceId,
    extraFee: extraFeeToDbValue(tx),
    createdByUserId: tx.createdByUserId,
    createdByEmail: tx.createdByEmail,
    createdByName: tx.createdByName,
    pendingWhatsAppMessage: tx.pendingWhatsAppMessage,
    approvalDetails: tx.approvalDetails,
    approvedByName: tx.approvedByName,
    approvedByEmail: tx.approvedByEmail,
    approvedAt: tx.approvedAt,
    orderedDate: tx.orderedDate,
    halabRemittance: tx.halabRemittance,
  };
}

function txNoteToDb(tx: Transaction): string | null {
  return encodeNoteMeta(tx.note, txNoteMeta(tx)) ?? null;
}

function txToRow(tx: Transaction) {
  return {
    id: tx.id,
    fund_id: tx.fundId,
    ledger: tx.ledger ?? 'fund',
    date: tx.date,
    currency: tx.currency,
    kind: tx.kind,
    amount: tx.amount,
    party: tx.party,
    counterparty: tx.counterparty ?? null,
    intermediary: formatIntermediary(tx.intermediary) ?? null,
    fee: feeToDbValue(tx),
    note: txNoteToDb(tx),
    status: tx.status,
    batch_id: tx.batchId ?? null,
    link_id: tx.linkId ?? null,
    created_by_id: tx.createdByUserId ?? null,
    created_by_email: tx.createdByEmail ?? null,
    created_by_name: tx.createdByName ?? null,
    last_edited_at: tx.lastEditedAt ?? null,
    last_edited_by_name: tx.lastEditedByName ?? null,
    last_edited_by_email: tx.lastEditedByEmail ?? null,
    edit_history: tx.editHistory?.length ? tx.editHistory : null,
    exchange_to_currency: tx.exchangeToCurrency ?? null,
    exchange_rate: tx.exchangeRate ?? null,
    exchange_to_amount: tx.exchangeToAmount ?? null,
    pending_whatsapp_message: tx.pendingWhatsAppMessage ?? null,
    approval_details: tx.approvalDetails ?? null,
    approved_by_name: tx.approvedByName ?? null,
    approved_by_email: tx.approvedByEmail ?? null,
    approved_at: tx.approvedAt ?? null,
    ordered_date: tx.orderedDate ?? null,
    claimed_by_id: tx.claimedByUserId ?? null,
    claimed_by_name: tx.claimedByName ?? null,
    claimed_at: tx.claimedAt ?? null,
    comments: tx.comments?.length ? tx.comments : null,
    created_at: tx.createdAt,
  };
}

function minimalTxToRow(tx: Transaction) {
  return {
    id: tx.id,
    fund_id: tx.fundId,
    date: tx.date,
    currency: tx.currency,
    kind: tx.kind,
    amount: tx.amount,
    party: tx.party,
    intermediary: formatIntermediary(tx.intermediary) ?? null,
    note: txNoteToDb(tx),
    status: tx.status,
    exchange_to_currency: tx.exchangeToCurrency ?? null,
    exchange_rate: tx.exchangeRate ?? null,
    exchange_to_amount: tx.exchangeToAmount ?? null,
    created_at: tx.createdAt,
  };
}

function billToRow(bill: Bill) {
  return {
    id: bill.id,
    fund_id: bill.fundId,
    invoice_no: bill.invoiceNo || null,
    description: bill.description,
    amount: bill.amount ?? null,
    currency: bill.currency ?? null,
    paid_at: bill.paidAt ?? null,
    created_at: bill.createdAt,
  };
}

function customerToRow(customer: Customer) {
  return {
    id: customer.id,
    fund_id: customer.fundId,
    name: customer.name,
    phone: customer.phone ?? null,
    note: encodeCustomerNote(customer.note, {
      reconciliation: customer.reconciliation,
      accountNumber: customer.accountNumber,
      accountBranch: customer.accountBranch,
    }) ?? null,
    shared_fund_ids: customer.sharedFundIds?.length ? customer.sharedFundIds : [],
    created_at: customer.createdAt,
  };
}

async function upsertTxRows(txs: Transaction[]) {
  const client = requireClient();
  let { error } = await client.from('transactions').upsert(txs.map(txToRow));
  if (error && isMissingColumnError(error)) {
    ({ error } = await client.from('transactions').upsert(txs.map(minimalTxToRow)));
  }
  if (error) throw formatDbError(error);
}

export async function fetchDataFingerprint(): Promise<DataFingerprint> {
  const client = requireClient();
  const [txCountRes, customerCountRes, billCountRes, latestTxRes, latestEditRes] = await Promise.all([
    client.from('transactions').select('*', { count: 'exact', head: true }),
    client.from('customers').select('*', { count: 'exact', head: true }),
    client.from('bills').select('*', { count: 'exact', head: true }),
    client.from('transactions').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    client.from('transactions').select('last_edited_at').not('last_edited_at', 'is', null).order('last_edited_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (txCountRes.error) throw formatDbError(txCountRes.error);
  if (customerCountRes.error) throw formatDbError(customerCountRes.error);
  if (billCountRes.error) throw formatDbError(billCountRes.error);
  if (latestTxRes.error) throw formatDbError(latestTxRes.error);
  if (latestEditRes.error) throw formatDbError(latestEditRes.error);

  return {
    transactions: txCountRes.count ?? 0,
    customers: customerCountRes.count ?? 0,
    bills: billCountRes.count ?? 0,
    latestTxAt: (latestTxRes.data?.created_at as string) ?? null,
    latestEditAt: (latestEditRes.data?.last_edited_at as string) ?? null,
  };
}

export async function fetchAppState(): Promise<AppState> {
  const client = requireClient();
  const [txRes, billsRes, customersRes] = await Promise.all([
    client.from('transactions').select('*').order('created_at', { ascending: false }),
    client.from('bills').select('*').order('created_at', { ascending: false }),
    client.from('customers').select('*').order('created_at', { ascending: false }),
  ]);

  if (txRes.error) throw formatDbError(txRes.error);
  if (billsRes.error) throw formatDbError(billsRes.error);
  if (customersRes.error) throw formatDbError(customersRes.error);

  return {
    transactions: (txRes.data ?? []).map(mapTransaction),
    bills: (billsRes.data ?? []).map(mapBill),
    customers: (customersRes.data ?? []).map(mapCustomer).filter((c): c is Customer => c !== null),
  };
}

export async function upsertTransaction(tx: Transaction) {
  await upsertTxRows([tx]);
}

export async function upsertTransactions(txs: Transaction[]) {
  if (!txs.length) return;
  await upsertTxRows(txs);
}

export async function patchTransaction(id: string, patch: Partial<Transaction>) {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.fundId !== undefined) row.fund_id = patch.fundId;
  if (patch.ledger !== undefined) row.ledger = patch.ledger;
  if (patch.counterparty !== undefined) row.counterparty = patch.counterparty;
  if (patch.date !== undefined) row.date = patch.date;
  if (patch.amount !== undefined) row.amount = patch.amount;
  if (patch.note !== undefined) row.note = patch.note;
  if (patch.lastEditedAt !== undefined) row.last_edited_at = patch.lastEditedAt;
  if (patch.lastEditedByName !== undefined) row.last_edited_by_name = patch.lastEditedByName;
  if (patch.lastEditedByEmail !== undefined) row.last_edited_by_email = patch.lastEditedByEmail;
  if (patch.editHistory !== undefined) row.edit_history = patch.editHistory;
  if (patch.pendingWhatsAppMessage !== undefined) row.pending_whatsapp_message = patch.pendingWhatsAppMessage;
  if (patch.approvalDetails !== undefined) row.approval_details = patch.approvalDetails;
  if (patch.approvedByName !== undefined) row.approved_by_name = patch.approvedByName;
  if (patch.approvedByEmail !== undefined) row.approved_by_email = patch.approvedByEmail;
  if (patch.approvedAt !== undefined) row.approved_at = patch.approvedAt;
  if (patch.orderedDate !== undefined) row.ordered_date = patch.orderedDate;
  if (patch.fee !== undefined || patch.feeMode !== undefined) {
    row.fee = feeToDbValue(patch as Transaction) ?? null;
  }
  if ('claimedByUserId' in patch) row.claimed_by_id = patch.claimedByUserId ?? null;
  if ('claimedByName' in patch) row.claimed_by_name = patch.claimedByName ?? null;
  if ('claimedAt' in patch) row.claimed_at = patch.claimedAt ?? null;
  if (patch.comments !== undefined) row.comments = patch.comments?.length ? patch.comments : null;
  const { error } = await requireClient().from('transactions').update(row).eq('id', id);
  if (error && isMissingColumnError(error)) {
    const { data, error: readErr } = await requireClient()
      .from('transactions')
      .select('note')
      .eq('id', id)
      .single();
    if (readErr) throw formatDbError(readErr);
    const decoded = decodeNoteMeta((data?.note as string) || undefined);
    const note = encodeNoteMeta(patch.note ?? decoded.userNote, {
      ledger: patch.ledger ?? decoded.ledger,
      counterparty: patch.counterparty ?? decoded.counterparty,
      batchId: decoded.batchId,
      linkId: decoded.linkId,
      createdByUserId: decoded.createdByUserId,
      createdByEmail: decoded.createdByEmail,
      createdByName: decoded.createdByName,
      pendingWhatsAppMessage: patch.pendingWhatsAppMessage ?? decoded.pendingWhatsAppMessage,
      approvalDetails: patch.approvalDetails ?? decoded.approvalDetails,
      approvedByName: patch.approvedByName ?? decoded.approvedByName,
      approvedByEmail: patch.approvedByEmail ?? decoded.approvedByEmail,
      approvedAt: patch.approvedAt ?? decoded.approvedAt,
      orderedDate: patch.orderedDate ?? decoded.orderedDate,
      feeSourceId: patch.feeSourceId ?? decoded.feeSourceId,
      halabRemittance: patch.halabRemittance ?? decoded.halabRemittance,
    });
    const legacyUpdate: Record<string, unknown> = {};
    if (patch.status !== undefined) legacyUpdate.status = patch.status;
    if (note !== undefined) legacyUpdate.note = note;
    const { error: noteErr } = await requireClient()
      .from('transactions')
      .update(legacyUpdate)
      .eq('id', id);
    if (noteErr) throw formatDbError(noteErr);
    return;
  }
  if (error) throw formatDbError(error);
}

export async function patchTransactions(ids: string[], patch: Partial<Transaction>) {
  await Promise.all(ids.map(id => patchTransaction(id, patch)));
}

export async function removeTransaction(id: string) {
  const { error } = await requireClient().from('transactions').delete().eq('id', id);
  if (error) throw formatDbError(error);
}

export async function removeTransactions(ids: string[]) {
  if (!ids.length) return;
  const { error } = await requireClient().from('transactions').delete().in('id', ids);
  if (error) throw formatDbError(error);
}

export async function upsertBill(bill: Bill) {
  const { error } = await requireClient().from('bills').upsert(billToRow(bill));
  if (error) throw formatDbError(error);
}

export async function removeBill(id: string) {
  const { error } = await requireClient().from('bills').delete().eq('id', id);
  if (error) throw formatDbError(error);
}

export async function upsertCustomer(customer: Customer) {
  const row = customerToRow(customer);
  let { error } = await requireClient().from('customers').upsert(row);
  if (error && isMissingColumnError(error) && 'shared_fund_ids' in row) {
    const { shared_fund_ids: _omit, ...legacyRow } = row;
    ({ error } = await requireClient().from('customers').upsert(legacyRow));
  }
  if (error) throw formatDbError(error);
}

export async function removeCustomer(id: string) {
  const { error } = await requireClient().from('customers').delete().eq('id', id);
  if (error) throw formatDbError(error);
}

export async function importAppState(state: AppState) {
  if (state.transactions.length) await upsertTxRows(state.transactions);
  const client = requireClient();
  if (state.bills.length) {
    const { error } = await client.from('bills').upsert(state.bills.map(billToRow));
    if (error) throw formatDbError(error);
  }
  if (state.customers.length) {
    const { error } = await client.from('customers').upsert(state.customers.map(customerToRow));
    if (error) throw formatDbError(error);
  }
}
