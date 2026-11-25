// Prediction Lab: dependency-free Node.js live prediction demo.
// No Instagram connection is included.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const PIN = process.env.PERFORMER_PIN;
const minPinLength = process.env.NODE_ENV === 'production' ? 12 : 6;
if (!PIN || PIN.length < minPinLength) {
  console.error(`Set PERFORMER_PIN to a secret of at least ${minPinLength} characters.`);
  process.exit(1);
}

const PUBLIC = path.join(__dirname, 'public');
const clients = new Set();
const authFailures = new Map();
const AUTH_WINDOW_MS = 5 * 60 * 1000;
const AUTH_MAX_FAILURES = 15;
function checkAuthentication(req, res) {
  // Simple protection against repeated guessing (not a substitute for a real login system).
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
  if (!authorized(req)) {
    record.count += 1;
    json(res, 401, { error: 'Invalid PIN' });
    return false;
  }
  authFailures.delete(ip);
  return true;
}
// Opportunistically clear stale rate-limit entries to cap memory use.
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of authFailures) if (now - record.since > AUTH_WINDOW_MS) authFailures.delete(ip);
}, AUTH_WINDOW_MS).unref();
let state = {
  value: null,
  kind: null,
  before: 'Before we started, I predicted: ',
  after: '.',
  updatedAt: null,
  version: 0,
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
function authorized(req) {
  const candidate = req.headers['x-performer-pin'];
  if (typeof candidate !== 'string') return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(PIN).digest();
  return crypto.timingSafeEqual(a, b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10_000) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function notify() {
  const event = `event: prediction\ndata: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) {
    try { client.write(event); } catch { clients.delete(client); }
  }
}
function serveFile(res, filename, type) {
  fs.readFile(path.join(PUBLIC, filename), (err, data) => {
    if (err) return json(res, 404, { error: 'File not found' });
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
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;
  if (route === '/healthz' && req.method === 'GET') return json(res, 200, { ok: true });
  if (route === '/' && req.method === 'GET') { res.writeHead(302, { Location: '/perform' }); res.end(); return; }
  if (files[route] && req.method === 'GET') return serveFile(res, ...files[route]);
  if (route === '/api/state' && req.method === 'GET') return json(res, 200, state);
  if (route === '/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
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
  if (route === '/api/publish' && req.method === 'POST') {
    if (!checkAuthentication(req, res)) return;
    try {
      const data = await readBody(req);
      const value = String(data.value ?? '').trim();
      const kind = String(data.kind ?? 'word');
      const before = String(data.before ?? state.before);
      const after = String(data.after ?? state.after);
      if (!value || value.length > 120) return json(res, 400, { error: 'Prediction must be 1–120 characters' });
      if (!['card', 'number', 'word'].includes(kind)) return json(res, 400, { error: 'Invalid type' });
      if (before.length > 200 || after.length > 200) return json(res, 400, { error: 'Template too long' });
      state = { value, kind, before, after, updatedAt: new Date().toISOString(), version: state.version + 1 };
      notify();
      return json(res, 200, { ok: true, state });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (route === '/api/reset' && req.method === 'POST') {
    if (!checkAuthentication(req, res)) return;
    state = { ...state, value: null, kind: null, updatedAt: new Date().toISOString(), version: state.version + 1 };
    notify();
    return json(res, 200, { ok: true, state });
  }
  json(res, 404, { error: 'Not found' });
});
server.listen(PORT, '0.0.0.0', () => console.log(`Prediction Lab at http://localhost:${PORT}/perform`));
