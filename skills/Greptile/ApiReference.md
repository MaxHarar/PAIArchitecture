# Greptile API Reference

Full API documentation for direct API fallback when MCP tools are unavailable.

**Base URL:** `https://api.greptile.com`

**Authentication:** Every request requires two headers:
```
Authorization: Bearer $GREPTILE_API_KEY
X-Github-Token: $(gh auth token)
```

---

## POST /v2/query

Natural language codebase Q&A. This is the primary endpoint.

**Request:**
```json
{
  "messages": [
    {
      "id": "msg-1",
      "content": "How does authentication work?",
      "role": "user"
    }
  ],
  "repositories": [
    {
      "remote": "github",
      "repository": "owner/repo",
      "branch": "main"
    }
  ],
  "genius": true,
  "stream": false
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | array | yes | Chat messages (supports multi-turn) |
| `messages[].id` | string | yes | Unique message ID |
| `messages[].content` | string | yes | The question or follow-up |
| `messages[].role` | string | yes | `user` or `assistant` |
| `repositories` | array | yes | Repos to query against |
| `repositories[].remote` | string | yes | `github` or `gitlab` |
| `repositories[].repository` | string | yes | `owner/repo` format |
| `repositories[].branch` | string | yes | Branch name |
| `genius` | boolean | no | Enable deeper analysis (slower, more thorough) |
| `stream` | boolean | no | Stream response via SSE |

**Response:**
```json
{
  "message": "Authentication is handled by...",
  "sources": [
    {
      "repository": "owner/repo",
      "remote": "github",
      "branch": "main",
      "filepath": "src/auth/handler.ts",
      "linestart": 15,
      "lineend": 42,
      "summary": "Main authentication handler that validates JWT tokens"
    }
  ]
}
```

---

## POST /v2/search

Search for specific code references. Returns file matches sorted by relevance.

**Request:**
```json
{
  "query": "authentication middleware",
  "repositories": [
    {
      "remote": "github",
      "repository": "owner/repo",
      "branch": "main"
    }
  ],
  "stream": false
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | Search query |
| `repositories` | array | yes | Repos to search (same format as /v2/query) |
| `stream` | boolean | no | Stream response via SSE |

**Response:**
```json
[
  {
    "repository": "owner/repo",
    "remote": "github",
    "branch": "main",
    "filepath": "src/middleware/auth.ts",
    "linestart": 1,
    "lineend": 35,
    "summary": "Express middleware for JWT authentication"
  }
]
```

---

## POST /v2/repositories

Index a new repository or re-index an existing one.

**Request:**
```json
{
  "remote": "github",
  "repository": "owner/repo",
  "branch": "main",
  "reload": false,
  "notify": false
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `remote` | string | yes | `github` or `gitlab` |
| `repository` | string | yes | `owner/repo` format |
| `branch` | string | yes | Branch to index |
| `reload` | boolean | no | Force re-index if already indexed |
| `notify` | boolean | no | Send notification when indexing completes |

**Response:**
```json
{
  "response": "submitted",
  "sha": "abc123..."
}
```

---

## GET /v2/repositories/{repositoryId}

Check indexing status. The `repositoryId` is URL-encoded: `github:main:owner/repo`.

**Example:**
```bash
curl -s "https://api.greptile.com/v2/repositories/github%3Amain%3Aowner%2Frepo" \
  -H "Authorization: Bearer $GREPTILE_API_KEY" \
  -H "X-Github-Token: $(gh auth token)"
```

**Response:**
```json
{
  "repository": "owner/repo",
  "remote": "github",
  "branch": "main",
  "private": true,
  "status": "completed",
  "filesProcessed": 42,
  "numFiles": 42,
  "sha": "abc123..."
}
```

**Status values:** `submitted`, `cloning`, `processing`, `completed`, `failed`

---

## Rate Limits

- **Query:** 5 requests/minute (free tier), higher on paid plans
- **Search:** 10 requests/minute
- **Index:** 3 requests/minute
- **Status:** 30 requests/minute

---

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad request — check required fields |
| 401 | Invalid or missing API key |
| 403 | No access to repository (check GitHub token permissions) |
| 404 | Repository not indexed — index it first |
| 429 | Rate limited — wait and retry |
| 500 | Greptile server error |
