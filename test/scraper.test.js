import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, SignatureGenerator, fingerprintPcm } from '../src/fingerprint.js';
import { decodePcm, withAudioFile, probeDuration } from '../src/audio.js';
import { parseRecognition } from '../src/parser.js';
import { recognitionWindows, recognizeAudio } from '../src/recognize.js';
import { flightRows, flightText } from '../src/pages.js';
import { createServer } from '../src/server.js';

const BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = n => fs.readFile(path.join(BASE, n));

test('Python and Node fingerprints are byte-for-byte identical', async () => {
  const bytes = await fixture('signal.pcm');
  const pcm = new Int16Array(bytes.byteLength / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readInt16LE(i * 2);
  const generator = new SignatureGenerator();
  generator.feed(pcm);
  const sig = generator.encode();
  assert.equal(generator.peakCount(), 78);
  assert.equal(generator.numberSamples, 160000);
  assert.deepEqual(sig, await fixture('python.sig'));
  assert.equal(sig.readUInt32LE(0), 0xcafe2580);
  assert.equal(crc32(sig.subarray(8)), sig.readUInt32LE(4));
  assert.equal(fingerprintPcm(pcm).sampleMs, 10000);
});

test('original recognition response normalized', async () => {
  const body = JSON.parse((await fixture('recognition-response.json')).toString('utf8'));
  const parsed = parseRecognition(body);
  assert.equal(parsed.is_matched, true);
  assert.equal(parsed.track.shazam_key, '40333609');
  assert.equal(parsed.track.title, 'River Flows In You');
  assert.equal(parsed.matches.length, 3);
  assert.equal(parseRecognition({ matches: [] }).is_matched, false);
});

test('WAV and M4A decode with FFmpeg', async () => {
  for (const ext of ['wav', 'm4a']) {
    const bytes = await fixture('test-signal.' + ext);
    await withAudioFile(bytes, async file => {
      const duration = await probeDuration(file);
      assert.ok(duration > 9.9 && duration < 10.2);
      const pcm = await decodePcm(file);
      assert.ok(pcm.length >= 160000);
      assert.ok(fingerprintPcm(pcm).peakCount > 0);
    });
  }
});

test('no audio and too short PCM fail', () => {
  assert.throws(() => fingerprintPcm(new Int16Array(500)), /little usable audio/);
});

test('fingerprint Shazam windows heuristic', () => {
  assert.deepEqual(recognitionWindows(100, undefined, 12), [44, 0, 12]);
  assert.deepEqual(recognitionWindows(10, undefined, 12), [0]);
  assert.deepEqual(recognitionWindows(50, 20, 12), [20]);
});

test('RSC flight text blob and JSON can be decoded', () => {
  const rows = '0:{"hello":true}\n1:T5,café\n2:{"data":[1,2]}\n';
  const html = `<script>self.__next_f.push([1,${JSON.stringify(rows)}])</script>`;
  assert.equal(flightText(html), rows);
  assert.deepEqual(flightRows(html), { '0': { hello: true }, '1': 'café', '2': { data: [1, 2] } });
});

test('local recognition workflow parses a mocked upstream Shazam response', async () => {
  const originalFetch = globalThis.fetch;
  const body = JSON.parse((await fixture('recognition-response.json')).toString('utf8'));
  let called = 0;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /amp\.shazam\.com\/discovery\/v5\/en\/US\/iphone\/\-\/tag\//);
    const requestBody = JSON.parse(init.body);
    assert.ok(requestBody.signature.uri.startsWith('data:audio/vnd.shazam.sig;base64,'));
    assert.equal(requestBody.signature.samplems, 10000);
    called++;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await recognizeAudio(await fixture('test-signal.wav'), { source: 'test.wav' });
    assert.equal(called, 1);
    assert.equal(result.is_matched, true);
    assert.equal(result.track.title, 'River Flows In You');
    assert.equal(result.attempts.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

function request(port, route, body, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers }, res => {
      const parts = [];
      res.on('data', chunk => parts.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(parts).toString('utf8')) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('REST health, invalid options, and real multipart upload with mocked upstream', async () => {
  const originalFetch = globalThis.fetch;
  const result = JSON.parse((await fixture('recognition-response.json')).toString('utf8'));
  globalThis.fetch = async () => new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const health = await request(port, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.backend, 'nodejs');
    assert.ok(health.json.endpoints.includes('POST /recognize/file'));
    const bad = await request(port, '/songs/details');
    assert.equal(bad.status, 400);
    const bytes = await fixture('test-signal.wav');
    const boundary = '----test-boundary-1234';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="mic.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await request(port, '/recognize/file', payload, { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': payload.length }, 'POST');
    assert.equal(upload.status, 200);
    assert.equal(upload.json.is_matched, true);
    assert.equal(upload.json.source, 'mic.wav');
    assert.equal(upload.json.track.shazam_key, '40333609');
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
  }
});

test('track page fixture: lyrics, AI audio analysis and popularity heatmap', async () => {
  const { parseLyrics, parseAudioAnalysis, parsePopularSegments } = await import('../src/pages.js');
  const sample = JSON.parse((await fixture('sample-page-extract.json')).toString('utf8'));
  assert.equal(sample.song.attributes.title, 'i like the way you kiss me');
  const lyrics = parseLyrics(sample.lyrics);
  assert.equal(lyrics.line_count, 42);
  assert.equal(lyrics.is_time_synced, true);
  assert.ok(lyrics.text.includes('I like the way you kiss me'));
  assert.equal(parseAudioAnalysis(sample.analysis).bpm, 151);
  const popular = parsePopularSegments(sample.segments);
  assert.equal(popular.period, 'past_7_days');
  assert.equal(popular.segments.length, 15);
  assert.ok(popular.most_popular.shazam_count > 0);
});

test('chart fixture has a populated country/genre/playlist catalog', async () => {
  const body = JSON.parse((await fixture('sample-charts.json')).toString('utf8'));
  assert.equal(body.count, 71);
  assert.ok(body.first.listid);
  assert.ok(Array.isArray(body.first.genres));
});

test('API handles missing multipart file, disallowed upload body and missing URL option', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const missing = await request(port, '/recognize/file', Buffer.from('hello'), { 'content-type': 'text/plain' }, 'POST');
    assert.equal(missing.status, 400);
    const unsupported = await request(port, '/recognize/url?url=https%3A%2F%2Fexample.com%2Fsong.mp3');
    assert.equal(unsupported.status, 400);
    assert.match(unsupported.json.error, /disabled/i);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
