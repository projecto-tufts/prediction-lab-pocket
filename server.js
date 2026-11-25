// Prediction Lab: pocket input, public reveal, and optional private Instagram bridge.
// The Instagram worker runs on your own machine; login credentials never reach this server.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const PIN = process.env.PERFORMER_PIN;
const BRIDGE_KEY = process.env.INSTAGRAM_BRIDGE_KEY || '';
const production = process.env.NODE_ENV === 'production';
if (!PIN || PIN.length < (production ? 12 : 6)) {
  console.error(`Set PERFORMER_PIN to at least ${production ? 12 : 6} characters.`);
  process.exit(1);
}
if (BRIDGE_KEY && BRIDGE_KEY.length < 24) {
  console.error('INSTAGRAM_BRIDGE_KEY must be at least 24 characters (or be omitted).');
  process.exit(1);
}
if (BRIDGE_KEY && BRIDGE_KEY === PIN) {
  console.error('INSTAGRAM_BRIDGE_KEY must be different from PERFORMER_PIN.');
  process.exit(1);
}
const PUBLIC = path.join(__dirname, 'public');
const clients = new Set();
const authFailures = new Map();
const AUTH_WINDOW_MS = 5 * 60 * 1000;
const AUTH_MAX_FAILURES = 15;
let state = {
  value: null, kind: null,
  before: 'Before we started, I predicted: ', after: '.',
  updatedAt: null, version: 0,
};
let job = null;
let lastBridgePoll = 0;
let instagram = {
  status: BRIDGE_KEY ? 'idle' : 'disabled',
  message: BRIDGE_KEY ? 'Waiting for a prediction.' : 'Set up the Instagram bridge to enable bio updates.',
  updatedAt: null, jobId: null,
};

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
function secretMatches(candidate, target) {
  if (!target || typeof candidate !== 'string') return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(target).digest();
  return crypto.timingSafeEqual(a, b);
}
function checkAuthentication(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let record = authFailures.get(ip);
  if (!record || now - record.since > AUTH_WINDOW_MS) {
    record = { since: now, count: 0 };
    authFailures.set(ip, record);
  }
  if (record.count >= AUTH_MAX_FAILURES) {
    json(res, 429, { error: 'Too many failed PIN attempts. Try later.' });
    return false;
  }
  if (!secretMatches(req.headers['x-performer-pin'], PIN)) {
    record.count++;
    json(res, 401, { error: 'Invalid PIN' });
    return false;
  }
  authFailures.delete(ip);
  return true;
}
function checkBridge(req, res) {
  if (!BRIDGE_KEY) { json(res, 503, { error: 'Instagram bridge is disabled.' }); return false; }
  if (!secretMatches(req.headers['x-instagram-bridge-key'], BRIDGE_KEY)) {
    json(res, 401, { error: 'Bridge authentication failed.' });
    return false;
  }
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of authFailures) if (now - record.since > AUTH_WINDOW_MS) authFailures.delete(ip);
}, AUTH_WINDOW_MS).unref();
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10000 && !tooLarge) { tooLarge = true; reject(new Error('Request too large')); }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function bridgeStatus() {
  return {
    enabled: Boolean(BRIDGE_KEY),
    workerOnline: Boolean(BRIDGE_KEY) && Date.now() - lastBridgePoll < 15000,
    ...instagram,
  };
}
function emit(kind, data) {
  const event = `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.write(event); } catch { clients.delete(client); }
  }
}
function notify() { emit('prediction', state); emit('instagram', bridgeStatus()); }
function setInstagramStatus(status, message, id) {
  instagram = { status, message, jobId: id || null, updatedAt: new Date().toISOString() };
  emit('instagram', bridgeStatus());
}
function serveFile(res, filename, type) {
  fs.readFile(path.join(PUBLIC, filename), (err, data) => {
    if (err) return json(res, 404, { error: 'File not found; verify the public/ directory was deployed.' });
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(data);
  });
}
const files = {
  '/perform': ['perform.html', 'text/html; charset=utf-8'],
  '/pocket': ['pocket.html', 'text/html; charset=utf-8'],
  '/pocket.js': ['pocket.js', 'text/javascript; charset=utf-8'],
  '/pocket-engine.js': ['pocket-engine.js', 'text/javascript; charset=utf-8'],
  '/reveal': ['reveal.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/perform.js': ['perform.js', 'text/javascript; charset=utf-8'],
  '/reveal.js': ['reveal.js', 'text/javascript; charset=utf-8'],
};

const server = http.createServer(async (req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  if (route === '/healthz' && req.method === 'GET') return json(res, 200, { ok: true, bridgeConfigured: Boolean(BRIDGE_KEY) });
  if (route === '/' && req.method === 'GET') { res.writeHead(302, { Location: '/perform' }); res.end(); return; }
  if (files[route] && req.method === 'GET') return serveFile(res, ...files[route]);
  if (route === '/api/state' && req.method === 'GET') return json(res, 200, state);
  if (route === '/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 1000\nevent: prediction\ndata: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch {} }, 20000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (route === '/api/verify' && req.method === 'POST') {
    if (!checkAuthentication(req, res)) return;
    return json(res, 200, { ok: true });
  }
  if (route === '/api/instagram/status' && req.method === 'POST') {
    if (!checkAuthentication(req, res)) return;
    return json(res, 200, bridgeStatus());
  }
  if (route === '/api/instagram/job' && req.method === 'GET') {
    if (!checkBridge(req, res)) return;
    lastBridgePoll = Date.now();
    // Only the newest unresolved prediction is available to the worker.
    return json(res, 200, { job, status: instagram.status });
  }
  if (route === '/api/instagram/report' && req.method === 'POST') {
    if (!checkBridge(req, res)) return;
    lastBridgePoll = Date.now();
    try {
      const report = await readBody(req);
      if (!job || report.jobId !== job.id) return json(res, 409, { error: 'Stale or unknown job.' });
      const status = String(report.status || '');
      if (!['working', 'confirmed_in_editor', 'verified_public', 'saved_unverified', 'login_required', 'failed'].includes(status))
        return json(res, 400, { error: 'Invalid status.' });
      const message = String(report.message || '').slice(0, 350);
      setInstagramStatus(status, message || status.replaceAll('_', ' '), job.id);
      if (status !== 'working') job = null;
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (route === '/api/publish' && req.method === 'POST') {
    if (!checkAuthentication(req, res)) return;
    try {
      const data = await readBody(req);
      const value = String(data.value ?? '').trim();
      const kind = String(data.kind ?? 'word');
      const before = String(data.before ?? state.before);
      const after = String(data.after ?? state.after);
      if (!value || value.length > 120) return json(res, 400, { error: 'Prediction must be 1–120 characters.' });
      if (!['card','number','word'].includes(kind)) return json(res, 400, { error: 'Invalid type.' });
      if (before.length > 200 || after.length > 200) return json(res, 400, { error: 'Template too long.' });
      const text = `${before}${value}${after}`;
      if (BRIDGE_KEY && Array.from(text).length > 150)
        return json(res, 400, { error: 'Instagram bios have a 150-character limit. Shorten the prediction template.' });
      state = { value, kind, before, after, updatedAt: new Date().toISOString(), version: state.version + 1 };
      if (BRIDGE_KEY) {
        job = { id: crypto.randomUUID(), version: state.version, bio: text, createdAt: state.updatedAt };
        setInstagramStatus('queued', 'Prediction queued for the local Instagram worker.', job.id);
      } else {
        job = null;
        setInstagramStatus('disabled', 'Instagram bridge is not configured on Render. The reveal page was updated.');
      }
      notify();
      return json(res, 200, { ok: true, state, instagram: bridgeStatus() });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (route === '/api/reset' && req.method === 'POST') {
    if (!checkAuthentication(req, res)) return;
    state = { ...state, value: null, kind: null, updatedAt: new Date().toISOString(), version: state.version + 1 };
    job = null;
    setInstagramStatus(BRIDGE_KEY ? 'idle' : 'disabled',
      'Local prediction cleared. This does not restore or erase the Instagram bio.');
    notify();
    return json(res, 200, { ok: true, state });
  }
  return json(res, 404, { error: 'Not found' });
});
server.listen(PORT, '0.0.0.0', () => console.log(`Prediction Lab at http://localhost:${PORT}/perform`));
