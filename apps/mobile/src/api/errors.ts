import { formatDate } from '@/format';

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
  ALREADY_CHECKED_IN: 'Bu bilet kapıda kullanıldı.',
  TICKET_CANCELLED: 'Bu bilet iptal edildi.',
  TICKET_NOT_FOUND: 'Bilet bulunamadı.',
  EVENT_NOT_FOUND: 'Etkinlik bulunamadı.',
  TICKET_TYPE_NOT_FOUND: 'Bilet türü bulunamadı.',
  FORBIDDEN: 'Bunu yapmak için kulüpte yetkin yok.',
  SLUG_TAKEN: 'Bu kısa ad başka bir kulübe ait; başka bir tane seç.',
  WRONG_PASSWORD: 'Şifre yanlış.',
  INVALID_EVENT_TIMES: 'Etkinliğin bitişi başlangıcından sonra olmalı.',
  INVALID_CHECKIN_WINDOW: 'Kapının kapanışı açılışından sonra olmalı.',
  TICKET_TYPE_NAME_TAKEN: 'Bu etkinlikte aynı adla bir bilet türü zaten var.',
  INVALID_SALES_WINDOW: 'Satış, etkinlik başlamadan önce bitmeli.',
  INVALID_PRIORITY_CONFIG: 'Erken erişim, herkese açık satıştan önce başlamalı.',
  EVENT_NOT_EDITABLE: 'Bu etkinlik artık değiştirilemez.',
  EVENT_ALREADY_ENDED: 'Etkinlik bitmiş; artık yayınlanamaz.',
  NO_TICKET_TYPES: 'Yayınlamak için en az bir bilet türü ekle.',
  PAYMENT_INFO_REQUIRED: 'Ücretli etkinlikte ödemenin nasıl yapılacağını yazmalısın.',
  INVALID_STATUS_TRANSITION: 'Etkinlik bu durumdayken bu işlem yapılamaz.',
  UNIVERSITY_ONLY: 'Bu etkinlik sadece kulübün üniversitesindeki öğrencilere açık.',
  CLUB_HAS_NO_UNIVERSITY: 'Etkinliği üniversitenize özel yapmak için önce kulübün üniversitesini seç.',
  NOT_A_NO_SHOW: 'Sadece bitmiş bir etkinliğe gelmeyenler mazeretli sayılabilir.',
  INVALID_NO_SHOW_RULE: 'Gelmeme kuralı için hem sayı hem süre seçmelisin.',
  UNSUPPORTED_IMAGE: 'Bu görsel kullanılamadı; başka bir fotoğraf seç.',
  FST_ERR_CTP_BODY_TOO_LARGE: 'Afiş çok büyük; en fazla 1,5 MB olabilir.',
};

/** Messages that name the date a time-limited refusal ends. */
const UNTIL_MESSAGES: Record<string, (date: string) => string> = {
  NO_SHOW_LIMIT: (date) =>
    `Bu kulübün son etkinliklerine bilet alıp gelmediğin için ${date} tarihine kadar bu kulüpten bilet alamazsın.`,
  UNIVERSITY_LOCKED: (date) =>
    `Üniversiteni ${date} tarihinde yeniden değiştirebilirsin. Acil bir durum varsa erenkamilgoksel96@gmail.com adresine yaz.`,
};

const FALLBACK = 'Bir şeyler ters gitti. Bağlantını kontrol edip tekrar dene.';

export function problemMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return FALLBACK;
  const code = 'code' in error ? String(error.code) : '';
  const withDate = UNTIL_MESSAGES[code];
  if (withDate && 'until' in error && typeof error.until === 'string') return withDate(formatDate(error.until));
  const known = MESSAGES[code];
  if (known) return known;
  return 'detail' in error && typeof error.detail === 'string' ? error.detail : FALLBACK;
}
