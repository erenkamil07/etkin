/**
 * Dynamic ticket QR codes.
 *
 * The server derives a per-ticket key from its master key and gives it to the
 * holder's device once. The device then renders a fresh code every
 * QR_STEP_SECONDS without network access:
 *
 *   payload = "E1." + base64url(ticketId (16 B) || step (u32 BE) || mac (16 B))
 *   mac     = HMAC-SHA256(ticketKey, ticketId || step)[0..16]
 *
 * A screenshot stops scanning after at most (2 * QR_TOLERANCE_STEPS + 1) steps.
 * Pure JavaScript (no Node APIs) so the same code runs in the API and in React Native.
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';

/** How long each code is shown before the next one. */
export const QR_STEP_SECONDS = 15;
/** Steps either side of the scanner's clock still accepted: a code lives 15-45 s. */
export const QR_TOLERANCE_STEPS = 1;

const PREFIX = 'E1.';
const ID_BYTES = 16;
const STEP_BYTES = 4;
const MAC_BYTES = 16;
const KEY_CONTEXT = utf8ToBytes('etkin/qr/v1');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QrVerdict = 'valid' | 'expired' | 'invalid';

export interface ParsedQr {
  ticketId: string;
  step: number;
  mac: Uint8Array;
}

export function qrStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / QR_STEP_SECONDS);
}

/** For the countdown ring on the ticket screen. */
export function msUntilNextQr(nowMs: number): number {
  const stepMs = QR_STEP_SECONDS * 1000;
  return stepMs - (nowMs % stepMs);
}

function u32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`not a uint32: ${value}`);
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_PATTERN.test(uuid)) throw new TypeError(`not a UUID: ${uuid}`);
  return hexToBytes(uuid.replaceAll('-', ''));
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function codeMac(ticketKey: Uint8Array, ticketIdBytes: Uint8Array, step: number): Uint8Array {
  return hmac(sha256, ticketKey, concatBytes(ticketIdBytes, u32(step))).slice(0, MAC_BYTES);
}

/**
 * Server only. Bumping `keyVersion` (the ticket moved to a new device) yields a
 * new key, which invalidates every code the old device can produce.
 */
export function deriveTicketKey(masterKey: Uint8Array, ticketId: string, keyVersion: number): Uint8Array {
  return hmac(sha256, masterKey, concatBytes(KEY_CONTEXT, uuidToBytes(ticketId), u32(keyVersion)));
}

/** Transport encoding for the ticket key in API responses and device storage. */
export function encodeTicketKey(key: Uint8Array): string {
  return base64urlnopad.encode(key);
}

export function decodeTicketKey(encoded: string): Uint8Array {
  return base64urlnopad.decode(encoded);
}

/** Device side: the code to show right now. */
export function createQrPayload(ticketKey: Uint8Array, ticketId: string, nowMs: number): string {
  const id = uuidToBytes(ticketId);
  const step = qrStep(nowMs);
  return PREFIX + base64urlnopad.encode(concatBytes(id, u32(step), codeMac(ticketKey, id, step)));
}

/** Scanner side, step 1: structure only. Returns null for anything that isn't one of our codes. */
export function parseQrPayload(payload: string): ParsedQr | null {
  if (!payload.startsWith(PREFIX)) return null;
  let bytes: Uint8Array;
  try {
    bytes = base64urlnopad.decode(payload.slice(PREFIX.length));
  } catch {
    return null;
  }
  if (bytes.length !== ID_BYTES + STEP_BYTES + MAC_BYTES) return null;
  return {
    ticketId: bytesToUuid(bytes.subarray(0, ID_BYTES)),
    step: new DataView(bytes.buffer, bytes.byteOffset).getUint32(ID_BYTES),
    mac: bytes.slice(ID_BYTES + STEP_BYTES),
  };
}

/**
 * Scanner side, step 2, once the ticket's key version is known. The signature is
 * checked before the clock, so a forged code reads 'invalid', never 'expired'.
 */
export function verifyQrPayload(parsed: ParsedQr, ticketKey: Uint8Array, nowMs: number): QrVerdict {
  const expected = codeMac(ticketKey, uuidToBytes(parsed.ticketId), parsed.step);
  if (!constantTimeEqual(expected, parsed.mac)) return 'invalid';
  return Math.abs(parsed.step - qrStep(nowMs)) <= QR_TOLERANCE_STEPS ? 'valid' : 'expired';
}
