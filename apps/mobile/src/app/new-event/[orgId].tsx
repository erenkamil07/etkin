import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { api } from '@/api/client';
import { useClub } from '@/api/queries';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorBanner, Field, Notice, Screen, Segmented } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  buildEvent,
  type DraftErrors,
  dateIn,
  type EventDraft,
  emptyDraft,
  emptyTicketType,
  PAYMENT_TEMPLATES,
  typeDate,
  typeTime,
} from '@/orgs/event-form';

type EventPlan = Exclude<ReturnType<typeof buildEvent>, { errors: DraftErrors }>;

const QUICK_DATES = [
  { label: 'Bugün', days: 0 },
  { label: 'Yarın', days: 1 },
  { label: '1 hafta sonra', days: 7 },
];

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.chip, { borderColor: theme.border, opacity: pressed ? 0.6 : 1 }]}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}

export default function NewEvent() {
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<EventDraft>(emptyDraft);
  // Who can get tickets. A club with a university keeps events to its students
  // unless it says otherwise; without one, everyone can come.
  const club = useClub(orgId);
  const university = club.data?.university ?? null;
  const [audience, setAudience] = useState<'university' | 'everyone'>('university');
  const universityOnly = university !== null && audience === 'university';
  const [errors, setErrors] = useState<DraftErrors>({});
  const set =
    <K extends keyof EventDraft>(key: K) =>
    (value: EventDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value }));
  const setTicketType = (index: number, change: Partial<EventDraft['ticketTypes'][number]>) =>
    setDraft((current) => ({
      ...current,
      ticketTypes: current.ticketTypes.map((type, i) => (i === index ? { ...type, ...change } : type)),
    }));

  // What a failed attempt already created, so trying again finishes the job
  // instead of leaving a second draft behind.
  const progress = useRef<{ eventId?: string; ticketTypes: number }>({ ticketTypes: 0 });
  const [draftSaved, setDraftSaved] = useState(false);

  const save = useMutation({
    mutationFn: async ({ publish, plan }: { publish: boolean; plan: EventPlan }) => {
      let eventId = progress.current.eventId;
      if (!eventId) {
        const { data, error } = await api.POST('/orgs/{orgId}/events', {
          params: { path: { orgId } },
          body: plan.event,
        });
        if (error) throw error;
        eventId = data.id;
        progress.current.eventId = eventId;
        setDraftSaved(true);
      }
      const path = { orgId, eventId };
      for (let i = progress.current.ticketTypes; i < plan.ticketTypes.length; i++) {
        const body = plan.ticketTypes[i];
        if (!body) continue;
        const { error } = await api.POST('/orgs/{orgId}/events/{eventId}/ticket-types', { params: { path }, body });
        if (error) throw error;
        progress.current.ticketTypes = i + 1;
      }
      if (publish) {
        const { error } = await api.POST('/orgs/{orgId}/events/{eventId}/publish', { params: { path } });
        if (error) throw error;
      }
      return eventId;
    },
    onSuccess: (eventId) => {
      queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'events'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      router.replace({ pathname: '/manage/[eventId]', params: { eventId, orgId } });
    },
  });

  const submit = (publish: boolean) => {
    const plan = buildEvent(draft, Date.now());
    if ('errors' in plan) {
      setErrors(plan.errors);
      return;
    }
    setErrors({});
    save.mutate({ publish, plan: { ...plan, event: { ...plan.event, universityOnly } } });
  };

  return (
    <Screen belowHeader>
      <Field label="Başlık" value={draft.title} onChangeText={set('title')} error={errors.title} />
      <Field
        label="Açıklama (isteğe bağlı)"
        value={draft.description}
        onChangeText={set('description')}
        multiline
        numberOfLines={3}
        style={styles.multiline}
      />
      <Field label="Yer (isteğe bağlı)" value={draft.location} onChangeText={set('location')} />

      <View style={styles.row}>
        <View style={styles.grow}>
          <Field
            label="Tarih"
            placeholder="GG.AA.YYYY"
            value={draft.date}
            onChangeText={(value) => set('date')(typeDate(value))}
            keyboardType="number-pad"
            error={errors.date}
          />
        </View>
        <View style={styles.grow}>
          <Field
            label="Saat"
            placeholder="SS:DD"
            value={draft.time}
            onChangeText={(value) => set('time')(typeTime(value))}
            keyboardType="number-pad"
            error={errors.time}
          />
        </View>
      </View>
      <View style={styles.chips}>
        {QUICK_DATES.map((quick) => (
          <Chip key={quick.label} label={quick.label} onPress={() => set('date')(dateIn(quick.days))} />
        ))}
      </View>

      <View style={styles.row}>
        <View style={styles.grow}>
          <Field
            label="Süre (saat)"
            value={draft.hours}
            onChangeText={set('hours')}
            keyboardType="decimal-pad"
            error={errors.hours}
          />
        </View>
        <View style={styles.grow}>
          <Field
            label="Girişte kazanılan puan"
            value={draft.points}
            onChangeText={set('points')}
            keyboardType="number-pad"
            error={errors.points}
          />
        </View>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Kapı, etkinlikten 1 saat önce açılır ve etkinlik bitince kapanır.
      </ThemedText>

      {university ? (
        <>
          <ThemedText type="smallBold">Kimler bilet alabilir?</ThemedText>
          <Segmented
            options={[
              { value: 'university', label: 'Üniversitemiz' },
              { value: 'everyone', label: 'Herkes' },
            ]}
            value={audience}
            onChange={setAudience}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {universityOnly
              ? `Sadece ${university.name} öğrencileri bilet alabilir.`
              : 'Her üniversiteden öğrenci bilet alabilir; örneğin üniversiteler arası etkinlikler için.'}
          </ThemedText>
        </>
      ) : null}

      <ThemedText type="smallBold">Ücret</ThemedText>
      <Segmented
        options={[
          { value: 'free', label: 'Ücretsiz' },
          { value: 'paid', label: 'Ücretli' },
        ]}
        value={draft.paid ? 'paid' : 'free'}
        onChange={(value) => set('paid')(value === 'paid')}
      />

      <ThemedText type="smallBold">Bilet türleri</ThemedText>
      {draft.ticketTypes.map((type, index) => {
        const capacity = (
          <Field
            label="Kontenjan"
            value={type.capacity}
            onChangeText={(value) => setTicketType(index, { capacity: value })}
            keyboardType="number-pad"
            error={errors.ticketTypes?.[index]?.capacity}
          />
        );
        // Three fields don't fit a phone's width, so a paid ticket type puts
        // its numbers on a second line and keeps the whole name visible.
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id until saved, and only the last one is removed
          <View key={index} style={styles.ticketType}>
            <View style={styles.row}>
              <View style={styles.grow}>
                <Field
                  label="Ad"
                  value={type.name}
                  onChangeText={(name) => setTicketType(index, { name })}
                  error={errors.ticketTypes?.[index]?.name}
                />
              </View>
              {draft.paid ? null : <View style={styles.number}>{capacity}</View>}
            </View>
            {draft.paid ? (
              <View style={styles.row}>
                <View style={styles.grow}>{capacity}</View>
                <View style={styles.grow}>
                  <Field
                    label="Fiyat (₺)"
                    value={type.price}
                    onChangeText={(price) => setTicketType(index, { price })}
                    keyboardType="decimal-pad"
                    placeholder="150"
                    error={errors.ticketTypes?.[index]?.price}
                  />
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={styles.chips}>
        <Chip
          label="+ Bilet türü ekle"
          onPress={() => set('ticketTypes')([...draft.ticketTypes, { ...emptyTicketType(), name: '' }])}
        />
        {draft.ticketTypes.length > 1 ? (
          <Chip label="Sonuncuyu kaldır" onPress={() => set('ticketTypes')(draft.ticketTypes.slice(0, -1))} />
        ) : null}
      </View>

      {draft.paid ? (
        <>
          <Field
            label="Ücrete dahil olanlar (isteğe bağlı)"
            placeholder="Ör. yemek, sertifika, ulaşım"
            value={draft.priceIncludes}
            onChangeText={set('priceIncludes')}
            multiline
            numberOfLines={2}
            maxLength={500}
            style={styles.multiline}
            error={errors.priceIncludes}
          />
          <Field
            label="Ödeme bilgisi"
            placeholder="Ödemenin nasıl ve nereye yapılacağı"
            value={draft.paymentInfo}
            onChangeText={set('paymentInfo')}
            multiline
            numberOfLines={3}
            maxLength={500}
            style={styles.multiline}
            error={errors.paymentInfo}
          />
          <View style={styles.chips}>
            {PAYMENT_TEMPLATES.map((template) => (
              <Chip key={template.label} label={template.label} onPress={() => set('paymentInfo')(template.text)} />
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Etkin ödeme almaz; öğrenciler bilet alıp yerini ayırır, ücreti doğrudan kulübe öder. Bu bilgi etkinlik
            sayfasında herkese görünür.
          </ThemedText>
        </>
      ) : null}

      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <ThemedText type="smallBold">Sadık üyelere erken erişim</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Kulüpten yeterli puanı olanlar satışa herkesten önce girer.
          </ThemedText>
        </View>
        <Switch value={draft.priority} onValueChange={set('priority')} />
      </View>
      {draft.priority ? (
        <View style={styles.row}>
          <View style={styles.grow}>
            <Field
              label="Gereken puan"
              value={draft.priorityPoints}
              onChangeText={set('priorityPoints')}
              keyboardType="number-pad"
              error={errors.priorityPoints}
            />
          </View>
          <View style={styles.grow}>
            <Field
              label="Kaç saat önce"
              value={draft.priorityHours}
              onChangeText={set('priorityHours')}
              keyboardType="decimal-pad"
              error={errors.priorityHours}
            />
          </View>
        </View>
      ) : null}

      {draftSaved && save.isError ? (
        <Notice tone="warning">
          Etkinlik taslak olarak kaydedildi; tekrar denediğinde kalan adımlardan devam edilir.
        </Notice>
      ) : null}
      <ErrorBanner error={save.error} />
      <Button title="Yayınla" loading={save.isPending && save.variables?.publish} onPress={() => submit(true)} />
      <Button
        title="Taslak olarak kaydet"
        variant="secondary"
        loading={save.isPending && !save.variables?.publish}
        onPress={() => submit(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  grow: { flex: 1 },
  number: { width: 120 },
  ticketType: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
