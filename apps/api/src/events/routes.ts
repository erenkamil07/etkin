import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Database } from '../db.js';
import {
  atLeastOneField,
  BEARER,
  DateTimeInput,
  DateTimeOutput,
  EventParams,
  OrgEventParams,
  OrgParams,
} from '../schemas.js';
import {
  cancelEvent,
  createEvent,
  createTicketType,
  deleteEvent,
  deleteTicketType,
  getEvent,
  listOrgEvents,
  listUpcomingEvents,
  publishEvent,
  updateEvent,
  updateTicketType,
} from './service.js';

const AllocationModeSchema = z
  .enum(['fcfs', 'priority', 'lottery'])
  .describe('fcfs: first come first served; priority: early window for loyal members; lottery: points-weighted draw');

const TicketType = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  capacity: z.number().int(),
  issued: z.number().int(),
  remaining: z.number().int(),
  priceCents: z.number().int(),
  currency: z.string(),
  allocationMode: AllocationModeSchema,
  minPointsRequired: z.number().int(),
  priorityPointsThreshold: z.number().int().nullable(),
  prioritySalesStartsAt: DateTimeOutput.nullable(),
  salesStartsAt: DateTimeOutput,
  salesEndsAt: DateTimeOutput,
});

const EventBase = z.object({
  id: z.uuid(),
  organization: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
  title: z.string(),
  description: z.string().nullable(),
  locationName: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  startsAt: DateTimeOutput,
  endsAt: DateTimeOutput,
  checkinOpensAt: DateTimeOutput,
  checkinClosesAt: DateTimeOutput,
  checkinPoints: z.number().int(),
  status: z.enum(['draft', 'published', 'cancelled', 'completed']),
  publishedAt: DateTimeOutput.nullable(),
});
const EventSummary = EventBase.extend({ capacity: z.number().int(), remaining: z.number().int() });
const EventDetail = EventBase.extend({ ticketTypes: z.array(TicketType) });

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const ImageUrl = z
  .url({ protocol: /^https$/ })
  .max(500)
  .nullable()
  .optional();

const EventBody = z.object({
  title: z.string().trim().min(3).max(200),
  description: text(5000),
  locationName: text(200),
  coverImageUrl: ImageUrl,
  startsAt: DateTimeInput,
  endsAt: DateTimeInput,
  checkinOpensAt: DateTimeInput.optional().describe('Defaults to one hour before startsAt'),
  checkinClosesAt: DateTimeInput.optional().describe('Defaults to endsAt'),
  checkinPoints: z.number().int().min(0).max(100).optional().describe('Points awarded at the door; default 1'),
});

const TicketTypeBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: text(1000),
  capacity: z.number().int().positive().max(100_000),
  priceCents: z.number().int().min(0).max(10_000_000).optional().describe('Informational for now; 0 = free'),
  allocationMode: AllocationModeSchema.optional(),
  minPointsRequired: z.number().int().min(0).optional().describe('Club points needed to claim at all'),
  priorityPointsThreshold: z.number().int().positive().nullable().optional(),
  prioritySalesStartsAt: DateTimeInput.nullable().optional(),
  salesStartsAt: DateTimeInput.optional().describe('Defaults to now'),
  salesEndsAt: DateTimeInput.optional().describe('Defaults to the event start'),
});

const FIELD_REQUIRED = 'Provide at least one field to change';
const TicketTypeParams = OrgEventParams.extend({ ticketTypeId: z.uuid() });

