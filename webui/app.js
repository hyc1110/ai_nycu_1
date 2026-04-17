'use strict';

/* ═══════════════════════════════════════════════════════════
   MOCK API
   Replace these three functions with real WebSocket / fetch
   calls when the backend is ready.
═══════════════════════════════════════════════════════════ */

function _delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const _BOT_NAMES  = ['Ghost42', 'NightOwl', 'Alpha_99'];
const _BOT_REPLIES = [
  'Makes sense!',
  'Good point — I ran into the same thing.',
  'Interesting approach. How did you handle edge cases?',
  'Yeah that worked for me too.',
  'Thanks for the tip!',
  'Have you checked the docs for that?',
  'I ended up doing something similar.',
];

/** Returns a pre-seeded history of messages (simulates fetching chat log). */
async function fetchMessages() {
  await _delay(350);
  const now = Date.now();
  return [
    { type: 'system',  event: 'user_joined', callsign: 'Ghost42',  timestamp: new Date(now - 600_000).toISOString() },
    { type: 'message', callsign: 'Ghost42',  text: 'Hey everyone! Anyone working on the WebSocket assignment?',                   timestamp: new Date(now - 580_000).toISOString() },
    { type: 'message', callsign: 'NightOwl', text: 'Yeah, just got the Lambda functions deployed. The connect handler was easy.', timestamp: new Date(now - 540_000).toISOString() },
    { type: 'message', callsign: 'Ghost42',  text: 'Nice! I\'m still working on the DynamoDB table. How did you store connection IDs?', timestamp: new Date(now - 480_000).toISOString() },
    { type: 'message', callsign: 'NightOwl', text: 'Simple partition key on connectionId. The scan for broadcast is fine at our scale.', timestamp: new Date(now - 420_000).toISOString() },
    { type: 'system',  event: 'user_left',   callsign: 'Alpha_99', timestamp: new Date(now - 180_000).toISOString() },
  ];
}

/**
 * Simulates sending a message.
 * Calls onIncoming with a random bot reply ~40% of the time.
 * @param {string} callsign
 * @param {string} text
 * @param {function} onIncoming  - called with an incoming ServerMessage when a bot replies
 */
async function sendMessage(callsign, text, onIncoming) {
  await _delay(60);
  if (Math.random() < 0.4) {
    const bot   = _BOT_NAMES[Math.floor(Math.random() * _BOT_NAMES.length)];
    const reply = _BOT_REPLIES[Math.floor(Math.random() * _BOT_REPLIES.length)];
    setTimeout(() => {
      onIncoming({ type: 'message', callsign: bot, text: reply, timestamp: new Date().toISOString() });
    }, 900 + Math.random() * 1400);
  }
}

/* ═══════════════════════════════════════════════════════════
   Validation
═══════════════════════════════════════════════════════════ */

const CALLSIGN_RE = /^[a-zA-Z0-9_]{1,20}$/;

/* ═══════════════════════════════════════════════════════════
   State
═══════════════════════════════════════════════════════════ */

const state = {
  callsign: '',
};

/* ═══════════════════════════════════════════════════════════
   DOM refs
═══════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

const screenJoin      = $('screen-join');
const screenChat      = $('screen-chat');
const callsignInput   = $('callsign-input');
const joinBtn         = $('join-btn');
const joinError       = $('join-error');
const messageList     = $('message-list');
const msgInput        = $('msg-input');
const sendBtn         = $('send-btn');
const statusDot       = $('status-dot');
const statusLabel     = $('status-label');
const myCallsignEl    = $('my-callsign');

/* ═══════════════════════════════════════════════════════════
   Utilities
═══════════════════════════════════════════════════════════ */

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(iso) {
  try {
    return new Date(iso || Date.now())
      .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ''; }
}

function scrollToBottom() {
  messageList.scrollTop = messageList.scrollHeight;
}

/* ═══════════════════════════════════════════════════════════
   Render
═══════════════════════════════════════════════════════════ */

/**
 * @param {{ type: string, event?: string, callsign?: string, text?: string, timestamp?: string }} data
 */
