/**
 * POST /join
 *
 * Body: { "callsign": "CoolDog" }
 *
 * Creates a session for the caller if the callsign is not already taken.
 * Returns a sessionId that must be sent with every POST /message request.
 *
 * DynamoDB table: anon-chat-sessions
 *   PK  callsign  (String)
 *   TTL ttl       (Number, Unix seconds)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const SESSIONS_TABLE  = process.env.SESSIONS_TABLE  || 'anon-chat-sessions';
const SESSION_TTL_SEC = 24 * 60 * 60;          // sessions expire after 24 h
const CALLSIGN_RE     = /^[a-zA-Z0-9_]{1,20}$/;

// ---------------------------------------------------------------------------

export const handler = async (event) => {
  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Request body must be valid JSON.' });
  }

  const { callsign } = body;

  // Validate callsign
  if (!callsign || !CALLSIGN_RE.test(callsign)) {
    return respond(400, {
      error: 'callsign is required and must be 1–20 letters, numbers, or underscores.',
    });
  }

  // Check if callsign is already active
  try {
    const existing = await ddb.send(new GetCommand({
      TableName: SESSIONS_TABLE,
      Key: { callsign },
    }));

    if (existing.Item) {
      return respond(409, { error: 'Callsign already in use. Choose another.' });
    }
  } catch (err) {
    console.error('GetCommand failed:', err);
    return respond(500, { error: 'Internal server error.' });
  }

  // Create session — use ConditionExpression as a race-condition guard
  const sessionId = randomUUID();
  const ttl       = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;

  try {
    await ddb.send(new PutCommand({
      TableName:           SESSIONS_TABLE,
      Item:                { callsign, sessionId, joinedAt: new Date().toISOString(), ttl },
      ConditionExpression: 'attribute_not_exists(callsign)',
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return respond(409, { error: 'Callsign already in use. Choose another.' });
    }
    console.error('PutCommand failed:', err);
    return respond(500, { error: 'Internal server error.' });
  }

  return respond(200, { callsign, sessionId });
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
