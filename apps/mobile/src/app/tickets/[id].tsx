import { createQrPayload, decodeTicketKey, msUntilNextQr, QR_STEP_SECONDS, qrStep } from '@etkin/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api } from '@/api/client';
import { type MyTicket, useMe } from '@/api/queries';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, confirmAction, ErrorBanner, Loading, Notice, Screen } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatClock, formatDateTime } from '@/format';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { useTicketDisplay } from '@/hooks/use-ticket-display';
import { forgetQrKey, loadQrKey, type QrKey } from '@/tickets/qr-key';

const STEP_MS = QR_STEP_SECONDS * 1000;

/**
 * The code at the door. It changes every QR_STEP_SECONDS and is computed on the
 * phone from the ticket key, so it needs no network once the key is saved. The
 * running clock under it shows the door team this is a live screen, not a photo.
 */
function LiveQr({ ticketId, qrKey }: { ticketId: string; qrKey: QrKey }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const now = useNow(250) + qrKey.clockOffsetMs;
  const step = qrStep(now);
  const payload = useMemo(
    () => createQrPayload(decodeTicketKey(qrKey.key), ticketId, step * STEP_MS),
    [qrKey.key, ticketId, step],
  );
  const left = msUntilNextQr(now);
  const size = Math.min(Math.min(width, MaxContentWidth) - 2 * Spacing.four - 2 * Spacing.three, 280);

  return (
    <View style={styles.qrBlock}>
      {/* Black on white in both themes: scanners need the contrast. */}
      <View style={styles.paper}>
        <QRCode value={payload} size={size} ecl="M" color="#000000" backgroundColor="#FFFFFF" />
      </View>
      <View style={[styles.track, { backgroundColor: theme.backgroundSelected, width: size }]}>
        <View style={[styles.bar, { backgroundColor: theme.tint, width: `${(left / STEP_MS) * 100}%` }]} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Kod {Math.ceil(left / 1000)} sn sonra yenilenir
      </ThemedText>
      <ThemedText style={styles.clock}>{formatClock(now)}</ThemedText>
    </View>
  );
}

export default function Ticket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const me = useMe();
  const now = useNow(30_000);

  const ticket = useQuery({
    queryKey: ['tickets', id],
    queryFn: async () => {
      const { data, error } = await api.GET('/tickets/{ticketId}', { params: { path: { ticketId: id } } });
      if (error) throw error;
      return data;
    },
    // Opened from the list: show what is already known at once.
    initialData: () => queryClient.getQueryData<MyTicket[]>(['me', 'tickets'])?.find((item) => item.id === id),
    initialDataUpdatedAt: () => queryClient.getQueryState(['me', 'tickets'])?.dataUpdatedAt,
    // Watch for the door scan so the screen can switch to "you're in".
    refetchInterval: (query) => (query.state.data?.status === 'active' ? 5_000 : false),
  });

  // Unknown status still gets a code: with no signal the ticket can't load, but the saved key works.
  const status = ticket.data?.status;
  const usable = status === undefined || status === 'active';
  const qrKey = useQuery({
    queryKey: ['qr-key', id],
    queryFn: () => loadQrKey(id),
    enabled: usable,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const showingCode = usable && qrKey.isSuccess;
  useTicketDisplay(showingCode);

  const previousStatus = useRef(status);
  useEffect(() => {
    if (previousStatus.current === 'active' && status === 'checked_in') {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }
      queryClient.invalidateQueries({ queryKey: ['me', 'tickets'] });
    }
    previousStatus.current = status;
  }, [status, queryClient]);

  const cancel = useMutation({
    mutationFn: async () => {
      const ok = await confirmAction(
        'Bileti iptal et',
        'Yerin başka birine açılır. Yeniden almak istersen yer kalmamış olabilir.',
        'İptal et',
      );
      if (!ok) return;
      const { data, error } = await api.POST('/tickets/{ticketId}/cancel', { params: { path: { ticketId: id } } });
      if (error) throw error;
      await forgetQrKey(id);
      queryClient.setQueryData(['tickets', id], data);
      queryClient.invalidateQueries({ queryKey: ['me', 'tickets'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });

  if (!ticket.data && ticket.isPending) return <Loading />;

  const event = ticket.data?.event;
  return (
    <Screen belowHeader>
      {event ? (
        <View style={styles.heading}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {event.organization.name} · {ticket.data?.ticketType.name}
          </ThemedText>
          <ThemedText type="subtitle">{event.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDateTime(event.startsAt)}
            {event.locationName ? ` · ${event.locationName}` : ''}
          </ThemedText>
        </View>
      ) : (
        <ErrorBanner error={ticket.error} />
      )}
      {event?.status === 'cancelled' ? <Notice tone="danger">Bu etkinlik iptal edildi.</Notice> : null}

      {status === 'checked_in' ? (
        <Card>
          <ThemedText type="default" themeColor="success">
            Giriş yapıldı
          </ThemedText>
          {ticket.data?.checkedInAt ? (
            <ThemedText type="small" themeColor="textSecondary">
              {formatDateTime(ticket.data.checkedInAt)}
            </ThemedText>
          ) : null}
        </Card>
      ) : status === 'cancelled' ? (
        <Notice tone="warning">Bu bilet iptal edildi.</Notice>
      ) : qrKey.isPending ? (
        <Loading />
      ) : qrKey.error ? (
        <ErrorBanner error={qrKey.error} />
      ) : (
        <>
          {me.data ? (
            <ThemedText type="smallBold" style={styles.center}>
              {me.data.fullName}
            </ThemedText>
          ) : null}
          <LiveQr ticketId={id} qrKey={qrKey.data} />
          {qrKey.data.offline ? (
            <Notice tone="warning">Çevrimdışısın: kod bu telefonda kayıtlı anahtarla üretiliyor.</Notice>
          ) : null}
          {qrKey.data.deviceChanged ? (
            <Notice tone="warning">Bilet bu telefona taşındı; önceki telefondaki kodlar artık geçmez.</Notice>
          ) : null}
        </>
      )}

      {status === 'active' && event && now < Date.parse(event.startsAt) ? (
        <>
          <ErrorBanner error={cancel.error} />
          <Button
            title="Bileti iptal et"
            variant="secondary"
            loading={cancel.isPending}
            onPress={() => cancel.mutate()}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: Spacing.one },
  center: { textAlign: 'center' },
  qrBlock: { alignItems: 'center', gap: Spacing.two },
  paper: { backgroundColor: '#FFFFFF', padding: Spacing.three, borderRadius: 16 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: '100%' },
  clock: { fontSize: 28, lineHeight: 36, fontWeight: 700, fontVariant: ['tabular-nums'] },
});
