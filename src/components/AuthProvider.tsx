import React, { useEffect, useState } from 'react';
import { INITIAL_AUTH_STATE, watchAdminAuth, type AdminAuthState } from '../utils/auth';
import { AdminAuthContext } from '../utils/adminAuthContext';

/**
 * Holds the single Firebase Auth subscription for the portal. Everything that
 * needs to know who is signed in reads it through `useAdminAuth` /
 * `useAdminLabel` from `utils/adminAuthContext`.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AdminAuthState>(INITIAL_AUTH_STATE);

  useEffect(() => watchAdminAuth(setState), []);

  return (
    <AdminAuthContext.Provider value={state}>
      {children}
    </AdminAuthContext.Provider>
  );
};
