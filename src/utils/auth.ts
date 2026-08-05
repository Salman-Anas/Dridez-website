// ─── Dridez Admin Portal Auth Utilities ───────────────────────────────────────

const SESSION_KEY = 'dridez_admin_session';

// Correct SHA-256 cryptographic hash of "Admin@123" in hexadecimal:
// e86f78a8a3caf0b60d8e74e5942aa6d86dc150cd3c03338aef25b7d2d7e3acc7
const ENCRYPTED_ADMIN_HASH = 'e86f78a8a3caf0b60d8e74e5942aa6d86dc150cd3c03338aef25b7d2d7e3acc7';

interface AdminSession {
  token: string;
  username: string;
  deviceFingerprint: string;
  loginTimestamp: number;
  expiresAt: number;
}

function sha256PureJS(ascii: string): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i, j;

  const words: number[] = [];
  const asciiBitLength = ascii[lengthProperty] * 8;
  let hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isComposite: { [key: number]: boolean } = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = true;
      }
      hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return ''; // ASCII check
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
  words[words[lengthProperty]] = (asciiBitLength) | 0;

  for (j = 0; j < words[lengthProperty]; j += 16) {
    const w = words.slice(j, j + 16);
    const oldHash = hash.slice(0);
    for (i = 0; i < 64; i++) {
      let w15_val = w[i - 15] || 0;
      let w2_val = w[i - 2] || 0;
      const s0 = rightRotate(w15_val, 7) ^ rightRotate(w15_val, 18) ^ (w15_val >>> 3);
      const s1 = rightRotate(w2_val, 17) ^ rightRotate(w2_val, 19) ^ (w2_val >>> 10);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp1 = (hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) + ch + k[i] + (w[i] = (i < 16) ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0)) | 0;
      const temp2 = ((rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)) + maj) | 0;

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  let hexOutput = '';
  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (8 * j)) & 255;
      hexOutput += (b + 256).toString(16).substring(1);
    }
  }
  return hexOutput;
}

/**
 * Encrypts / hashes a raw password string using native Web Crypto API when available,
 * gracefully falling back to a pure JS SHA-256 implementation if necessary.
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto?.subtle?.digest) {
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // If crypto.subtle fails due to HTTP network origin restrictions, fallback below
  }
  return sha256PureJS(password);
}

/**
 * Generates a resilient device fingerprint to ensure session is bound to this device/browser.
 * Uses string hashing to avoid DOMException errors caused by special characters in btoa().
 */
function getDeviceFingerprint(): string {
  const navigatorInfo = typeof window !== 'undefined' ?
    `${navigator.userAgent}-${navigator.language}-${window.screen.width}x${window.screen.height}` : 'unknown';

  // Create a clean numeric hash of the device characteristics
  let hash = 0;
  for (let i = 0; i < navigatorInfo.length; i++) {
    const char = navigatorInfo.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `device_${Math.abs(hash).toString(16)}`;
}

/**
 * Validates login credentials against encrypted hash and generates a local device session.
 */
export async function loginAdmin(username: string, passwordRaw: string): Promise<boolean> {
  // Validate username (Admin)
  if (username.trim().toLowerCase() !== 'admin') {
    return false;
  }

  // Validate encrypted hash against SHA-256("Admin@123")
  const passwordHash = await hashPassword(passwordRaw);
  if (passwordHash !== ENCRYPTED_ADMIN_HASH) {
    return false;
  }

  // Generate secure device session (expires in 7 days)
  const now = Date.now();
  const session: AdminSession = {
    token: crypto.randomUUID ? crypto.randomUUID() : `dridez_token_${now}_${Math.random().toString(36).substring(2, 10)}`,
    username: 'Admin',
    deviceFingerprint: getDeviceFingerprint(),
    loginTimestamp: now,
    expiresAt: now + (7 * 24 * 60 * 60 * 1000), // 7 days
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return true;
}

/**
 * Checks if the current device has an active, valid, unexpired session token.
 */
export function isAuthenticated(): boolean {
  try {
    const sessionStr = localStorage.getItem(SESSION_KEY);
    if (!sessionStr) {
      return false; // New device or cleared session -> require login
    }

    const session: AdminSession = JSON.parse(sessionStr);

    // Check expiration
    if (Date.now() > session.expiresAt) {
      logoutAdmin();
      return false;
    }

    // Ensure device fingerprint matches this device
    if (session.deviceFingerprint !== getDeviceFingerprint()) {
      logoutAdmin();
      return false;
    }

    return Boolean(session.token && session.username === 'Admin');
  } catch {
    return false;
  }
}

/**
 * Clears the active admin session from this device.
 */
export function logoutAdmin(): void {
  localStorage.removeItem(SESSION_KEY);
}
