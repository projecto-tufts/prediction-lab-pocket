
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const PIN = process.env.PERFORMER_PIN || '';
const KEY = process.env.INSTAGRAM_BRIDGE_KEY || '';

if (PIN.length < (process.env.NODE_ENV === 'production' ? 12 : 6)) {
  throw Error('Set PERFORMER_PIN (12+ characters in production).');
}
if (KEY && (KEY.length < 24 || KEY === PIN)) {
  throw Error('Set a distinct INSTAGRAM_BRIDGE_KEY of 24+ characters.');
}

let prediction = {
  value: null,
  kind: null,
  before: 'Before we started, I predicted: ',
  after: '.',
  updatedAt: null,
  version: 0
};

let job = null;
let lastPoll = 0;

let instagram = {
  status: KEY ? 'idle' : 'disabled',
  message: 'Waiting for a prediction.',
  updatedAt: null,
  jobId: null
};

const listeners = new Set();
const failed = new Map();

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function secureEquals(a, b) {
  if (!b || typeof a !== 'string') return false;
  const hash = value =>
    crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

function auth(req, res, bridge = false) {
  if (bridge) {
    if (!KEY) {
      json(res, 503, { error: 'Instagram bridge disabled' });
      return false;
    }
    if (!secureEquals(req.headers['x-instagram-bridge-key'], KEY)) {
      json(res, 401, { error: 'Invalid Instagram bridge key' });
      return false;
    }
    return true;
  }

  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = failed.get(ip) || { count: 0, since: now };

  if (now - entry.since > 300000)
    entry = { count: 0, since: now };

  if (entry.count >= 15) {
    json(res, 429, { error: 'Too many attempts. Try again in 5 minutes.' });
    return false;
  }

  if (!secureEquals(req.headers['x-performer-pin'], PIN)) {
    entry.count++;
    failed.set(ip, entry);
    json(res, 401, { error: 'Wrong performer PIN' });
    return false;
  }

  failed.delete(ip);
  return true;
}

async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 10000) throw Error('Request too large');
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw Error('Invalid JSON');
  }
}

function bridgeStatus() {
  return {
    enabled: !!KEY,
    workerOnline: !!KEY && Date.now() - lastPoll < 15000,
    ...instagram
  };
}

function broadcast(type, data) {
  const event =
    'event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n';

  for (const res of listeners) {
    try {
      res.write(event);
    } catch {
      listeners.delete(res);
    }
  }
}

