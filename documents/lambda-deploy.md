# Lambda Deployment Guide (AWS Console)

Three Lambda functions back the anonymous chat API.
All steps use the AWS Console — no CLI required.

---

## Architecture Overview

```
Browser
  │
  ▼
API Gateway (REST)
  ├── POST /join      → Lambda: anon-chat-join
  ├── GET  /messages  → Lambda: anon-chat-messages
  └── POST /message   → Lambda: anon-chat-message

DynamoDB
  ├── anon-chat-sessions   (active users)
  └── anon-chat-messages   (chat history)
```

---

## Step 1 — Create DynamoDB Tables

### Table A: `anon-chat-sessions`

1. Open **DynamoDB → Tables → Create table**
2. **Table name:** `anon-chat-sessions`
3. **Partition key:** `callsign` (String)
4. Leave sort key empty
5. **Settings:** default (On-demand capacity is fine)
6. Create table
7. After creation, open the table → **Additional settings** tab → **Time to Live (TTL)**
   - Enable TTL, attribute name: `ttl`

### Table B: `anon-chat-messages`

1. **Table name:** `anon-chat-messages`
2. **Partition key:** `messageId` (String)
3. Leave sort key empty
4. Create table
5. After creation, open the table → **Indexes** tab → **Create index (GSI)**
   - **Partition key:** `channel` (String)
   - **Sort key:** `timestamp` (String)
   - **Index name:** `channel-timestamp-index`
   - **Projected attributes:** All
   - Create index (takes ~1 minute)

---

## Step 2 — Create IAM Role for Lambda

1. Open **IAM → Roles → Create role**
2. **Trusted entity:** AWS service → Lambda
3. **Permissions:** attach the following two managed policies:
   - `AWSLambdaBasicExecutionRole` (CloudWatch Logs)
4. **Role name:** `anon-chat-lambda-role`
5. Create role
6. Open the role → **Add permissions → Create inline policy**

