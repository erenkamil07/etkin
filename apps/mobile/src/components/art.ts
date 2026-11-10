/**
 * The colours and pictures Etkin makes up for clubs and events that have no
 * logo or poster of their own. Everything is derived from ids and names, so a
 * club looks the same on every screen and every phone.
 */

/** FNV-1a: a small, stable hash of a string. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A repeatable 0..1 sequence from a seed (mulberry32), for shapes that must not move between renders. */
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Gradient {
  from: string;
  to: string;
  /** Text and symbols drawn on the gradient: near-black on light ones, white on dark ones. */
  ink: string;
}

const PAIRS: [string, string][] = [
  ['#FF5A1F', '#FF2E7E'], // brand orange → pink
  ['#FFB020', '#FF5A1F'], // amber → orange
  ['#7C3AED', '#DB2777'], // violet → pink
  ['#4F46E5', '#0891B2'], // indigo → cyan
  ['#059669', '#0284C7'], // emerald → sky
  ['#0D9488', '#65A30D'], // teal → lime
  ['#E11D48', '#9333EA'], // rose → purple
  ['#2563EB', '#7C3AED'], // blue → violet
];

/** WCAG relative luminance of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const GRADIENTS: Gradient[] = PAIRS.map(([from, to]) => {
  const light = (luminance(from) + luminance(to)) / 2;
  // Above about 0.18, near-black reads better than white.
  return { from, to, ink: light > 0.18 ? '#0F0F12' : '#FFFFFF' };
});

/** A club's own colours: its avatar and its events' covers share them. */
export const clubGradient = (orgId: string): Gradient => GRADIENTS[hashString(orgId) % GRADIENTS.length] as Gradient;

// Words that most club names share, so they make poor initials.
const FILLER = new Set([
  'kulübü',
  'kulubu',
  'kulüp',
  'kolu',
  'topluluğu',
  'toplulugu',
  'topluluk',
  'üniversitesi',
  'universitesi',
  'öğrenci',
  'ogrenci',
  've',
  'club',
  'society',
  'of',
  'the',
]);

/** "Mersin Üniversitesi Yazılımcı Topluluğu" → "MY"; "IEEE" → "IE". */
export function clubInitials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const meaningful = words.filter((word) => !FILLER.has(word.toLocaleLowerCase('tr')));
  const picked = meaningful.length > 0 ? meaningful : words;
  if (picked.length === 1) return (picked[0] ?? '').slice(0, 2).toLocaleUpperCase('tr');
  return picked
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase('tr'))
    .join('');
}

// First match wins, so the more specific words come first.
const THEMES: [RegExp, string][] = [
  [/hackathon|yazılım|kod|programlama|yapay zeka|siber|robot|teknoloji|bilişim/, '💻'],
  [/konser|müzik|gitar|koro|caz|rock|dj/, '🎸'],
  [/tiyatro|sahne|drama/, '🎭'],
  [/film|sinema|belgesel/, '🎬'],
  [/dans|tango|salsa|zumba/, '💃'],
  [/futbol|basketbol|voleybol|turnuva|maç|spor|koşu|yoga|fitness/, '⚽'],
  [/satranç|oyun|e-?spor|kutu/, '🎮'],
  [/kitap|edebiyat|şiir|okuma/, '📚'],
  [/foto|fotoğraf|kamera/, '📷'],
  [/gezi|tur|kamp|doğa|yürüyüş|trekking/, '🧭'],
  [/kahve|çay|kahvaltı|yemek|piknik|mutfak/, '☕'],
  [/parti|festival|bahar|şenlik|mezuniyet|gala|balo/, '🎉'],
  [/atölye|workshop|eğitim|kurs|bootcamp/, '🛠️'],
  [/kariyer|staj|mülakat|cv|iş /, '💼'],
  [/sanat|resim|sergi|tasarım|çizim/, '🎨'],
  [/bilim|fizik|kimya|biyoloji|astronomi|uzay/, '🔭'],
  [/gönüllü|yardım|bağış|sosyal sorumluluk/, '🤝'],
  [/seminer|konferans|söyleşi|panel|zirve|summit|konuşma|sunum/, '🎤'],
];

/** A picture for an event's generated cover, guessed from its title. */
export function eventEmoji(title: string): string {
  const text = ` ${title.toLocaleLowerCase('tr')} `;
  return THEMES.find(([pattern]) => pattern.test(text))?.[1] ?? '🎟️';
}
