import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/**
 * RFC 9457 problem details. `code` is the stable, machine-readable identifier
 * clients branch on (e.g. ALREADY_CHECKED_IN); `traceId` matches the
 * x-request-id header and the server logs.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance: string;
  traceId: string;
  errors?: { path: string; message: string }[];
  /** When a time-limited refusal ends (ISO 8601), e.g. a no-show ban. */
  until?: string;
}

/** An expected failure whose message is safe to show to the client. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra problem members for the client, such as `until`. */
    readonly extensions: Pick<ProblemDetails, 'until'> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

type Problem = Pick<ProblemDetails, 'status' | 'code' | 'detail'>;

// Cross-field rules live in the database as CHECK/UNIQUE constraints (one source
// of truth for create and update); these turn their violations into client errors.
const CONSTRAINT_PROBLEMS: Record<string, Problem> = {
  organizations_slug_key: { status: 409, code: 'SLUG_TAKEN', detail: 'Another club already uses this slug' },
  organizations_no_show_rule: {
    status: 400,
    code: 'INVALID_NO_SHOW_RULE',
    detail: 'A no-show rule needs both a limit (2-5) and a ban length (7, 14 or 30 days)',
  },
  events_time_order: { status: 400, code: 'INVALID_EVENT_TIMES', detail: 'endsAt must be after startsAt' },
  events_checkin_order: {
    status: 400,
    code: 'INVALID_CHECKIN_WINDOW',
    detail: 'checkinClosesAt must be after checkinOpensAt',
  },
  ticket_types_name_unique: {
    status: 409,
    code: 'TICKET_TYPE_NAME_TAKEN',
    detail: 'This event already has a ticket type with that name',
  },
  ticket_types_capacity: {
    status: 409,
    code: 'CAPACITY_BELOW_ISSUED',
    detail: 'capacity cannot be lower than the number of tickets already issued',
  },
  ticket_types_sales_window: {
    status: 400,
    code: 'INVALID_SALES_WINDOW',
    detail: 'salesEndsAt must be after salesStartsAt (it defaults to the event start)',
  },
  ticket_types_priority_config: {
    status: 400,
    code: 'INVALID_PRIORITY_CONFIG',
    detail:
      "allocationMode 'priority' needs priorityPointsThreshold and a prioritySalesStartsAt before salesStartsAt; other modes must leave both empty",
  },
};

function constraintProblem(error: unknown): Problem | undefined {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  return typeof error.constraint === 'string' ? CONSTRAINT_PROBLEMS[error.constraint] : undefined;
}

function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  problem: Pick<ProblemDetails, 'status' | 'code' | 'detail' | 'errors' | 'until'>,
) {
  const body: ProblemDetails = {
    type: 'about:blank',
    title: STATUS_TITLES[problem.status] ?? 'Error',
    instance: request.url,
    traceId: request.id,
    ...problem,
  };
  return reply.status(problem.status).type('application/problem+json').send(body);
}

export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, {
      status: 404,
      code: 'NOT_FOUND',
      detail: `Route ${request.method} ${request.url} does not exist`,
    }),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return sendProblem(request, reply, {
        status: 400,
        code: 'VALIDATION_FAILED',
        detail: `Invalid request ${error.validationContext ?? 'input'}`,
        errors: error.validation.map((issue) => ({
          path: issue.instancePath.replace(/^\//, '').replaceAll('/', '.'),
          message: issue.message ?? 'Invalid value',
        })),
      });
    }

    if (error instanceof AppError) {
      return sendProblem(request, reply, {
        status: error.status,
        code: error.code,
        detail: error.message,
        ...error.extensions,
      });
    }

    const fromConstraint = constraintProblem(error);
    if (fromConstraint) return sendProblem(request, reply, fromConstraint);

    // Fastify's own client errors (malformed JSON, payload too large, ...) are safe to echo.
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return sendProblem(request, reply, { status, code: error.code ?? 'BAD_REQUEST', detail: error.message });
    }

    request.log.error({ err: error }, 'unhandled error');
    return sendProblem(request, reply, {
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred',
    });
  });
}
