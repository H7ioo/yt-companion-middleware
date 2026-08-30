import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for the hosted deployment's accounts (PRD-15 §2, issue 043).
 *
 * scrypt from `node:crypto` rather than bcrypt/argon2: the desktop build ships as an Electron
 * bundle, and a native addon would have to be rebuilt per Electron ABI on every platform we
 * publish. scrypt is memory-hard, in the standard library, and needs no build step.
 *
 * The stored form is self-describing — `scrypt$N$r$p$salt$hash`, all base64url — so the cost
 * parameters can be raised later without invalidating existing credentials: a hash carries the
 * parameters it was made with, and verification uses those, not today's defaults.
 */

/** CPU/memory cost. 2^15 keeps a single verify around 100ms on modest VPS hardware. */
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * scrypt's default maxmem (32MB) is below what N=32768 needs (128 * N * r ≈ 32MB plus overhead),
 * so it is raised explicitly — otherwise the derivation throws instead of hashing.
 */
const MAX_MEM = 64 * 1024 * 1024;

function derive(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N: cost, r: blockSize, p: parallelization, maxmem: MAX_MEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** Hashes a password into the self-describing stored form. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, COST, BLOCK_SIZE, PARALLELIZATION);
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/**
 * Checks a password against a stored hash. Returns false — never throws — for a malformed or
 * unknown-algorithm stored value, so a corrupted store record fails the sign-in rather than
 * crashing the login route.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, costRaw, blockRaw, parallelRaw, saltRaw, keyRaw] = parts;
  const cost = Number(costRaw);
  const blockSize = Number(blockRaw);
  const parallelization = Number(parallelRaw);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization))
    return false;
  const salt = Buffer.from(saltRaw, "base64url");
  const expected = Buffer.from(keyRaw, "base64url");
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await derive(password, salt, cost, blockSize, parallelization);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
