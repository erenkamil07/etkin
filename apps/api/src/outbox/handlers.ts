import { z } from 'zod';
import { awardBadgesAfterCheckIn } from '../badges/service.js';
import type { OutboxHandlers } from './processor.js';

const CheckInAccepted = z.object({
  checkInId: z.uuid(),
  userId: z.uuid(),
  organizationId: z.uuid(),
});

export const outboxHandlers: OutboxHandlers = {
  'checkin.accepted': async (db, payload) => {
    await awardBadgesAfterCheckIn(db, CheckInAccepted.parse(payload));
  },
};
