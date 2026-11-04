// Writes the door scanner's three sounds as small WAV files, synthesised here
// so there is no third-party audio to license. Run again after changing a tone:
//   node apps/mobile/scripts/make-door-sounds.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 22_050;
const out = new URL('../assets/sounds/', import.meta.url);

/** A tone with a short attack and an exponential fade, so it never clicks. */
function tone(hz, seconds, { volume = 0.6, decay = 6, harmonics = [1] } = {}) {
  const samples = Math.round(RATE * seconds);
  const data = new Float32Array(samples);
  const attack = Math.round(RATE * 0.006);
  for (let i = 0; i < samples; i++) {
    const t = i / RATE;
    const envelope = Math.min(1, i / attack) * Math.exp(-decay * t);
    let value = 0;
    harmonics.forEach((weight, index) => {
      value += weight * Math.sin(2 * Math.PI * hz * (index + 1) * t);
    });
    data[i] = (volume * envelope * value) / harmonics.reduce((sum, weight) => sum + weight, 0);
  }
  return data;
}

const silence = (seconds) => new Float32Array(Math.round(RATE * seconds));

function concat(...parts) {
  const result = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function wav(samples) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32_767), 44 + i * 2);
  });
  return buffer;
}

const sounds = {
  // Admitted: a bright rising two-note chime.
  'door-ok.wav': concat(tone(988, 0.09, { decay: 10 }), tone(1480, 0.28, { decay: 9 })),
  // Already used or invalid: two low, buzzy pulses.
  'door-denied.wav': concat(
    tone(196, 0.16, { decay: 3, harmonics: [1, 0.5, 0.3] }),
    silence(0.07),
    tone(196, 0.2, { decay: 3, harmonics: [1, 0.5, 0.3] }),
  ),
  // Check the person (expired code, another event, door closed): one middle tone.
  'door-warning.wav': tone(587, 0.3, { decay: 5, harmonics: [1, 0.3] }),
};

mkdirSync(out, { recursive: true });
for (const [name, samples] of Object.entries(sounds)) {
  writeFileSync(new URL(name, out), wav(samples));
  console.log(`${name}: ${((44 + samples.length * 2) / 1024).toFixed(1)} KB`);
}
