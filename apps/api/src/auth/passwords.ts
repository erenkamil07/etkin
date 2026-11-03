import { hash, verify } from '@node-rs/argon2';

// argon2id (the library default) at the OWASP Password Storage Cheat Sheet baseline.
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * When the account doesn't exist we still verify against a throwaway hash, so
 * response time doesn't reveal which emails are registered.
 */
export async function verifyPassword(storedHash: string | null | undefined, password: string): Promise<boolean> {
  dummyHash ??= hashPassword('timing-equalisation-only');
  const matches = await verify(storedHash ?? (await dummyHash), password);
  return matches && storedHash != null;
}
