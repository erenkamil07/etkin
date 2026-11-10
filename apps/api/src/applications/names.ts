// Small text helpers for club applications: where to check the club, and
// whether a new club's name looks like one that already exists.

/**
 * "@kulup" or "kulup" means an Instagram account; anything else must be an
 * http(s) address ("instagram.com/kulup", "https://kulup.mersin.edu.tr").
 * Returns null when it is neither.
 */
export function verificationUrl(input: string): string | null {
  const text = input.trim();
  const handle = /^@?([A-Za-z0-9._]{1,30})$/.exec(text);
  if (handle && (text.startsWith('@') || !text.includes('.'))) return `https://instagram.com/${handle[1]}`;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname.includes('.') || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// Words every club name shares; they say nothing about which club it is.
const COMMON = new Set([
  'kulubu',
  'kulup',
  'toplulugu',
  'topluluk',
  'ogrenci',
  'kolu',
  'universitesi',
  'universite',
  'university',
  'club',
  'society',
  've',
  'and',
  'of',
  'the',
]);
const FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };

/** "Yazılımcı Topluluğu" → ["yazilimci"]: lower case, no accents, without the common words or `ignore`. */
export function nameWords(name: string, ignore: ReadonlySet<string> = new Set()): string[] {
  return name
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (char) => FOLD[char] ?? char)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !COMMON.has(word) && !ignore.has(word));
}

/** "yazilim" and "yazilimci" are the same word here; short words have to match exactly. */
const sameWord = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Whether two club names look alike enough for the admin to compare them: at
 * least half the words of the shorter name appear in the other. Words of the
 * university's own name ("Mersin") are left out, or every club there would match.
 */
export function looksAlike(a: string, b: string, universityName: string | null): boolean {
  const ignore = new Set(universityName ? nameWords(universityName) : []);
  const x = nameWords(a, ignore);
  const y = nameWords(b, ignore);
  if (x.length === 0 || y.length === 0) return false;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  const shared = shorter.filter((word) => longer.some((other) => sameWord(word, other))).length;
  return shared / shorter.length >= 0.5;
}
