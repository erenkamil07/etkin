import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { restoreSession, useSessionStatus } from '@/auth/session';
import { Colors, Fonts } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/** Headers and screen backgrounds in Etkin's colours. */
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.tint,
    background: Colors.background,
    card: Colors.background,
    text: Colors.text,
    border: Colors.border,
    notification: Colors.tint,
  },
  fonts: {
    ...DarkTheme.fonts,
    regular: { fontFamily: Fonts.regular, fontWeight: '400' as const },
    medium: { fontFamily: Fonts.medium, fontWeight: '500' as const },
    bold: { fontFamily: Fonts.bold, fontWeight: '700' as const },
    heavy: { fontFamily: Fonts.extrabold, fontWeight: '800' as const },
  },
};

/** Pages opened over the tabs get a header with a back button. */
const pushed = { headerShown: true, headerBackButtonDisplayMode: 'minimal' } as const;

export default function RootLayout() {
  const status = useSessionStatus();
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  // A font that fails to load falls back to the system font rather than blocking the app.
  const ready = status !== 'loading' && (fontsLoaded || fontError !== null);

  useEffect(() => {
    restoreSession();
  }, []);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // Keep the splash screen up until the fonts are in and we know whether someone is signed in.
  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <ThemeProvider value={navigationTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={status === 'signedIn'}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="events/[id]" options={{ ...pushed, title: 'Etkinlik' }} />
            <Stack.Screen name="tickets/[id]" options={{ ...pushed, title: 'Bilet' }} />
            {/* Club team pages; the club's id travels as `orgId` in the URL. */}
            <Stack.Screen name="club/[orgId]" options={{ ...pushed, title: 'Kulüp' }} />
            <Stack.Screen name="manage/[eventId]" options={{ ...pushed, title: 'Etkinlik yönetimi' }} />
            <Stack.Screen name="scan/[eventId]" options={{ ...pushed, title: 'Kapı' }} />
            <Stack.Screen name="new-event/[orgId]" options={{ ...pushed, title: 'Yeni etkinlik' }} />
            <Stack.Screen name="new-club" options={{ ...pushed, title: 'Kulüp oluştur' }} />
            <Stack.Screen name="delete-account" options={{ ...pushed, title: 'Hesabı sil' }} />
            <Stack.Screen name="report/[eventId]" options={{ ...pushed, title: 'Etkinliği bildir' }} />
            <Stack.Screen name="moderation" options={{ ...pushed, title: 'Moderasyon' }} />
          </Stack.Protected>
          <Stack.Protected guard={status === 'signedOut'}>
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="sign-up" />
          </Stack.Protected>
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
