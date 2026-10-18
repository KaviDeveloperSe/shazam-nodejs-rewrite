/**
 * A pure JavaScript SigX signature generator, translated from the bundled
 * MIT-licensed Python sigx.py. 16 kHz mono s16le samples -> Shazam SigX.
 * No Python, numpy, native binaries or reference-song index is needed.
 * Input audio codecs are handled separately via ffmpeg.
 */
import { InputError } from './errors.js';

export const SAMPLE_RATE = 16000;
const N = 2048;
const STEP = 128;
const FFT_BINS = 1025;
const ROWS = 256;
const MAG_FLOOR = 1 / 64;
const HANNING = Float64Array.from({ length: N }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * (i + 1) / 2049)));
const BANDS = [ [250, 520, 0], [520, 1450, 1], [1450, 3500, 2] ];
const OTHER_OFFSETS = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249];
const NEIGH_OFFSETS = [-10, -7, -4, -3, 1, 2, 5, 8];
const PREFIX = 'data:audio/vnd.shazam.sig;base64,';
const rev = new Uint16Array(N);
for (let i = 0; i < N; i++) {
  let x = i, r = 0;
  for (let j = 0; j < 11; j++) { r = (r << 1) | (x & 1); x >>>= 1; }
  rev[i] = r;
}
const cos = new Float64Array(N / 2);
const sin = new Float64Array(N / 2);
for (let i = 0; i < N / 2; i++) {
  cos[i] = Math.cos(2 * Math.PI * i / N);
  sin[i] = Math.sin(2 * Math.PI * i / N);
}

/** Non-normalized forward FFT. Only squared magnitudes of rFFT bins needed. */
function fftPower(input, re, im, power) {
  for (let i = 0; i < N; i++) { re[rev[i]] = input[i] * HANNING[i]; im[rev[i]] = 0; }
  for (let len = 2; len <= N; len *= 2) {
    const half = len >>> 1, step = N / len;
    for (let base = 0; base < N; base += len) {
      for (let j = 0; j < half; j++) {
        const p = base + j, q = p + half, k = j * step;
        const tr = re[q] * cos[k] + im[q] * sin[k];
        const ti = im[q] * cos[k] - re[q] * sin[k];
        const ur = re[p], ui = im[p];
        re[p] = ur + tr; im[p] = ui + ti;
        re[q] = ur - tr; im[q] = ui - ti;
      }
    }
  }
  for (let k = 0; k < FFT_BINS; k++) power[k] = Math.max(1e-10, (re[k] ** 2 + im[k] ** 2) / (1 << 17));
}