function setStatus(status, message, jobId = null) {
  instagram = {
    status,
    message,
    jobId,
    updatedAt: new Date().toISOString()
  };
  broadcast('instagram', bridgeStatus());
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#101217;color:#f4f4f7;
font:16px system-ui,-apple-system,sans-serif}
main{max-width:650px;margin:35px auto;padding:18px}
h1{font-size:30px;line-height:1.2}
p{color:#c6c8d0;line-height:1.5}
section{border:1px solid #393d48;background:#191d27;
border-radius:16px;padding:20px;margin:14px 0}
label{display:block;margin:13px 0 5px;color:#c7cbd5;font-size:14px}
input,select{width:100%;padding:12px;background:#11151e;
color:white;border:1px solid #555d70;border-radius:9px;font-size:16px}
button,.button{display:inline-block;background:#b5ed88;border:0;
border-radius:10px;color:#152112;font-weight:750;
padding:12px 18px;margin:8px 7px 0 0;cursor:pointer;
text-decoration:none;font-size:15px}
button.secondary,.button.secondary{background:#323a49;color:#f1f1f5}
small,.muted{color:#9ca3b4}
#status,#bridgeStatus{overflow-wrap:anywhere;min-height:20px}
a{color:#b5ed88}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
#tap{position:fixed;inset:0;display:flex;flex-direction:column;
align-items:center;justify-content:space-between;
padding:48px 20px 32px;touch-action:none;user-select:none;
-webkit-user-select:none;background:#131a21;
overscroll-behavior:none;text-align:center}
#tap h1{font-size:min(12vw,64px);margin:0}
#tap strong{font-size:25px}
#tap p{font-size:15px;max-width:370px}
#tap[hidden]{display:none}
#tap .large{font-size:70px;font-weight:850;color:#b5ed88}
#prediction{font-size:clamp(26px,6vw,40px);font-weight:700;
white-space:pre-wrap;overflow-wrap:anywhere}
#revealMain{margin-top:14vh}
`;

function page(title, content, script = '') {
  return '<!doctype html><html lang="en"><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title><style>' + CSS + '</style>' +
    '</head><body>' + content +
    (script ? '<script>' + script + '</script>' : '') +
    '</body></html>';
}

const PERFORM = page('Prediction Lab - Performer', `
<main>
<h1>Prediction Lab - Performer</h1>
<p>Secret controls. Keep this page away from spectators.</p>

<section>
<label>Performer PIN</label>
<input id="pin" type="password" autocomplete="off">
</section>

<section>
<h2>Playing card</h2>
<div class="pair">
<div>
<label>Suit</label>
<select id="suit">
<option>Clubs</option><option>Diamonds</option>
<option>Hearts</option><option>Spades</option>
</select>
</div>
<div>
<label>Rank</label>
<select id="rank">
<option>A</option><option>2</option><option>3</option>
<option>4</option><option>5</option><option>6</option>
<option>7</option><option>8</option><option>9</option>
<option>10</option><option>J</option><option>Q</option>
<option>K</option>
</select>
</div>
</div>
<button id="card">Publish card</button>
</section>

<section>
<h2>Number / word</h2>
<label>Prediction value</label>
<input id="value" placeholder="Number or phrase">
<button id="other">Publish value</button>
</section>

<section>
<h2>Prediction text</h2>
<label>Before</label>
<input id="before" value="Before we started, I predicted: ">
<label>After</label>
<input id="after" value=".">
<small>Instagram bios have a 150-character limit.</small>
</section>

<section>
<button class="secondary" id="check">Check Instagram connection</button>
<button class="secondary" id="reset">Clear local prediction</button>
<p id="status">Ready.</p>
<p id="bridgeStatus"></p>
</section>

<a class="button secondary" href="/pocket">Pocket Mode</a>
<a class="button secondary" href="/reveal" target="_blank">Reveal</a>
</main>
`, `
const $ = id => document.getElementById(id);

async function request(route, payload) {
  const r = await fetch(route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Performer-Pin': $('pin').value
    },
    body: JSON.stringify(payload || {})
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || 'Request failed');
  return data;
}

function status(s) {
  $('status').textContent = s;
}

async function publish(kind, value) {
  try {
    const r = await request('/api/publish', {
      kind,
      value,
      before: $('before').value,
      after: $('after').value
    });
    status('Published: ' + r.state.value);
    check();
  } catch (e) {
    status('Error: ' + e.message);
  }
}

$('card').onclick = () =>
  publish('card', $('rank').value + ' of ' + $('suit').value);

$('other').onclick = () =>
  publish('word', $('value').value.trim());

async function check() {
  try {
    const s = await request('/api/instagram/status');
    $('bridgeStatus').textContent =
      'Instagram: ' + s.status + ' - ' +
      (s.workerOnline ? 'Worker online' : 'Worker offline') +
      ' - ' + s.message;
  } catch (e) {
    $('bridgeStatus').textContent = e.message;
  }
}

$('check').onclick = check;

$('reset').onclick = async () => {
  try {
    await request('/api/reset');
    status('Local prediction cleared. Instagram bio unchanged.');
  } catch (e) {
    status(e.message);
  }
};

fetch('/api/state')
  .then(r => r.json())
  .then(s => {
    $('before').value = s.before;
    $('after').value = s.after;
  });

setInterval(() => {
  if ($('pin').value) check();
}, 5000);
`);

const POCKET = page('Prediction Lab - Pocket', `
<main id="setup">
<h1>Pocket Mode</h1>
<p>Suit: 1-4 taps (Clubs, Diamonds, Hearts, Spades).
Pause, then rank: 1-13 taps (Ace through King).
Pause again to publish.</p>

<section>
<label>Performer PIN</label>
<input id="pin" type="password" autocomplete="off">
<button id="start">Enter Pocket Mode</button>
<p id="setupStatus"></p>
</section>

<p>Hold 1.5 seconds to arm.
Hold 2.5 seconds to undo.
Keep your phone awake and unlocked.</p>
<a href="/perform">Manual controls</a>
</main>

<div id="tap" hidden>
<div>
<strong>POCKET MODE</strong>
<p id="phase">Ready</p>
</div>
<div>
<div id="number" class="large">--</div>
<h1 id="prompt">Ready</h1>
<p id="detail">Hold 1.5 seconds to arm</p>
</div>
<p>Hold 1.5s to arm / Hold 2.5s to undo</p>
</div>
`, `
const $ = id => document.getElementById(id);

let pin = '';
let armed = false;
let phase = 'idle';
let count = 0;
let suit = '';
let hold = null;
let pause = null;
let held = false;
let started = 0;
let busy = false;

const suits = ['Clubs','Diamonds','Hearts','Spades'];
const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function view(prompt, detail) {
  $('phase').textContent = phase.toUpperCase();
  $('prompt').textContent = prompt;
  $('detail').textContent = detail;
  $('number').textContent = armed ? String(count) : '--';
}

function cancelTimer() {
  if (pause) {
    clearTimeout(pause);
    pause = null;
  }
}

function reset() {
  cancelTimer();
  armed = true;
  phase = 'suit';
  count = 0;
  suit = '';
  busy = false;
  view('Suit', 'Tap 1-4 times, then pause');
}

function disarm(msg) {
  cancelTimer();
  armed = false;
  phase = 'idle';
  count = 0;
  suit = '';
  busy = false;
  view(msg, 'Hold 1.5 seconds to arm again');
}

$('start').onclick = async () => {
  pin = $('pin').value;
  try {
    const r = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'X-Performer-Pin': pin }
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    $('setup').hidden = true;
    $('tap').hidden = false;
    view('Ready', 'Hold 1.5 seconds to arm');
  } catch (e) {
    $('setupStatus').textContent = e.message;
  }
};

async function publish() {
  if (busy) return;
  busy = true;
  phase = 'sending';

  const card = ranks[count - 1] + ' of ' + suit;
  view('Sending...', card);

  try {
    const r = await fetch('/api/publish', {
      method: 'POST',
      headers: {
        'X-Performer-Pin': pin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ kind: 'card', value: card })
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || 'Publish failed');
    disarm('Published ' + card);
  } catch (e) {
    disarm('Error: ' + e.message);
  }
}

function tap() {
  if (!armed || busy) return;
  count++;

  if (phase === 'suit' && count > 4) {
    reset();
    view('Too many suit taps', 'Restart suit input');
    return;
  }
  if (phase === 'rank' && count > 13) {
    reset();
    view('Too many rank taps', 'Restart suit input');
    return;
  }

  view(
    phase === 'suit' ? 'Suit taps: ' + count : 'Rank taps: ' + count,
    'Pause to confirm'
  );

  cancelTimer();
  pause = setTimeout(() => {
    pause = null;
    if (phase === 'suit') {
      suit = suits[count - 1];
      phase = 'rank';
      count = 0;
      view('Rank', 'Tap 1-13 times, then pause');
    } else if (phase === 'rank') {
      publish();
    }
  }, 950);
}

const pad = $('tap');

pad.addEventListener('contextmenu', e => e.preventDefault());

pad.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (busy) return;

  cancelTimer();
  started = Date.now();
  held = false;

  try {
    pad.setPointerCapture(e.pointerId);
  } catch {}

  hold = setTimeout(() => {
    held = true;
    if (!armed) {
      reset();
      view('Armed', 'Enter suit taps');
    } else {
      reset();
      view('Undone', 'Start suit taps again');
    }
  }, armed ? 2500 : 1500);
});

