// Door rush: 5,000+ people through 4 gates, ramping to 60 scans per second
// (a 500-person event peaks around 1-2 per second). 3% first show an expired
// screenshot, 10% get scanned again at another gate.
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { QR_STEP_SECONDS, qrPayload, selfTest, uuidv4 } from './lib/qr.js';

const FIXTURE = './.fixtures/fixture.json';
const BASE_URL = __ENV.BASE_URL ?? 'http://etkin-load-api:3000';

const attendees = new SharedArray('attendees', () => JSON.parse(open(FIXTURE)).attendees);
const [door] = new SharedArray('door', () => {
  const { orgId, eventId, gates } = JSON.parse(open(FIXTURE));
  return [{ orgId, eventId, gates }];
});

const verdicts = new Counter('scan_verdicts');

export const options = {
  scenarios: {
    door_rush: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 400,
      stages: [
        { target: 60, duration: '30s' },
        { target: 60, duration: '60s' },
        { target: 0, duration: '15s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:scan}': ['p(95)<250', 'p(99)<500'],
    'http_req_duration{expected:accepted}': ['p(95)<250'],
    checks: ['rate>0.999'],
    dropped_iterations: ['count<1'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  selfTest();
}

function scan(gate, qr, expected) {
  const res = http.post(
    `${BASE_URL}/orgs/${door.orgId}/events/${door.eventId}/check-ins`,
    JSON.stringify({ qr, gate: gate.name }),
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${gate.token}`,
        'idempotency-key': uuidv4(),
      },
      tags: { endpoint: 'scan', expected },
    },
  );
  const result = res.status === 200 ? res.json('result') : `http_${res.status}`;
  verdicts.add(1, { result });
  check(res, { [`verdict is ${expected}`]: () => result === expected });
}

export default function () {
  const i = exec.scenario.iterationInTest;
  const attendee = attendees[i % attendees.length];
  const gate = door.gates[i % door.gates.length];
  const code = (ageMs) => qrPayload(attendee.key, attendee.ticketId, Date.now() - ageMs);
  const roll = Math.random();

  if (roll < 0.03) scan(gate, code(3 * QR_STEP_SECONDS * 1000), 'expired_token');
  scan(gate, code(0), i < attendees.length ? 'accepted' : 'duplicate');
  if (roll >= 0.9) scan(door.gates[(i + 1) % door.gates.length], code(0), 'duplicate');
}
