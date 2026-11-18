import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Switch, View } from 'react-native';
import { api } from '@/api/client';
import { useMe } from '@/api/queries';
import { ThemedText } from '@/components/themed-text';
import { ErrorBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * "Katıldığım etkinliklerde fotoğrafım görünsün": the one place a profile photo
 * becomes visible to other students. Off until the person turns it on.
 */
export function PhotoAtEventsSwitch() {
  const theme = useTheme();
  const me = useMe();
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: async (showPhotoAtEvents: boolean) => {
      const { data, error } = await api.PATCH('/me', { body: { showPhotoAtEvents } });
      if (error) throw error;
      return data;
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(['me'], profile);
      // The faces on event cards change with it.
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });

  if (!me.data) return null;
  const on = change.isPending ? change.variables : me.data.showPhotoAtEvents;
  const hasPhoto = me.data.avatarUrl !== null;

  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <ThemedText type="default">Katıldığım etkinliklerde fotoğrafım görünsün</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {hasPhoto
              ? 'Açarsan bilet aldığın etkinliklerde, "kişi katılıyor" yazısının yanında fotoğrafın görünebilir; uygulamayı kullanan herkes görebilir. Adın görünmez.'
              : 'Önce bir profil fotoğrafı eklemelisin. Fotoğrafın sen açmadıkça etkinliklerde görünmez.'}
          </ThemedText>
        </View>
        <Switch
          accessibilityLabel="Katıldığım etkinliklerde fotoğrafım görünsün"
          value={on}
          disabled={!hasPhoto && !on}
          onValueChange={(value) => change.mutate(value)}
          trackColor={{ true: theme.tint, false: theme.backgroundSelected }}
        />
      </View>
      <ErrorBanner error={change.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1, gap: 2 },
});
