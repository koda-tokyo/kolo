# 06 — Production Infrastructure: Docker, K8s, CI/CD & Observability

## Table of Contents
1. [Docker Best Practices](#docker)
2. [Kubernetes Core](#kubernetes)
3. [CI/CD Pipeline Stages](#cicd)
4. [Zero-Downtime Deploys](#zero-downtime)
5. [Observability](#observability)
6. [Secrets Management](#secrets)
7. [Disaster Recovery](#disaster-recovery)
8. [Capacity Planning](#capacity-planning)
9. [Load Balancing](#load-balancing)

---

## Docker Best Practices {#docker}

### Multi-Stage Builds
Separate build dependencies from runtime — dramatically smaller production images.

```dockerfile
# === BUILD STAGE ===
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ./cmd/server

# === RUNTIME STAGE ===
FROM alpine:3.20
RUN apk --no-cache add ca-certificates tzdata
COPY --from=builder /app/server /usr/local/bin/server
RUN adduser -D -u 1000 appuser
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1
ENTRYPOINT ["/usr/local/bin/server"]
```

### Docker Security Checklist

| Check | Why |
|---|---|
| ✅ Use specific image tags (`alpine:3.20`), never `:latest` | Reproducible builds; avoid surprise CVEs |
| ✅ Run as non-root user (`USER appuser`) | Container escape risk; least privilege |
| ✅ Use `COPY` not `ADD` (unless tar/URL needed) | `ADD` has unexpected behaviors |
| ✅ Multi-stage builds | No build tools, compilers, or secrets in final image |
| ✅ `.dockerignore` file | Exclude `.git`, `node_modules`, secrets |
| ✅ Scan images (`docker scout`, Trivy, Snyk) | Detect known CVEs in base image |
| ✅ No secrets in image layers | Use build args for compile-time secrets; runtime secrets via K8s/Vault |
| ✅ Set resource limits in compose/K8s | Prevent noisy neighbor / OOM kills |
| ✅ Read-only root filesystem if possible | `--read-only` + tmpfs for `/tmp` |
| ✅ Minimize base image (distroless, scratch) | Smaller attack surface |

### HEALTHCHECK
Docker's built-in health probe — K8s can use this as liveness/readiness source.

```dockerfile
# Simple HTTP check
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Check a specific dependency
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s \
    CMD pg_isready -h $DB_HOST -U $DB_USER || exit 1
```

### Docker Commands Quick Reference
```bash
# Build with multi-stage
docker build -t myapp:v1.2.3 --target runtime .

# Scan for vulnerabilities
docker scout quickview myapp:v1.2.3

# Inspect layers (find bloat)
docker history myapp:v1.2.3 --no-trunc

# Run with security hardening
docker run --read-only --tmpfs /tmp \
    --memory=512m --cpus=1 \
    --security-opt=no-new-privileges \
    myapp:v1.2.3
```

---

## Kubernetes Core {#kubernetes}

### Pod — Smallest Deployable Unit
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app-pod
  labels:
    app: my-app
spec:
  containers:
  - name: app
    image: myapp:v1.2.3
    ports:
    - containerPort: 8080
    resources:
      requests:
        memory: "256Mi"
        cpu: "250m"
      limits:
        memory: "512Mi"
        cpu: "500m"
    livenessProbe:
      httpGet:
        path: /health
        port: 8080
      initialDelaySeconds: 30
      periodSeconds: 10
    readinessProbe:
      httpGet:
        path: /ready
        port: 8080
      initialDelaySeconds: 5
      periodSeconds: 5
```

### Deployment — Declarative Replica Management
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # Extra pods allowed during update
      maxUnavailable: 0  # Zero downtime (v1.26+: also use minReadySeconds)
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
        version: v1.2.3
    spec:
      containers:
      - name: app
        image: myapp:v1.2.3
        envFrom:
        - configMapRef:
            name: app-config
        - secretRef:
            name: app-secrets
```

### Service — Stable Network Endpoint
```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-app-svc
spec:
  type: ClusterIP       # Internal only (ClusterIP, NodePort, LoadBalancer)
  selector:
    app: my-app
  ports:
  - port: 80            # Service port
    targetPort: 8080    # Pod port
    protocol: TCP
```

### Ingress — HTTP/S Routing to Services

> **Note:** Kubernetes **Gateway API** is rapidly replacing Ingress as the standard (GA since 2023). Gateway API offers more expressive routing (HTTP header matching, traffic splitting by weight, named routes, cross-namespace gateways). For new projects, prefer Gateway API. Ingress is not deprecated but is limited compared to Gateway API.

```yaml
# Gateway API example (preferred for new projects)
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-app-route
spec:
  parentRefs:
  - name: my-gateway
  rules:
  - matches:
    - path:
        type: PathPrefix
        value: /api
    backendRefs:
    - name: my-app-svc
      port: 80

---
# Traditional Ingress (still widely used, less expressive)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - api.example.com
    secretName: api-tls
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: my-app-svc
            port:
              number: 80
```

### ConfigMap & Secret
```yaml
# ConfigMap — non-sensitive configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  LOG_LEVEL: "info"
  DB_MAX_CONNECTIONS: "100"
  CACHE_TTL_SECONDS: "300"

---
# Secret — sensitive data (base64-encoded, not encrypted by default!)
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
type: Opaque
stringData:            # Use stringData (plain text, K8s auto-encodes)
  DB_PASSWORD: "s3cr3t-p4ssw0rd"
  API_KEY: "sk-live-abc123xyz"
```

### Horizontal Pod Autoscaler (HPA)
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # Wait 5 min before scaling down
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
```

### K8s Architecture Quick Reference
```
┌─────────────────────────────────────────┐
│              Control Plane               │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │API Server│ │Scheduler │ │Control  │ │
│  │          │ │          │ │Manager  │ │
│  └──────────┘ └──────────┘ └─────────┘ │
│  ┌──────────┐                           │
│  │   etcd   │ (SSD-backed, odd # nodes)│
│  └──────────┘                           │
└─────────────────────────────────────────┘
              │
    ┌─────────┼─────────┬─────────┐
┌───┴───┐ ┌───┴───┐ ┌───┴───┐ ┌───┴───┐
│Worker │ │Worker │ │Worker │ │Worker │
│┌─────┐│ │┌─────┐│ │┌─────┐│ │┌─────┐│
││Pod  ││ ││Pod  ││ ││Pod  ││ ││Pod  ││
││┌───┐││ │└─────┘│ │┌───┐││ │└─────┘│
│││C1 │││ │       │ ││C1 │││ │       │
││└───┘││ │       │ │└───┘││ │       │
│└─────┘│ │       │ └─────┘│ │       │
│Kubelet│ │Kubelet│ │Kubelet│ │Kubelet│
│k-proxy│ │k-proxy│ │k-proxy│ │k-proxy│
└───────┘ └───────┘ └───────┘ └───────┘
```

---

## CI/CD Pipeline Stages {#cicd}

### Pipeline Architecture

```
┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐
│  LINT   │→│  TEST   │→│  BUILD   │→│  SCAN    │→│ DEPLOY  │→│ VERIFY   │
│         │  │         │  │          │  │          │  │         │  │          │
│• format  │  │• unit   │  │• docker  │  │• SAST    │  │• staging│  │• smoke   │
│• lint    │  │• integ  │  │• compile │  │• image   │  │• canary │  │• health  │
│• typechk │  │• e2e    │  │• artifact│  │• deps    │  │• prod   │  │• metrics │
└─────────┘  └─────────┘  └──────────┘  └──────────┘  └─────────┘  └──────────┘
   Fast         Medium        Slow          Medium        Staged       Fast
  (<2 min)     (<10 min)    (<15 min)      (<10 min)
```

### Sample GitHub Actions CI/CD

```yaml
name: CI/CD Pipeline
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-python@v5
      with: { python-version: '3.12' }
    - run: pip install ruff pytest
    - run: ruff check .
    - run: pytest --cov=. --cov-report=xml
    - uses: codecov/codecov-action@v4
      with: { files: ./coverage.xml }

  build-and-scan:
    needs: lint-and-test
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - name: Build Docker image
      run: docker build -t myapp:${{ github.sha }} .
    - name: Scan for vulnerabilities
      uses: aquasecurity/trivy-action@master
      with:
        image-ref: myapp:${{ github.sha }}
        format: sarif
        output: trivy-results.sarif
        severity: CRITICAL,HIGH
    - name: Push to registry
      run: |
        docker tag myapp:${{ github.sha }} registry.example.com/myapp:${{ github.sha }}
        docker push registry.example.com/myapp:${{ github.sha }}

  deploy-staging:
    needs: build-and-scan
    runs-on: ubuntu-latest
    steps:
    - uses: azure/k8s-deploy@v5
      with:
        manifests: k8s/deployment.yaml
        images: registry.example.com/myapp:${{ github.sha }}
        namespace: staging

  deploy-production:
    needs: deploy-staging
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production  # Requires approval / protection rules
    steps:
    - uses: azure/k8s-deploy@v5
      with:
        manifests: k8s/deployment.yaml
        images: registry.example.com/myapp:${{ github.sha }}
        namespace: production
```

### Pipeline Best Practices
- **Fail fast**: Linting first, then unit tests, then integration, then build
- **Caching**: Cache dependencies (`node_modules`, `pip cache`, Go modules)
- **Artifact once**: Build Docker image once, promote across environments
- **Branch protection**: Require PR reviews, CI passing before merge
- **Secrets**: Never hardcode; use GitHub Secrets / Vault / K8s SealedSecrets
- **Environment gates**: Require manual approval for production deploys

---

## Zero-Downtime Deploys {#zero-downtime}

### Rolling Update (K8s Default)
```
v1:  [██] [██] [██] [██] [██]  →  5 replicas
v2:  [  ] [  ] [  ] [  ] [  ]

Step 1: v2 [██] is created → v1 [xx] terminated
v1:  [██] [██] [██] [██] [  ]
v2:  [██] [  ] [  ] [  ] [  ]

Step 2-N: repeat until all v2
v1:  [  ] [  ] [  ] [  ] [  ]
v2:  [██] [██] [██] [██] [██]
```

**When to use**: Standard deploys; compatible API changes
**Risks**: Old and new versions briefly coexist; ensure backward compatibility

### Blue-Green Deployment
```
BLUE (v1, active):  [██] [██] [██]  ← traffic
GREEN (v2, idle):   [  ] [  ] [  ]

Step 1: Deploy v2 to GREEN
BLUE (v1):  [██] [██] [██]  ← traffic
GREEN (v2): [██] [██] [██]

Step 2: Switch traffic → GREEN
BLUE (v1):  [██] [██] [██]  (standby, quick rollback)
GREEN (v2): [██] [██] [██]  ← traffic
```

**When to use**: Major version upgrades; risky changes; need instant rollback
**Cost**: 2x infrastructure during deploy

### Canary Deployment
```
v1 (stable): [██] [██] [██] [██] [  ]  ← 80% traffic
v2 (canary): [██]                          ← 20% traffic

Phase 1: 5%  traffic → monitor 10 min
Phase 2: 25% traffic → monitor 30 min
Phase 3: 100% traffic → v2 is stable, decommission v1
```

**When to use**: Validate new version with real traffic; minimize blast radius
**Requires**: Traffic splitting (service mesh / ingress); monitoring for comparison

### Shadow (Traffic Mirroring)
```
v1 (active):  [██] [██] [██] [██] [██]  ← 100% production traffic
v2 (shadow):  [██]                              ← mirrored copy (responses discarded)
```

**When to use**: Test v2 under real load without affecting users
**Requires**: Traffic mirroring (Envoy/Istio); v2 must handle production data patterns

### Deployment Comparison

| Pattern | Rollback Speed | Infrastructure Cost | Blast Radius | Complexity |
|---|---|---|---|---|
| **Rolling** | Slow (reverse rollout) | No extra | Medium | Low |
| **Blue-Green** | Instant (switch LB) | 2x | Low (full cutover) | Medium |
| **Canary** | Medium (reduce %) | ~10-25% extra | Small (controlled %) | High |
| **Shadow** | N/A (no production impact) | 1x + shadow infra | None | Very high |

---

## Observability {#observability}

### Three Pillars + One

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  Logs    │  │ Metrics  │  │  Traces  │  │ Profiles │
├──────────┤  ├──────────┤  ├──────────┤  ├──────────┤
│What      │  │How much/ │  │Where time│  │Why slow? │
│happened  │  │how fast? │  │is spent? │  │(CPU/mem) │
├──────────┤  ├──────────┤  ├──────────┤  ├──────────┤
│Timestamp │  │Gauges    │  │Spans     │  │Flame     │
│structured│  │Counters  │  │Trace ID  │  │graphs    │
│JSON      │  │Histograms│  │Context   │  │pprof     │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
   ELK/Loki     Prometheus     Jaeger/OTel   Pyroscope
```

### RED Method (Request-Driven Services)
For every service, measure:
- **R**ate: requests per second
- **E**rrors: error rate (4xx client errors? 5xx server errors?)
- **D**uration: latency distribution (p50, p95, p99)

### USE Method (Resource-Driven)
For every resource (CPU, memory, disk, network):
- **U**tilization: % of capacity used
- **S**aturation: queue depth / work waiting
- **E**rrors: error count (disk failures, network drops)

### Four Golden Signals (Google SRE)
1. **Latency**: Time to serve a request (distinguish success vs. error latency!)
2. **Traffic**: Demand on the system (requests/s, transactions/s)
3. **Errors**: Rate of failed requests (explicit 5xx, implicit slow responses)
4. **Saturation**: How "full" the service is (queue depth, thread pool, GC pressure)

### Prometheus Alerting Rule Example

```yaml
groups:
- name: api-alerts
  rules:
  
  # Four Golden Signals
  - alert: HighErrorRate
    expr: |
      rate(http_requests_total{status=~"5.."}[5m]) 
      / rate(http_requests_total[5m]) > 0.01
    for: 5m
    labels:
      severity: critical
      team: backend
    annotations:
      summary: "High error rate on {{ $labels.service }}"
      description: "Error rate is {{ $value | humanizePercentage }} (threshold: 1%)"
      runbook_url: "https://wiki.example.com/runbooks/high-error-rate"
  
  - alert: HighLatency
    expr: |
      histogram_quantile(0.99,
        rate(http_request_duration_seconds_bucket[5m])
      ) > 1.0
    for: 10m
    labels:
      severity: warning
    annotations:
      summary: "p99 latency > 1s on {{ $labels.service }}"
      description: "p99: {{ $value }}s"
  
  - alert: ServiceDown
    expr: up == 0
    for: 2m
    labels:
      severity: page  # Wake someone up
    annotations:
      summary: "{{ $labels.instance }} is DOWN"

  # Saturation — queue depth
  - alert: HighQueueDepth
    expr: task_queue_depth > 1000
    for: 15m
    labels:
      severity: warning
    annotations:
      summary: "Task queue depth > 1000 on {{ $labels.queue }}"
```

### Observability Stack Comparison

| Stack | Logs | Metrics | Traces | Alerting | Dashboards |
|---|---|---|---|---|---|
| **ELK** (Elastic) | ✅ ✅ | ✅ | ✅ (APM) | ✅ (Kibana) | ✅ |
| **Grafana LGTM** | ✅ (Loki) | ✅ (Mimir) | ✅ (Tempo) | ✅ (AlertManager) | ✅ ✅ |
| **Datadog** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **New Relic** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **OpenTelemetry + Prometheus + Jaeger** | — | ✅ | ✅ | ✅ (AlertManager) | ✅ (Grafana) |

---

## Secrets Management {#secrets}

### HashiCorp Vault

```
┌─────────────────────────────────────────────┐
│                 VAULT                        │
│  ┌──────────────┐  ┌──────────────┐        │
│  │ Static       │  │ Dynamic      │        │
│  │ Secrets      │  │ Secrets      │        │
│  │ • API keys   │  │ • DB creds   │←───────│── auto-rotated, short-lived
│  │ • TLS certs  │  │ • Cloud IAM  │        │
│  └──────────────┘  └──────────────┘        │
│  ┌──────────────────────────────┐          │
│  │    Encryption as a Service   │          │
│  │  • Transit engine            │          │
│  │  • Encrypt/decrypt w/o app   │          │
│  │    knowing master key        │          │
│  └──────────────────────────────┘          │
└─────────────────────────────────────────────┘
```

**Dynamic DB Credentials Pattern:**
```hcl
# Vault: Enable database secrets engine
vault secrets enable database

# Configure PostgreSQL connection
vault write database/config/postgres-db \
    plugin_name=postgresql-database-plugin \
    allowed_roles="readonly,readwrite" \
    connection_url="postgresql://{{username}}:{{password}}@db-host:5432/mydb" \
    username="vault-admin" \
    password="admin-password"

# Create role: generates temp credentials on read
vault write database/roles/readonly \
    db_name=postgres-db \
    creation_statements="CREATE USER \"{{name}}\" WITH PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
    default_ttl="1h" \
    max_ttl="24h"
```

**App retrieves credentials:**
```python
import hvac

client = hvac.Client(url='https://vault.internal:8200')
client.auth.kubernetes.login(role='my-app', jwt=k8s_jwt_token)

# Dynamic: creates NEW temporary DB credentials each time
creds = client.secrets.database.generate_credentials('readonly')
db_user = creds['data']['username']   # v-token-readonly-abc123
db_pass = creds['data']['password']   # auto-generated, expires in 1h

# Static: reads existing secret
secret = client.secrets.kv.v2.read_secret_version(path='stripe/api-key')
api_key = secret['data']['data']['key']
```

### SOPS (Secrets OPerationS)
Encrypt secrets in Git — safe to commit encrypted files.

```bash
# Encrypt a YAML file with KMS
sops --encrypt --kms arn:aws:kms:us-east-1:123456789:key/abc-123 \
     secrets.yaml > secrets.enc.yaml

# File content (committed to Git):
# api_key: ENC[AES256_GCM,data:abc123...,iv:def456...,tag:ghi789...,type:str]
# db_password: ENC[AES256_GCM,data:xyz789...,iv:...]

# Decrypt at deploy time
sops --decrypt secrets.enc.yaml > secrets.yaml
```

### Secret Rotation Pattern

```python
import time
import threading

class SecretRotator:
    """Rotates secrets before they expire."""
    
    def __init__(self, vault_client, secret_path, ttl_buffer=600):
        self.client = vault_client
        self.secret_path = secret_path
        self.ttl_buffer = ttl_buffer  # Refresh 10 min before expiry
        self.current = None
        self.lock = threading.RLock()
        self.schedule_next()
    
    def fetch_new(self):
        """Fetch fresh secret from Vault."""
        resp = self.client.secrets.kv.v2.read_secret_version(self.secret_path)
        data = resp['data']['data']
        lease_duration = resp['data'].get('lease_duration', 3600)  # seconds
        self.current = data
        self.schedule_next(lease_duration)
        return data
    
    def schedule_next(self, lease_duration=None):
        """Schedule next rotation before current secret expires."""
        if lease_duration:
            delay = max(lease_duration - self.ttl_buffer, 60)
            threading.Timer(delay, self.fetch_new).start()
    
    def get(self):
        """Thread-safe access to current secret."""
        with self.lock:
            if not self.current:
                return self.fetch_new()
            return self.current
```

### Secret Management Comparison

| Approach | Security | Complexity | Use Case |
|---|---|---|---|
| **K8s Secrets (plain)** | Low (base64, not encrypted) | Minimal | Development only |
| **Sealed Secrets** | Medium (encrypted in Git) | Low | GitOps with K8s |
| **SOPS + KMS** | High | Medium | Git-based workflows |
| **HashiCorp Vault** | Very High | High | Dynamic secrets, audit, enterprise |
| **Cloud-native (AWS Secrets Manager, GCP Secret Manager)** | High | Low | Cloud-only deployments |
| **External Secrets Operator** | High | Medium | Sync cloud secrets → K8s secrets |

---

## Disaster Recovery {#disaster-recovery}

### RPO and RTO
```
    ┌─────────────── RPO ───────────────┐
    │  (acceptable data loss)           │
    │                                   │
────┼───────────────────────────────────┼─────► time
    │  Disaster                        │
    │  strikes                   Recovery
    │                           point
    │                                   │
    └────────── RTO ─────────────────────┘
               (time to restore service)
```

| Metric | Definition | Target Examples |
|---|---|---|
| **RPO** | Maximum acceptable data loss (time) | Tier 1: < 1 min (sync replication); Tier 4: 24h (daily backup) |
| **RTO** | Maximum acceptable downtime | Tier 1: < 5 min; Tier 4: 72h |

### Backup Strategies

| Strategy | RPO | Storage Cost | Restore Speed |
|---|---|---|---|
| **Full backup** | Hours to days | High | Fast (single restore) |
| **Incremental** (since last backup) | Hours | Medium | Medium (chain restore) |
| **Differential** (since last full) | Hours | Medium | Medium |
| **Continuous / CDP** | Seconds | Very high | Fast |
| **WAL archiving** (PostgreSQL) | Seconds | Medium | PITR (point-in-time recovery) |
| **Snapshot** (block-level) | Minutes | Low (copy-on-write) | Fast |

### PostgreSQL PITR Example
```bash
# Continuous archiving config (postgresql.conf)
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://backups/wal/%f'

# Base backup
pg_basebackup -D /backup/base -Ft -z -P

# Point-in-time recovery
# restore_command = 'aws s3 cp s3://backups/wal/%f %p'
# recovery_target_time = '2026-05-19 14:30:00 JST'
```

### DR Tiers (Simplified)

| Tier | RPO | RTO | Architecture | Cost Multiplier |
|---|---|---|---|---|
| **Tier 1: Hot** | < 1 min | < 5 min | Active-active multi-region | 2.5x |
| **Tier 2: Warm** | < 5 min | < 60 min | Active-passive, warm standby | 1.5x |
| **Tier 3: Cold** | < 4 hours | < 8 hours | Restore from snapshots to new infra | 1.1x |
| **Tier 4: Backup-only** | < 24 hours | < 72 hours | Restore from tape/S3 | 1.05x |

### DR Checklist
- ✅ RPO/RTO defined and documented per service
- ✅ Backups regularly tested (restore drills monthly)
- ✅ Runbook exists (and has been tested by someone other than author)
- ✅ Multi-region? Test failover (do it on a Tuesday afternoon, not Friday at 5pm)
- ✅ DNS TTL is low enough for fast cutover (60-300 seconds, not 86400)
- ✅ Stateful services (DB) have replication + backup
- ✅ Stateless services can be redeployed from IaC

---

## Capacity Planning {#capacity-planning}

### Back-of-Envelope Reference Numbers

| Resource | Approximate Capacity | Notes |
|---|---|---|
| 1 CPU core | ~5K–10K simple req/s | Depends on language, framework, I/O vs compute |
| 1 GB RAM | ~1M concurrent connections (Go) | Connection state costs ~1 KB |
| 1 Gbps network | 125 MB/s | ~10K × 10 KB req/s |
| PostgreSQL (4 vCPU, 16 GB) | ~5K TPS (mixed reads/writes) | Disk I/O typically bottleneck |
| Redis (single-threaded) | 100K–200K ops/s | CPU-bound; pipeline for more |
| Kafka broker | ~1M msgs/s, ~100 MB/s per broker | Disk throughput is bottleneck |
| Nginx (reverse proxy) | 50K–100K req/s | Connection count limited by RAM |
| CDN edge | 100K–1M req/s per PoP | Limited by bandwidth, not compute |

### Estimation Formulas

```
Requests/sec    = (DAU × Requests_per_user_per_day) / 86400
Peak QPS        = Average QPS × Peak multiplier (typically 2-5x)

Bandwidth       = Peak QPS × avg_response_size (in bits)
                = QPS × 8 × response_size_KB × 1024

Storage         = (Data_per_day × retention_days) + (Data_per_day × 365 × years)
                = Write_throughput_MBps × 86400 × retention_days

Cache memory    = (Hot_keys × avg_value_size) + 20% overhead
                ≈ (DAU × 0.01 × avg_cache_size_KB × 1024) + overhead

DB connections  = application_instances × pool_size
                = (Peak QPS × avg_query_duration_seconds) + buffer
```

### Capacity Planning Example: Social Feed Service

```
Assumptions:
  - 10M DAU
  - 50 requests/user/day (feed refresh, scroll, like, comment)
  - Avg response: 15 KB JSON
  - Peak multiplier: 3x
  - Data retention: 1 year

Calculations:
  Avg QPS     = (10M × 50) / 86400 = 5789 req/s
  Peak QPS    = 5789 × 3 = 17,367 req/s
  
  Bandwidth   = 17367 × 15 × 1024 × 8 = ~2.13 Gbps
  
  New content: Assume 1% of requests create content (175 create/s)
  Data/day    = 175 × 2 KB avg × 86400 ≈ 30 GB/day
  Storage/yr  = 30 × 365 ≈ 10.9 TB (raw) × 3 (replication) ≈ 33 TB

Infrastructure:
  App servers: 17367 req/s / 5000 req/s per core ≈ 4 cores → 4 × t3.large (2 vCPU)
               → ~8 instances for redundancy + headroom
  Cache:       0.5% of data is hot → 33 TB × 0.005 ≈ 165 GB → 2 × r6g.xlarge (32 GB)
               → ~4 Redis nodes (each ~32 GB) with cluster
  DB:          30 GB/day writes, 5000 TPS → ~4 × r6g.2xlarge (8 vCPU, 64 GB)
               → 1 writer + 2 read replicas
  CDN:         2.13 Gbps → basically any CDN plan handles this
```

### Capacity Planning Anti-Patterns
- ❌ "We'll scale when we need to" — scaling isn't instant; warm up before events
- ❌ Planning for average, ignoring peak — peak is what kills systems
- ❌ Ignoring stateful services — stateless scales; databases don't
- ❌ Single-region planning — assume entire region can fail
- ❌ No load testing — back-of-envelope is a start, not a conclusion

---

## Load Balancing {#load-balancing}

### Layer 4 vs. Layer 7

| | L4 (Transport) | L7 (Application) |
|---|---|---|
| **OSI layer** | TCP/UDP | HTTP/HTTPS, gRPC, WebSocket |
| **Routing decision** | IP + port | URL path, headers, cookies, method |
| **SSL termination** | Pass-through | Terminate at LB (offload crypto) |
| **Sticky sessions** | By source IP | By cookie (more reliable) |
| **Content-based routing** | ❌ | ✅ (`/api/*` → backend-A, `/static/*` → CDN) |
| **Performance** | Higher (less processing) | Slightly lower (inspects payload) |
| **Example** | HAProxy (TCP mode), AWS NLB | Nginx, HAProxy (HTTP mode), AWS ALB, Envoy |

### Load Balancing Algorithms

| Algorithm | How It Works | Best For |
|---|---|---|
| **Round Robin** | Sequentially to each server | Homogeneous servers |
| **Least Connections** | To server with fewest active connections | Heterogeneous workloads |
| **Least Response Time** | To server with lowest latency | Performance-sensitive |
| **IP Hash** | `hash(src_ip) % N` — same IP → same server | Session persistence (L4) |
| **Weighted** | Servers get proportional share | Heterogeneous capacity |
| **Random** | Randomly choose (two-random-choices = near optimal!) | Simple, surprisingly good |
| **Consistent Hash** | Key mapped to ring; minimal remap on scale | Cache/stateful routing |
| **Power of Two Choices** | Pick 2 random, send to less loaded | Near-optimal with minimal state |

### Health Checks

```nginx
# Nginx active health check (nginx-plus or open source with module)
upstream backend {
    server 10.0.1.10:8080;
    server 10.0.1.11:8080;
    server 10.0.1.12:8080;
}

server {
    listen 443 ssl;
    
    location / {
        proxy_pass http://backend;
        proxy_next_upstream error timeout http_500 http_502 http_503;
        proxy_next_upstream_tries 2;  # Retry up to 2 other servers
        proxy_next_upstream_timeout 10s;
    }
    
    # Passive health check: mark server "down" after 3 failures in 30s
    # (nginx automatically tracks failures)
    # Active health check (nginx plus):
    # health_check interval=5s fails=3 passes=2 uri=/health;
}
```

### SSL Termination
```
                 ┌──────────┐
Client ──TLS────→│    LB    │──HTTP──→ Backend
                 │ (decrypt)│
                 └──────────┘

Benefits:
  - Backend doesn't spend CPU on crypto (can be 10-30% overhead)
  - Centralized certificate management
  - LB can inspect headers for routing (L7)
  - WAF/IDS can inspect traffic
```

### Auto-Scaling Configuration (AWS Example)
```yaml
# Auto Scaling Group
ASG:
  min_size: 2
  max_size: 20
  desired_capacity: 4
  health_check_type: ELB
  health_check_grace_period: 300

# Scaling Policies
ScaleOut:
  metric: CPUUtilization > 70% for 3 minutes
  adjustment: +2 instances
  cooldown: 300 seconds

ScaleIn:
  metric: CPUUtilization < 30% for 10 minutes
  adjustment: -1 instance
  cooldown: 600 seconds

# Scheduled Scaling (predictable traffic)
MorningSpike:
  schedule: "0 8 * * 1-5"  # 8 AM weekdays
  min_size: 6, desired: 8
EveningLull:
  schedule: "0 22 * * 1-5" # 10 PM weekdays
  min_size: 2, desired: 3
```

### Load Balancer Architecture Pattern
```
                    ┌─────────────┐
                    │   DNS / GSLB │
                    │ (Route53,    │
                    │  Cloudflare) │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  LB (AZ1)│ │  LB (AZ2)│ │  LB (AZ3)│  ← Layer 7 (ALB)
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │             │
        ┌────┴────┐  ┌────┴────┐  ┌────┴────┐
        │App Pods │  │App Pods │  │App Pods │
        │(AZ1)    │  │(AZ2)    │  │(AZ3)    │
        └─────────┘  └─────────┘  └─────────┘
```

### Interview Tips: Load Balancing
- **Describe L4 vs L7** and when you'd use each
- **Explain sticky sessions** and why they're a code smell (stateful backends)
- **Mention health checks**: active (LB probes `/health`) vs. passive (observe failures)
- **Connection draining**: Before removing a server, stop new connections; wait for active requests to finish
- **SSL offloading vs. pass-through**: trade-offs of security, performance, and inspection
