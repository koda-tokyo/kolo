# Unit Economics

## Table of Contents
1. [CAC & LTV Framework](#cac--ltv-framework)
2. [KODA KENKŌ Unit Economics](#koda-kenkō-unit-economics)
3. [Agent-Hour Cost Model](#agent-hour-cost-model)
4. [Inference Cost Modeling](#inference-cost-modeling)
5. [Revenue Models](#revenue-models)

---

## CAC & LTV Framework

### For B2B SaaS (Enterprise Healthcare)
```
CAC = Total Sales & Marketing Spend / Number of New Customers Acquired
LTV = (Average Revenue Per Customer × Gross Margin %) / Monthly Churn Rate
LTV:CAC Ratio Target: > 3x
Payback Period: CAC / Monthly Gross Profit Per Customer — target < 12 months
```

### CAC Composition for KodaSōken (projected)
| Component | % of CAC | Notes |
|-----------|---------|-------|
| Sales team (salary + commission) | 40% | Hospital sales cycles are long |
| Clinical demos & pilots | 25% | Free pilots are acquisition cost |
| Conference/event marketing | 15% | Medical conferences in Japan |
| Content & materials (Japanese) | 10% | Japanese-language case studies |
| Partner/referral commissions | 10% | EMR vendor referral fees |

### LTV for Japanese Hospitals
Japanese hospitals don't churn like SaaS customers — once integrated into clinical workflow, switching costs are extremely high. But pilot-to-contract conversion is the bottleneck, not churn.

**For KODA KENKŌ, model LTV differently:**
```
LTV = (Annual Contract Value × Expected Contract Duration) × Gross Margin
Where Expected Contract Duration = 5-7 years for hospital systems (conservative)
```

---

## KODA KENKŌ Unit Economics

### Per-Hospital Model
```
Unit: 1 hospital (200+ bed, medium-to-large, urban)
Annual Contract Value (ACV): ¥3M-8M (base platform + per-clinician modules)
Gross Margin: 70-80% (software — GPU is the main variable COGS)
Contribution Margin per Hospital: ¥2.1M-6.4M annually
Customer Acquisition Cost: ¥1.5M-3M (sales, pilot, integration)
Payback Period: 6-18 months depending on ACV tier
```

### Per-Clinician Model
```
Unit: 1 active clinician user
Monthly Revenue: ¥15,000-30,000 (per-user license add-on)
Monthly GPU/Inference Cost: ¥2,000-5,000 (depends on usage volume)
Monthly Contribution: ¥10,000-28,000
```

### Cost Drivers (per hospital deployment)
| Cost | Range | Type |
|------|-------|------|
| Initial data integration | ¥500k-1.5M | One-time |
| On-site training & onboarding | ¥300k-500k | One-time |
| Ongoing GPU inference | ¥50k-200k/month | Variable (usage-based) |
| Customer success (clinician support) | ¥100k-200k/month | Recurring |
| Compliance/security audit per hospital | ¥200k-500k | One-time (may repeat annually) |

---

## Agent-Hour Cost Model

For KodaSōken's AI agents (clinical documentation, decision support, etc.):

### Cost per Agent-Hour
```
Agent-Hour Cost = GPU Cost per Inference × Inferences per Hour + API Overhead
```

| Model Tier | GPU Cost/Hour | Inferences/Hour | Cost per Agent-Hour | Use Case |
|-----------|---------------|-----------------|---------------------|----------|
| Light (8B params) | ¥15 | 600 | ¥0.025 | Simple documentation |
| Medium (70B params) | ¥150 | 200 | ¥0.75 | Clinical note summarization |
| Heavy (API, GPT-4 class) | ¥500 | 60 | ¥8.33 | Complex differential diagnosis |

**Blended agent-hour cost** (assuming usage mix): ~¥2-5 per agent-hour. Charge ¥15-30 → healthy margin.

### Cost Optimization Path
1. **Distillation**: Fine-tune smaller models to match larger model quality on KodaSōken-specific tasks. 70B → 8B quality via distillation = 10x cost reduction.
2. **Batching**: Batch inference requests during hospital off-hours for non-real-time tasks.
3. **On-premise/edge**: For large hospitals (500+ beds), consider on-premise deployment to eliminate per-inference cloud costs. Higher upfront, lower marginal cost.

---

## Inference Cost Modeling

### Per-User Inference Cost
For a clinician user of KODA KENKŌ:

```
Monthly Inference Cost = Avg Queries per Day × Days Active × Cost per Query
```

| Clinician Type | Queries/Day | Days/Month | Cost/Query | Monthly Cost |
|---------------|-------------|------------|-----------|-------------|
| Light user (nurse) | 20 | 22 | ¥0.02 | ¥9 |
| Medium user (GP) | 50 | 22 | ¥0.50 | ¥550 |
| Heavy user (specialist) | 120 | 22 | ¥1.50 | ¥3,960 |

### Inference Cost Breakdown by Task
| Task | Model Size | Tokens (I/O) | Est. Cost | Latency Req. |
|------|-----------|-------------|-----------|-------------|
| SOAP note generation | Medium | 500/800 | ¥0.30 | <5s |
| Radiology report draft | Heavy | 200/1500 | ¥1.20 | <10s |
| Drug interaction check | Light | 100/50 | ¥0.01 | <2s |
| Clinical guideline lookup | Light (RAG) | 300/200 | ¥0.05 | <3s |
| Differential diagnosis | Heavy | 2000/3000 | ¥5.00 | <30s |

### GPU Procurement Strategy
- **Primary**: Cloud GPU (AWS p4d/p5, GCP A3) for flexibility during development
- **Secondary**: Reserved instances (1-year commitment, 30-40% discount) once usage patterns stabilize
- **Future**: Japan-based GPU cloud (Sakura Internet, IDCF) for data residency requirements. Japanese hospitals may require data to stay in Japan.
- **Fallback**: Spot/preemptible instances for batch inference, model training. Use for non-latency-sensitive workloads.

---

## Revenue Models

### Model 1: SaaS (Subscription)
```
Per hospital, per month. Tiered by bed count: <100 beds, 100-300, 300+.
Annual contracts with quarterly billing.
```

**Pros**: Predictable, fundable, investor-friendly. **Cons**: Hospital procurement hates monthly SaaS — annual contracts are easier to process.

### Model 2: Per-Transaction
```
Per clinical note, per radiology read, per drug check.
Micro-charges: ¥50-500 per transaction depending on complexity.
```

**Pros**: Aligns with usage, low barrier to start. **Cons**: Unpredictable revenue, hard to forecast, clinicians may self-ration.

### Model 3: Enterprise License
```
Flat annual fee per hospital for unlimited usage.
ACV: ¥5-15M depending on hospital size.
```

**Pros**: Simplest to sell, easy for procurement. **Cons**: Overuse risk if not capped; requires usage monitoring.

### Recommended Revenue Model (KODA KENKŌ)
**Hybrid: Base platform fee (SaaS) + per-clinician module add-ons + volume cap.**
- Base fee: ¥300k-500k/month per hospital (core platform)
- Per-clinician: ¥15k-30k/month (active user license)
- Volume cap: Included queries up to X; overage at ¥Y per query
- Annual contract with quarterly billing

This gives predictable revenue (SaaS base), growth alignment (per-clinician), and usage alignment (volume cap). This is the model most Japanese hospital CIOs are comfortable with.

### Revenue Model Benchmarks (Japanese Healthcare AI)
| Company | Model | ACV Range | Notes |
|---------|-------|-----------|-------|
| Ubie | SaaS + per-screen | ¥1-5M | Symptom checker for hospitals |
| AI Medical Service | Per-procedure | Variable | Endoscopic AI, NHI path |
| MediSpeak (hypothetical) | SaaS + per-clinician | ¥3-8M | Comparable to KODA KENKŌ |

**NHI Reimbursement Note**: The holy grail for healthcare AI in Japan is NHI (National Health Insurance) reimbursement as a medical device (SaMD). This path takes 3-5 years from PMDA approval. KODA KENKŌ's initial revenue model should not depend on NHI — build commercial revenue first, pursue NHI as upside.
