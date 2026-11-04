import { parseQrPayload } from '@etkin/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problemMessage } from '@/api/errors';
import { ThemedText } from '@/components/themed-text';
import { Button, Loading, Screen } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { checkIn, describeVerdict, type ScanVerdict } from '@/orgs/check-in';

// The camera reports a code in view many times a second, and the holder's code
// changes every 15 s. A ticket counts as one scan until it has been out of view
// this long, so holding the phone up a little longer never reads as "already used".
const OUT_OF_VIEW_MS = 2_500;
const SHOW_ACCEPTED_MS = 2_000;
const SHOW_REJECTED_MS = 4_000;

type Shown = { verdict: ScanVerdict } | { error: unknown };

function feedback(accepted: boolean) {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(
    accepted ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
  ).catch(() => undefined);
}

export default function Scan() {
  const { orgId, eventId } = useLocalSearchParams<{ orgId: string; eventId: string }>();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [shown, setShown] = useState<Shown | null>(null);
  const [inside, setInside] = useState<number | null>(null);
  const [torch, setTorch] = useState(false);
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
      feedback(verdict.result === 'accepted');
      if (verdict.result === 'accepted') {
        queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'events', eventId] });
      }
    } catch (error) {
      setShown({ error });
      feedback(false);
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

  const panel = shown
    ? 'verdict' in shown
      ? describeVerdict(shown.verdict)
      : { title: 'Gönderilemedi', tone: 'danger' as const, detail: problemMessage(shown.error) }
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
        <ThemedText type="smallBold" style={styles.onCamera}>
          {inside === null ? 'Okutmaya hazır' : `İçeride: ${inside}`}
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={() => setTorch((on) => !on)} hitSlop={12}>
          <ThemedText type="smallBold" style={styles.onCamera}>
            {torch ? 'Işığı kapat' : 'Işığı aç'}
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.frameArea} pointerEvents="none">
        <View style={styles.frame} />
        <ThemedText type="small" style={styles.onCamera}>
          QR kodu çerçeveye getir
        </ThemedText>
      </View>

      {panel ? (
        <Pressable
          accessibilityRole="alert"
          onPress={() => setShown(null)}
          style={[styles.panel, { backgroundColor: Colors[panel.tone], paddingBottom: insets.bottom + Spacing.four }]}
        >
          <ThemedText type="subtitle" style={styles.onPanel}>
            {panel.title}
          </ThemedText>
          {panel.detail ? (
            <ThemedText type="default" style={styles.onPanel}>
              {panel.detail}
            </ThemedText>
          ) : null}
          <ThemedText type="small" style={styles.dismiss}>
            Kapatmak için dokun
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000000' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing.three,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  onCamera: { color: '#FFFFFF' },
  frameArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  frame: { width: 240, height: 240, borderWidth: 3, borderColor: '#FFFFFF', borderRadius: 24 },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: Spacing.four,
    gap: Spacing.two,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  onPanel: { color: '#FFFFFF' },
  dismiss: { color: 'rgba(255,255,255,0.8)', marginTop: Spacing.two },
});
