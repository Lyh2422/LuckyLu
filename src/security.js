import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fff]{3,32}$/;

export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

export function validateRegistration({ username, password, displayName }) {
  const normalized = normalizeUsername(username);
  const name = String(displayName || '').trim();
  if (!USERNAME_RE.test(normalized)) throw httpError(400, '账号需为 3–32 位中文、字母、数字或下划线');
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw httpError(400, '密码需为 10–128 位');
  if (!name || name.length > 20) throw httpError(400, '昵称需为 1–20 个字符');
  return { username: normalized, password, displayName: name };
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, cost, saltText, hashText] = String(encoded).split('$');
    if (algorithm !== 'scrypt' || cost !== '16384') return false;
    const expected = Buffer.from(hashText, 'base64url');
    const actual = Buffer.from(await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length, { N: Number(cost), r: 8, p: 1 }));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function makeToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    if (index < 0) return [part, ''];
    return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
