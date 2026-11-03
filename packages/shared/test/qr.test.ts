import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createQrPayload,
  decodeTicketKey,
  deriveTicketKey,
  encodeTicketKey,
  msUntilNextQr,
  parseQrPayload,
  QR_STEP_SECONDS,
  qrStep,
  verifyQrPayload,
} from '../src/index.js';

const MASTER = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const TICKET = '019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b';
const NOW = 1_800_000_000_000; // 2027-01-15T08:00:00Z, step 120000000
const STEP_MS = QR_STEP_SECONDS * 1000;

const key = deriveTicketKey(MASTER, TICKET, 1);
const verifyAt = (payload: string, nowMs: number, ticketKey = key) => {
  const parsed = parseQrPayload(payload);
  if (!parsed) throw new Error('unparseable');
  return verifyQrPayload(parsed, ticketKey, nowMs);
};

describe('format', () => {
  // Pinned so the mobile app and the API can never drift apart silently.
  it('matches the reference vector', () => {
    expect(encodeTicketKey(key)).toBe('yabRAS5ax_1F1MiHi85ppKmkCE7a_OpjRcDRErXVovw');
    expect(createQrPayload(key, TICKET, NOW)).toBe('E1.AZorPE1ef2CKmwwdLj9KWwcnDgBBobKnXosR6EudqoWl0bph');
  });

  it('is plain HMAC-SHA256 over the documented byte layout', () => {
    const id = Buffer.from(TICKET.replaceAll('-', ''), 'hex');
    const u32 = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(n);
      return b;
    };
    const refKey = createHmac('sha256', MASTER)
      .update(Buffer.concat([Buffer.from('etkin/qr/v1'), id, u32(1)]))
      .digest();
    const step = qrStep(NOW);
    const refMac = createHmac('sha256', refKey)
      .update(Buffer.concat([id, u32(step)]))
      .digest()
      .subarray(0, 16);

    expect(Buffer.from(key).equals(refKey)).toBe(true);
    expect(createQrPayload(key, TICKET, NOW)).toBe(
      `E1.${Buffer.concat([id, u32(step), refMac]).toString('base64url')}`,
    );
  });

  it('round-trips through parsing', () => {
    const parsed = parseQrPayload(createQrPayload(key, TICKET, NOW));
    expect(parsed).toMatchObject({ ticketId: TICKET, step: qrStep(NOW) });
  });

  it('round-trips the key encoding', () => {
    expect(decodeTicketKey(encodeTicketKey(key))).toEqual(key);
  });

  it('ignores anything that is not one of our codes', () => {
    for (const junk of [
      '',
      'hello',
      'E1.',
      'E1.!!!',
      'https://example.com',
      `E2.${'A'.repeat(48)}`,
      `E1.${'A'.repeat(40)}`,
    ]) {
      expect(parseQrPayload(junk)).toBeNull();
    }
  });
});

describe('rotation', () => {
  it(`changes every ${QR_STEP_SECONDS} seconds`, () => {
    const stepStart = qrStep(NOW) * STEP_MS;
    expect(createQrPayload(key, TICKET, stepStart)).toBe(createQrPayload(key, TICKET, stepStart + STEP_MS - 1));
    expect(createQrPayload(key, TICKET, stepStart)).not.toBe(createQrPayload(key, TICKET, stepStart + STEP_MS));
  });

  it('counts down to the next code', () => {
    const stepStart = qrStep(NOW) * STEP_MS;
    expect(msUntilNextQr(stepStart)).toBe(STEP_MS);
    expect(msUntilNextQr(stepStart + 5_000)).toBe(STEP_MS - 5_000);
  });
});

describe('verification', () => {
  const payload = createQrPayload(key, TICKET, NOW);

  it('accepts the current code and one step of clock drift either way', () => {
    for (const drift of [-1, 0, 1]) expect(verifyAt(payload, NOW + drift * STEP_MS)).toBe('valid');
  });

  it('rejects a screenshot once it is two steps old (at most 45 s of life)', () => {
    expect(verifyAt(payload, NOW + 2 * STEP_MS)).toBe('expired');
    expect(verifyAt(payload, NOW - 2 * STEP_MS)).toBe('expired');
  });

  it('rejects a tampered signature', () => {
    const parsed = parseQrPayload(payload);
    if (!parsed) throw new Error('unparseable');
    parsed.mac[0] = (parsed.mac[0] ?? 0) ^ 0xff;
    expect(verifyQrPayload(parsed, key, NOW)).toBe('invalid');
  });

  it("rejects a code moved onto another ticket's id", () => {
    const parsed = parseQrPayload(payload);
    if (!parsed) throw new Error('unparseable');
    expect(verifyQrPayload({ ...parsed, ticketId: '019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5c' }, key, NOW)).toBe('invalid');
  });

  it('reports an old forged code as invalid, not expired', () => {
    const forged = createQrPayload(deriveTicketKey(MASTER, TICKET, 99), TICKET, NOW - 10 * STEP_MS);
    expect(verifyAt(forged, NOW)).toBe('invalid');
  });

  it('stops accepting codes from the old device after the key version moves on', () => {
    const newKey = deriveTicketKey(MASTER, TICKET, 2);
    expect(newKey).not.toEqual(key);
    expect(verifyAt(payload, NOW, newKey)).toBe('invalid');
    expect(verifyAt(createQrPayload(newKey, TICKET, NOW), NOW, newKey)).toBe('valid');
  });
});
