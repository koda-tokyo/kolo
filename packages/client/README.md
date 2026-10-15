# @kodasoken/kurahi-client

Typed client for the Kurahi gateway HTTP and WebSocket API, generated from the gateway's OpenAPI 3.1 document. One method per operation, typed WebSocket methods and events, gateway discovery under `KOLO_HOME`, and the pairing helpers a device needs to hold its own credential.

Licence: MIT ([LICENSE](LICENSE)). Runs on Node.js 22 or newer; the HTTP client also runs in a browser when you pass `baseUrl` and a credential (discovery and pairing need Node).

## Install

```bash
npm install @kodasoken/kurahi-client
```

## Find the gateway

`discover()` reads the state root (`KOLO_HOME`, else `KOLO_STATE_DIR`, else `~/.kolo`) and returns the base URL, the WebSocket URL and the credential it found, without ever printing the token. The port comes from `KOLO_GATEWAY_URL`, the environment, `run/gateway.lock`, `kolo.json` or the default; the credential from the environment, the owner token file, or a paired device credential.

```ts
import { discover } from "@kodasoken/kurahi-client";

const found = await discover();
found.baseUrl; // http://127.0.0.1:18789
found.wsUrl; // ws://127.0.0.1:18789/
found.tokenSource; // "env" | "file" | "password" | "device" | "none"
found.device; // { file, fingerprint, scope, ... } when a paired device credential exists
```

`KoloClient.local()` does the same and returns a ready client. When the only credential is a device credential with an expired access token, it refreshes it first. Explicit options win over discovered values.

```ts
import { KoloClient } from "@kodasoken/kurahi-client";

const client = await KoloClient.local();
client.discovered.home; // the state root that was used
```

Without discovery (a remote gateway, a browser, a test):

```ts
const client = new KoloClient({
  baseUrl: "http://gateway-host:18789",
  token: process.env.KOLO_TOKEN,
});
```

## One HTTP call

Every operation in the OpenAPI document is a method named after its `operationId`, with typed parameters, body and response.

```ts
const health = await client.getHealth(); // GET /health, no credential needed
const { sessions } = await client.listSessions(); // GET /api/sessions, attach scope
const page = await client.listAuditEvents({ limit: 20 }); // GET /api/admin/audit, admin scope
const invite = await client.createPairInvitation({ scope: "attach", ttlMinutes: 10 });
```

Anything not covered by a method can be called by operation id through the base class: `client.request("getHealth")`. `listOperations()` and `getOperation(id)` expose the operation table (method, path, parameters, auth kinds, minimum scope) that `kurahi api list` prints.

## One WebSocket call

`client.ws()` opens the gateway socket with the client's URL and credential and completes the `connect` handshake, including the device-key challenge when the credential is a pairing token. `connectWs()` does the same from explicit options.

```ts
const sock = await client.ws();
sock.hello.server; // version and features from the handshake

const list = await sock.call("sessions.list", { limit: 5 }); // typed by method name
const stop = sock.on("chat", (payload) => console.log(payload.sessionKey));
await sock.call("agent", { message: "status?" }, { expectFinal: true });

stop();
sock.close();
await sock.closed;
```

`wsMethods` and `wsEvents` list the method and event names; `WsMethodMap` and `WsEventMap` carry their types.

## Pairing helpers

A device redeems a one-use invitation from `kurahi pair invite`, proves a freshly generated Ed25519 key over a server nonce and stores the credential file under `<home>/secrets/devices/<fingerprint>.json` with mode 0600. The file holds a short-lived access token and a rotating refresh token; `refresh()` rotates both and rewrites the file.

```ts
import { pair, refresh, readDeviceCredential } from "@kodasoken/kurahi-client";

const { file, credential } = await pair({
  code: "kpi_...",
  baseUrl: "http://gateway-host:18789",
  deviceName: "ops-bot",
});
credential.scope; // "attach"

await refresh({ file }); // new access and refresh tokens
const stored = await readDeviceCredential(file);
```

`generateDeviceKey`, `signWithDeviceKey`, `pairProofPayload` and `deviceConnectPayload` are the building blocks when you need to drive the flow yourself. `isExpired(iso)` tells whether a stored access token is still usable.

## Errors

| Class              | When                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KoloApiError`     | the gateway answered with a non-2xx status. `operationId`, `status`, `body` (the decoded error model) and `headers`; `retryAfterSeconds` on a 429 |
| `KoloNetworkError` | the request never produced a response: network failure, timeout or abort                                                                          |
| `KoloWsError`      | a WebSocket call failed: handshake refused, method error, socket not open, timeout                                                                |
| `KoloPairError`    | pairing or refresh failed: invalid or expired code, reuse detected, device pending or re-consent required                                         |

Per-request timeouts default to 30 s (`timeoutMs: 0` disables). A `fetch` and a `WebSocket` constructor can be injected for tests and proxies.

## How it is generated

`scripts/client-gen.mjs` in the repository reads `openapi/kolo-gateway.openapi.json` and writes `src/generated/client.ts`, `operations.ts`, `types.ts` and `websocket.ts`. There is no network access and no external generator: a small JSON Schema to TypeScript mapper covers the subset the gateway document uses, and the output is a pure function of the document, so two runs produce byte-identical files.

- Regenerate: `pnpm client:gen`
- Drift check: `pnpm client:check` (runs in CI with `pnpm openapi:check`, which checks the document itself against the gateway's route table)
- Version lock: `SPEC_VERSION` and `OPENAPI_VERSION` are exported from the generated code; `pnpm release:check` requires the client's version to equal the CLI's

Hand-written files (`base.ts`, `discover.ts`, `pair.ts`, `ws.ts`, `operation-spec.ts`) are not touched by the generator.

## Related

- CLI equivalent: `kurahi api <operationId>`, `kurahi api ws <method>`, `kurahi api discover`
- Pairing from the terminal: `kurahi pair invite`, `kurahi pair redeem`
- Gateway documentation: https://kodasoken.com/kolo
