# Frontend Design Document

## Overview

A responsive web application (RWD) for anonymous real-time chat, built with React + Vite + TypeScript, hosted on GitHub Pages.

**Repository:** `git@github.com:samsonchen/ai_course_2.git`
**Code location:** `webui/`

## Technology Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 18+ | UI framework |
| TypeScript | 5+ | Type safety |
| Vite | 5+ | Build tooling and dev server |
| CSS | (TBD) | Styling — design scheme to be provided separately |

## Application Flow

```
┌──────────────────────┐
│  1. Landing Screen    │
│                       │
│  Enter your callsign: │
│  [________________]   │
│  [  Join Chat  ]      │
└──────────┬───────────┘
           │ callsign validated
           ▼
┌──────────────────────┐
│  2. Chat Screen       │
│                       │
│  ┌──────────────────┐ │
│  │ Message List     │ │
│  │ (scrollable)     │ │
│  │                  │ │
│  │ CoolDog: Hello   │ │
│  │ Ghost42: Hey!    │ │
│  │ [system] X left  │ │
│  └──────────────────┘ │
│                       │
│  ┌────────────┐ [Send]│
│  │ Type here..│       │
│  └────────────┘       │
│                       │
│  Status: Connected    │
└──────────────────────┘
```

## Screens

### Screen 1: Join Screen

**Purpose:** Capture the user's callsign before entering the chat.

**Elements:**

| Element | Type | Behavior |
|---------|------|----------|
| App title | Text | Display application name |
| Callsign input | Text input | Max 20 chars, alphanumeric + underscore |
| Join button | Button | Validates callsign, initiates WebSocket connection |
| Error message | Text (conditional) | Shown if callsign is invalid or connection fails |

**Validation (client-side):**

- Not empty
- 1–20 characters
- Matches `^[a-zA-Z0-9_]{1,20}$`

**On Join:**

1. Validate callsign
2. Open WebSocket: `wss://{endpoint}?callsign={callsign}`
3. On successful connection → transition to Chat Screen
4. On connection failure → display error message

### Screen 2: Chat Screen

**Purpose:** Display messages and allow sending.

**Elements:**

| Element | Type | Behavior |
|---------|------|----------|
| Message list | Scrollable container | Displays all received messages, auto-scrolls to bottom on new message |
| Message input | Text input | Max 1000 chars |
| Send button | Button | Sends message via WebSocket |
| Connection status | Indicator | Shows connected/disconnected/reconnecting state |

**Message display format:**

- **Chat message:** `[callsign]: text` with timestamp
- **System message (join):** `[system] CoolDog joined`
- **System message (leave):** `[system] CoolDog left`
- **Own messages:** Visually distinct from others (e.g., aligned right or different background)

## WebSocket Integration

### Configuration

```typescript
// WebSocket endpoint — configurable via environment variable
const WS_ENDPOINT = import.meta.env.VITE_WS_ENDPOINT || "wss://default.execute-api.us-west-2.amazonaws.com/prod";
```

### Connection Lifecycle

```typescript
// Connect
const ws = new WebSocket(`${WS_ENDPOINT}?callsign=${encodeURIComponent(callsign)}`);

// Receive messages
ws.onmessage = (event: MessageEvent) => {
  const data = JSON.parse(event.data);
  // data.type === "message" | "system"
  // Append to message list
};

// Send message
const sendMessage = (text: string) => {
  ws.send(JSON.stringify({
    action: "sendMessage",
    text: text,
  }));
};

// Handle disconnect
ws.onclose = (event: CloseEvent) => {
  // Update status indicator
  // Optionally attempt reconnect
};

// Handle errors
ws.onerror = (event: Event) => {
  // Update status indicator
  // Log error
};
```

### Reconnection Strategy

On unexpected disconnect:

1. Show "Disconnected" status
2. Wait 2 seconds, attempt reconnect
3. On success → rejoin with same callsign, show "Reconnected" status
4. On failure → exponential backoff (2s, 4s, 8s, max 30s)
5. After 5 failed attempts → show "Connection lost" with manual reconnect button