export const eventRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  // --- public ---------------------------------------------------------------

  app.get(
    '/events',
    {
      schema: {
        tags: ['events'],
        summary: 'Upcoming published events, soonest first',
        querystring: z.object({
          orgId: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
          cursor: z.string().max(200).optional().describe('nextCursor from the previous page'),
        }),
        response: { 200: z.object({ items: z.array(EventSummary), nextCursor: z.string().nullable() }) },
      },
    },
    async (request) => listUpcomingEvents(db, request.query),
  );

  app.get(
    '/events/:eventId',
    {
      onRequest: app.authenticateOptional,
      schema: {
        tags: ['events'],
        summary: "Event page with its ticket types; drafts only for the club's team",
        params: EventParams,
        response: { 200: EventDetail },
      },
    },
    async (request) => getEvent(db, request.params.eventId, request.user),
  );

  // --- club management --------------------------------------------------------

  const organizer = { onRequest: app.authenticate, preHandler: app.requireOrgRole('organizer') };

  app.get(
    '/orgs/:orgId/events',
    {
      onRequest: app.authenticate,
      preHandler: app.requireOrgRole('scanner'),
      schema: {
        tags: ['events'],
        summary: "All of the club's events, drafts included (any team role)",
        security: BEARER,
        params: OrgParams,
        response: { 200: z.array(EventSummary) },
      },
    },
    async (request) => listOrgEvents(db, request.params.orgId),
  );

  app.post(
    '/orgs/:orgId/events',
    {
      ...organizer,
      schema: {
        tags: ['events'],
        summary: 'Create a draft event (organizer+)',
        security: BEARER,
        params: OrgParams,
        body: EventBody,
        response: { 201: EventDetail },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await createEvent(db, request.params.orgId, currentUser(request).id, request.body)),
  );

  app.patch(
    '/orgs/:orgId/events/:eventId',
    {
      ...organizer,
      schema: {
        tags: ['events'],
        summary: 'Edit an event; moving it resets the check-in window unless you send one (organizer+)',
        security: BEARER,
        params: OrgEventParams,
        body: EventBody.partial().refine(atLeastOneField, FIELD_REQUIRED),
        response: { 200: EventDetail },
      },
    },
    async (request) => updateEvent(db, request.params.orgId, request.params.eventId, request.body),
  );

  app.delete(
    '/orgs/:orgId/events/:eventId',
    {
      ...organizer,
      schema: { tags: ['events'], summary: 'Delete a draft (organizer+)', security: BEARER, params: OrgEventParams },
    },
    async (request, reply) => {
      await deleteEvent(db, request.params.orgId, request.params.eventId);
      return reply.status(204).send();
    },
  );

  app.post(
    '/orgs/:orgId/events/:eventId/publish',
    {
      ...organizer,
      schema: {
        tags: ['events'],
        summary: 'Publish a draft that has at least one ticket type (organizer+)',
        security: BEARER,
        params: OrgEventParams,
        response: { 200: EventDetail },
      },
    },
    async (request) => publishEvent(db, request.params.orgId, request.params.eventId),
  );

  app.post(
    '/orgs/:orgId/events/:eventId/cancel',
    {
      ...organizer,
      schema: {
        tags: ['events'],
        summary: 'Cancel a draft or published event (organizer+)',
        security: BEARER,
        params: OrgEventParams,
        response: { 200: EventDetail },
      },
    },
    async (request) => cancelEvent(db, request.params.orgId, request.params.eventId),
  );

  app.post(
    '/orgs/:orgId/events/:eventId/ticket-types',
    {
      ...organizer,
      schema: {
        tags: ['events'],
        summary: 'Add a ticket type with its capacity and allocation rules (organizer+)',
        security: BEARER,
        params: OrgEventParams,
        body: TicketTypeBody,
        response: { 201: TicketType },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await createTicketType(db, request.params.orgId, request.params.eventId, request.body)),
  );

  app.patch(
    '/orgs/:orgId/events/:eventId/ticket-types/:ticketTypeId',
    {
      ...organizer,
      schema: {
        tags: ['events'],
        summary: 'Edit a ticket type; capacity cannot drop below tickets issued (organizer+)',
        security: BEARER,
        params: TicketTypeParams,
        body: TicketTypeBody.partial().refine(atLeastOneField, FIELD_REQUIRED),
        response: { 200: TicketType },
      },
    },
    async (request) =>
      updateTicketType(db, request.params.orgId, request.params.eventId, request.params.ticketTypeId, request.body),
  );

  app.delete(
    '/orgs/:orgId/events/:eventId/ticket-types/:ticketTypeId',
    {
      ...organizer,
      schema: {
        tags: ['events'],
        summary: 'Delete a ticket type nobody holds yet (organizer+)',
        security: BEARER,
        params: TicketTypeParams,
      },
    },
    async (request, reply) => {
      await deleteTicketType(db, request.params.orgId, request.params.eventId, request.params.ticketTypeId);
      return reply.status(204).send();
    },
  );
};
