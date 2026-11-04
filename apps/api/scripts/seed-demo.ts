// Demo data for trying the app by hand: a club with an owner and a door
// scanner, a student, two upcoming events and a live one whose door is open
// right now, so the scanner can be tried at any time. Safe to run again:
// existing rows are kept, and the live event is moved back to "now".
//
//   pnpm demo:seed
import { hashPassword } from '../src/auth/passwords.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db.js';

// Development-only accounts; README lists them too.
const ACCOUNTS = {
  organizer: { email: 'demo.organizer@etkin.dev', password: 'demo-organizer-2026', fullName: 'Demo Organizatör' },
  scanner: { email: 'kapi.demo@etkin.dev', password: 'demo-kapi-2026', fullName: 'Kapı Görevlisi' },
  student: {
    email: 'ayse.demo@uni.edu.tr',
    password: 'correct horse battery',
    fullName: 'Ayşe Yılmaz',
    university: 'ODTÜ',
  },
  // A second student, so one ticket can be admitted while another is already used.
  student2: {
    email: 'mert.demo@uni.edu.tr',
    password: 'mert demo 2026',
    fullName: 'Mert Demir',
    university: 'Mersin Üniversitesi',
  },
};
const CLUB = { slug: 'ieee-demo', name: 'IEEE Öğrenci Kolu' };
const LIVE_TITLE = 'Canlı Demo: Kapı Testi';

const config = loadConfig();
if (config.NODE_ENV === 'production') throw new Error('Demo data never goes into a production database');
const db = createDatabase(config.DATABASE_URL, 2);

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);
/** A day `days` from today at `hour`:00, local time. */
function dayAt(days: number, hour: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

async function ensureUser(account: { email: string; password: string; fullName: string; university?: string }) {
  const existing = await db.selectFrom('users').select('id').where('email', '=', account.email).executeTakeFirst();
  if (existing) return existing.id;
  const { id } = await db
    .insertInto('users')
    .values({
      email: account.email,
      password_hash: await hashPassword(account.password),
      full_name: account.fullName,
      university: account.university ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

const organizerId = await ensureUser(ACCOUNTS.organizer);
const scannerId = await ensureUser(ACCOUNTS.scanner);
await ensureUser(ACCOUNTS.student);
await ensureUser(ACCOUNTS.student2);

const orgId =
  (await db.selectFrom('organizations').select('id').where('slug', '=', CLUB.slug).executeTakeFirst())?.id ??
  (await db.insertInto('organizations').values(CLUB).returning('id').executeTakeFirstOrThrow()).id;
await db
  .insertInto('organization_members')
  .values([
    { organization_id: orgId, user_id: organizerId, role: 'owner' },
    { organization_id: orgId, user_id: scannerId, role: 'scanner' },
  ])
  .onConflict((oc) => oc.columns(['organization_id', 'user_id']).doNothing())
  .execute();

interface DemoEvent {
  title: string;
  description: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
  checkinOpensAt: Date;
  ticketTypes: { name: string; capacity: number }[];
}

/** The club's event with this title, created and published if it is missing. */
async function ensureEvent(event: DemoEvent) {
  const existing = await db
    .selectFrom('events')
    .select('id')
    .where('organization_id', '=', orgId)
    .where('title', '=', event.title)
    .where('status', '!=', 'cancelled')
    .executeTakeFirst();
  if (existing) return { id: existing.id, created: false };

  const { id } = await db
    .insertInto('events')
    .values({
      organization_id: orgId,
      title: event.title,
      description: event.description,
      location_name: event.location,
      starts_at: event.startsAt,
      ends_at: event.endsAt,
      checkin_opens_at: event.checkinOpensAt,
      checkin_closes_at: event.endsAt,
      status: 'published',
      published_at: new Date(),
      created_by: organizerId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('ticket_types')
    .values(
      event.ticketTypes.map((type) => ({
        event_id: id,
        name: type.name,
        capacity: type.capacity,
        sales_starts_at: minutesFromNow(-60),
        sales_ends_at: event.startsAt,
      })),
    )
    .execute();
  return { id, created: true };
}

const workshopStart = dayAt(5, 18);
await ensureEvent({
  title: 'Bulut Bilişime Giriş: AWS Atölyesi',
  description: 'EC2, S3 ve IAM ile ilk adımlar. Bilgisayarını getir.',
  location: 'Mühendislik B-101',
  startsAt: workshopStart,
  endsAt: new Date(workshopStart.getTime() + 3 * 3_600_000),
  checkinOpensAt: new Date(workshopStart.getTime() - 3_600_000),
  ticketTypes: [
    { name: 'Standart', capacity: 60 },
    { name: 'VIP (ön sıra)', capacity: 10 },
  ],
});

const talkStart = dayAt(9, 19);
await ensureEvent({
  title: 'Kariyer Sohbetleri: Yazılımda İlk İş',
  description: 'Mezunlarımız ilk işlerini nasıl bulduklarını anlatıyor.',
  location: 'Kültür Merkezi Salon 2',
  startsAt: talkStart,
  endsAt: new Date(talkStart.getTime() + 2 * 3_600_000),
  checkinOpensAt: new Date(talkStart.getTime() - 3_600_000),
  ticketTypes: [{ name: 'Standart', capacity: 120 }],
});

// The live event: doors opened half an hour ago, it starts in half an hour.
const live = {
  startsAt: minutesFromNow(30),
  endsAt: minutesFromNow(3 * 60),
  checkinOpensAt: minutesFromNow(-30),
};
const { id: liveId, created } = await ensureEvent({
  title: LIVE_TITLE,
  description: 'Tarayıcıyı denemek için: kapı şu an açık. Bilet al, QR kodunu başka bir telefona okut.',
  location: 'Kulüp odası',
  ...live,
  ticketTypes: [{ name: 'Standart', capacity: 100 }],
});
if (!created) {
  // Bring it back to "now"; the worker marks events completed once they end.
  await db
    .updateTable('events')
    .set({
      starts_at: live.startsAt,
      ends_at: live.endsAt,
      checkin_opens_at: live.checkinOpensAt,
      checkin_closes_at: live.endsAt,
      status: 'published',
    })
    .where('id', '=', liveId)
    .execute();
  await db
    .updateTable('ticket_types')
    .set({ sales_starts_at: minutesFromNow(-60), sales_ends_at: live.startsAt })
    .where('event_id', '=', liveId)
    .execute();
}

console.log(
  `Demo club "${CLUB.name}" is ready; "${LIVE_TITLE}" has its door open until ${live.endsAt.toLocaleTimeString('tr-TR')}.`,
);
console.log('Accounts (password in parentheses):');
for (const [role, account] of Object.entries(ACCOUNTS)) {
  console.log(`  ${role.padEnd(9)} ${account.email} (${account.password})`);
}
await db.destroy();
