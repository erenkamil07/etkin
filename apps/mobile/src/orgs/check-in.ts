import { randomUUID } from 'expo-crypto';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';
import { getDeviceId } from '@/auth/device';
import { formatDateTime } from '@/format';

export type ScanVerdict =
  paths['/orgs/{orgId}/events/{eventId}/check-ins']['post']['responses'][200]['content']['application/json'];

/** Admits a QR code (`qr`) or, for a holder whose phone died, a ticket by id (`ticketId`). */
export async function checkIn(
  orgId: string,
  eventId: string,
  ticket: { qr: string } | { ticketId: string },
): Promise<ScanVerdict> {
  // One key per physical scan. If the network drops after the server admitted
  // someone, the retry carries the same key and gets that answer back instead
  // of "already checked in".
  const key = randomUUID();
  const deviceId = await getDeviceId();
  const options = { params: { path: { orgId, eventId }, header: { 'idempotency-key': key } } };
  const send = () =>
    'qr' in ticket
      ? api.POST('/orgs/{orgId}/events/{eventId}/check-ins', { ...options, body: { qr: ticket.qr, deviceId } })
      : api.POST('/orgs/{orgId}/events/{eventId}/check-ins/manual', {
          ...options,
          body: { ticketId: ticket.ticketId, deviceId },
        });
  const { data, error } = await send().catch(() => send());
  if (error) throw error;
  return data;
}

/** What the door team reads: a headline, a colour and a line on what to do. */
export function describeVerdict(verdict: ScanVerdict): {
  title: string;
  tone: 'success' | 'warning' | 'danger';
  detail: string;
} {
  const who = verdict.attendee
    ? [verdict.attendee.name, verdict.attendee.studentNumber].filter(Boolean).join(' · ')
    : '';
  switch (verdict.result) {
    case 'accepted':
      return {
        title: 'Giriş onaylandı',
        tone: 'success',
        detail: [who, verdict.ticketType, verdict.pointsAwarded > 0 ? `+${verdict.pointsAwarded} puan` : '']
          .filter(Boolean)
          .join('\n'),
      };
    case 'duplicate': {
      const first = verdict.checkIn;
      const when = first ? `İlk giriş ${formatDateTime(first.at)}${first.gate ? `, ${first.gate}` : ''}` : '';
      return { title: 'Bu bilet zaten kullanıldı', tone: 'danger', detail: [who, when].filter(Boolean).join('\n') };
    }
    case 'expired_token':
      return {
        title: 'Kodun süresi dolmuş',
        tone: 'warning',
        detail: 'Ekran görüntüsü olabilir. Biletini uygulamada açmasını iste.',
      };
    case 'wrong_event':
      return {
        title: 'Başka etkinliğin bileti',
        tone: 'warning',
        detail: verdict.otherEvent ? `Bu bilet "${verdict.otherEvent.title}" için.` : '',
      };
    case 'ticket_cancelled':
      return { title: 'Bilet iptal edilmiş', tone: 'danger', detail: who };
    case 'outside_window':
      return { title: 'Kapı şu an kapalı', tone: 'warning', detail: 'Giriş saatleri dışında okutma yapılamaz.' };
    default:
      return { title: 'Geçersiz kod', tone: 'danger', detail: 'Bu bir Etkin bileti değil ya da kod bozuk.' };
  }
}