## TypeScript Interfaces

```typescript
// Incoming messages from server
interface ChatMessage {
  type: "message";
  callsign: string;
  text: string;
  timestamp: string;  // ISO 8601
}

interface SystemEvent {
  type: "system";
  event: "user_joined" | "user_left";
  callsign: string;
  timestamp: string;
}

type ServerMessage = ChatMessage | SystemEvent;

// Outgoing message to server
interface SendMessagePayload {
  action: "sendMessage";
  text: string;
}

// Application state
interface AppState {
  screen: "join" | "chat";
  callsign: string;
  messages: ServerMessage[];
  connectionStatus: "connecting" | "connected" | "disconnected" | "reconnecting";
  inputText: string;
}
```

## Component Structure

```
webui/src/
├── App.tsx                  # Root: routes between JoinScreen and ChatScreen
├── main.tsx                 # Entry point
├── components/
│   ├── JoinScreen.tsx       # Callsign input + join button
│   ├── ChatScreen.tsx       # Message list + input + status
│   ├── MessageList.tsx      # Scrollable message container
│   ├── MessageItem.tsx      # Single message rendering
│   ├── MessageInput.tsx     # Text input + send button
│   └── StatusIndicator.tsx  # Connection status display
├── hooks/
│   └── useWebSocket.ts     # WebSocket connection management hook
├── types/
│   └── index.ts             # TypeScript interfaces
├── config.ts                # Environment-based configuration
└── styles/                  # (TBD — design scheme provided separately)
```

## Responsive Design (RWD) Requirements

The app must work on both mobile and desktop browsers.

**Breakpoints:**

| Breakpoint | Target |
|-----------|--------|
| < 480px | Mobile portrait |
| 480–768px | Mobile landscape / small tablet |
| 768–1024px | Tablet |
| > 1024px | Desktop |

**Layout behavior:**

- **Mobile:** Full-width message list, input fixed to bottom of viewport, no wasted horizontal space
- **Desktop:** Centered content area with max-width (e.g., 800px), comfortable reading width
- **All sizes:** Message input always visible at bottom, message list scrollable above it

**Touch considerations:**

- Input field should not be obscured by virtual keyboard on mobile
- Send button should be large enough for touch (min 44x44px tap target)
- Auto-scroll to latest message

## Build and Deployment

### Development

```bash
cd webui
npm install
npm run dev
# Open http://localhost:5173
```

**Environment variable for local development:**

Create `webui/.env.local`:

```
VITE_WS_ENDPOINT=wss://{your-api-id}.execute-api.{region}.amazonaws.com/prod
```

### Production Build

```bash
cd webui
npm run build
# Output: webui/dist/
```

### GitHub Pages Deployment

**Option A: Manual**

Copy the contents of `webui/dist/` to the repository branch/folder configured for GitHub Pages.

**Option B: GitHub Actions (recommended)**

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
    paths: [webui/**]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: cd webui && npm ci && npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./webui/dist
```

### Vite Configuration for GitHub Pages

```typescript
// webui/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/ai_course_2/',  // Must match GitHub repo name for GitHub Pages
});
```

## UI Design Scheme

> **To be provided separately.** This document covers structure, components, and behavior. Visual design (colors, typography, spacing, component styling) will be defined in a separate design scheme document and applied via the `styles/` directory.

## Accessibility Baseline

Even before the design scheme is applied:

- All interactive elements must be keyboard-accessible
- Input fields must have associated labels (visible or `aria-label`)
- Status changes (connected/disconnected) should be announced to screen readers via `aria-live` region
- Color contrast ratios should meet WCAG AA (4.5:1 for normal text) — enforced when design scheme is applied

## Error States

| State | Display |
|-------|---------|
| WebSocket connection failed | Error message on Join Screen with retry option |
| Connection lost during chat | Status indicator changes, reconnection attempts begin |
| Message send failed | Visual indicator on the failed message (e.g., red icon) |
| Invalid callsign | Inline validation error below the input field |
