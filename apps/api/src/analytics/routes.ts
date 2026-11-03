import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../db.js';
import { BEARER, DateTimeOutput, OrgEventParams } from '../schemas.js';
import { getEventStats, searchAttendees } from './service.js';

const count = z.number().int();

const EventStats = z.object({
  tickets: z.object({
    issued: count.describe('Live tickets (active + checked in)'),
    checkedIn: count,
    cancelled: count,
    waiting: count.describe('Holders not admitted yet'),
    noShows: count.nullable().describe('Holders who never came; null until the event ends'),
    attendanceRate: z.number().nullable().describe('checkedIn / issued, 0..1'),
  }),
  byTicketType: z.array(z.object({ id: z.uuid(), name: z.string(), capacity: count, issued: count, checkedIn: count })),
  arrivals: z.array(z.object({ from: DateTimeOutput, count })).describe('Check-ins per 10 minutes from door opening'),
  gates: z.array(z.object({ gate: z.string().nullable(), count })),
  scans: z.record(
    z.enum([
      'accepted',
      'duplicate',
      'invalid_token',
      'expired_token',
      'wrong_event',
      'ticket_cancelled',
      'outside_window',
    ]),
    count,
  ),
});

const Attendee = z.object({
  ticketId: z.uuid(),
  status: z.enum(['active', 'checked_in', 'cancelled']),
  checkedInAt: DateTimeOutput.nullable(),
  ticketType: z.string(),
  name: z.string(),
  studentNumber: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});

export const analyticsRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  const organizer = { onRequest: app.authenticate, preHandler: app.requireOrgRole('organizer') };

  app.get(
    '/orgs/:orgId/events/:eventId/stats',
    {
      ...organizer,
      schema: {
        tags: ['analytics'],
        summary: 'Attendance, no-shows, arrival curve, gates and scan outcomes (organizer+)',
        security: BEARER,
        params: OrgEventParams,
        response: { 200: EventStats },
      },
    },
    async (request) => getEventStats(db, request.params.orgId, request.params.eventId),
  );

  app.get(
    '/orgs/:orgId/events/:eventId/attendees',
    {
      ...organizer,
      schema: {
        tags: ['analytics'],
        summary: 'Ticket holders, searchable by name or student number (organizer+)',
        security: BEARER,
        params: OrgEventParams,
        querystring: z.object({
          q: z.string().trim().min(1).max(100).optional(),
          status: z.enum(['active', 'checked_in', 'cancelled']).optional(),
        }),
        response: { 200: z.array(Attendee) },
      },
    },
    async (request) => searchAttendees(db, request.params.orgId, request.params.eventId, request.query),
  );
};
