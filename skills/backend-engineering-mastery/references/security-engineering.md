# Security Engineering — Cryptography, Threat Modeling, Defense

## The UC Berkeley / Stanford Lineage

David Wagner (UC Berkeley) and Dan Boneh (Stanford) defined modern applied cryptography and systems security. The key insight: security is a system property, not a feature. You cannot add security — you can only reveal its absence.

---

## Threat Modeling (Shostack, 2014)

### STRIDE — Systematic Threat Identification
| Threat | Property Violated | Example |
|--------|------------------|---------|
| Spoofing | Authentication | Attacker impersonates a doctor |
| Tampering | Integrity | Modifying lab results in transit |
| Repudiation | Non-repudiation | Doctor denies ordering a medication |
| Information Disclosure | Confidentiality | Patient records leaked via API |
| Denial of Service | Availability | Overload API, block clinical access |
| Elevation of Privilege | Authorization | Nurse accesses admin functions |

### The Four Questions (Adam Shostack)
1. What are we building? (Data flow diagrams, architecture)
2. What can go wrong? (STRIDE on each element)
3. What are we going to do about it? (Mitigations)
4. Did we do a good enough job? (Validation)

### Attack Trees
```
Goal: Access patient records without authorization
├── AND Exploit API vulnerability
│   ├── OR SQL injection in patient search
│   ├── OR Broken access control (IDOR — change patient_id in URL)
│   └── OR JWT token forgery (weak signing key)
├── AND Compromise doctor credentials
│   ├── OR Phishing attack
│   ├── OR Credential stuffing (password reuse)
│   └── OR Brute force (no rate limiting)
└── AND Physical access
    ├── OR Unlocked terminal in clinic
    └── OR Stolen laptop without disk encryption
```

---

## Cryptography — What To Use (And Never To Build)

### The Golden Rule
**NEVER design your own cryptographic algorithm or protocol.** Use well-audited libraries (libsodium, OpenSSL, Ring). The gap between "works" and "secure" in cryptography is invisible to non-cryptographers.

### Symmetric Encryption
```
Use: AES-256-GCM (authenticated encryption)
GCM provides: confidentiality + integrity + authenticity
IV (nonce) must be unique per encryption with same key
96-bit IV recommended

NEVER: AES-ECB, AES-CBC without HMAC, DES (broken), RC4 (broken)
```

### Key Derivation
```
Argon2id (winner of Password Hashing Competition, 2015)
Parameters:
  memory:      64 MB (minimum), 256 MB+ (production)
  iterations:  3 (minimum), 10+ (production)
  parallelism: number of cores
  
Purpose: Derive encryption key from password
Also: rate-limit password attempts (computationally expensive)
```

### Asymmetric Encryption
```
Use: X25519 (Elliptic Curve Diffie-Hellman) + Ed25519 (signatures)
Why not RSA-2048: Larger keys, slower, no forward secrecy without ephemeral keys
Why Curve25519: Fast, constant-time, small keys (32 bytes), no known backdoors
```

### TLS 1.3 Only
```
TLS 1.2: Still okay if configured correctly (no CBC, no RC4, no SHA1)
TLS 1.3: Mandatory forward secrecy, 1-RTT handshake, removes all legacy crypto

Minimum configuration:
  tls_min_version = "1.3"  # or "1.2" with strict cipher suite
  cipher_suites = TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256
  curves = X25519
  cert_sign = ECDSA P-256 or Ed25519
```

### Hashing
```
Use: SHA-256 or BLAKE3 (newer, faster, equally secure)
For passwords: Argon2id (see above) — NEVER SHA-256 for passwords

NEVER: MD5, SHA-1 (broken — collisions practical)
```

---

## Authentication Architecture

### Token Types
```
Session tokens: Server-side state (cookie). Revocable. CSRF protection needed.
JWT (stateless): Client holds token. No server-side state needed.
  Pro: scalable (no centralized session store)
  Con: server can't revoke individual tokens (need blocklist or short expiry)
  
Refresh token + Access token pattern:
  Access token: short-lived (15 min), used for API calls
  Refresh token: long-lived (30 days), used only to get new access tokens
  → Refresh token rotation: issue new refresh token on each use
  → Reuse detection: if stolen refresh token is reused, revoke all tokens for user
```

### OAuth 2.0 / OIDC
```
Authorization Code Flow (for server-side apps):
1. Redirect user to authorization server
2. User authenticates, authorizes
3. Authorization server redirects back with auth code
4. Exchange auth code + client_secret for tokens (server-to-server)
5. Use access token for API calls

PKCE (for SPAs and mobile): adds code_challenge/code_verifier to prevent auth code interception
```

