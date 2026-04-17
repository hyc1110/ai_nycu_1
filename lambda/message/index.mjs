/**
 * POST /message
 *
 * Body: { "callsign": "CoolDog", "sessionId": "<uuid>", "text": "Hello!" }
 *
 * Validates the session, then stores the message.
 * Returns the stored message object.
 *
 * DynamoDB tables:
 *   anon-chat-sessions  (read — validate session)
 *   anon-chat-messages  (write — store message)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const SESSIONS_TABLE = process.env.SESSIONS_TABLE  || 'anon-chat-sessions';
const MESSAGES_TABLE = process.env.MESSAGES_TABLE  || 'anon-chat-messages';
const CHANNEL        = 'global';
const MAX_TEXT_LEN   = 1000;

// ---------------------------------------------------------------------------

export const handler = async (event) => {
  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Request body must be valid JSON.' });
  }

  const { callsign, sessionId, text } = body;

  // Field presence check
  if (!callsign || !sessionId || !text) {
    return respond(400, { error: 'callsign, sessionId, and text are required.' });
  }

  // Text validation
  const trimmed = String(text).trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TEXT_LEN) {
    return respond(400, { error: `text must be 1–${MAX_TEXT_LEN} characters.` });
  }

  // Validate session
  let session;
  try {
    const result = await ddb.send(new GetCommand({
      TableName: SESSIONS_TABLE,
      Key: { callsign },
    }));
    session = result.Item;
  } catch (err) {
    console.error('Session GetCommand failed:', err);
    return respond(500, { error: 'Internal server error.' });
  }

  if (!session || session.sessionId !== sessionId) {
    return respond(401, { error: 'Invalid or expired session. Please /join again.' });
  }

  // Store message
  const messageId = randomUUID();
  const timestamp = new Date().toISOString();

  try {
    await ddb.send(new PutCommand({
      TableName: MESSAGES_TABLE,
      Item: {
        messageId,
        channel: CHANNEL,
        callsign,
        text: trimmed,
        timestamp,
      },
    }));
  } catch (err) {
    console.error('Message PutCommand failed:', err);
    return respond(500, { error: 'Internal server error.' });
  }

  return respond(201, {
    type: 'message',
    messageId,
    callsign,
    text: trimmed,
    timestamp,
  });
};

// ---------------------------------------------------------------------------

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
