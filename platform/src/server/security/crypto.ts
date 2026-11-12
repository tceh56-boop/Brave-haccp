import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/**
 * Пароли — scrypt (адаптивная функция с настраиваемой стоимостью по памяти и времени, ТЗ v1 §15).
 * Формат: scrypt$N$r$p$соль$хеш (base64url). Параметры хранятся в строке — их можно повысить,
 * не ломая старые хеши.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 128 * PARAMS.N * PARAMS.r * 2 });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const N = Number(n), R = Number(r), P = Number(p);
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Случайный токен для ссылки или сессии; в базе хранится только sha256 от него. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Требования к паролю: не короче 10 символов, буквы и цифры. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Пароль — не короче 10 символов.';
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/\d/.test(password)) return 'В пароле нужны буквы и цифры.';
  return null;
}
