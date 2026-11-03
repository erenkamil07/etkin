const dateTime = new Intl.DateTimeFormat('tr-TR', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** "Paz 16 Kasım 19:00" in the device's time zone. */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
