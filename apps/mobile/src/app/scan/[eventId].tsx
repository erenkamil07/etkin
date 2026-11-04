import { parseQrPayload } from '@etkin/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problemMessage } from '@/api/errors';
import { ThemedText } from '@/components/themed-text';
import { Button, Loading, Screen } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { checkIn, describeVerdict, type ScanVerdict } from '@/orgs/check-in';
import { type DoorSignal, useDoorFeedback } from '@/orgs/door-feedback';

// The camera reports a code in view many times a second, and the holder's code
// changes every 15 s. A ticket counts as one scan until it has been out of view
// this long, so holding the phone up a little longer never reads as "already used".
const OUT_OF_VIEW_MS = 2_500;
const SHOW_ACCEPTED_MS = 2_000;
const SHOW_REJECTED_MS = 4_000;

type Shown = { verdict: ScanVerdict } | { error: unknown };

// The scanner screen itself is neutral grey and black: no brand orange, so the
// amber "take a look" verdict can never be mistaken for ordinary UI. Each
// verdict also has its own symbol, for anyone who can't tell the colours apart.
const LOOK = {
  success: { signal: 'ok', symbol: '✓', ink: Colors.background },
  warning: { signal: 'warning', symbol: '!', ink: Colors.background },
  danger: { signal: 'denied', symbol: '✕', ink: '#FFFFFF' },
} as const satisfies Record<string, { signal: DoorSignal; symbol: string; ink: string }>;

/** Full-screen verdict. "Stop" verdicts pulse once: a single flash, never continuous blinking. */
function VerdictScreen({
  verdict,
  onDismiss,
}: {
  verdict: { title: string; tone: keyof typeof LOOK; detail: string };
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const pulse = useRef(new Animated.Value(1)).current;
  const look = LOOK[verdict.tone];

  useEffect(() => {
    if (verdict.tone !== 'danger') return;
    Animated.sequence([
      Animated.timing(pulse, { toValue: 0.55, duration: 140, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [verdict, pulse]);

  return (
    <Pressable accessibilityRole="alert" onPress={onDismiss} style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.verdict,
          { backgroundColor: Colors[verdict.tone], opacity: pulse, paddingBottom: insets.bottom + Spacing.five },
        ]}
      >
        <View style={[styles.symbolRing, { borderColor: look.ink }]}>
          <ThemedText style={[styles.symbol, { color: look.ink }]}>{look.symbol}</ThemedText>
        </View>
        <ThemedText style={[styles.verdictTitle, { color: look.ink }]}>{verdict.title}</ThemedText>
        {verdict.detail ? (
          <ThemedText style={[styles.verdictDetail, { color: look.ink }]}>{verdict.detail}</ThemedText>
        ) : null}
        <ThemedText type="small" style={[styles.dismiss, { color: look.ink }]}>
          Sonraki için dokun
        </ThemedText>
      </Animated.View>
    </Pressable>
  );
}

function CameraButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={8}
      style={[styles.cameraButton, active && styles.cameraButtonActive]}
    >
      <ThemedText type="smallBold" style={{ color: active ? Colors.background : '#FFFFFF' }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export default function Scan() {
  const { orgId, eventId } = useLocalSearchParams<{ orgId: string; eventId: string }>();
  const queryClient = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();
  const [shown, setShown] = useState<Shown | null>(null);
  const [inside, setInside] = useState<number | null>(null);
  const [torch, setTorch] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const signal = useDoorFeedback(soundOn);
  const busy = useRef(false);
  const lastSeen = useRef({ ticket: '', at: 0 });

  useEffect(() => {
    if (!shown) return;
    const accepted = 'verdict' in shown && shown.verdict.result === 'accepted';
    const timer = setTimeout(() => setShown(null), accepted ? SHOW_ACCEPTED_MS : SHOW_REJECTED_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  async function onCode(code: string) {
    const ticket = parseQrPayload(code)?.ticketId ?? code;
    const now = Date.now();
    const sameTicket = ticket === lastSeen.current.ticket && now - lastSeen.current.at < OUT_OF_VIEW_MS;
    lastSeen.current = { ticket, at: now };
    if (sameTicket || busy.current) return;

    busy.current = true;
    try {
      const verdict = await checkIn(orgId, eventId, { qr: code });
      setShown({ verdict });
      setInside(verdict.checkedInCount);
      signal(LOOK[describeVerdict(verdict).tone].signal);
      if (verdict.result === 'accepted') {
        queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'events', eventId] });
      }
    } catch (error) {
      setShown({ error });
      signal('warning');
    } finally {
      busy.current = false;
    }
  }

  if (!permission) return <Loading />;
  if (!permission.granted) {
    return (
      <Screen belowHeader>
        <ThemedText type="subtitle">Kamera izni</ThemedText>
        <ThemedText>
          Biletlerin QR kodunu okutmak için kamera gerekiyor. Görüntü kaydedilmez; sunucuya yalnızca kodun içeriği
          gider.
        </ThemedText>
        {permission.canAskAgain ? (
          <Button title="Kameraya izin ver" onPress={requestPermission} />
        ) : (
          <Button title="Ayarlarda izin ver" onPress={() => Linking.openSettings()} />
        )}
      </Screen>
    );
  }

  // A failed request is not a verdict on the person: ask the team to try again.
  const verdict = shown
    ? 'verdict' in shown
      ? describeVerdict(shown.verdict)
      : { title: 'Gönderilemedi', tone: 'warning' as const, detail: `${problemMessage(shown.error)} Tekrar okut.` }
    : null;

  return (
    <View style={styles.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          onCode(data);
        }}
      />

      <View style={styles.topBar}>
        <View style={styles.counter}>
          <ThemedText type="small" style={styles.counterLabel}>
            İçeride
          </ThemedText>
          <ThemedText style={styles.counterValue}>{inside ?? '–'}</ThemedText>
        </View>
        <View style={styles.buttons}>
          <CameraButton
            label={soundOn ? '🔊 Ses' : '🔇 Sessiz'}
            active={soundOn}
            onPress={() => setSoundOn((on) => !on)}
          />
          <CameraButton label="🔦 Işık" active={torch} onPress={() => setTorch((on) => !on)} />
        </View>
      </View>

      <View style={styles.frameArea} pointerEvents="none">
        <View style={styles.frame} />
        <ThemedText type="smallBold" style={styles.hint}>
          QR kodu çerçeveye getir
        </ThemedText>
      </View>

      {verdict ? <VerdictScreen verdict={verdict} onDismiss={() => setShown(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000000' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.three,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  counter: { gap: 0 },
  counterLabel: { color: 'rgba(255, 255, 255, 0.7)' },
  counterValue: { fontFamily: Fonts.extrabold, fontSize: 28, lineHeight: 32, color: '#FFFFFF' },
  buttons: { flexDirection: 'row', gap: Spacing.two },
  cameraButton: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  cameraButtonActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  frameArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  frame: { width: 250, height: 250, borderWidth: 3, borderColor: '#FFFFFF', borderRadius: 28 },
  hint: { color: '#FFFFFF' },
  verdict: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  symbolRing: {
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbol: { fontFamily: Fonts.extrabold, fontSize: 72, lineHeight: 84 },
  verdictTitle: { fontFamily: Fonts.extrabold, fontSize: 32, lineHeight: 38, textAlign: 'center' },
  verdictDetail: { fontFamily: Fonts.semibold, fontSize: 20, lineHeight: 28, textAlign: 'center' },
  dismiss: { marginTop: Spacing.four, opacity: 0.75 },
});
