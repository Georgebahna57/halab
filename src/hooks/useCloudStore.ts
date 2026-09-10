import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountBranchId, AppState, Bill, Customer, Transaction, TransactionComment } from '../types';
import {
  fetchAppState,
  fetchDataFingerprint,
  importAppState,
  patchTransactions,
  removeBill,
  removeCustomer,
  removeTransactions,
  upsertBill,
  upsertCustomer,
  upsertTransactions,
} from '../lib/db';
import { saveValuationRates } from '../lib/appSettings';
import type { AppBackup } from '../lib/backup';
import { repairNsypToSypTransactions, normalizeSyrianTransaction } from '../lib/syrianCurrency';
import {
  appendEditHistory,
  applyCustomerFundMove,
  applyCustomerRename,
  backfillLinkedAccountFields,
  describeTransaction,
  getDeletionGroupIds,
  getOperationGroupIds,
  inferAccountTransactionFund,
  loadState,
  parseMentions,
  prepareCustomerFundMove,
  repairHalabFundTransactions,
} from '../lib/utils';
import {
  collectFeeSyncLeadIds,
  getFeeSyncLeadIds,
  syncAutoFeesForOperations,
} from '../lib/feePosting';
import {
  describeRemoteChange,
  findNewTransactionsFromOthers,
  fingerprintKey,
  mergeCloudState,
} from '../lib/remoteSync';
import {
  maybeAutoSnapshot,
  mirrorAppState,
  recoverFromLocalMirror,
  saveManualSnapshot,
  savePreDestructiveSnapshot,
} from '../lib/localMirror';
import {
  ACCOUNT_BRANCH_LABELS,
  applyAccountBranchMove,
  accountExistsInBranch,
  inferAccountBranch,
  prepareCustomerForBranch,
} from '../lib/accountBranch';
import { logAudit } from '../lib/auditLog';
import { runAllHalabRepairs } from '../lib/halabBalance';
import {
  buildAllImportTransactions,
  TRIAL_BALANCE_IMPORT_NOTE,
  TRIAL_BALANCE_OPENING_NOTE,
  type TrialBalanceImportAccount,
} from '../lib/trialBalanceImport';
import { createCustomer, findCustomerForAccount } from '../lib/utils';
import { getFund } from '../config';
import type { FundId } from '../types';

const MIGRATED_KEY = 'sandouk-cloud-migrated';

type FeeSyncResult = {
  transactions: Transaction[];
  upsert: Transaction[];
  removeIds: string[];
};

function mergeFeeSync(transactions: Transaction[], leadIds: string[]): FeeSyncResult {
  const { transactions: synced, changed, removedIds } = syncAutoFeesForOperations(transactions, leadIds);
  return { transactions: synced, upsert: changed, removeIds: removedIds };
}

export interface StoreActor {
  userId: string;
  email: string;
  displayName: string;
}

function toArray(tx: Transaction | Transaction[]): Transaction[] {
  return Array.isArray(tx) ? tx : [tx];
}

function stampActor(tx: Transaction, actor?: StoreActor): Transaction {
  if (!actor) return tx;
  return {
    ...tx,
    createdByUserId: actor.userId,
    createdByEmail: actor.email,
    createdByName: actor.displayName,
  };
}

function mergeUniqueTransactions(existing: Transaction[], incoming: Transaction[]): Transaction[] {
  const byId = new Map<string, Transaction>();
  for (const tx of existing) byId.set(tx.id, tx);
  for (const tx of incoming) byId.set(tx.id, tx);
  return [...byId.values()];
}

