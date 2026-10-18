// Usage: node examples/upload-file.mjs ./mic-recording.m4a
// API must already be running via `npm start`.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const file = process.argv[2];
if (!file) { console.error('Usage: node examples/upload-file.mjs ./recording.m4a'); process.exit(1); }
const audio = await readFile(file);
const form = new FormData();
form.append('file', new Blob([audio], { type: 'application/octet-stream' }), basename(file));
const response = await fetch(process.env.SHAZAM_NODE_API || 'http://127.0.0.1:8000/recognize/file', {
  method: 'POST',
  headers: process.env.API_KEY ? { 'X-API-Key': process.env.API_KEY } : {},
  body: form,
});
const json = await response.json();
console.log(JSON.stringify({ httpStatus: response.status, ...json }, null, 2));
if (!response.ok) process.exitCode = 1;
