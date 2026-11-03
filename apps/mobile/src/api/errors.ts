/** Turkish copy for the API's problem codes; anything else falls back to the API's own detail. */
const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'E-posta ya da şifre hatalı.',
  EMAIL_TAKEN: 'Bu e-posta ile zaten bir hesap var.',
  VALIDATION_FAILED: 'Bazı bilgiler eksik ya da hatalı.',
  RATE_LIMITED: 'Çok fazla deneme yaptın. Biraz bekleyip tekrar dene.',
  SOLD_OUT: 'Bu bilet türü tükendi.',
  ALREADY_HAS_TICKET: 'Bu etkinlik için zaten bir biletin var.',
  SALES_NOT_OPEN: 'Satışlar henüz açılmadı.',
  SALES_CLOSED: 'Satışlar kapandı.',
  NOT_ENOUGH_POINTS: 'Bu bilet için kulüpten yeterli puanın yok.',
  LOTTERY_ONLY: 'Bu bilet çekilişle dağıtılıyor.',
  EVENT_NOT_OPEN: 'Bu etkinlik artık bilet almaya açık değil.',
  TOO_LATE_TO_CANCEL: 'Etkinlik başladığı için bilet iptal edilemez.',
};

const FALLBACK = 'Bir şeyler ters gitti. Bağlantını kontrol edip tekrar dene.';

export function problemMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return FALLBACK;
  const code = 'code' in error ? String(error.code) : '';
  const known = MESSAGES[code];
  if (known) return known;
  return 'detail' in error && typeof error.detail === 'string' ? error.detail : FALLBACK;
}
