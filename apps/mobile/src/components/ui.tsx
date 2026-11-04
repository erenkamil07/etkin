import { type ReactNode, useState } from 'react';
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
import { Fonts, MaxContentWidth, Radius, Spacing, withAlpha } from '@/constants/theme';
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
  onFocus,
  onBlur,
  ...input
}: TextInputProps & { label: string; error?: string | undefined }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        selectionColor={theme.tint}
        {...input}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor: error ? theme.danger : focused ? theme.tint : theme.border,
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

// White text needs a deeper red than the danger accent to stay readable (4.8:1).
const DANGER_BUTTON = '#DC2626';

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
  const look = {
    primary: { background: theme.tint, pressed: theme.glow, color: theme.onTint, border: theme.tint },
    secondary: {
      background: theme.backgroundElement,
      pressed: theme.backgroundSelected,
      color: theme.text,
      border: theme.border,
    },
    danger: { background: DANGER_BUTTON, pressed: theme.danger, color: '#FFFFFF', border: DANGER_BUTTON },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed ? look.pressed : look.background,
          borderColor: look.border,
          opacity: loading ? 0.7 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={look.color} />
      ) : (
        <ThemedText style={[styles.buttonLabel, { color: look.color }]}>{title}</ThemedText>
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
    <View
      accessibilityRole="alert"
      style={[
        styles.banner,
        { borderColor: withAlpha(theme.danger, 0.4), backgroundColor: withAlpha(theme.danger, 0.1) },
      ]}
    >
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
  const style = [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];
  return onPress ? (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [...style, pressed && { backgroundColor: theme.backgroundSelected }]}
    >
      {children}
    </Pressable>
  ) : (
    <View style={style}>{children}</View>
  );
}

/** Two or three side-by-side options where exactly one is on, e.g. "Ücretsiz | Ücretli". */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[styles.segmented, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: theme.tint }]}
          >
            <ThemedText style={[styles.segmentLabel, { color: selected ? theme.onTint : theme.textSecondary }]}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One option in a list (radio) or a yes/no agreement (checkbox), with an optional line underneath. */
export function Choice({
  label,
  detail,
  selected,
  onPress,
  kind = 'radio',
}: {
  label: ReactNode;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  kind?: 'radio' | 'checkbox';
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={kind}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
          borderColor: selected ? theme.tint : theme.border,
        },
      ]}
    >
      <View
        style={[
          styles.mark,
          kind === 'radio' ? styles.radio : styles.checkbox,
          { borderColor: selected ? theme.tint : theme.textSecondary },
        ]}
      >
        {selected ? (
          <View
            style={[
              styles.markFill,
              kind === 'radio' ? styles.radio : styles.checkboxFill,
              { backgroundColor: theme.tint },
            ]}
          />
        ) : null}
      </View>
      <View style={styles.choiceText}>
        <ThemedText type="default">{label}</ThemedText>
        {detail ? (
          <ThemedText type="small" themeColor="textSecondary">
            {detail}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A coloured note inside the page, e.g. "this event was cancelled". */
export function Notice({ children, tone }: { children: ReactNode; tone: 'success' | 'warning' | 'danger' }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.banner,
        { borderColor: withAlpha(theme[tone], 0.4), backgroundColor: withAlpha(theme[tone], 0.1) },
      ]}
    >
      <ThemedText type="small" style={{ color: theme[tone] }}>
        {children}
      </ThemedText>
    </View>
  );
}

/** A small rounded label: "Son 5 yer", "Tükendi", "Kullanıldı". */
export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'tint' | 'success' | 'warning' | 'danger';
}) {
  const theme = useTheme();
  const color = tone === 'neutral' ? theme.textSecondary : theme[tone];
  const background = tone === 'neutral' ? theme.backgroundSelected : withAlpha(theme[tone], 0.14);
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <ThemedText type="smallBold" style={[styles.pillLabel, { color }]}>
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
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    fontFamily: Fonts.medium,
    fontSize: 16,
  },
  button: {
    minHeight: 52,
    borderRadius: Radius.medium,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  buttonLabel: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 22 },
  banner: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three },
  card: { borderRadius: Radius.large, borderWidth: 1, padding: Spacing.three, gap: Spacing.one },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
    padding: Spacing.three,
  },
  choiceText: { flex: 1, gap: 2 },
  segmented: { flexDirection: 'row', borderWidth: 1, borderRadius: Radius.medium, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 44, borderRadius: Radius.small, alignItems: 'center', justifyContent: 'center' },
  segmentLabel: { fontFamily: Fonts.bold, fontSize: 15 },
  mark: { width: 22, height: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radio: { borderRadius: 11 },
  checkbox: { borderRadius: 6 },
  markFill: { width: 10, height: 10 },
  checkboxFill: { borderRadius: 2 },
  pill: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  pillLabel: { fontSize: 12, lineHeight: 18 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: '100%' },
  loading: { marginTop: Spacing.five },
});
