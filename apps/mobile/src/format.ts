const dateTime = new Intl.DateTimeFormat('tr-TR', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

const clock = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const time = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });

const longDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

/** "16 Kasım 2026". */
export const formatDate = (iso: string) => longDate.format(new Date(iso));

/** "Paz 16 Kasım 19:00" in the device's time zone. */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

/** "19:00". */
export const formatTime = (iso: string) => time.format(new Date(iso));

/** "19:00:42", for the ticket screen's running clock. */
export const formatClock = (ms: number) => clock.format(new Date(ms));

/** "Ücretsiz", "₺150" or "₺149,90": kuruş only when there are some. */
export const formatPrice = (cents: number, currency: string) =>
  cents === 0
    ? 'Ücretsiz'
    : new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency,
        minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
      }).format(cents / 100);

const dayOfMonth = new Intl.DateTimeFormat('tr-TR', { day: 'numeric' });
const shortMonth = new Intl.DateTimeFormat('tr-TR', { month: 'short' });
const weekdayAndTime = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', hour: '2-digit', minute: '2-digit' });

/** The parts of a calendar-page date badge: "8" and "KAS". */
export const dateBadge = (iso: string) => {
  const date = new Date(iso);
  return {
    day: dayOfMonth.format(date),
    month: shortMonth.format(date).replace('.', '').toLocaleUpperCase('tr'),
  };
};

/** "Pazar 18:00", next to a date badge. */
export const formatWeekdayTime = (iso: string) => weekdayAndTime.format(new Date(iso));
