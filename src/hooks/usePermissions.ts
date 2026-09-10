import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { FUNDS, isBoxFund } from '../config';
import {
  ensureProfile,
  fetchMyPermissions,
} from '../lib/profile';
import {
  canEditFund,
  canEditTransaction,
  canViewFund,
  resolveFundAccess,
  type FundAccess,
  type UserProfile,
} from '../lib/permissions';
import type { FundId, Transaction } from '../types';

export function usePermissions(user: User | null) {
  const userId = user?.id ?? null;
  const loadedForUserRef = useRef<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [permissions, setPermissions] = useState<Partial<Record<FundId, 'edit' | 'view'>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user || !userId) {
      loadedForUserRef.current = null;
      setProfile(null);
      setPermissions({});
      setLoading(false);
      return;
    }

    const isRefresh = loadedForUserRef.current === userId;
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const p = await ensureProfile(user);
      const perms = p.isAdmin ? {} : await fetchMyPermissions(user.id);
      setProfile(p);
      setPermissions(perms);
      loadedForUserRef.current = userId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تحميل الصلاحيات');
    } finally {
      setLoading(false);
    }
  }, [user, userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const fundAccess = useMemo(() => {
    const map = {} as Record<FundId, FundAccess>;
    for (const fund of FUNDS) {
      map[fund.id] = resolveFundAccess(fund.id, profile?.isAdmin ?? false, permissions);
    }
    return map;
  }, [profile, permissions]);

  const visibleFunds = useMemo(
    () => FUNDS.filter(f => canViewFund(fundAccess[f.id])),
    [fundAccess],
  );

  const accountsOnly = profile?.accountsOnly ?? false;

  const visibleBoxFunds = useMemo(
    () => accountsOnly ? [] : visibleFunds.filter(f => isBoxFund(f.id)),
    [visibleFunds, accountsOnly],
  );

  const accountAccessibleFunds = useMemo(
    () => visibleFunds.filter(f => isBoxFund(f.id) || f.id === 'marakiz'),
    [visibleFunds],
  );

  const canAccessCenters = useMemo(
    () => canViewFund(fundAccess.marakiz),
    [fundAccess],
  );

  const canAccessAccountsSection = useMemo(
    () => accountAccessibleFunds.length > 0 || canAccessCenters,
    [accountAccessibleFunds, canAccessCenters],
  );

  const getAccess = useCallback((fundId: FundId) => fundAccess[fundId], [fundAccess]);
  const canEdit = useCallback((fundId: FundId) => canEditFund(fundAccess[fundId]), [fundAccess]);

  const canEditTx = useCallback((tx: Transaction, fundId?: FundId) => canEditTransaction(tx, {
    isAdmin: profile?.isAdmin ?? false,
    canEditPast: profile?.canEditPast ?? false,
    hasFundEdit: canEditFund(fundAccess[fundId ?? tx.fundId]),
  }), [profile, fundAccess]);

  return {
    profile,
    permissions,
    fundAccess,
    visibleFunds,
    visibleBoxFunds,
    accountAccessibleFunds,
    accountsOnly,
    canAccessCenters,
    canAccessAccountsSection,
    loading,
    error,
    isAdmin: profile?.isAdmin ?? false,
    canEditPast: profile?.canEditPast ?? false,
    getAccess,
    canEdit,
    canEditTx,
    reload,
  };
}
