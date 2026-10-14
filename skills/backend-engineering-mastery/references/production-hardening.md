# Production Hardening — Enterprise-Grade Deployment

## The Oxford/Cambridge Verification Lineage

Oxford's formal verification tradition (Tony Hoare, Marta Kwiatkowska) and Cambridge's systems research (Ring, Xen, CHERI) inform the discipline of hardening: systematically eliminating failure modes through formal reasoning, defense in depth, and operational rigor. Production hardening is not one technique — it's the integration of all previous domains into a deployment that cannot fail.

---

## Deployment Patterns

### Blue-Green Deployment
```
BLUE (current production) → GREEN (new version)
1. Deploy to GREEN
2. Run smoke tests on GREEN
3. Route traffic from BLUE → GREEN (load balancer switch)
4. Monitor GREEN
5. Keep BLUE for rollback (idle, but ready)
→ Rollback: switch traffic back to BLUE (instant)
```

### Canary Deployment
```
1. Deploy new version alongside old
2. Route 1% traffic → new version
3. Monitor error rate, latency, correctness
4. 1% → 5% → 25% → 100% (gradual ramp)
5. If anomaly detected → automated rollback
```

### Rolling Update
```
1. Replace pods one at a time
2. Each new pod must pass health check before next old pod is terminated
3. maxSurge: 1 (extra pod during update), maxUnavailable: 0 (no capacity loss)
→ Standard for Kubernetes deployments
```

### Feature Flags (LaunchDarkly / OpenFeature)
```
if (featureFlag('new-patient-dashboard', user)) {
  return <NewDashboard />;
} else {
  return <OldDashboard />;
}
```
**Purpose:** Decouple deploy from release.
- Deploy: code is in production (technical act)
- Release: feature is visible to users (business act)
- → Deploy disabled. Enable gradually. Kill switch instantly.

---

## Multi-Region Architecture

### Active-Passive (Warm Standby)
```
Region A: Active (serves all traffic)
Region B: Standby (database replica, scaled to zero or min instances)
Failover: DNS update or BGP anycast switch → traffic to Region B
RTO: minutes (time to scale up + promote database)
Cost: moderate (standby infrastructure)
```

### Active-Active
```
Region A: Serves 50% traffic
Region B: Serves 50% traffic
Both regions: full capacity (can handle 100% if one fails)
Data sync: Multi-master replication or CRDTs
RTO: seconds (no failover needed — just stop sending to failed region)
Cost: 2× infrastructure
Complexity: High (conflict resolution, consistency tradeoffs)
```

### Region Selection
```
Latency: Users in Asia → Asia-Pacific region (Tokyo/Singapore)
Data Residency: MHLW requires patient data in Japan → must have Japan region
Provider Diversity: Not both regions on same cloud provider
  → Primary: AWS Tokyo
  → DR: GCP Osaka or on-premise (Koda Box)
```

---

## Infrastructure as Code

### Terraform Architecture
```
Environments:
  production/
    main.tf          # Provider config, remote state
    networking.tf    # VPC, subnets, security groups
    kubernetes.tf    # EKS/GKE cluster
    database.tf      # RDS/Cloud SQL
    dns.tf           # Route53/Cloud DNS
    
  staging/           # Mirrors production at reduced scale
  
  modules/           # Reusable components
    vpc/
    kubernetes/
    postgresql/

State: Remote (S3 + DynamoDB lock, or Terraform Cloud)
  NEVER local state. NEVER commit state to git (secrets may be in state).
```

### GitOps (ArgoCD / Flux)
```
Git repo = single source of truth for desired state
ArgoCD continuously reconciles: cluster state → git state
Any drift → auto-corrected (or alerted)

Workflow:
  1. PR to update deployment manifest (image tag, replica count)
  2. Merge → ArgoCD detects change → applies to cluster
  3. ArgoCD monitors health → reports status back to git (commit status)
```

---

## Kubernetes Production Patterns

### Pod Anti-Affinity (Spread across nodes)
```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
    - labelSelector:
        matchLabels:
          app: patient-api
      topologyKey: kubernetes.io/hostname
```
**Why:** If a node fails, only one pod from each service is affected. All eggs not in one basket.

### Pod Disruption Budget (PDB)
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
spec:
  minAvailable: 2  # At least 2 pods must be available during voluntary disruptions
```
**Why:** Node drains for maintenance won't take down the entire service.

### Resource Requests vs. Limits
```yaml
resources:
  requests:
    cpu: "500m"      # Guaranteed: scheduler ensures this is available
    memory: "512Mi"  # Guaranteed: OOM if usage exceeds request × overcommit factor
  limits:
    cpu: "2000m"     # Burst: can use up to this much if available
    memory: "1Gi"    # Hard limit: OOM kill if exceeded