pad.addEventListener('pointerup', e => {
  e.preventDefault();
  clearTimeout(hold);
  hold = null;

  const duration = Date.now() - started;
  if (!held && duration < 1200) tap();
});

pad.addEventListener('pointercancel', () => {
  clearTimeout(hold);
  hold = null;
});
`);

const REVEAL = page('Prediction Lab - Reveal', `
<main id="revealMain">
<section>
<p class="muted">PREDICTION</p>
<h1>Before you made your choice...</h1>
<div id="prediction">Waiting for a prediction</div>
<p id="when"></p>
</section>
</main>
`, `
function show(s) {
  document.getElementById('prediction').textContent =
    s.value === null
      ? 'Waiting for a prediction'
      : s.before + s.value + s.after;

  document.getElementById('when').textContent =
    s.updatedAt ? 'Updated ' + new Date(s.updatedAt).toLocaleString() : '';
}

fetch('/api/state').then(r => r.json()).then(show);

const events = new EventSource('/events');
events.addEventListener('prediction', e => {
  try { show(JSON.parse(e.data)); } catch {}
});

setInterval(() => {
  fetch('/api/state').then(r => r.json()).then(show).catch(() => {});
}, 10000);
`);

function serve(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(html);
}

http.createServer(async (req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;

  if (req.method === 'GET' && route === '/') {
    res.writeHead(302, { Location: '/perform' });
    return res.end();
  }

  if (req.method === 'GET' && route === '/perform')
    return serve(res, PERFORM);

  if (req.method === 'GET' && route === '/pocket')
    return serve(res, POCKET);

  if (req.method === 'GET' && route === '/reveal')
    return serve(res, REVEAL);

  if (req.method === 'GET' && route === '/healthz')
    return json(res, 200, {
      ok: true,
      bridgeConfigured: !!KEY
    });

  if (req.method === 'GET' && route === '/api/state')
    return json(res, 200, prediction);

  if (req.method === 'GET' && route === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    res.write(
      'retry: 1000\nevent: prediction\ndata: ' +
      JSON.stringify(prediction) + '\n\n'
    );

    listeners.add(res);

    const timer = setInterval(() => {
      try { res.write(': ping\n\n'); } catch {}
    }, 20000);

    req.on('close', () => {
      clearInterval(timer);
      listeners.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && route === '/api/verify') {
    if (!auth(req, res)) return;
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && route === '/api/instagram/status') {
    if (!auth(req, res)) return;
    return json(res, 200, bridgeStatus());
  }

  if (req.method === 'GET' && route === '/api/instagram/job') {
    if (!auth(req, res, true)) return;
    lastPoll = Date.now();
    return json(res, 200, {
      job,
      status: instagram.status
    });
  }

  if (req.method === 'POST' && route === '/api/instagram/report') {
    if (!auth(req, res, true)) return;
    lastPoll = Date.now();

    try {
      const data = await body(req);

      if (!job || data.jobId !== job.id)
        return json(res, 409, { error: 'Stale or unknown job' });

      const validStatuses = [
        'working',
        'confirmed_in_editor',
        'verified_public',
        'saved_unverified',
        'login_required',
        'failed'
      ];

      if (!validStatuses.includes(data.status))
        return json(res, 400, { error: 'Invalid status' });

      setStatus(
        data.status,
        String(data.message || data.status).slice(0, 350),
        job.id
      );

      if (data.status !== 'working') job = null;

      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method === 'POST' && route === '/api/publish') {
    if (!auth(req, res)) return;

    try {
      const data = await body(req);

      const value = String(data.value ?? '').trim();
      const kind = String(data.kind || 'word');
      const before = String(data.before ?? prediction.before);
      const after = String(data.after ?? prediction.after);

      if (!value || value.length > 120)
        return json(res, 400, {
          error: 'Prediction must be 1-120 characters'
        });

      if (!['card', 'number', 'word'].includes(kind))
        return json(res, 400, {
          error: 'Invalid prediction type'
        });

      if (before.length > 200 || after.length > 200)
        return json(res, 400, { error: 'Template too long' });

      const bio = before + value + after;

      if (KEY && Array.from(bio).length > 150)
        return json(res, 400, {
          error: 'Instagram bio exceeds 150 characters'
        });

      prediction = {
        value,
        kind,
        before,
        after,
        version: prediction.version + 1,
        updatedAt: new Date().toISOString()
      };

      if (KEY) {
        job = {
          id: crypto.randomUUID(),
          version: prediction.version,
          bio,
          createdAt: prediction.updatedAt
        };

        setStatus(
          'queued',
          'Waiting for local Instagram worker',
          job.id
        );
      } else {
        job = null;
        setStatus(
          'disabled',
          'Render has no Instagram Bridge key'
        );
      }

      broadcast('prediction', prediction);

      return json(res, 200, {
        ok: true,
        state: prediction,
        instagram: bridgeStatus()
      });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method === 'POST' && route === '/api/reset') {
    if (!auth(req, res)) return;

    prediction = {
      ...prediction,
      value: null,
      kind: null,
      version: prediction.version + 1,
      updatedAt: new Date().toISOString()
    };

    job = null;

    setStatus(
      KEY ? 'idle' : 'disabled',
      'Local prediction cleared; Instagram bio unchanged'
    );

    broadcast('prediction', prediction);

    return json(res, 200, {
      ok: true,
      state: prediction
    });
  }

  return json(res, 404, { error: 'Not found' });
}).listen(PORT, '0.0.0.0', () => {
  console.log('Prediction Lab ready on port ' + PORT);
});
