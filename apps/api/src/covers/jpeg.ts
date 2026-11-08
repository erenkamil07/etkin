/**
 * Reads a JPEG's size and drops its metadata segments, so a poster never
 * carries the photo's EXIF (GPS position, camera, date) or XMP to everyone who
 * opens the event. No image library: JPEG is a list of length-prefixed
 * segments up to the compressed data, and only those segments are touched.
 */

const SOI = 0xd8;
const SOS = 0xda;
const APP1 = 0xe1; // EXIF and XMP
const APP13 = 0xed; // Photoshop IPTC
const COMMENT = 0xfe;
// Start-of-frame markers carry the size; C4 (DHT), C8 (JPG) and CC (DAC) don't.
const isStartOfFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

export class NotAJpegError extends Error {}

export function cleanJpeg(input: Buffer): { data: Buffer; width: number; height: number } {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== SOI) throw new NotAJpegError('not a JPEG');
  const kept: Buffer[] = [input.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let at = 2;
  while (at + 4 <= input.length) {
    if (input[at] !== 0xff) throw new NotAJpegError('broken segment');
    const marker = input[at + 1] as number;
    if (marker === SOS) {
      kept.push(input.subarray(at)); // the image data, through to the end
      break;
    }
    const length = input.readUInt16BE(at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > input.length) throw new NotAJpegError('broken segment');
    if (isStartOfFrame(marker) && length >= 7) {
      height = input.readUInt16BE(at + 5);
      width = input.readUInt16BE(at + 7);
    }
    if (marker !== APP1 && marker !== APP13 && marker !== COMMENT) kept.push(input.subarray(at, end));
    at = end;
  }
  if (!width || !height) throw new NotAJpegError('no image size');
  return { data: Buffer.concat(kept), width, height };
}
