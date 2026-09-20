// ─── Dridez Admin Portal Auth ────────────────────────────────────────────────
// The portal used to check a username and a password hash in the browser and
// then talk to Firebase anonymously. The security rules refuse that outright:
// nothing in Firestore or the Realtime Database is readable or writable unless
// the caller is signed in to Firebase Auth, and only a user whose ID token
// carries the custom claim `admin: true` may read and write everything the
// portal touches (schema.md section 7).
//
// So authentication is Firebase Auth, and authorisation is that one claim.
// There is no local session to forge: signing in with a real account that
// lacks the claim gets you signed straight back out, because every request
// that account made would be refused by the rules anyway.

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase';

/** The claim the `setAdmin.js` script in the app repo grants. */
const ADMIN_CLAIM = 'admin';

export type AdminAuthStatus =
  /** Firebase has not yet restored (or rejected) a persisted session. */
  | 'loading'
  /** Nobody is signed in. */
  | 'signed-out'
  /** A real account is signed in, but it does not carry `admin: true`. */
  | 'not-admin'
  /** Signed in and authorised. */
  | 'admin';

export interface AdminAuthState {
  status: AdminAuthStatus;
  user: User | null;
  /** Who to record as `verifiedBy` / `reviewedBy` / `by` on portal writes. */
  adminEmail: string | null;
}

export const INITIAL_AUTH_STATE: AdminAuthState = {
  status: 'loading',
  user: null,
  adminEmail: null,
};

/** Error codes the login form turns into something a person can act on. */
export class AdminAuthError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'AdminAuthError';
    this.code = code;
  }
}

/**
 * Does this signed-in user carry the admin claim?
 *
 * `forceRefresh` re-fetches the ID token rather than using the cached one. A
 * claim granted after the session started otherwise takes up to an hour to
 * appear, which looks exactly like a broken login to whoever was just made an
 * admin — so the sign-in path always forces a refresh.
 */
export async function hasAdminClaim(user: User, forceRefresh = false): Promise<boolean> {
  const { claims } = await user.getIdTokenResult(forceRefresh);
  return claims[ADMIN_CLAIM] === true;
}

const SIGN_IN_ERRORS: Record<string, string> = {
  'auth/invalid-email': 'That does not look like an email address.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Could not reach Firebase. Check your connection.',
  'auth/operation-not-allowed': 'Email/password sign-in is disabled for this Firebase project.',
};

/**
 * Sign in and confirm the admin claim. A non-admin account is signed out again
 * before this returns, so no part of the portal ever runs against a session
 * whose every request the rules would refuse.
 */
export async function loginAdmin(email: string, password: string): Promise<User> {
  let user: User;
  try {
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    user = credential.user;
  } catch (e) {
    const code = (e as { code?: string })?.code ?? 'auth/unknown';
    throw new AdminAuthError(SIGN_IN_ERRORS[code] ?? 'Sign-in failed. Please try again.', code);
  }

  if (!(await hasAdminClaim(user, true))) {
    await signOut(auth);
    throw new AdminAuthError(
      'That account exists but is not an admin. Ask someone to run setAdmin.js for it, then sign in again.',
      'portal/not-an-admin',
    );
  }

  return user;
}

/** Ends the Firebase session on this device. */
export async function logoutAdmin(): Promise<void> {
  await signOut(auth);
}

/**
 * Subscribe to the signed-in admin. Fires once with the restored session (or
 * `signed-out`) as soon as Firebase has decided, and again on every change.
 * Returns the unsubscribe function.
 */
export function watchAdminAuth(onChange: (state: AdminAuthState) => void): () => void {
  return onAuthStateChanged(auth, user => {
    if (!user) {
      onChange({ status: 'signed-out', user: null, adminEmail: null });
      return;
    }
    hasAdminClaim(user)
      .then(isAdmin => {
        onChange(
          isAdmin
            ? { status: 'admin', user, adminEmail: user.email }
            : { status: 'not-admin', user, adminEmail: null },
        );
      })
      .catch(() => {
        // The token could not be read — treat it as unauthorised rather than
        // letting the portal run against a session the rules will refuse.
        onChange({ status: 'not-admin', user, adminEmail: null });
      });
  });
}
