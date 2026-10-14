# 02 — API Design: REST, GraphQL, gRPC & WebSockets

## Table of Contents
1. [REST API Design](#rest)
2. [GraphQL](#graphql)
3. [gRPC](#grpc)
4. [WebSockets & SSE](#websockets)
5. [API Authentication & Authorization](#api-auth)
6. [API Patterns Cheat Sheet](#patterns)

---

## REST API Design {#rest}

### Core Principles
- **Resource-oriented URIs**: `/users`, `/users/42/orders`, not `/getUserOrders`
- **HTTP methods as actions**: GET (read), POST (create), PUT (replace), PATCH (partial update), DELETE (remove)
- **Stateless**: Each request contains all info needed; no server-side session
- **HATEOAS**: Hypermedia as the Engine of Application State (optional, rare in practice)

### HTTP Status Codes — Quick Reference

| Range | Meaning | Key Codes |
|---|---|---|
| 2xx Success | Request succeeded | 200 OK, 201 Created, 202 Accepted, 204 No Content |
| 3xx Redirect | Resource moved | 301 Permanent, 302 Temporary, 304 Not Modified |
| 4xx Client Error | Client mistake | 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict, 422 Unprocessable, 429 Too Many Requests |
| 5xx Server Error | Server failure | 500 Internal, 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout |

### REST Anti-Patterns
- ❌ `POST /users/42/delete` → ✅ `DELETE /users/42`
- ❌ `/api/getUserProfile?id=42` → ✅ `GET /users/42/profile`
- ❌ `POST /createUser` with verb in URL → ✅ `POST /users`
- ❌ Returning 200 with `{ "error": "not found" }` → ✅ Use 404
- ❌ Deep nesting: `/users/1/orders/99/items/5/reviews/3` → ✅ `/reviews/3` with query params
- ❌ Tunneling everything through POST → ✅ Use appropriate HTTP methods

### Pagination Strategies

**1. Offset-Based (simplest)**
```
GET /users?offset=100&limit=20
```
- **Problem**: Drift when records are inserted/deleted (page misses or duplicates)
- **Use**: Small, stable datasets

**2. Cursor-Based (recommended)**
```
GET /users?cursor=eyJpZCI6NDJ9&limit=20
Response: { "data": [...], "next_cursor": "eyJpZCI6NjJ9" }
```
- Encodes the last item's sort key; immutable ordering
- **Used by**: Twitter, Stripe, Slack APIs
- **Tradeoff**: No "page 5 of 100" without additional counting

**3. Keyset Pagination**
```
GET /users?after_id=42&limit=20
```
- Simpler variant of cursor-based; uses raw column values

### Rate Limiting Strategies

| Strategy | How It Works | Example |
|---|---|---|
| Token Bucket | Tokens added at fixed rate; request consumes token | Burst-friendly; 100 req/s with burst 200 |
| Leaky Bucket | Fixed queue; processed at constant rate | Smooths traffic; drops overflow |
| Fixed Window | Counters reset at fixed intervals | 1000 req/hour → reset on the hour |
| Sliding Window Log | Timestamped log of each request | Precise; memory-intensive |
| Sliding Window Counter | Approximate with counter + previous window ratio | Redis-backed; good enough for most uses |

**Header Conventions:**
```
RateLimit-Limit: 1000
RateLimit-Remaining: 734
RateLimit-Reset: 1620000000
Retry-After: 60
```

### API Versioning

| Method | Example | Best For |
|---|---|---|
| URL Path | `/v1/users` | Simplest; explicit |
| Query Param | `/users?version=1` | Easy to test; clutters URLs |
| Header | `Accept: application/vnd.api+json;version=1` | Clean URLs; harder to test |
| Content Negotiation | `Accept: application/vnd.myapp.v1+json` | Hypermedia; complex |

**Recommendation**: URL path versioning for public APIs (`/v1/`); header for internal service-to-service.

---

## GraphQL {#graphql}

### Core Concepts
- **Single endpoint**: `POST /graphql` for all operations
- **Client-specified fields**: Client defines response shape → no over-fetching/under-fetching
- **Strongly typed schema**: SDL (Schema Definition Language)
- **Queries, Mutations, Subscriptions**: Three operation types

### N+1 Problem & DataLoader

The **N+1 problem**: fetching a list of posts (1 query), then fetching the author for each post (N queries).

```
query { posts { title author { name } } }
```

Without DataLoader — N+1 SQL queries:
```sql
SELECT * FROM posts;                    -- 1 query
SELECT * FROM users WHERE id = 1;      -- N queries for each author
SELECT * FROM users WHERE id = 2;
...
```

**DataLoader** (Facebook's solution) batches and caches:
```javascript
const userLoader = new DataLoader(async (userIds) => {
  const users = await db.users.findByIds(userIds);
  // Return in same order as input
  return userIds.map(id => users.find(u => u.id === id));
});
// Now all N author fetches are collapsed into 1 query:
// SELECT * FROM users WHERE id IN (1, 2, 3, ..., N)
```

### Query Complexity & Depth Limiting
```javascript
// graphql-depth-limit: prevent deep queries
app.use('/graphql', graphqlHTTP({ validationRules: [depthLimit(5)] }));

// graphql-query-complexity: cost-based limiting
const rule = queryComplexity({
  maximumComplexity: 1000,
  variables: {},
  onComplete: (complexity) => { console.log(`Complexity: ${complexity}`); }
});
```

### Persisted Queries
- Clients send a query **hash** instead of full query string
- Server stores `hash → query` mapping
- **Benefits**: Smaller payload, security (only allowlisted queries), caching at CDN
- **Used by**: Apollo, Relay

```
POST /graphql
{ "extensions": { "persistedQuery": { "version": 1, "sha256Hash": "abc123..." } } }
```

### GraphQL Anti-Patterns
- ❌ Exposing raw DB models without a GraphQL layer
- ❌ Circular references in schema (infinite recursion)
- ❌ Field-level auth without field middleware
- ❌ No query cost analysis → malicious expensive queries

---

## gRPC {#grpc}

### Why gRPC?
- **Protocol Buffers** (binary serialization): 3-10x smaller than JSON, 20-100x faster to parse
- **HTTP/2**: Multiplexing, header compression, server push
- **Code generation**: `.proto` file → client/server stubs in 10+ languages
- **Streaming**: Unary, server-streaming, client-streaming, bidirectional

### Protobuf Example
```protobuf
syntax = "proto3";

service OrderService {
  rpc CreateOrder (CreateOrderRequest) returns (Order);
  rpc StreamOrders (OrderFilter) returns (stream Order);  // server streaming
  rpc BatchCreate (stream CreateOrderRequest) returns (BatchResult);  // client streaming
  rpc Chat (stream Message) returns (stream Message);  // bidi streaming
}

message CreateOrderRequest {
  string user_id = 1;
  repeated OrderItem items = 2;
  double total_amount = 3;
}

message Order {
  string order_id = 1;
  string status = 2;
  google.protobuf.Timestamp created_at = 3;
}
```

### gRPC Streaming Patterns

| Pattern | Client | Server | Use Case |
|---|---|---|---|
| Unary | 1 req | 1 resp | CRUD operations |
| Server streaming | 1 req | Many resp | Real-time feeds, large datasets |
| Client streaming | Many req | 1 resp | File upload, sensor data |
| Bidi streaming | Many req | Many resp | Chat, collaborative editing |

### Deadlines & Error Model
```go
// Always set deadlines in gRPC!
ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
defer cancel()
resp, err := client.CreateOrder(ctx, req)

// gRPC error codes
codes.OK, codes.Canceled, codes.DeadlineExceeded,
codes.Internal, codes.Unavailable, codes.ResourceExhausted
```

### gRPC Deadline Propagation — Critical

Every gRPC call **MUST** carry a deadline. The deadline **MUST** propagate.

**Why propagation matters:**
```
Client (deadline: 1000ms)
  → serviceA (inherits 800ms remaining)
    → serviceB (inherits 650ms remaining)
      → serviceC (inherits 500ms remaining)
```

Without propagation: serviceB times out at 800ms, but serviceC keeps working (wasted compute, invisible failures). With propagation: the deadline flows through the call chain. Every service knows how much time it has left.

```go
// Set deadline at the edge
ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
defer cancel()

// The deadline is embedded in the gRPC metadata.
// When serviceA calls serviceB, pass the same ctx:
resp, err := serviceBClient.Process(ctx, req)

// serviceB can check remaining time:
if deadline, ok := ctx.Deadline(); ok {
    remaining := time.Until(deadline)
    if remaining < 100*time.Millisecond {
        return nil, status.Error(codes.DeadlineExceeded, "not enough time remaining")
    }
}
```

**Critical rules:**
- Default gRPC deadline is `∞` (no deadline) — **always set one explicitly**
- Deadline must be **> total retry budget**. If you retry 3× with 2s timeout, set a 7s deadline (not 2s)
- Don't set deadlines deep in the call chain — set them **at the edge** (the first service that receives the external request)
- Check remaining deadline before doing expensive work. If there's only 50ms left, fail fast instead of half-completing
- **gRPC status codes for timeouts:** `DeadlineExceeded` (4 — the server finished the gRPC deadline), `Canceled` (1 — the caller cancelled), `Unavailable` (14 — transient, safe to retry)

### REST vs gRPC Decision Grid

| Factor | REST | gRPC |
|---|---|---|
| Browser support | Native | Via gRPC-web |
| Human-readable | Yes (JSON) | No (binary) |
| Performance | Good | Excellent |
| Schema enforcement | Optional (OpenAPI) | Required (.proto) |
| Streaming | No native support | Native bidi streaming |
| Tooling ecosystem | Mature | Growing |
| **Best for** | Public APIs, web apps | Microservices, low-latency internal |

---

## WebSockets & SSE {#websockets}

### WebSocket Lifecycle
```
Client                                  Server
  |--- HTTP Upgrade (101) -------------->|
  |<-- 101 Switching Protocols ----------|
  |      [Persistent TCP connection]     |
  |<-- ws.send("data") ----------------> |
  |              ...                     |
  |<-- Close frame --------------------->|
```

### Scaling WebSockets with Pub/Sub Backplane

```javascript
// Single server: in-memory
const sessions = new Map(); // user_id → WebSocket

// Multi-server: Redis Pub/Sub backplane
const Redis = require('ioredis');
const pub = new Redis();
const sub = new Redis();

sub.subscribe('messages');
sub.on('message', (channel, msg) => {
  const { userId, data } = JSON.parse(msg);
  const ws = localSessions.get(userId);
  if (ws) ws.send(data);  // Only send if user is on THIS server
});

wss.on('connection', (ws, req) => {
  pub.publish('messages', JSON.stringify({ userId, data }));
});
```

### SSE (Server-Sent Events) as Alternative
```
GET /events/stream
Content-Type: text/event-stream

data: {"type": "update", "payload": {...}}
id: 42

data: {"type": "update", "payload": {...}}
id: 43
```

- ✅ Simpler than WebSockets; native browser API; auto-reconnect
- ✅ Works over HTTP/2; proxy-friendly
- ❌ Unidirectional (server → client only)
- ❌ Binary not natively supported
- **Use SSE when**: Server-push only (live scores, stock tickers, notifications)

| Feature | WebSocket | SSE |
|---|---|---|
| Direction | Bidirectional | Server→Client |
| Protocol | ws:// or wss:// | HTTP/HTTPS |
| Binary | Yes | Via base64 |
| Auto-reconnect | Manual | Built-in |
| Browser support | All | All modern |

---

## API Auth & Authorization {#api-auth}

### JWT Best Practices

```javascript
// ✅ DO: Use RS256 (asymmetric) for service-to-service
const token = jwt.sign({ sub: userId, scope: 'read:orders' }, privateKey, {
  algorithm: 'RS256',
  expiresIn: '15m',      // Short-lived access tokens
  issuer: 'auth.example.com',
  audience: 'api.example.com'
});

// ✅ DO: Validate EVERYTHING on the server
jwt.verify(token, publicKey, {
  algorithms: ['RS256'],   // Explicit whitelist
  issuer: 'auth.example.com',
  audience: 'api.example.com'
});

// ❌ DON'T: Store sensitive data in JWT payload (it's base64-encoded, NOT encrypted)
// ❌ DON'T: Use 'none' algorithm or 'HS256' with shared secrets for public APIs
// ❌ DON'T: Accept tokens without verifying the signature
```

### OAuth 2.0 Grant Types

| Grant Type | Flow | Use Case |
|---|---|---|
| Authorization Code | Browser redirect → code → exchange for token | **Server-side web apps** (most common) |
| Authorization Code + PKCE | Same + code verifier/challenge | **SPAs, mobile apps** (prevents interception) |
| Client Credentials | Client ID + secret → token | **Machine-to-machine**, microservices |
| Resource Owner Password | Username + password → token | **Deprecated**; avoid if possible |
| Device Code | Polling-based | TVs, IoT, CLI tools |
| Refresh Token | Long-lived token to get new access token | **Always use** with short-lived access tokens |

### API Key Management
- **Rotate keys** on a schedule; support overlap period (two keys valid during rotation)
- **Scope keys**: limit each key to specific APIs/resources
- **Rate limit per key**: prevent abuse
- **Vault storage**: Keys in HashiCorp Vault / AWS Secrets Manager, never in code/config

### API Gateway Auth Pattern
```
Client → [API Gateway (auth, rate limit)] → [Microservices (no auth)]
```
- Gateway validates JWT/API key at the edge
- Internal services trust headers from gateway (`X-User-ID`, `X-Scopes`)
- **Network security**: Firewall microservices to accept traffic only from gateway

---

## API Patterns Cheat Sheet {#patterns}

| Pattern | Technique | When to Use |
|---|---|---|
| Long-running operations | 202 Accepted + status endpoint | Async processing |
| Idempotency | `Idempotency-Key` header | Payment, order creation |
| Bulk operations | `POST /users/batch` with array body | CRUD on many resources |
| Conditional requests | `ETag` / `If-None-Match` / `If-Match` | Caching, optimistic concurrency |
| Partial responses | `?fields=id,name,email` or GraphQL | Mobile clients |
| Expansion | `?expand=orders,reviews` (Stripe-style) | Reduce roundtrips |
| Search | `GET /search?q=term&type=user&limit=20` | Full-text search |
| Webhooks | Server-to-server callbacks | Event notifications |
| CQRS | Separate read/write APIs | Different scale profiles |
