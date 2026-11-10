import { NativeTabs } from 'expo-router/native-tabs';
import { useClubApplications } from '@/api/queries';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function AppTabs() {
  const theme = useTheme();
  // Platform admins see on the Profil tab how many clubs wait for approval.
  const pendingClubs = useClubApplications().data?.length ?? 0;
  return (
    <NativeTabs
      backgroundColor={theme.backgroundElement}
      indicatorColor={theme.tintSoft}
      tintColor={theme.tint}
      iconColor={{ default: theme.textSecondary, selected: theme.tint }}
      labelStyle={{
        default: { color: theme.textSecondary, fontFamily: Fonts.medium },
        selected: { color: theme.text, fontFamily: Fonts.bold },
      }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Etkinlikler</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="event" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tickets">
        <NativeTabs.Trigger.Label>Biletlerim</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="ticket" md="confirmation_number" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profil</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="person" />
        <NativeTabs.Trigger.Badge hidden={pendingClubs === 0}>{String(pendingClubs)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
