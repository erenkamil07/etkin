import { TabList, type TabListProps, TabSlot, Tabs, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useClubApplications } from '@/api/queries';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from './themed-text';

// Native tabs don't exist on the web; this is the development build's stand-in.
export default function AppTabs() {
  // Platform admins see on the Profil tab how many clubs wait for approval.
  const pendingClubs = useClubApplications().data?.length ?? 0;
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <TabBar>
          <TabTrigger name="index" href="/" asChild>
            <TabButton>Etkinlikler</TabButton>
          </TabTrigger>
          <TabTrigger name="tickets" href="/tickets" asChild>
            <TabButton>Biletlerim</TabButton>
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton badge={pendingClubs}>Profil</TabButton>
          </TabTrigger>
        </TabBar>
      </TabList>
    </Tabs>
  );
}

function TabButton({ children, isFocused, badge = 0, ref: _ref, ...props }: TabTriggerSlotProps & { badge?: number }) {
  const theme = useTheme();
  return (
    <Pressable {...props} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      <View style={[styles.button, { backgroundColor: isFocused ? theme.tintSoft : 'transparent' }]}>
        <ThemedText type="smallBold" themeColor={isFocused ? 'tint' : 'textSecondary'}>
          {children}
        </ThemedText>
        {badge > 0 ? (
          <View accessibilityLabel={`${badge} yeni`} style={[styles.badge, { backgroundColor: theme.tint }]}>
            <ThemedText type="smallBold" style={[styles.badgeText, { color: theme.onTint }]}>
              {badge}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function TabBar(props: TabListProps) {
  const theme = useTheme();
  return (
    <View {...props} style={styles.container}>
      <View style={[styles.bar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        {props.children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', bottom: 0, width: '100%', padding: Spacing.three, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    maxWidth: MaxContentWidth,
    borderRadius: Spacing.five,
    borderWidth: 1,
    padding: Spacing.two,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, justifyContent: 'center' },
  badgeText: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
});
