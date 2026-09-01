// ─── User document helpers ───────────────────────────────────────────────────
// The `users` collection is mid-migration: newer documents carry
// `devicePlatform` / `verificationStatus`, older ones only `os` / `isVerified`.
// Everything that reads a user document goes through these resolvers so both
// shapes render and count identically.

export interface UserSchemaFields {
  devicePlatform?: string;
  lastLoginPlatform?: string;
  verificationStatus?: string;
  /** Legacy fields. */
  os?: string;
  isVerified?: boolean;
}

export type Platform = 'android' | 'ios' | 'unknown';

export const getPlatform = (u: UserSchemaFields): Platform => {
  const raw = (u.devicePlatform || u.lastLoginPlatform || u.os || '').toLowerCase();
  if (raw.includes('android')) return 'android';
  if (raw.includes('ios') || raw.includes('iphone') || raw.includes('ipad')) return 'ios';
  return 'unknown';
};

export const platformLabel = (p: Platform) =>
  p === 'android' ? 'Android' : p === 'ios' ? 'iOS' : 'Unknown';

export type Verification = 'verified' | 'pending' | 'rejected' | 'unverified';

export const getVerification = (u: UserSchemaFields): Verification => {
  const raw = (u.verificationStatus || '').toLowerCase();
  if (raw === 'verified' || raw === 'approved') return 'verified';
  if (raw === 'pending' || raw === 'in_review' || raw === 'submitted') return 'pending';
  if (raw === 'rejected' || raw === 'declined') return 'rejected';
  if (!raw && u.isVerified) return 'verified';
  return 'unverified';
};
