import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { type University, useUniversities } from '@/api/queries';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from './themed-text';
import { ErrorBanner, Loading } from './ui';

/** What was picked: a university, null for "mine is not listed", undefined for nothing yet. */
export type UniversityChoice = Pick<University, 'id' | 'name'> | null | undefined;

const FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
/** "Çukurova" → "cukurova", so people can type without Turkish letters. */
const fold = (text: string) => text.toLocaleLowerCase('tr').replace(/[çğıöşü]/g, (char) => FOLD[char] ?? char);

/** Name and city words, plus the initials students call it by: "Orta Doğu Teknik Üniversitesi" → "odtu". */
function searchText(university: University) {
  const words = fold(university.name).split(/\s+/);
  return `${words.join(' ')} ${fold(university.city)} ${words.map((word) => word[0]).join('')}`;
}

/** A field that opens a searchable list of every university. */
export function UniversityPicker({
  label,
  value,
  onChange,
  error,
  hint,
  disabled = false,
}: {
  label: string;
  value: UniversityChoice;
  onChange: (choice: University | null) => void;
  error?: string | undefined;
  /** A line under the field, e.g. when the choice can next be changed. */
  hint?: string | undefined;
  /** Shown but not changeable, e.g. while a student's university is locked. */
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const shown = value === undefined ? 'Üniversiteni seç' : value === null ? 'Listede yok' : value.name;

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[
          styles.trigger,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: error ? theme.danger : theme.border,
            opacity: disabled ? 0.6 : 1,
          },
        ]}
      >
        <ThemedText style={styles.grow} themeColor={value === undefined ? 'textSecondary' : 'text'} numberOfLines={1}>
          {shown}
        </ThemedText>
        {disabled ? null : <ThemedText themeColor="textSecondary">›</ThemedText>}
      </Pressable>
      {error ? (
        <ThemedText type="small" themeColor="danger">
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaProvider>
          <PickerList
            onPick={(choice) => {
              onChange(choice);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

function PickerList({ onPick, onClose }: { onPick: (choice: University | null) => void; onClose: () => void }) {
  const theme = useTheme();
  const universities = useUniversities();
  const [query, setQuery] = useState('');

  const indexed = useMemo(
    () => (universities.data ?? []).map((university) => ({ university, text: searchText(university) })),
    [universities.data],
  );
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  const matches = indexed
    .filter(({ text }) => words.every((word) => text.includes(word)))
    .map(({ university }) => university);

  return (
    <SafeAreaView style={[styles.sheet, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <ThemedText type="subtitle" style={styles.grow}>
          Üniversite seç
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
          <ThemedText themeColor="tint">Kapat</ThemedText>
        </Pressable>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Ara: Mersin, ODTÜ, Çukurova…"
        placeholderTextColor={theme.textSecondary}
        selectionColor={theme.tint}
        autoFocus
        autoCorrect={false}
        style={[
          styles.search,
          { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
        ]}
      />
      {universities.isPending ? <Loading /> : <ErrorBanner error={universities.error} />}
      <FlatList
        data={matches}
        keyExtractor={(university) => String(university.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => onPick(item)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}
          >
            <ThemedText>{item.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.city}
            </ThemedText>
          </Pressable>
        )}
        ListFooterComponent={
          universities.data ? (
            <Pressable accessibilityRole="button" onPress={() => onPick(null)} style={styles.row}>
              <ThemedText themeColor="tint">Üniversitem listede yok</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Etkinliklerde tüm Türkiye'yi görürsün; sonra Profil'den değiştirebilirsin.
              </ThemedText>
            </Pressable>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.one },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
  },
  grow: { flex: 1 },
  sheet: { flex: 1, paddingHorizontal: Spacing.four, gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: Spacing.three },
  search: {
    borderWidth: 1,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontFamily: Fonts.medium,
    fontSize: 16,
  },
  list: { paddingBottom: Spacing.six },
  row: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.one, gap: 2, borderRadius: Radius.small },
});
