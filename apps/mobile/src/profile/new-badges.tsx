import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { secureStorage } from '@/auth/storage';
import { Confetti } from '@/components/confetti';
import { hasHaptics } from '@/components/motion';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { badgeEmoji, type EarnedBadge } from './badges';

// Below any real date, for "seen nothing yet".
const NOTHING_SEEN = '1970-01-01T00:00:00.000Z';
const FIRST_RUN_WINDOW_MS = 3 * 86_400_000;

/**
 * Badges earned since this phone last showed them. The newest award time seen
 * is kept per account. On a phone with nothing recorded, only the last three
 * days count, so an update doesn't throw a party for badges earned months ago.
 */
function useUnseenBadges(userId: string | undefined, earned: EarnedBadge[] | undefined) {
  const [unseen, setUnseen] = useState<EarnedBadge[]>([]);
  const key = userId ? `etkin.badgesSeen.${userId}` : null;

  useEffect(() => {
    if (!key || !earned) return;
    let current = true;
    secureStorage
      .get(key)
      .then(async (seen) => {
        // Nothing recorded on this phone yet: count only the last few days as new.
        const since = seen === null ? Date.now() - FIRST_RUN_WINDOW_MS : Date.parse(seen);
        if (seen === null) await secureStorage.set(key, new Date(since).toISOString());
        const fresh = earned.filter((badge) => Date.parse(badge.awardedAt) > since);
        if (current) setUnseen(fresh);
      })
      // Celebrations are optional: a storage hiccup must not break the profile.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [key, earned]);

  const markSeen = useCallback(() => {
    if (!key || unseen.length === 0) return;
    secureStorage.set(key, newestAward(unseen) ?? NOTHING_SEEN).catch(() => undefined);
    setUnseen([]);
  }, [key, unseen]);

  return { unseen, markSeen };
}

function newestAward(badges: EarnedBadge[]): string | undefined {
  return badges.map((badge) => badge.awardedAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

/**
 * "Yeni rozet kazandın!" with confetti, the first time the profile is on screen
 * after a badge lands (often right after a door scan). Badges that arrive while
 * another tab is open wait until the profile is actually looked at.
 */
export function NewBadges({
  userId,
  earned,
  onOpen,
}: {
  userId: string | undefined;
  earned: EarnedBadge[] | undefined;
  onOpen: (badge: EarnedBadge) => void;
}) {
  const theme = useTheme();
  const { unseen, markSeen } = useUnseenBadges(userId, earned);
  const [shown, setShown] = useState<EarnedBadge[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (unseen.length === 0) return;
      setShown(unseen);
      markSeen();
      if (hasHaptics) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }, [unseen, markSeen]),
  );

  if (shown.length === 0) return null;
  const first = shown[0] as EarnedBadge;
  return (
    <Animated.View entering={FadeInDown.springify().damping(14)}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Yeni rozet: ${shown.map((badge) => badge.name).join(', ')}`}
        onPress={() => onOpen(first)}
        scaleTo={0.98}
        style={[styles.card, { backgroundColor: withAlpha(theme.tint, 0.12), borderColor: withAlpha(theme.tint, 0.5) }]}
      >
        <ThemedText style={styles.emoji}>{shown.map((badge) => badgeEmoji(badge.code)).join(' ')}</ThemedText>
        <View style={styles.text}>
          <ThemedText type="smallBold" themeColor="tint">
            {shown.length === 1 ? 'Yeni rozet kazandın!' : `${shown.length} yeni rozet kazandın!`}
          </ThemedText>
          <ThemedText type="default" numberOfLines={2}>
            {shown.map((badge) => badge.name).join(', ')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Ayrıntısı için dokun
          </ThemedText>
        </View>
      </PressableScale>
      {/* A sibling on top, not a child: a button inside a button is invalid on the web. */}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Kapat"
        hitSlop={12}
        onPress={() => setShown([])}
        style={styles.close}
      >
        <ThemedText type="smallBold" themeColor="textSecondary">
          ✕
        </ThemedText>
      </PressableScale>
      <Confetti origin={{ x: 0.5, y: 0.35 }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.large,
    padding: Spacing.three,
    // Room for the close button in the corner.
    paddingRight: Spacing.five,
  },
  emoji: { fontSize: 36, lineHeight: 44 },
  text: { flex: 1, gap: 2 },
  close: { position: 'absolute', top: Spacing.two, right: Spacing.two, padding: Spacing.two },
});
