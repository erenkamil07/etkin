import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  type DimensionValue,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { problemMessage } from '@/api/errors';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from './themed-text';

/**
 * A scrollable, keyboard-aware page with the app's padding and max width.
 * Pages pushed over the tabs pass `belowHeader`: the navigation header covers
 * the top inset there, and nothing covers the bottom one.
 */
export function Screen({
  children,
  scroll = true,
  belowHeader = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  belowHeader?: boolean;
}) {
  const theme = useTheme();
  const body = <View style={styles.content}>{children}</View>;
  return (
    <SafeAreaView
      style={[styles.fill, { backgroundColor: theme.background }]}
      edges={belowHeader ? ['left', 'right', 'bottom'] : ['top', 'left', 'right']}
    >
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {body}
          </ScrollView>
        ) : (
          body
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Field({
  label,
  error,
  style,
  ...input
}: TextInputProps & { label: string; error?: string | undefined }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        {...input}
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor: error ? theme.danger : theme.border,
            backgroundColor: theme.backgroundElement,
          },
          style,
        ]}
      />
      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  loading = false,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const theme = useTheme();
  const background = { primary: theme.tint, secondary: theme.backgroundElement, danger: theme.danger }[variant];
  const color = variant === 'secondary' ? theme.text : theme.onTint;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: background, opacity: pressed || loading ? 0.7 : 1 }]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <ThemedText type="smallBold" style={{ color }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

function technicalDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error).slice(0, 300);
  } catch {
    return String(error);
  }
}

/** The friendly Turkish message; development builds add the raw error underneath. */
export function ErrorBanner({ error }: { error: unknown }) {
  const theme = useTheme();
  if (!error) return null;
  return (
    <View accessibilityRole="alert" style={[styles.banner, { borderColor: theme.danger }]}>
      <ThemedText type="small" style={{ color: theme.danger }}>
        {problemMessage(error)}
      </ThemedText>
      {__DEV__ ? (
        <ThemedText type="code" themeColor="textSecondary">
          {technicalDetail(error)}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  const theme = useTheme();
  const style = [styles.card, { backgroundColor: theme.backgroundElement }];
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [...style, pressed && { opacity: 0.8 }]}>
      {children}
    </Pressable>
  ) : (
    <View style={style}>{children}</View>
  );
}

/** A coloured note inside the page, e.g. "this event was cancelled". */
export function Notice({ children, tone }: { children: ReactNode; tone: 'success' | 'warning' | 'danger' }) {
  const theme = useTheme();
  return (
    <View style={[styles.banner, { borderColor: theme[tone] }]}>
      <ThemedText type="small" style={{ color: theme[tone] }}>
        {children}
      </ThemedText>
    </View>
  );
}

/** Asks before something that cannot be undone. Resolves true when the person goes ahead. */
export function confirmAction(title: string, message: string, action: string): Promise<boolean> {
  // react-native-web's Alert does nothing, so the development web build uses the browser's dialog.
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Vazgeç', style: 'cancel', onPress: () => resolve(false) },
        { text: action, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** A thin bar filled to `value` (0 to 1). */
export function ProgressBar({ value, width = '100%' }: { value: number; width?: DimensionValue }) {
  const theme = useTheme();
  const filled = Math.min(Math.max(value, 0), 1) * 100;
  return (
    <View style={[styles.track, { backgroundColor: theme.backgroundSelected, width }]}>
      <View style={[styles.bar, { backgroundColor: theme.tint, width: `${filled}%` }]} />
    </View>
  );
}

export function Loading() {
  const theme = useTheme();
  return <ActivityIndicator style={styles.loading} color={theme.tint} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flexGrow: 1 },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  field: { gap: Spacing.one },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  banner: { borderWidth: 1, borderRadius: 12, padding: Spacing.three },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: '100%' },
  loading: { marginTop: Spacing.five },
});
