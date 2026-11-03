// The dynamic QR format from packages/shared/src/qr.ts, re-implemented with
// k6's built-in crypto (k6 can't load the npm package's dependencies).
// selfTest() pins it to the shared package's reference vector, so the load
// test refuses to run if the two implementations ever disagree.
import { hmac, randomBytes } from 'k6/crypto';
import encoding from 'k6/encoding';

export const QR_STEP_SECONDS = 15;

function uuidBytes(uuid) {
  const hex = uuid.replaceAll('-', '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function qrPayload(ticketKey, ticketId, nowMs) {
  const key = encoding.b64decode(ticketKey, 'rawurl');
  const id = uuidBytes(ticketId);
  const step = u32(Math.floor(nowMs / 1000 / QR_STEP_SECONDS));
  const mac = new Uint8Array(hmac('sha256', key, concat(id, step).buffer, 'binary')).slice(0, 16);
  return `E1.${encoding.b64encode(concat(id, step, mac).buffer, 'rawurl')}`;
}

export function selfTest() {
  const expected = 'E1.AZorPE1ef2CKmwwdLj9KWwcnDgBBobKnXosR6EudqoWl0bph';
  const actual = qrPayload(
    'yabRAS5ax_1F1MiHi85ppKmkCE7a_OpjRcDRErXVovw',
    '019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b',
    1_800_000_000_000,
  );
  if (actual !== expected) throw new Error(`QR implementation drifted from packages/shared: got ${actual}`);
}

/** RFC 4122 v4, from k6's CSPRNG. */
export function uuidv4() {
  const b = new Uint8Array(randomBytes(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
