// ─── Editing a user's details (dridez/schema.md §3.1) ────────────────────────
//
// What an admin may correct on `users/{uid}`: the name, the name on the ID
// card, the phone, the CNIC and the address. Validated with the app's own
// sign-up rules (dridez/screens/RegisterScreen.tsx). The email stays put: it
// is the Firebase Auth sign-in address, and changing the stored copy would not
// change the login. Saving never touches the verification status.
//
// Shared with the Admin-App (src/lib/userDetailsSchema.ts); keep them equal.

import { collection, doc, getDocs, limit, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';

export interface UserDetails {
  firstName: string;
  lastName: string;
  verifiedName: string;
  phone: string;
  cnic: string;
  address: string;
}

/** The parts of a `users` document the form reads. */
export interface UserDetailsSource {
  name?: string;
  firstName?: string;
  lastName?: string;
  verifiedName?: string;
  phone?: string;
  cnic?: string;
  address?: string;
}

export const PHONE_RULE = /^03\d{9}$/;
export const CNIC_RULE = /^\d{13}$/;
const MIN_ADDRESS_LENGTH = 10;

/** Phone numbers and CNICs are typed with spaces and dashes; stored bare. */
export const bareDigits = (v: string): string => v.replace(/[\s-]/g, '');

/** The form's starting values. Older accounts only have `name`, so it is split. */
export const detailsOf = (u: UserDetailsSource): UserDetails => {
  const [first = '', ...rest] = (u.name || '').trim().split(/\s+/);
  return {
    firstName: u.firstName ?? first,
    lastName: u.lastName ?? rest.join(' '),
    verifiedName: u.verifiedName || '',
    phone: u.phone || '',
    cnic: u.cnic || '',
    address: u.address || '',
  };
};

/** Trimmed, with spaces and dashes taken out of the phone and CNIC. */
const tidy = (f: UserDetails): UserDetails => ({
  firstName: f.firstName.trim(),
  lastName: f.lastName.trim(),
  verifiedName: f.verifiedName.trim(),
  phone: bareDigits(f.phone),
  cnic: bareDigits(f.cnic),
  address: f.address.trim(),
});

const problemWith = (f: UserDetails, had: UserDetails): string | null => {
  if (!f.firstName) return 'Enter a first name.';
  if (!f.lastName) return 'Enter a last name.';
  if (!PHONE_RULE.test(f.phone)) return 'The phone number must start with 03 and be 11 digits.';
  // Older accounts may never have given a CNIC or address; don't force one on them.
  if ((f.cnic || had.cnic) && !CNIC_RULE.test(f.cnic)) return 'The CNIC must be 13 digits.';
  if ((f.address || had.address) && f.address.length < MIN_ADDRESS_LENGTH) {
    return 'Enter the full address: house, street, area and city.';
  }
  return null;
};

/** Phone and CNIC are unique per account, as `checkAccountUnique` checks. */
export const takenBy = async (uid: string, field: 'phone' | 'cnic', value: string): Promise<boolean> => {
  const snap = await getDocs(query(collection(db, 'users'), where(field, '==', value), limit(2)));
  return snap.docs.some(d => d.id !== uid);
};

/**
 * Checks the form and writes only what changed (plus `name` when either half
 * did). `publicProfiles` picks up the new name and phone by itself. Throws an
 * Error whose message can be shown as is. Returns the fields written, empty
 * when nothing changed.
 */
export const saveUserDetails = async (
  uid: string,
  current: UserDetailsSource,
  form: UserDetails,
): Promise<Partial<UserDetails> & { name?: string }> => {
  const had = detailsOf(current);
  const next = tidy(form);
  const problem = problemWith(next, had);
  if (problem) throw new Error(problem);

  const changes: Partial<UserDetails> & { name?: string } = {};
  for (const key of Object.keys(next) as (keyof UserDetails)[]) {
    if (next[key] !== had[key]) changes[key] = next[key];
  }
  if (changes.firstName !== undefined || changes.lastName !== undefined) {
    changes.name = `${next.firstName} ${next.lastName}`;
  }
  if (!Object.keys(changes).length) return changes;

  let duplicate: string | null = null;
  try {
    if (changes.phone && await takenBy(uid, 'phone', changes.phone)) {
      duplicate = 'Another account already uses this phone number.';
    } else if (changes.cnic && await takenBy(uid, 'cnic', changes.cnic)) {
      duplicate = 'Another account already uses this CNIC.';
    } else {
      await updateDoc(doc(db, 'users', uid), changes);
    }
  } catch (e) {
    console.error(e);
    throw new Error('Could not save the details. Check the connection and try again.');
  }
  if (duplicate) throw new Error(duplicate);
  return changes;
};