function renderMessage(data) {
  const el = document.createElement('div');
  el.className = 'msg';

  if (data.type === 'system') {
    const join = data.event === 'user_joined';
    el.classList.add('msg--system');
    el.innerHTML =
      `<span class="msg__sys-icon msg__sys-icon--${join ? 'join' : 'leave'}">${join ? '&#8594;' : '&#8592;'}</span>` +
      `<span class="msg__sys-text msg__sys-text--${join ? 'join' : 'leave'}">${esc(data.callsign)} ${join ? 'joined the chat' : 'left the chat'}</span>` +
      `<span class="msg__time">${esc(fmtTime(data.timestamp))}</span>`;

  } else if (data.type === 'message') {
    const own  = data.callsign === state.callsign;
    const time = fmtTime(data.timestamp);
    const name = own ? `${esc(data.callsign)} (you)` : esc(data.callsign);

    if (own) {
      el.classList.add('msg--own');
      el.innerHTML =
        `<div class="msg__header">` +
          `<span class="msg__header-time">${esc(time)}</span>` +
          `<span class="msg__name">${name}</span>` +
        `</div>` +
        `<div class="msg__bubble"><p class="msg__body">${esc(data.text)}</p></div>`;
    } else {
      el.classList.add('msg--other');
      el.innerHTML =
        `<div class="msg__header">` +
          `<span class="msg__name">${name}</span>` +
          `<span class="msg__header-time">${esc(time)}</span>` +
        `</div>` +
        `<p class="msg__body">${esc(data.text)}</p>`;
    }
  } else {
    return;
  }

  messageList.appendChild(el);
  scrollToBottom();
}

/* ═══════════════════════════════════════════════════════════
   Join flow
═══════════════════════════════════════════════════════════ */

async function tryJoin() {
  const callsign = callsignInput.value.trim();

  if (!CALLSIGN_RE.test(callsign)) {
    joinError.textContent = callsign.length === 0
      ? 'Please enter a callsign.'
      : 'Use letters, numbers, or underscores only (max 20 characters).';
    callsignInput.focus();
    return;
  }

  joinError.textContent = '';
  joinBtn.disabled = true;
  joinBtn.textContent = 'Joining\u2026';
  state.callsign = callsign;

  // Transition to chat screen
  screenJoin.classList.remove('is-active');
  screenJoin.hidden = true;
  screenChat.hidden = false;
  screenChat.classList.add('is-active');

  myCallsignEl.textContent  = callsign;
  statusDot.dataset.status  = 'connected';
  statusLabel.dataset.status = 'connected';
  statusLabel.textContent   = 'Connected';

  // Render own join notice
  renderMessage({ type: 'system', event: 'user_joined', callsign, timestamp: new Date().toISOString() });

  // Load message history
  const history = await fetchMessages();
  history.forEach(renderMessage);

  msgInput.focus();
}

/* ═══════════════════════════════════════════════════════════
   Send message
═══════════════════════════════════════════════════════════ */

async function trySend() {
  const text = msgInput.value.trim();
  if (!text) return;

  msgInput.value = '';
  msgInput.focus();

  // Render own message immediately
  renderMessage({ type: 'message', callsign: state.callsign, text, timestamp: new Date().toISOString() });

  // Tell the mock API (passes onIncoming so bot replies can arrive)
  await sendMessage(state.callsign, text, renderMessage);
}

/* ═══════════════════════════════════════════════════════════
   Event listeners
═══════════════════════════════════════════════════════════ */

joinBtn.addEventListener('click', tryJoin);

callsignInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryJoin(); });
callsignInput.addEventListener('input',   ()  => { joinError.textContent = ''; });

sendBtn.addEventListener('click', trySend);

msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); trySend(); }
});

// Keep input visible when soft keyboard opens on mobile
msgInput.addEventListener('focus', () => setTimeout(scrollToBottom, 300));

/* ═══════════════════════════════════════════════════════════
   Init
═══════════════════════════════════════════════════════════ */

callsignInput.focus();
