'use strict';

// Set your WebSocket endpoint here, or override via the query string ?endpoint=wss://...
const WS_ENDPOINT =
  new URLSearchParams(location.search).get('endpoint') ||
  'wss://default.execute-api.us-west-2.amazonaws.com/prod';

const CALLSIGN_RE = /^[a-zA-Z0-9_]{1,20}$/;
// Reconnect delays in ms: 2s, 4s, 8s, 16s, 30s (capped)
const RECONNECT_DELAYS = [2000, 4000, 8000, 16000, 30000];
const JOIN_TIMEOUT_MS = 8000;

// ===== State =====
const state = {
  callsign: '',
  ws: null,
  intentionalClose: false,
  reconnectAttempts: 0,
  reconnectTimer: null,
  inChat: false,
};

// ===== DOM =====
const $ = (id) => document.getElementById(id);

const joinScreen        = $('join-screen');
const chatScreen        = $('chat-screen');
const callsignInput     = $('callsign-input');
const joinBtn           = $('join-btn');
const joinError         = $('join-error');
const messageList       = $('message-list');
const messageInput      = $('message-input');
const sendBtn           = $('send-btn');
const statusDot         = $('status-dot');
const statusText        = $('status-text');
const callsignDisplay   = $('callsign-display');
const reconnectBanner   = $('reconnect-banner');
const manualReconnectBtn = $('manual-reconnect-btn');

// ===== Helpers =====

