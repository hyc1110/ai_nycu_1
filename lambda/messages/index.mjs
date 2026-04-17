/**
 * GET /messages
 *
 * Query params (all optional):
 *   since  ISO-8601 timestamp — return only messages newer than this value
 *   limit  integer 1–100, default 50
 *
 * Returns messages in ascending chronological order.
 *
 * DynamoDB table: anon-chat-messages
 *   PK   messageId  (String, UUID)
 *   GSI  channel-timestamp-index
 *          PK  channel   (String) — always "global" in this app
 *          SK  timestamp (String, ISO-8601 — sorts lexicographically)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MESSAGES_TABLE = process.env.MESSAGES_TABLE || 'anon-chat-messages';
const GSI_NAME       = 'channel-timestamp-index';
const CHANNEL        = 'global';
const MAX_LIMIT      = 100;
const DEFAULT_LIMIT  = 50;

// ---------------------------------------------------------------------------

export const handler = async (event) => {
  const qs    = event.queryStringParameters || {};
  const since = qs.since  || null;
  const limit = Math.min(
    parseInt(qs.limit, 10) || DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  // Build query
  const params = {
    TableName:                 MESSAGES_TABLE,
    IndexName:                 GSI_NAME,
    ScanIndexForward:          true,      // ascending (oldest → newest)
    Limit:                     limit,
    KeyConditionExpression:    since
      ? 'channel = :ch AND #ts > :since'
      : 'channel = :ch',
    ExpressionAttributeNames:  { '#ts': 'timestamp' },
    ExpressionAttributeValues: since
      ? { ':ch': CHANNEL, ':since': since }
      : { ':ch': CHANNEL },
  };

  try {
    const result = await ddb.send(new QueryCommand(params));
    const messages = (result.Items || []).map(formatMessage);
    return respond(200, { messages });
  } catch (err) {
    console.error('QueryCommand failed:', err);
    return respond(500, { error: 'Internal server error.' });
  }
};

// ---------------------------------------------------------------------------

function formatMessage({ messageId, callsign, text, timestamp }) {
  return { type: 'message', messageId, callsign, text, timestamp };
}

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
