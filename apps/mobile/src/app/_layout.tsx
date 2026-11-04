import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { restoreSession, useSessionStatus } from '@/auth/session';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/** Pages opened over the tabs get a header with a back button. */
const pushed = { headerShown: true, headerBackButtonDisplayMode: 'minimal' } as const;

export default function RootLayout() {
  const status = useSessionStatus();
  const scheme = useColorScheme();

  useEffect(() => {
    restoreSession();
  }, []);
  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync();
  }, [status]);

  // Keep the splash screen up until we know whether someone is signed in.
  if (status === 'loading') return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
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
