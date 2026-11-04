import { createQrPayload, decodeTicketKey, msUntilNextQr, QR_STEP_SECONDS, qrStep } from '@etkin/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { Animated, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api } from '@/api/client';
import { type MyTicket, useMe } from '@/api/queries';
import { ThemedText } from '@/components/themed-text';
import { Button, confirmAction, ErrorBanner, Loading, Notice, Pill, ProgressBar, Screen } from '@/components/ui';
import { Fonts, MaxContentWidth, Radius, Spacing, withAlpha } from '@/constants/theme';
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
  const { width } = useWindowDimensions();
  const now = useNow(250) + qrKey.clockOffsetMs;
  const step = qrStep(now);
  const payload = useMemo(
    () => createQrPayload(decodeTicketKey(qrKey.key), ticketId, step * STEP_MS),
    [qrKey.key, ticketId, step],
  );
  const left = msUntilNextQr(now);
  // Screen padding, the ticket's padding and the white paper's margin on both sides.
  const size = Math.min(Math.min(width, MaxContentWidth) - 2 * (Spacing.four + Spacing.three + Spacing.three), 280);

  return (
    <View style={styles.qrBlock}>
      {/* Black on white: scanners need the contrast. */}
      <View style={styles.paper}>
        <QRCode value={payload} size={size} ecl="M" color="#000000" backgroundColor="#FFFFFF" />
      </View>
      <ProgressBar value={left / STEP_MS} width={size} />
      <ThemedText type="small" themeColor="textSecondary">
        Kod {Math.ceil(left / 1000)} sn sonra yenilenir
      </ThemedText>
      <View style={styles.clockRow}>
        <LiveDot />
        <ThemedText style={styles.clock}>{formatClock(now)}</ThemedText>
      </View>
    </View>
  );
}

/** A slowly breathing green dot: one more sign for the door team that this screen is live. */
function LiveDot() {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    breathe.start();
    return () => breathe.stop();
  }, [opacity]);
  return <Animated.View style={[styles.liveDot, { backgroundColor: theme.success, opacity }]} />;
}

/** Two half-circle notches and a dashed tear line, like a paper ticket's stub. */
function Perforation() {
  const theme = useTheme();
  const notch = [styles.notch, { backgroundColor: theme.background, borderColor: theme.border }];
  return (
    <View style={styles.perforation}>
      <View style={[...notch, styles.notchLeft]} />
      <View style={[styles.tearLine, { borderColor: withAlpha(theme.textSecondary, 0.35) }]} />
      <View style={[...notch, styles.notchRight]} />
    </View>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.detail}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" numberOfLines={2}>
        {children}
      </ThemedText>
    </View>
  );
}

export default function Ticket() {
  const theme = useTheme();
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
      // Tickets, points and badges all moved (badges a moment later, once the worker runs).
      queryClient.invalidateQueries({ queryKey: ['me'] });
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
      {!event ? <ErrorBanner error={ticket.error} /> : null}
      {event?.status === 'cancelled' ? <Notice tone="danger">Bu etkinlik iptal edildi.</Notice> : null}

      <View style={[styles.ticket, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        {event ? (
          <View style={[styles.stub, { backgroundColor: theme.tintSoft }]}>
            <View style={styles.stubTop}>
              <ThemedText type="smallBold" themeColor="tint" numberOfLines={1} style={styles.grow}>
                {event.organization.name}
              </ThemedText>
              {status === 'checked_in' ? (
                <Pill tone="success">Kullanıldı</Pill>
              ) : status === 'cancelled' ? (
                <Pill tone="danger">İptal</Pill>
              ) : (
                <Pill tone="tint">Geçerli</Pill>
              )}
            </View>
            <ThemedText type="subtitle">{event.title}</ThemedText>
            <View style={styles.details}>
              <Detail label="Tarih">{formatDateTime(event.startsAt)}</Detail>
              {event.locationName ? <Detail label="Yer">{event.locationName}</Detail> : null}
            </View>
            <View style={styles.details}>
              <Detail label="Bilet sahibi">{me.data?.fullName ?? '–'}</Detail>
              <Detail label="Bilet türü">{ticket.data?.ticketType.name ?? '–'}</Detail>
            </View>
          </View>
        ) : null}

        <Perforation />

        <View style={styles.body}>
          {status === 'checked_in' ? (
            <View style={styles.state}>
              <View style={[styles.stateRing, { backgroundColor: withAlpha(theme.success, 0.15) }]}>
                <ThemedText style={[styles.stateSymbol, { color: theme.success }]}>✓</ThemedText>
              </View>
              <ThemedText type="default" style={styles.center}>
                Giriş yapıldı, iyi eğlenceler!
              </ThemedText>
              {ticket.data?.checkedInAt ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDateTime(ticket.data.checkedInAt)}
                </ThemedText>
              ) : null}
            </View>
          ) : status === 'cancelled' ? (
            <View style={styles.state}>
              <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
                Bu bilet iptal edildi.
              </ThemedText>
            </View>
          ) : qrKey.isPending ? (
            <Loading />
          ) : qrKey.error ? (
            <ErrorBanner error={qrKey.error} />
          ) : (
            <LiveQr ticketId={id} qrKey={qrKey.data} />
          )}
        </View>
      </View>

      {showingCode && qrKey.data?.offline ? (
        <Notice tone="warning">Çevrimdışısın: kod bu telefonda kayıtlı anahtarla üretiliyor.</Notice>
      ) : null}
      {showingCode && qrKey.data?.deviceChanged ? (
        <Notice tone="warning">Bilet bu telefona taşındı; önceki telefondaki kodlar artık geçmez.</Notice>
      ) : null}

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

const NOTCH = 22;

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  grow: { flex: 1 },
  ticket: { borderWidth: 1, borderRadius: Radius.large, overflow: 'hidden' },
  stub: { padding: Spacing.three, gap: Spacing.two },
  stubTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  details: { flexDirection: 'row', gap: Spacing.three },
  detail: { flex: 1 },
  perforation: { flexDirection: 'row', alignItems: 'center', height: NOTCH },
  notch: { width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, borderWidth: 1 },
  notchLeft: { marginLeft: -NOTCH / 2 },
  notchRight: { marginRight: -NOTCH / 2 },
  tearLine: { flex: 1, borderTopWidth: 2, borderStyle: 'dashed', marginHorizontal: Spacing.one },
  body: { padding: Spacing.three, paddingTop: Spacing.one },
  qrBlock: { alignItems: 'center', gap: Spacing.two },
  paper: { backgroundColor: '#FFFFFF', padding: Spacing.three, borderRadius: Radius.medium },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  clock: { fontFamily: Fonts.extrabold, fontSize: 28, lineHeight: 36, fontVariant: ['tabular-nums'] },
  state: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
  stateRing: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  stateSymbol: { fontFamily: Fonts.extrabold, fontSize: 52, lineHeight: 62 },
});