### API Key Security
```
NEVER: API keys in source code, client-side code, or URLs
Store: Environment variables, secrets manager (Vault, AWS Secrets Manager)
Rotate: Automated rotation. Old key valid during rotation window.
Scope: Each key has minimal permissions. Not one super-key.
```

---

## Common Vulnerabilities (OWASP Top 10)

### Injection (SQL, Command, etc.)
```
❌ query = f"SELECT * FROM patients WHERE id = {user_input}"
✅ query = "SELECT * FROM patients WHERE id = $1"  # parameterized query

Principle: NEVER concatenate user input into queries, commands, or code.
Use parameterized queries, prepared statements, or ORM that ensures this.
```

### Broken Access Control
```
❌ GET /api/patients/12345  # Can I access patient 12346 by changing the ID?
✅ Every request verifies: is the authenticated user authorized for THIS resource?

Principle: Authorization check on EVERY request, not just login.
IDOR (Insecure Direct Object Reference) — the #1 access control bug.
```

### Cryptographic Failures
```
❌ Hardcoded keys, weak algorithms, missing encryption on sensitive data
✅ Secrets management, TLS everywhere, data encrypted at rest AND in transit
```

### Supply Chain Security
```
npm/pip dependency with 10 lines of code → can have 1000 transitive dependencies
→ Any of them can be compromised (event-stream incident, colors.js sabotage)

Protections:
  - Lockfiles (package-lock.json, Pipfile.lock, Cargo.lock)
  - Dependency scanning (npm audit, Dependabot, Snyk)
  - SBOM (Software Bill of Materials) — know what you depend on
  - Avoid dependency bloat. Every dependency is a trust relationship.
```

---

## Zero Trust Architecture

### Core Principles
1. **Never trust, always verify.** Every request is authenticated and authorized.
2. **Assume breach.** Design as if the perimeter is already compromised.
3. **Least privilege.** Every service has only the permissions it needs, for only as long as it needs them.
4. **Micro-segmentation.** Services can only communicate with explicitly authorized peers.

### Implementation (BeyondCorp — Google's model)
```
No VPN. No "internal network" trust.
Every service-to-service call is authenticated (mTLS).
Every user request is authenticated + authorized (OAuth/OIDC).
Network location grants zero trust — laptop at office = no different than laptop at cafe.
```

### Service Identity (SPIFFE/SPIRE)
```
Every service has a cryptographic identity (X.509 certificate or JWT).
SPIFFE ID: spiffe://kodasoken.com/namespace/production/service/patient-api
→ Authentication at the service level, not the IP level
→ mTLS between all services
```

---

## Secrets Management

### HashiCorp Vault Architecture
```
Applications NEVER hold secrets. They request them from Vault at runtime.

Vault Auth Methods:
  - Kubernetes: pod service account → Vault token
  - AWS/GCP: IAM role → Vault token
  - AppRole: RoleID + SecretID (for non-K8s, non-cloud)

Vault Secrets Engines:
  - KV v2: static secrets (API keys, passwords) with versioning
  - Database: dynamic credentials (temporary, auto-rotated, unique per client)
  - PKI: issue TLS certificates (internal CA)
  - Transit: encryption-as-a-service (never expose encryption keys to apps)

Dynamic Secrets (Database engine):
  App requests database credentials → Vault creates temporary user with GRANT
  → App uses credentials → TTL expires → Vault revokes user
  → Every app instance gets unique, temporary credentials
  → No long-lived database passwords anywhere
```

### Secret Rotation
```
Automated rotation schedule:
  TLS certificates: 30-90 days (automated via cert-manager or Vault PKI)
  Database credentials: 7-30 days (automated via Vault dynamic secrets)
  API keys: 30-90 days (automated with grace period)
  Encryption keys: annually (with re-wrapping, not re-encryption of all data)
```

---

## Incident Response

### Severity Levels
```
SEV-1 (Critical): Production down, patient safety risk, data breach. Page on-call. All hands.
SEV-2 (High): Major feature broken, security vulnerability. Page on-call.
SEV-3 (Medium): Minor feature degraded, non-critical. Alert during business hours.
SEV-4 (Low): Cosmetic, minor bug. Queue for next sprint.
```

### Blameless Post-Mortems
```
What happened? (timeline, impact, detection)
How did we fix it? (immediate mitigation)
Root cause analysis (5 Whys):
  Why? → Answer → Why? → Answer → Why? → Answer → Why? → Answer → Why? → Root cause
Action items (specific owner, deadline, tracked in issue tracker)
  - Prevention action
  - Detection action (faster time-to-detect)
  - Mitigation action (faster time-to-resolve)
```