Paste this JSON policy (replace `<ACCOUNT_ID>` and `<REGION>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SessionsReadWrite",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem"
      ],
      "Resource": "arn:aws:dynamodb:<REGION>:<ACCOUNT_ID>:table/anon-chat-sessions"
    },
    {
      "Sid": "MessagesReadWrite",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:Query"
      ],
      "Resource": [
        "arn:aws:dynamodb:<REGION>:<ACCOUNT_ID>:table/anon-chat-messages",
        "arn:aws:dynamodb:<REGION>:<ACCOUNT_ID>:table/anon-chat-messages/index/channel-timestamp-index"
      ]
    }
  ]
}
```

Name the inline policy `anon-chat-dynamodb-policy`.

---

## Step 3 — Create Lambda Functions

Repeat the steps below for each of the three functions:

| Function name         | Handler file              | Entry point   |
|-----------------------|---------------------------|---------------|
| `anon-chat-join`      | `lambda/join/index.mjs`   | `index.handler` |
| `anon-chat-messages`  | `lambda/messages/index.mjs` | `index.handler` |
| `anon-chat-message`   | `lambda/message/index.mjs` | `index.handler` |

### Per-function steps

1. Open **Lambda → Functions → Create function**
2. **Author from scratch**
3. **Function name:** (see table above)
4. **Runtime:** Node.js 20.x
5. **Architecture:** x86_64
6. **Execution role:** Use an existing role → `anon-chat-lambda-role`
7. Create function

**Upload code:**

8. In the function page, open the **Code** tab
9. Click **Upload from → .zip file**
10. Create a ZIP of the matching directory:
    - For `anon-chat-join`: ZIP the contents of `lambda/join/` (so `index.mjs` is at the root of the ZIP)
    - Same pattern for the other two
11. Upload the ZIP → Save

**Set the handler:**

12. **Code** tab → **Runtime settings → Edit**
13. **Handler:** `index.handler`
14. Save

**Set environment variables:**

15. **Configuration** tab → **Environment variables → Edit → Add**

| Key             | Value                   |
|-----------------|-------------------------|
| `SESSIONS_TABLE` | `anon-chat-sessions`   |
| `MESSAGES_TABLE` | `anon-chat-messages`   |

Add both variables to all three functions.

**Increase timeout (optional but recommended):**

16. **Configuration → General configuration → Edit**
17. **Timeout:** 10 seconds
18. Save

---

## Step 4 — Create API Gateway

1. Open **API Gateway → Create API → REST API → Build**
2. **API name:** `anon-chat-api`
3. **Endpoint type:** Regional
4. Create API

### Create resources and methods

#### /join  →  POST

1. **Actions → Create Resource**, Resource name: `join`, path: `/join`
2. Select `/join` → **Actions → Create Method → POST**
3. **Integration type:** Lambda Function, **Use Lambda Proxy integration:** ✓
4. **Lambda Function:** `anon-chat-join`
5. Save → grant API Gateway permission when prompted

#### /messages  →  GET

1. Select root `/` → **Create Resource**, name: `messages`, path: `/messages`
2. Select `/messages` → **Create Method → GET**
3. Integration: Lambda Proxy → `anon-chat-messages`
4. Save

#### /message  →  POST

1. Select root `/` → **Create Resource**, name: `message`, path: `/message`
2. Select `/message` → **Create Method → POST**
3. Integration: Lambda Proxy → `anon-chat-message`
4. Save

### Enable CORS

Repeat for each resource (`/join`, `/messages`, `/message`):

1. Select the resource → **Actions → Enable CORS**
2. **Access-Control-Allow-Origin:** `*`
3. **Access-Control-Allow-Headers:** `Content-Type`
4. **Access-Control-Allow-Methods:** check the relevant method + `OPTIONS`
5. **Enable CORS and replace existing CORS headers** → Yes

### Deploy the API

1. **Actions → Deploy API**
2. **Deployment stage:** [New Stage], **Stage name:** `prod`
3. Deploy

The **Invoke URL** is shown on the stage page, e.g.:
```
https://<api-id>.execute-api.<region>.amazonaws.com/prod
```

Your three endpoints are:
```
POST https://<api-id>.execute-api.<region>.amazonaws.com/prod/join
GET  https://<api-id>.execute-api.<region>.amazonaws.com/prod/messages
POST https://<api-id>.execute-api.<region>.amazonaws.com/prod/message
```

---

## Step 5 — Quick Smoke Test

Use curl or any HTTP client:

```bash
# 1. Join
curl -X POST https://<invoke-url>/prod/join \
  -H "Content-Type: application/json" \
  -d '{"callsign":"TestUser"}'
# → {"callsign":"TestUser","sessionId":"<uuid>"}

# 2. Send a message (replace sessionId)
curl -X POST https://<invoke-url>/prod/message \
  -H "Content-Type: application/json" \
  -d '{"callsign":"TestUser","sessionId":"<uuid>","text":"Hello world"}'
# → {"type":"message","messageId":"...","callsign":"TestUser",...}

# 3. Fetch messages
curl https://<invoke-url>/prod/messages
# → {"messages":[...]}

# 4. Fetch messages after a timestamp
curl "https://<invoke-url>/prod/messages?since=2024-01-01T00:00:00.000Z"
```

---

## API Reference

### POST /join

**Request**
```json
{ "callsign": "CoolDog" }
```

**Response 200**
```json
{ "callsign": "CoolDog", "sessionId": "550e8400-e29b-41d4-a716-446655440000" }
```

**Errors**

| Status | Reason |
|--------|--------|
| 400    | Missing or invalid callsign |
| 409    | Callsign already in use |

---

### GET /messages

**Query params**

| Param  | Type   | Description                              |
|--------|--------|------------------------------------------|
| since  | string | ISO-8601 — return only newer messages    |
| limit  | number | 1–100, default 50                        |

**Response 200**
```json
{
  "messages": [
    {
      "type": "message",
      "messageId": "...",
      "callsign": "CoolDog",
      "text": "Hello!",
      "timestamp": "2024-01-15T14:32:00.000Z"
    }
  ]
}
```

---

### POST /message

**Request**
```json
{
  "callsign": "CoolDog",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "text": "Hello everyone!"
}
```

**Response 201**
```json
{
  "type": "message",
  "messageId": "...",
  "callsign": "CoolDog",
  "text": "Hello everyone!",
  "timestamp": "2024-01-15T14:32:01.000Z"
}
```

**Errors**

| Status | Reason |
|--------|--------|
| 400    | Missing fields or text too long (>1000 chars) |
| 401    | Invalid or expired session |
