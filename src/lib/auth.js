// Password hashing for the dashboard's user accounts. Uses the
// built-in node:crypto scrypt — no native deps, no extra packages.
// Format on disk: `scrypt$<saltHex>$<hashHex>` so we can change
// parameters later without breaking old hashes.

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// 64-byte hash, 16-byte salt — well above any rainbow-table risk for
// the low-traffic internal logins this app handles.
const HASH_LEN = 64;
const SALT_LEN = 16;

export async function hashPassword(password) {
  const salt = randomBytes(SALT_LEN);
  const hash = await scryptAsync(password, salt, HASH_LEN);
  return `scrypt$${salt.toString('hex')}$${Buffer.from(hash).toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  // Constant-time compare to avoid timing leaks.
  return timingSafeEqual(expected, Buffer.from(actual));
}
