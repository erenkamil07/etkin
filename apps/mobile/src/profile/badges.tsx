import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import type { paths } from '@/api/schema';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Button, ProgressBar } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { formatDate } from '@/format';
import { useTheme } from '@/hooks/use-theme';

type Json<P extends keyof paths> = paths[P] extends {
  get: { responses: { 200: { content: { 'application/json': infer T } } } };
}
  ? T
  : never;

export type EarnedBadge = Json<'/me/badges'>[number];
export type BadgeGoal = Json<'/me/badges/progress'>[number];

/** One tile in the showcase: either earned, or still to earn with its progress. */
export type BadgeItem = { earned: EarnedBadge } | { goal: BadgeGoal };

/** Platform badges get their own picture; club badges share the medal. */
const BADGE_EMOJI: Record<string, string> = {
  first_checkin: '👣',
  regular_5: '⭐',
  regular_20: '🏆',
  explorer_3: '🧭',
};
export const badgeEmoji = (code: string) => BADGE_EMOJI[code] ?? '🏅';

/** What is left to do, e.g. "3 farklı kulübün etkinliğine katıl". Descriptions are written for when it is earned. */
function goalText(badge: BadgeGoal): string {
  if (badge.rule === 'distinct_clubs') return `${badge.target} farklı kulübün etkinliğine katıl`;
  if (badge.organization) return `${badge.organization.name} etkinliklerinden ${badge.target} tanesine katıl`;
  return badge.target === 1 ? 'İlk etkinliğine katıl' : `${badge.target} etkinliğe katıl`;
}

const badgeOf = (item: BadgeItem) => ('earned' in item ? item.earned : item.goal);

export const badgeKey = (item: BadgeItem) => {
  const badge = badgeOf(item);
  return badge.code + (badge.organization?.id ?? '');
};

export function BadgeTile({ item, onPress }: { item: BadgeItem; onPress: () => void }) {
  const theme = useTheme();
  const badge = badgeOf(item);
  const goal = 'goal' in item ? item.goal : null;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${badge.name}${goal ? `, ${goal.current} / ${goal.target}` : ', kazanıldı'}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}
    >
      <ThemedText style={[styles.emoji, goal && styles.locked]}>{badgeEmoji(badge.code)}</ThemedText>
      <ThemedText type="smallBold" themeColor={goal ? 'textSecondary' : 'text'} numberOfLines={2}>
        {badge.name}
      </ThemedText>
      {goal ? (
        <>
          <ProgressBar value={goal.current / goal.target} />
          <ThemedText type="small" themeColor="textSecondary">
            {goal.current} / {goal.target}
          </ThemedText>
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {badge.organization?.name ?? 'Etkin rozeti'}
        </ThemedText>
      )}
    </PressableScale>
  );
}

/** A badge up close: what it is for and when you got it, or what is left to do. */
export function BadgeSheet({ item, onClose }: { item: BadgeItem | null; onClose: () => void }) {
  const theme = useTheme();
  const badge = item ? badgeOf(item) : null;
  return (
    <Modal visible={item !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Kapat" style={styles.backdrop} onPress={onClose}>
        {item && badge ? (
          // Taps inside the card don't close it.
          <Pressable
            onPress={() => undefined}
            style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          >
            <Animated.View entering={ZoomIn.springify().damping(11)}>
              <ThemedText style={[styles.bigEmoji, 'goal' in item && styles.locked]}>
                {badgeEmoji(badge.code)}
              </ThemedText>
            </Animated.View>
            <ThemedText type="subtitle" style={styles.center}>
              {badge.name}
            </ThemedText>
            {badge.organization ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                {badge.organization.name} rozeti
              </ThemedText>
            ) : null}
            {'earned' in item ? (
              <>
                {/* Descriptions are written in the past tense, for once it is earned. */}
                {badge.description ? (
                  <ThemedText type="small" style={styles.center}>
                    {badge.description}
                  </ThemedText>
                ) : null}
                <ThemedText type="smallBold" themeColor="success" style={styles.center}>
                  {formatDate(item.earned.awardedAt)} tarihinde kazandın
                </ThemedText>
              </>
            ) : (
              <View style={styles.progress}>
                <ThemedText type="smallBold" style={styles.center}>
                  {goalText(item.goal)}
                </ThemedText>
                <ProgressBar value={item.goal.current / item.goal.target} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                  {item.goal.current} / {item.goal.target} · {item.goal.target - item.goal.current} kaldı
                </ThemedText>
              </View>
            )}
            <Button title="Tamam" variant="secondary" onPress={onClose} />
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Two per row; an odd last tile keeps its size instead of stretching across.
  tile: { flexBasis: '48%', flexGrow: 0, borderRadius: Radius.large, padding: Spacing.three, gap: Spacing.one },
  emoji: { fontSize: 32, lineHeight: 40 },
  bigEmoji: { fontSize: 64, lineHeight: 76, textAlign: 'center' },
  locked: { opacity: 0.35 },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    borderRadius: Radius.large,
    borderWidth: 1,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  progress: { gap: Spacing.two },
  center: { textAlign: 'center' },
});