const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  crc32Table[i] = crc >>> 0;
}
export function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) crc = crc32Table[(crc ^ buffer[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export class SignatureGenerator {
  constructor({ maxSeconds = 12, maxPeaks = 255 } = {}) {
    this.maxSeconds = maxSeconds;
    this.maxPeaks = maxPeaks;
    this.numberSamples = 0;
    this.peaks = [[], [], []];
    this.ring = new Float64Array(N);
    this.ringPos = 0;
    this.ffts = Array.from({ length: ROWS }, () => new Float64Array(FFT_BINS));
    this.fftPos = 0;
    this.spread = Array.from({ length: ROWS }, () => new Float64Array(FFT_BINS));
    this.spreadPos = 0;
    this.written = 0;
    this.excerpt = new Float64Array(N);
    this.re = new Float64Array(N);
    this.im = new Float64Array(N);
  }
  step(pcm, index) {
    this.numberSamples += STEP;
    for (let k = 0; k < STEP; k++) this.ring[this.ringPos + k] = pcm[index + k];
    this.ringPos = (this.ringPos + STEP) % N;
    for (let k = 0; k < N; k++) this.excerpt[k] = this.ring[(this.ringPos + k) % N];
    fftPower(this.excerpt, this.re, this.im, this.ffts[this.fftPos]);
    this.fftPos = (this.fftPos + 1) % ROWS;
    this.spreadPeaks();
    if (this.written >= 46) this.pickPeaks();
  }
  spreadPeaks() {
    const last = this.ffts[(this.fftPos - 1 + ROWS) % ROWS];
    const i1 = (this.spreadPos - 1 + ROWS) % ROWS;
    const i2 = (this.spreadPos - 3 + ROWS) % ROWS;
    const i3 = (this.spreadPos - 6 + ROWS) % ROWS;
    const r1 = this.spread[i1], r2 = this.spread[i2], r3 = this.spread[i3];
    const current = this.spread[this.spreadPos];
    for (let b = 0; b < FFT_BINS; b++) {
      const s = b < FFT_BINS - 3 ? Math.max(last[b], last[b + 1], last[b + 2]) : last[b];
      const a = r1[b], c = r2[b], d = r3[b];
      r1[b] = Math.max(s, a);
      r2[b] = Math.max(s, a, c);
      r3[b] = Math.max(s, a, c, d);
      current[b] = s;
    }
    this.spreadPos = (this.spreadPos + 1) % ROWS;
    this.written += 1;
  }
  pickPeaks() {
    const fft46 = this.ffts[(this.fftPos - 46 + ROWS) % ROWS];
    const s49 = this.spread[(this.spreadPos - 49 + ROWS) % ROWS];
    const others = OTHER_OFFSETS.map(i => this.spread[(this.spreadPos + i + ROWS) % ROWS]);
    const fftNumber = this.written - 46;
    for (let b = 10; b < 1015; b++) {
      const magnitude = fft46[b];
      if (magnitude < MAG_FLOOR || magnitude < s49[b - 1]) continue;
      let peak = true;
      for (const offset of NEIGH_OFFSETS) if (magnitude <= s49[b + offset]) { peak = false; break; }
      if (!peak) continue;
      for (const row of others) if (magnitude <= row[b - 1]) { peak = false; break; }
      if (!peak) continue;
      const mag = Math.log(Math.max(MAG_FLOOR, magnitude)) * 1477.3 + 6144;
      const before = Math.log(Math.max(MAG_FLOOR, fft46[b - 1])) * 1477.3 + 6144;
      const after = Math.log(Math.max(MAG_FLOOR, fft46[b + 1])) * 1477.3 + 6144;
      const variation = mag * 2 - before - after;
      if (variation <= 0) continue;
      const correctedBin = b * 64 + (after - before) * 32 / variation;
      const frequency = correctedBin * (SAMPLE_RATE / 2 / 1024 / 64);
      for (const [low, high, band] of BANDS) {
        if (low < frequency && frequency < high) {
          this.peaks[band].push([fftNumber, Math.trunc(mag), Math.trunc(correctedBin)]);
          break;
        }
      }
    }
  }
  feed(pcm) {
    if (!(pcm instanceof Int16Array)) throw new InputError('PCM must be Int16Array');
    let used = 0;
    const total = pcm.length - pcm.length % STEP;
    while (used < total && (this.numberSamples / SAMPLE_RATE < this.maxSeconds || this.peakCount() < this.maxPeaks)) {
      this.step(pcm, used);
      used += STEP;
    }
    return used;
  }
  peakCount() { return this.peaks.reduce((total, band) => total + band.length, 0); }
  encode() {
    const chunks = [];
    for (let band = 0; band < this.peaks.length; band++) {
      if (!this.peaks[band].length) continue;
      const parts = [];
      let last = 0;
      for (const [pass, mag, bin] of this.peaks[band]) {
        if (pass - last >= 255) {
          const abs = Buffer.alloc(5);
          abs[0] = 255; abs.writeUInt32LE(pass, 1); parts.push(abs);
          last = pass;
        }
        const peak = Buffer.alloc(5);
        peak[0] = pass - last;
        peak.writeUInt16LE(mag & 0xffff, 1);
        peak.writeUInt16LE(bin & 0xffff, 3);
        parts.push(peak);
        last = pass;
      }
      const raw = Buffer.concat(parts);
      const header = Buffer.alloc(8);
      header.writeUInt32LE(0x60030040 + band, 0);
      header.writeUInt32LE(raw.length, 4);
      chunks.push(header, raw, Buffer.alloc((4 - raw.length % 4) % 4));
    }
    const body = Buffer.concat(chunks);
    const size = body.length + 8;
    const headerRest = Buffer.alloc(40);
    headerRest.writeUInt32LE(size, 0);
    headerRest.writeUInt32LE(0x94119c00, 4);
    headerRest.writeUInt32LE(3 << 27, 20);
    headerRest.writeUInt32LE(Math.trunc(this.numberSamples + SAMPLE_RATE * 0.24), 32);
    headerRest.writeUInt32LE((15 << 19) + 0x40000, 36);
    const tail = Buffer.alloc(8);
    tail.writeUInt32LE(0x40000000, 0); tail.writeUInt32LE(size, 4);
    const rest = Buffer.concat([headerRest, tail, body]);
    const head = Buffer.alloc(8);
    head.writeUInt32LE(0xCAFE2580, 0);
    head.writeUInt32LE(crc32(rest), 4);
    return Buffer.concat([head, rest]);
  }
  signature() { return { uri: PREFIX + this.encode().toString('base64'), sampleMs: Math.trunc(this.numberSamples / SAMPLE_RATE * 1000), peakCount: this.peakCount() }; }
}

export function fingerprintPcm(pcm, { maxSeconds = 12 } = {}) {
  const gen = new SignatureGenerator({ maxSeconds });
  gen.feed(pcm);
  if (gen.numberSamples < 3 * SAMPLE_RATE || gen.peakCount() === 0) throw new InputError('The clip contains too little usable audio to fingerprint (minimum 3 seconds with spectral peaks)');
  return gen.signature();
}