export function useCloudStore(enabled: boolean, actor?: StoreActor) {
  const [state, setState] = useState<AppState>({ transactions: [], bills: [], customers: [] });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteNotice, setRemoteNotice] = useState<string | null>(null);
  const stateRef = useRef(state);
  const syncingRef = useRef(false);
  const fingerprintRef = useRef<string | null>(null);
  const lastPollAtRef = useRef(0);
  stateRef.current = state;
  syncingRef.current = syncing;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function init() {
      setLoading(true);
      setError(null);
      try {
        let cloud = await fetchAppState();
        const local = loadState();
        const hasLocal = local.transactions.length + local.bills.length + local.customers.length > 0;
        const hasCloud = cloud.transactions.length + cloud.bills.length + cloud.customers.length > 0;
        const alreadyMigrated = localStorage.getItem(MIGRATED_KEY) === '1';

        if (hasLocal && !hasCloud && !alreadyMigrated) {
          await importAppState(local);
          localStorage.setItem(MIGRATED_KEY, '1');
          cloud = await fetchAppState();
        }

        if (!cancelled) {
          // تحميل البيانات كما هي — الإصلاحات التلقائية من زر الإدارة فقط (تجنّب حلقة تحديث بين الأجهزة)
          setState(cloud);
          mirrorAppState(cloud);
          try {
            const fp = await fetchDataFingerprint();
            fingerprintRef.current = fingerprintKey(fp);
          } catch {
            fingerprintRef.current = null;
          }
        }
      } catch (err) {
        if (!cancelled) {
          const recovered = recoverFromLocalMirror();
          if (recovered) {
            setState(recovered.state);
            setError(`تعذّر الاتصال — عُرضت نسخة محلية (${new Date(recovered.savedAt).toLocaleString('ar-LB')})`);
          } else {
            setError(err instanceof Error ? err.message : 'فشل تحميل البيانات');
            setState(loadState());
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || loading) return;

    let cancelled = false;

    async function pollRemote() {
      if (cancelled || syncingRef.current || document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastPollAtRef.current < 5_000) return;
      lastPollAtRef.current = now;
      try {
        const fp = await fetchDataFingerprint();
        const key = fingerprintKey(fp);
        if (fingerprintRef.current === null) {
          fingerprintRef.current = key;
          return;
        }
        if (key === fingerprintRef.current) return;

        const cloud = await fetchAppState();
        if (cancelled || syncingRef.current) return;

        const previous = stateRef.current.transactions;
        const fromOthers = findNewTransactionsFromOthers(previous, cloud.transactions, actor?.userId);
        const nextState = mergeCloudState(stateRef.current, cloud);
        setState(nextState);
        mirrorAppState(nextState);
        fingerprintRef.current = key;

        if (fromOthers.length > 0) {
          setRemoteNotice(describeRemoteChange(fromOthers));
        }
      } catch {
        // تجاهل أخطاء الشبكة المؤقتة
      }
    }

    const timer = window.setInterval(() => { void pollRemote(); }, 60_000);
    const onVisible = () => { void pollRemote(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, loading, actor?.userId]);

  useEffect(() => {
    if (!enabled || loading) return;
    const timer = window.setTimeout(() => {
      mirrorAppState(state);
      maybeAutoSnapshot(state);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [enabled, loading, state]);

  useEffect(() => {
    if (!enabled || loading) return;
    function onHide() {
      if (document.visibilityState === 'hidden') mirrorAppState(stateRef.current);
    }
    function onUnload() {
      mirrorAppState(stateRef.current);
    }
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [enabled, loading]);

  const runSync = useCallback(async (fn: () => Promise<void>) => {
    setSyncing(true);
    setError(null);
    try {
      await fn();
      try {
        const fp = await fetchDataFingerprint();
        fingerprintRef.current = fingerprintKey(fp);
      } catch {
        // تجاهل
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الحفظ');
      throw err;
    } finally {
      setSyncing(false);
    }
  }, []);

  const addTransaction = useCallback(async (tx: Transaction | Transaction[]) => {
    const txs = toArray(tx).map(t => stampActor(normalizeSyrianTransaction(t) as Transaction, actor));
    let previous: Transaction[] = [];
    let syncResult: FeeSyncResult = { transactions: [], upsert: [], removeIds: [] };
    setState(prev => {
      previous = prev.transactions;
      const merged = mergeUniqueTransactions(txs, prev.transactions);
      const leadIds = collectFeeSyncLeadIds(merged, txs.map(t => t.id));
      syncResult = mergeFeeSync(merged, leadIds);
      return { ...prev, transactions: syncResult.transactions };
    });
    try {
      await runSync(async () => {
        if (syncResult.removeIds.length) await removeTransactions(syncResult.removeIds);
        const upsertIds = new Set(txs.map(t => t.id));
        const feeUpsert = syncResult.upsert.filter(t => !upsertIds.has(t.id));
        await upsertTransactions([...txs, ...feeUpsert]);
      });
    } catch {
      setState(prev => ({ ...prev, transactions: previous }));
      throw new Error('فشل الحفظ');
    }
  }, [actor, runSync]);

  const updateTransaction = useCallback(async (id: string, patch: Partial<Transaction>) => {
    let ids: string[] = [id];
    let upsertTxs: Transaction[] = [];
    let syncResult: FeeSyncResult = { transactions: [], upsert: [], removeIds: [] };
    setState(prev => {
      ids = getOperationGroupIds(prev.transactions, id);
      const patched = prev.transactions.map(tx => {
        if (!ids.includes(tx.id)) return tx;
        return normalizeSyrianTransaction({ ...tx, ...patch }) as Transaction;
      });
      upsertTxs = patched.filter(tx => ids.includes(tx.id));
      const leadIds = collectFeeSyncLeadIds(patched, ids);
      syncResult = mergeFeeSync(patched, leadIds);
      return { ...prev, transactions: syncResult.transactions };
    });
    await runSync(async () => {
      if (syncResult.removeIds.length) await removeTransactions(syncResult.removeIds);
      if (upsertTxs.length) await upsertTransactions(upsertTxs);
      if (syncResult.upsert.length) await upsertTransactions(syncResult.upsert);
    });
  }, [runSync]);

  const approvePendingOperations = useCallback(async (
    leadIds: string[],
    meta: {
      approvalDetails?: string;
      approvedByName?: string;
      approvedByEmail?: string;
      executionDate: string;
      approvedAt: string;
    },
  ) => {
    if (!leadIds.length) return;
    let upsertTxs: Transaction[] = [];
    let syncResult: FeeSyncResult = { transactions: [], upsert: [], removeIds: [] };
    const affectedIds = new Set<string>();

    setState(prev => {
      let transactions = prev.transactions;
      for (const leadId of leadIds) {
        const groupIds = getOperationGroupIds(transactions, leadId);
        groupIds.forEach(gid => affectedIds.add(gid));
        const lead = transactions.find(t => t.id === leadId);
        if (!lead) continue;
        const orderedDate = lead.date !== meta.executionDate ? lead.date : undefined;
        const patch = {
          status: 'posted' as const,
          date: meta.executionDate,
          orderedDate,
          approvalDetails: meta.approvalDetails,
          approvedByName: meta.approvedByName,
          approvedByEmail: meta.approvedByEmail,
          approvedAt: meta.approvedAt,
        };
        transactions = transactions.map(tx =>
          groupIds.includes(tx.id)
            ? normalizeSyrianTransaction({ ...tx, ...patch }) as Transaction
            : tx,
        );
      }
      upsertTxs = transactions.filter(tx => affectedIds.has(tx.id));
      syncResult = mergeFeeSync(transactions, collectFeeSyncLeadIds(transactions, leadIds));
      return { ...prev, transactions: syncResult.transactions };
    });

    await runSync(async () => {
      if (syncResult.removeIds.length) await removeTransactions(syncResult.removeIds);
      if (upsertTxs.length) await upsertTransactions(upsertTxs);
      if (syncResult.upsert.length) await upsertTransactions(syncResult.upsert);
    });
  }, [runSync]);

  const deleteTransaction = useCallback(async (id: string) => {
    const tx = stateRef.current.transactions.find(t => t.id === id);
    savePreDestructiveSnapshot(stateRef.current, 'pre-delete');
    let removeIds: string[] = [id];
    setState(prev => {
      removeIds = getDeletionGroupIds(prev.transactions, id);
      return { ...prev, transactions: prev.transactions.filter(tx => !removeIds.includes(tx.id)) };
    });
    await runSync(() => removeTransactions(removeIds));
    if (tx && actor) {
      logAudit({
        userId: actor.userId,
        userName: actor.displayName,
        action: 'transaction_delete',
        entityType: 'transaction',
        entityId: id,
        fundId: tx.fundId,
        details: describeTransaction(tx),
      });
    }
  }, [actor, runSync]);

  const editTransactions = useCallback(async (updated: Transaction[], summary: string) => {
    const stamped = updated.map(tx => appendEditHistory(normalizeSyrianTransaction(tx) as Transaction, summary, actor));
    let syncResult: FeeSyncResult = { transactions: [], upsert: [], removeIds: [] };
    setState(prev => {
      const merged = prev.transactions.map(tx => {
        const u = stamped.find(s => s.id === tx.id);
        return u ?? tx;
      });
      const leadIds = collectFeeSyncLeadIds(merged, stamped.map(t => t.id));
      syncResult = mergeFeeSync(merged, leadIds);
      return { ...prev, transactions: syncResult.transactions };
    });
    await runSync(async () => {
      if (syncResult.removeIds.length) await removeTransactions(syncResult.removeIds);
      const upsertIds = new Set(stamped.map(t => t.id));
      const feeUpsert = syncResult.upsert.filter(t => !upsertIds.has(t.id));
      await upsertTransactions([...stamped, ...feeUpsert]);
    });
    if (actor) {
      logAudit({
        userId: actor.userId,
        userName: actor.displayName,
        action: 'transaction_edit',
        entityType: 'transaction',
        entityId: stamped[0]?.id,
        fundId: stamped[0]?.fundId,
        details: summary,
      });
    }
  }, [actor, runSync]);

  const addBill = useCallback(async (bill: Bill) => {
    setState(prev => ({ ...prev, bills: [bill, ...prev.bills] }));
    await runSync(() => upsertBill(bill));
  }, [runSync]);

  const deleteBill = useCallback(async (id: string) => {
    savePreDestructiveSnapshot(stateRef.current, 'pre-delete');
    setState(prev => ({ ...prev, bills: prev.bills.filter(b => b.id !== id) }));
    await runSync(() => removeBill(id));
  }, [runSync]);

  const addCustomer = useCallback(async (customer: Customer) => {
    setState(prev => ({ ...prev, customers: [customer, ...prev.customers] }));
    await runSync(() => upsertCustomer(customer));
  }, [runSync]);

  const updateCustomer = useCallback(async (updated: Customer, previousName: string) => {
    const prevCustomer = stateRef.current.customers.find(c => c.id === updated.id);
    const nameChanged = updated.name.trim() !== previousName.trim();
    const fundChanged = prevCustomer && updated.fundId !== prevCustomer.fundId;
    const changedTxMap = new Map<string, Transaction>();

    const customerToSave = fundChanged
      ? prepareCustomerFundMove(updated, updated.fundId)
      : updated;

    setState(prev => {
      let transactions = prev.transactions;

      if (fundChanged && prevCustomer) {
        const sourceFund = inferAccountTransactionFund(
          prev.transactions,
          previousName.trim(),
          prevCustomer.fundId,
        );
        const moveResult = applyCustomerFundMove(
          transactions,
          previousName.trim(),
          sourceFund,
          customerToSave.fundId,
        );
        transactions = moveResult.transactions;
        for (const tx of moveResult.changed) changedTxMap.set(tx.id, tx);
      }

      if (nameChanged) {
        const renameResult = applyCustomerRename(
          transactions,
          previousName.trim(),
          customerToSave.name.trim(),
          customerToSave.fundId,
          customerToSave.sharedFundIds,
        );
        transactions = renameResult.transactions;
        for (const tx of renameResult.changed) changedTxMap.set(tx.id, tx);
      }

      return {
        ...prev,
        customers: prev.customers.map(c => (c.id === updated.id ? customerToSave : c)),
        transactions,
      };
    });

    const changedTxs = [...changedTxMap.values()];

    await runSync(async () => {
      await upsertCustomer(customerToSave);
      if (changedTxs.length) await upsertTransactions(changedTxs);
    });

    if (actor) {
      const prevRecon = prevCustomer?.reconciliation?.throughDate;
      const newRecon = customerToSave.reconciliation?.throughDate;
      if (prevRecon !== newRecon) {
        logAudit({
          userId: actor.userId,
          userName: actor.displayName,
          action: 'reconciliation',
          entityType: 'customer',
          entityId: customerToSave.id,
          fundId: customerToSave.fundId,
          details: newRecon
            ? `مطابق حتى ${newRecon}`
            : 'إلغاء المطابقة',
        });
      } else if (fundChanged && prevCustomer) {
        logAudit({
          userId: actor.userId,
          userName: actor.displayName,
          action: 'customer_move',
          entityType: 'customer',
          entityId: customerToSave.id,
          fundId: customerToSave.fundId,
          details: `نقل الحساب ${customerToSave.name}: ${getFund(prevCustomer.fundId).name} → ${getFund(customerToSave.fundId).name}`,
        });
      } else if (nameChanged || customerToSave.phone !== prevCustomer?.phone) {
        logAudit({
          userId: actor.userId,
          userName: actor.displayName,
          action: 'customer_update',
          entityType: 'customer',
          entityId: customerToSave.id,
          fundId: customerToSave.fundId,
          details: nameChanged
            ? `تغيير الاسم: ${previousName} → ${customerToSave.name}`
            : `تعديل حساب ${customerToSave.name}`,
        });
      }
    }
  }, [actor, runSync]);

  const moveAccountToBranch = useCallback(async (
    accountName: string,
    toBranch: AccountBranchId,
    customersLedgerFundId: FundId,
    opts?: { customerId?: string; accountNumber?: string },
  ) => {
    const trimmed = accountName.trim();
    const fromBranch = inferAccountBranch(
      stateRef.current.transactions,
      trimmed,
      opts?.customerId
        ? stateRef.current.customers.find(c => c.id === opts.customerId)
        : stateRef.current.customers.find(c => c.name === trimmed),
    );

    if (fromBranch === toBranch) return;

    if (accountExistsInBranch(stateRef.current.customers, toBranch, trimmed, opts?.customerId)) {
      throw new Error('في حساب بنفس الاسم في هذا القسم');
    }

    const prevCustomer = opts?.customerId
      ? stateRef.current.customers.find(c => c.id === opts.customerId)
      : stateRef.current.customers.find(c => c.name === trimmed);

    let customerToSave: Customer | undefined;
    if (prevCustomer) {
      customerToSave = prepareCustomerForBranch(prevCustomer, toBranch, customersLedgerFundId);
    }

    const changedTxMap = new Map<string, Transaction>();
    setState(prev => {
      const moveResult = applyAccountBranchMove(
        prev.transactions,
        trimmed,
        toBranch,
        customersLedgerFundId,
      );
      for (const tx of moveResult.changed) changedTxMap.set(tx.id, tx);

      if (!customerToSave && moveResult.changed.length > 0) {
        customerToSave = createCustomer({
          fundId: toBranch === 'centers' ? 'marakiz' : customersLedgerFundId,
          name: trimmed,
          accountNumber: opts?.accountNumber,
          accountBranch: toBranch,
        });
      }

      const customers = customerToSave
        ? [customerToSave, ...prev.customers.filter(c => c.id !== customerToSave!.id)]
        : prev.customers;

      return { ...prev, transactions: moveResult.transactions, customers };
    });

    const changedTxs = [...changedTxMap.values()];

    await runSync(async () => {
      if (customerToSave) await upsertCustomer(customerToSave);
      if (changedTxs.length) await upsertTransactions(changedTxs);
    });

    if (actor) {
      logAudit({
        userId: actor.userId,
        userName: actor.displayName,
        action: 'customer_move',
        entityType: 'customer',
        entityId: customerToSave?.id,
        fundId: customerToSave?.fundId,
        details: `نقل الحساب ${trimmed}: ${ACCOUNT_BRANCH_LABELS[fromBranch]} → ${ACCOUNT_BRANCH_LABELS[toBranch]}`,
      });
    }
  }, [actor, runSync]);

  const deleteCustomer = useCallback(async (id: string) => {
    const customer = stateRef.current.customers.find(c => c.id === id);
    savePreDestructiveSnapshot(stateRef.current, 'pre-delete');
    setState(prev => ({ ...prev, customers: prev.customers.filter(c => c.id !== id) }));
    await runSync(() => removeCustomer(id));
    if (customer && actor) {
      logAudit({
        userId: actor.userId,
        userName: actor.displayName,
        action: 'customer_delete',
        entityType: 'customer',
        entityId: id,
        fundId: customer.fundId,
        details: customer.name,
      });
    }
  }, [actor, runSync]);

  const addComment = useCallback(async (id: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const comment: TransactionComment = {
      id: crypto.randomUUID(),
      text: trimmed,
      at: new Date().toISOString(),
      byUserId: actor?.userId,
      byName: actor?.displayName,
      byEmail: actor?.email,
      mentions: parseMentions(trimmed),
    };
    let ids: string[] = [id];
    let comments: TransactionComment[] = [];
    setState(prev => {
      ids = getOperationGroupIds(prev.transactions, id);
      const lead = prev.transactions.find(t => t.id === id)
        ?? prev.transactions.find(t => ids.includes(t.id));
      comments = [...(lead?.comments ?? []), comment];
      return {
        ...prev,
        transactions: prev.transactions.map(tx => (
          ids.includes(tx.id) ? { ...tx, comments } : tx
        )),
      };
    });
    await runSync(() => patchTransactions(ids, { comments }));
  }, [actor, runSync]);

  const claimTransaction = useCallback(async (id: string) => {
    if (!actor) return;
    const patch = {
      claimedByUserId: actor.userId,
      claimedByName: actor.displayName,
      claimedAt: new Date().toISOString(),
    };
    let ids: string[] = [id];
    setState(prev => {
      ids = getOperationGroupIds(prev.transactions, id);
      return {
        ...prev,
        transactions: prev.transactions.map(tx => (
          ids.includes(tx.id) ? { ...tx, ...patch } : tx
        )),
      };
    });
    await runSync(() => patchTransactions(ids, patch));
  }, [actor, runSync]);

  const releaseClaim = useCallback(async (id: string) => {
    const patch = {
      claimedByUserId: undefined,
      claimedByName: undefined,
      claimedAt: undefined,
    };
    let ids: string[] = [id];
    setState(prev => {
      ids = getOperationGroupIds(prev.transactions, id);
      return {
        ...prev,
        transactions: prev.transactions.map(tx => (
          ids.includes(tx.id) ? { ...tx, ...patch } : tx
        )),
      };
    });
    await runSync(() => patchTransactions(ids, patch));
  }, [runSync]);

  const restoreBackup = useCallback(async (backup: AppBackup, mode: 'merge' | 'replace') => {
    setSyncing(true);
    setError(null);
    try {
      if (mode === 'replace') {
        savePreDestructiveSnapshot(stateRef.current, 'pre-replace');
      } else {
        saveManualSnapshot(stateRef.current);
      }
      if (mode === 'replace') {
        let txIds: string[] = [];
        let billIds: string[] = [];
        let customerIds: string[] = [];
        setState(prev => {
          txIds = prev.transactions.map(t => t.id);
          billIds = prev.bills.map(b => b.id);
          customerIds = prev.customers.map(c => c.id);
          return prev;
        });
        if (txIds.length) await removeTransactions(txIds);
        await Promise.all(billIds.map(id => removeBill(id)));
        await Promise.all(customerIds.map(id => removeCustomer(id)));
      }

      await importAppState({
        transactions: backup.transactions,
        bills: backup.bills,
        customers: backup.customers,
      });

      if (backup.valuationRates) {
        await saveValuationRates(backup.valuationRates);
      }

      const cloud = await fetchAppState();
      setState(cloud);
      mirrorAppState(cloud);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل استرجاع النسخة');
      throw err;
    } finally {
      setSyncing(false);
    }
  }, []);

  const repairHalabData = useCallback(async () => {
    await runSync(async () => {
      const cloud = await fetchAppState();
      const { changed: repairedNsyp, transactions: afterNsyp } = repairNsypToSypTransactions(cloud.transactions);
      const { changed: repairedHalab, transactions: afterParty } = repairHalabFundTransactions(afterNsyp);
      const { changed: repairedOpening, transactions: afterOpening } = runAllHalabRepairs(afterParty);
      const { transactions: withBackfill, changed } = backfillLinkedAccountFields(afterOpening);
      const leadIds = getFeeSyncLeadIds(withBackfill);
      const feeSync = mergeFeeSync(withBackfill, leadIds);
      if (feeSync.removeIds.length) await removeTransactions(feeSync.removeIds);
      const toUpsert = [...repairedNsyp, ...repairedHalab, ...repairedOpening, ...changed, ...feeSync.upsert];
      if (toUpsert.length) await upsertTransactions(toUpsert);
      const refreshed = await fetchAppState();
      setState(refreshed);
      mirrorAppState(refreshed);
    });
  }, [runSync]);

  const importTrialBalance = useCallback(async (
    accounts: TrialBalanceImportAccount[],
    fundId: FundId,
  ) => {
    const importMarkers = [TRIAL_BALANCE_IMPORT_NOTE, TRIAL_BALANCE_OPENING_NOTE];
    const accountNames = accounts.map(a => a.name.trim());

    savePreDestructiveSnapshot(stateRef.current, 'pre-import');

    const deleteIds = stateRef.current.transactions
      .filter(t =>
        t.fundId === fundId
        && t.ledger === 'account'
        && (
          importMarkers.some(m => (t.note ?? '').includes(m))
          || accountNames.includes((t.party ?? '').trim())
        ),
      )
      .map(t => t.id);

    let newCustomers: Customer[] = [];
    const customerUpdates: Customer[] = [];

    for (const acc of accounts) {
      const name = acc.name.trim();
      const existing = findCustomerForAccount(stateRef.current.customers, name, fundId)
        ?? stateRef.current.customers.find(c => c.fundId === fundId && c.name === name);
      if (!existing) {
        newCustomers.push(createCustomer({
          fundId,
          name,
          accountNumber: acc.code?.trim() || undefined,
        }));
      } else if (acc.code?.trim() && existing.accountNumber !== acc.code.trim()) {
        customerUpdates.push({ ...existing, accountNumber: acc.code.trim() });
      }
    }

    const importTxs = buildAllImportTransactions(accounts, fundId);

    setState(prev => {
      const filteredTx = prev.transactions.filter(t => !deleteIds.includes(t.id));
      const mergedCustomers = [...prev.customers];
      for (const c of newCustomers) mergedCustomers.unshift(c);
      for (const u of customerUpdates) {
        const idx = mergedCustomers.findIndex(c => c.id === u.id);
        if (idx >= 0) mergedCustomers[idx] = u;
      }
      return {
        ...prev,
        customers: mergedCustomers,
        transactions: mergeUniqueTransactions(importTxs, filteredTx),
      };
    });

    await runSync(async () => {
      if (deleteIds.length) await removeTransactions(deleteIds);
      for (const c of newCustomers) await upsertCustomer(c);
      for (const u of customerUpdates) await upsertCustomer(u);
      if (importTxs.length) await upsertTransactions(importTxs);
    });
  }, [runSync]);

  return {
    state,
    loading,
    syncing,
    error,
    remoteNotice,
    clearRemoteNotice: () => setRemoteNotice(null),
    addTransaction,
    updateTransaction,
    approvePendingOperations,
    deleteTransaction,
    editTransactions,
    addBill,
    deleteBill,
    addCustomer,
    updateCustomer,
    moveAccountToBranch,
    deleteCustomer,
    importTrialBalance,
    addComment,
    claimTransaction,
    releaseClaim,
    restoreBackup,
    repairHalabData,
  };
}
