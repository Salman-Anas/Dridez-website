import { createContext, useContext, useMemo } from 'react';
import { INITIAL_AUTH_STATE, type AdminAuthState } from './auth';

/**
 * One Firebase Auth subscription for the whole portal, provided by
 * `components/AuthProvider`. The context and its hooks live here rather than
 * beside the component so that the provider file exports a component and
 * nothing else, which is what keeps Fast Refresh working.
 */
export const AdminAuthContext = createContext<AdminAuthState>(INITIAL_AUTH_STATE);

export const useAdminAuth = (): AdminAuthState => useContext(AdminAuthContext);

/**
 * The label to store on records this admin touches — `verifiedBy` on a user,
 * `reviewedBy` on a driver application, `by` on a wallet top-up. Falls back to
 * the uid when the account has no email, and to "Admin" only if neither is
 * known: the field is an audit trail, so it is never left blank.
 */
export const useAdminLabel = (): string => {
  const { user, adminEmail } = useAdminAuth();
  return useMemo(() => adminEmail || user?.uid || 'Admin', [adminEmail, user]);
};