```

**Request > Limit for memory:** Never set memory request > memory limit (contradiction).
**Limit without Request:** Kubernetes sets request = limit. This is usually wrong — wastes resources.
**No Limit:** Pod can consume all node resources. Starve neighbors.

### Horizontal Pod Autoscaling (HPA)
```yaml
metrics:
- type: Resource
  resource:
    name: cpu
    target:
      type: Utilization
      averageUtilization: 70  # Scale when average CPU > 70%
minReplicas: 2
maxReplicas: 10
```
**Scale-up speed:** HPA checks every 15s. New pod startup + health check must complete fast.

---

## Database High Availability

### PostgreSQL HA Options
```
Streaming Replication + Patroni + etcd:
  Patroni manages leader election. etcd stores leader state.
  Primary failure → Patroni promotes standby → VIP moves → ~30s failover

Cloud-native (RDS/Aurora/Cloud SQL):
  Managed HA. Multi-AZ. Automatic failover.
  Aurora: storage replicated 6 ways across 3 AZs automatically

For self-hosted (Koda Box):
  Patroni + etcd (or Consul) for automated failover
  pgBackRest for continuous WAL archiving + point-in-time recovery
```

### Connection Handling During Failover
```
Application → PgBouncer (connection pool) → PostgreSQL
During failover: PgBouncer pauses, waits for new primary, resumes
→ Application sees brief delay, not connection errors
```

---

## Observability Stack

### The Three Pillars (with storage)
```
Metrics:  Prometheus (short-term) + Thanos/Mimir (long-term)
  → System behavior over time. Alerting.

Logs:     Loki (lightweight, label-based) or Elasticsearch (full-text)
  → Debugging specific events. Tracing request flow.

Traces:   Tempo (object storage backed) or Jaeger
  → Request lifecycle across services. Performance bottlenecks.
```

### Dashboards That Matter
```
Golden Signals Dashboard (SRE):
  - Latency (p50, p90, p99)
  - Traffic (requests/second)
  - Errors (error rate by endpoint)
  - Saturation (CPU, memory, connection pool utilization)

Service Dashboard (per service):
  - Request rate, latency, error rate (RED method)
  - Dependency health (circuit breaker state, upstream latency)
  
Business Dashboard:
  - Active users, new patients registered, clinical documents processed
  - NOT just technical metrics — business outcomes
```

### Alerting Design
```
PAGE (wake someone up):
  - Service is down or largely unavailable
  - Error budget burn rate > critical threshold
  - Data loss or corruption
  - Security incident

TICKET (handle during business hours):
  - Disk > 80% full (still have time)
  - Certificate expiring in < 14 days
  - Slow but not broken (p99 latency > SLO but < 2× SLO)

NO ALERT (just dashboard):
  - CPU usage > 80% but service is healthy (just utilization)
  - Expected fluctuations
```

---

## Compliance and Hardening Checklist

### MHLW Data Residency (Japan Healthcare)
```
✓ All patient data stored AND processed in Japan region
✓ Encryption at rest: AES-256, keys in Cloud HSM or Vault
✓ Encryption in transit: TLS 1.3 for all connections
✓ Access logs: all PHI access logged with user, timestamp, purpose
✓ Audit trail: immutable log of all data modifications
✓ Retention policy: defined and enforced
✓ Data deletion: verifiable deletion on patient request
✓ Access control: role-based, minimum necessary, break-glass for emergencies
```

### Production Readiness Checklist
```
✓ Automated deployment (no manual commands in production)
✓ Rollback capability (can revert to previous version in < 5 minutes)
✓ Health checks (liveness + readiness probes)
✓ Graceful shutdown (SIGTERM handling, drain connections)
✓ Resource limits (CPU, memory, storage for every container)
✓ Monitoring (golden signals for every service)
✓ Alerting (page for critical, ticket for non-critical)
✓ Logging (structured JSON, aggregated)
✓ Backups (tested, automated, offsite)
✓ DR plan (documented, tested)
✓ Security scanning (container images, dependencies updated within SLA)
✓ Runbooks (for every alert that can page)
✓ Capacity planning (can handle 2× current peak)
✓ Chaos tested (at least pod-kill tested in staging)
```

---

## The Ship/No-Ship Decision

Before deploying to production, ask:
1. Can we roll back? (If not, what's the mitigation?)
2. What does degraded look like? (Graceful, not catastrophic?)
3. Who's on call? (And do they know about this deploy?)
4. What metrics tell us it's working? (And where's the dashboard?)
5. What metrics tell us it's broken? (And what's the alert?)
6. What's the blast radius? (Just this service, or the whole platform?)

If you can answer all 6 clearly: ship it.
If any answer is "I don't know": don't ship until you do.
