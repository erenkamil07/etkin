const dateTime = new Intl.DateTimeFormat('tr-TR', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

const clock = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const time = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });

/** "Paz 16 Kasım 19:00" in the device's time zone. */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

/** "19:00". */
export const formatTime = (iso: string) => time.format(new Date(iso));

/** "19:00:42", for the ticket screen's running clock. */
export const formatClock = (ms: number) => clock.format(new Date(ms));

/** "Ücretsiz" or "₺150,00". */
export const formatPrice = (cents: number, currency: string) =>
  cents === 0 ? 'Ücretsiz' : new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(cents / 100);