function formatTime(iso) {
  try {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scrollToBottom() {
  messageList.scrollTop = messageList.scrollHeight;
}

// ===== Status indicator =====

function setStatus(status, label) {
  const labels = {
    connecting:   'Connecting\u2026',
    connected:    'Connected',
    disconnected: 'Disconnected',
    reconnecting: 'Reconnecting\u2026',
  };
  const text = label || labels[status] || status;
  statusDot.dataset.status  = status;
  statusText.dataset.status = status;
  statusText.textContent    = text;
}

// ===== Render messages =====

function renderMessage(data) {
  const el = document.createElement('div');
  el.className = 'msg';

  if (data.type === 'system') {
    const join = data.event === 'user_joined';
    const cls  = join ? 'join' : 'leave';
    const icon = join ? '&#8594;' : '&#8592;';
    const verb = join ? 'joined the chat' : 'left the chat';
    const time = formatTime(data.timestamp);
    el.classList.add('msg-system');
    el.innerHTML =
      `<span class="msg-sys-icon ${cls}">${icon}</span>` +
      `<span class="msg-sys-text ${cls}">${esc(data.callsign)} ${verb}</span>` +
      `<span class="msg-time">${esc(time)}</span>`;

  } else if (data.type === 'message') {
    const own  = data.callsign === state.callsign;
    const time = formatTime(data.timestamp);
    const name = own ? `${esc(data.callsign)} (you)` : esc(data.callsign);

    if (own) {
      el.classList.add('msg-own');
      el.innerHTML =
        `<div class="msg-header">` +
          `<span class="msg-header-time">${esc(time)}</span>` +
          `<span class="msg-name">${name}</span>` +
        `</div>` +
        `<div class="msg-bubble"><p class="msg-body">${esc(data.text)}</p></div>`;
    } else {
      el.classList.add('msg-other');
      el.innerHTML =
        `<div class="msg-header">` +
          `<span class="msg-name">${name}</span>` +
          `<span class="msg-header-time">${esc(time)}</span>` +
        `</div>` +
        `<p class="msg-body">${esc(data.text)}</p>`;
    }
  } else {
    return; // unknown type
  }

  messageList.appendChild(el);
  scrollToBottom();
}

function appendNotice(text, type = 'info') {
  const el = document.createElement('div');
  el.className = 'msg msg-system';
  el.innerHTML =
    `<span class="msg-sys-icon ${type}">&#8635;</span>` +
    `<span class="msg-sys-text ${type}">${esc(text)}</span>`;
  messageList.appendChild(el);
  scrollToBottom();
}

// ===== WebSocket handlers =====

function attachChatHandlers(ws) {
  ws.onmessage = (ev) => {
    try { renderMessage(JSON.parse(ev.data)); } catch { /* ignore */ }
  };

  ws.onclose = () => {
    if (state.intentionalClose) return;
    setStatus('disconnected');
    messageInput.disabled = true;
    sendBtn.disabled = true;
    scheduleReconnect();
  };

  ws.onerror = () => { /* onclose will fire */ };
}

function scheduleReconnect() {
  if (state.reconnectAttempts >= RECONNECT_DELAYS.length) {
    reconnectBanner.hidden = false;
    return;
  }
  setStatus('reconnecting');
  const delay = RECONNECT_DELAYS[state.reconnectAttempts++];
  state.reconnectTimer = setTimeout(reconnect, delay);
}

function reconnect() {
  if (state.ws &&
      (state.ws.readyState === WebSocket.OPEN ||
       state.ws.readyState === WebSocket.CONNECTING)) return;

  setStatus('connecting');
  const ws = new WebSocket(`${WS_ENDPOINT}?callsign=${encodeURIComponent(state.callsign)}`);
  state.ws = ws;
  state.intentionalClose = false;

  ws.onopen = () => {
    setStatus('connected');
    state.reconnectAttempts = 0;
    reconnectBanner.hidden = true;
    messageInput.disabled = false;
    sendBtn.disabled = false;
    appendNotice('Reconnected');
    attachChatHandlers(ws);
  };

  ws.onclose = () => {
    if (state.intentionalClose) return;
    setStatus('disconnected');
    scheduleReconnect();
  };

  ws.onerror = () => {};
}

// ===== Join flow =====

function tryJoin() {
  const callsign = callsignInput.value.trim();

  if (!CALLSIGN_RE.test(callsign)) {
    joinError.textContent = callsign.length === 0
      ? 'Please enter a callsign.'
      : 'Invalid callsign. Use letters, numbers, or underscores (max 20 characters).';
    callsignInput.focus();
    return;
  }

  joinError.textContent = '';
  joinBtn.disabled = true;
  joinBtn.textContent = 'Connecting\u2026';
  state.callsign = callsign;

  const ws = new WebSocket(`${WS_ENDPOINT}?callsign=${encodeURIComponent(callsign)}`);
  state.ws = ws;
  state.intentionalClose = false;
  let settled = false;

  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    state.intentionalClose = true;
    ws.close();
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join Chat';
    joinError.textContent = 'Connection timed out. Please try again.';
  }, JOIN_TIMEOUT_MS);

  ws.onopen = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    setStatus('connected');
    state.reconnectAttempts = 0;
    state.inChat = true;

    // Transition to chat screen
    joinScreen.classList.remove('active');
    joinScreen.hidden = true;
    chatScreen.hidden = false;
    chatScreen.classList.add('active');
    callsignDisplay.textContent = callsign;
    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.focus();

    attachChatHandlers(ws);
  };

  ws.onclose = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join Chat';
    joinError.textContent = 'Connection failed. Please try again.';
  };

  ws.onerror = () => {};

  // Also wire up onmessage early so messages arriving right after connect are captured
  ws.onmessage = (ev) => {
    try { renderMessage(JSON.parse(ev.data)); } catch { /* ignore */ }
  };
}

// ===== Send message =====

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  state.ws.send(JSON.stringify({ action: 'sendMessage', text }));
  messageInput.value = '';
  messageInput.focus();
}

// ===== Event listeners =====

joinBtn.addEventListener('click', tryJoin);

callsignInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryJoin();
});

callsignInput.addEventListener('input', () => {
  joinError.textContent = '';
});

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

manualReconnectBtn.addEventListener('click', () => {
  reconnectBanner.hidden = true;
  state.reconnectAttempts = 0;
  reconnect();
});

// Scroll to bottom on mobile keyboard open
messageInput.addEventListener('focus', () => {
  setTimeout(scrollToBottom, 300);
});

// ===== Init =====
callsignInput.focus();
