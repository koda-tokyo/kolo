# Privacy Engineering — Data Protection, Consent, Anonymization & Audit

## Purpose

Engineering privacy into systems from architecture, not bolted on after. Covers Japanese data protection law (APPI), healthcare privacy (next-gen medical infrastructure act), GDPR cross-relevance, consent management, data minimization, anonymization, pseudonymization, audit trail architecture, and privacy-by-design methodology. Built for KODA KENKŌ (medical data), Mnemosyne (bio→digital continuity), and all Kurahi data handling.

## Triggers

Use this skill for:

- Handling personal data, medical data, PHI (Protected Health Information)
- Designing consent flows or data subject rights mechanisms
- Anonymization or pseudonymization of datasets
- Privacy impact assessments (PIA)
- Audit trail design for data access/modification
- Cross-border data transfers (Japan → global)
- Data retention and deletion policies
- Privacy-by-design architecture review
- Any prompt involving: privacy, consent, anonymize, pseudonymize, PII, PHI, APPI, GDPR, data subject, right to erasure, data minimization, audit trail, data breach, personal information, medical data, patient data

## Core Knowledge

### Japan's APPI (Act on Protection of Personal Information) — Key Requirements

**Personal Information (個人情報):** Any information that can identify a specific individual. Includes name, birth date, contact info, but ALSO device IDs, IP addresses, cookie data when linkable to an individual.

**Special Care-Required Personal Information (要配慮個人情報):** Medical history, race, creed, criminal record, disability, genetic data. Higher protection standard. Explicit opt-in consent required for acquisition and transfer.

**Key Obligations:**

1. **Purpose specification (利用目的の特定):** Must specify and disclose the purpose of use. Cannot use data beyond the specified purpose.
2. **Consent for transfers (第三者提供の同意):** Opt-in consent required for third-party data transfers. Opt-out system (opt-out notification to PPC) is possible but limited.
3. **Security measures (安全管理措置):** Must take "necessary and appropriate" measures — organizational, human, physical, technical.
4. **Data subject rights:** Disclosure, correction, suspension of use, erasure.
5. **Breach notification:** Must report to PPC (Personal Information Protection Commission) and notify data subjects for certain breaches.
6. **Cross-border transfers:** Must obtain consent for transfers to countries without equivalent protection, OR ensure equivalent measures via contract.

### Next-Gen Medical Infrastructure Act (次世代医療基盤法)

For KODA KENKŌ specifically:

- Enables use of anonymized medical data for research and AI development
- Requires certification as an authorized anonymization processor (認定匿名加工医療情報作成事業者)
- Opt-out model: patients can refuse inclusion
- Data must be anonymized to the standard specified by the act (more rigorous than general APPI anonymization)
- Governance: certified body + ethics review committee

### Data Classification Tiers

```
Tier 4: IDENTIFIED     — Full name + medical record + contact. Maximum protection.
Tier 3: PSEUDONYMIZED  — ID replaced with code, key stored separately. High protection.
Tier 2: ANONYMIZED     — Cannot be re-identified with reasonable effort. Moderate protection.
Tier 1: AGGREGATED     — Statistical summaries only. Minimal protection.
Tier 0: PUBLIC         — Intended for public release. No protection needed.
```

### De-Identification Techniques (from weakest to strongest)

| Technique                           | Re-identification Risk | Data Utility          | Use Case                          |
| ----------------------------------- | ---------------------- | --------------------- | --------------------------------- |
| Direct identifier removal           | High                   | Full                  | Internal pseudonymized datasets   |
| k-anonymity (k≥5)                   | Medium                 | Good                  | Research datasets                 |
| l-diversity on sensitive attributes | Low                    | Reduced               | Published datasets                |
| t-closeness                         | Very Low               | Significantly reduced | Public datasets                   |
| Differential privacy (ε=1)          | Mathematical guarantee | Limited               | Aggregate statistics, public APIs |

### Privacy Impact Assessment (PIA) — Minimum Template

For any new system or feature handling personal data:

```markdown
# Privacy Impact Assessment: [Project Name]

## 1. Data Inventory

- What personal data is collected? (list every field)
- Is it Special Care-Required? (Y/N for each field)
- How is it collected? (user input, API, device, inference, third party)

## 2. Purpose & Lawful Basis

- What is the specific purpose of processing?
- Legal basis under APPI: [Consent | Contract | Legal obligation | Legitimate interests]
- If consent: how is it obtained? Can it be withdrawn?

## 3. Data Flow

- Where is data stored? (country, infrastructure)
- Who has access? (roles, not names)
- Is data transferred to third parties? To which countries?
- How long is data retained? Deletion mechanism?

## 4. Risk Assessment

- What's the worst-case scenario if this data is breached?
- Likelihood: [Low | Medium | High]
- Impact: [Low | Medium | High | Critical]

## 5. Mitigations

- Encryption at rest: [Yes/No — algorithm]
- Encryption in transit: [Yes/No — protocol]
- Access controls: [RBAC model, audit logging]
- Anonymization applied: [technique, re-identification risk level]
- Data minimization: what fields could we NOT collect?

## 6. Data Subject Rights

- How can a data subject request disclosure? deletion? correction?
- Response time commitment: [X business days — APPI requires "without delay"]

## 7. Sign-off

- Privacy review by: [Name/Role]
- Date: [YYYY-MM-DD]
- Review cycle: [Quarterly | Bi-annual | Annual]
```

### Consent Management — Design Principles

1. **Granular, not bundled.** Consent for analytics ≠ consent for ML training ≠ consent for third-party sharing. Separate checkboxes.
2. **Affirmative, not pre-checked.** Default must be OFF. Silence is not consent.
3. **Specific, not vague.** "We use your data to improve our services" → too broad. "We use your diagnostic images to train an AI model that detects condition X" → specific.
4. **Revocable, not permanent.** Withdrawing consent must be as easy as giving it. One click.
5. **Documented, not assumed.** Every consent action logged: who, what, when, how, version of consent text.

### Audit Trail Architecture

Every access, modification, or export of personal data must leave a trail:

```json
{
  "event_id": "audit-uuid-here",
  "timestamp": "2026-08-04T21:30:00+09:00",
  "actor": {
    "type": "user|system|agent",
    "id": "hashed-identifier",
    "role": "clinician|researcher|admin|automated"
  },
  "action": "read|create|update|delete|export|share|anonymize",
  "resource": {
    "type": "patient_record|dataset|model|consent",
    "id": "hashed-resource-id",
    "data_classification": "tier_4|tier_3|tier_2|tier_1|tier_0"
  },
  "context": {
    "purpose": "clinical_care|research_named_study|research_general|audit|maintenance",
    "authorization": "consent_id|study_protocol_id|legal_obligation_ref"
  },
  "result": "success|denied|error",
  "fields_accessed": ["diagnosis", "medication"], // or null for full record
  "export_destination": null // populated if data left the system
}
```

### Retention & Deletion

| Data Type                           | Minimum Retention                | Maximum Retention                                 | Deletion Trigger                     |
| ----------------------------------- | -------------------------------- | ------------------------------------------------- | ------------------------------------ |
| Clinical records                    | 5 years (Japan Medical Care Act) | Per institution policy                            | Retention period expiry              |
| Research data                       | Per study protocol               | Per consent agreement                             | Consent withdrawal, study completion |
| Consent records                     | Duration of data use + 3 years   | N/A                                               | Data deletion confirmed              |
| Audit logs                          | 3 years                          | Per risk assessment                               | Retention period expiry              |
| ML training data                    | Per consent                      | Per consent                                       | Consent withdrawal, model retirement |
| Identifiers mapping (pseudonym key) | Duration of pseudonym use        | Must be deleted when data is deleted              | Data deletion                        |
| De-identified/anonymized data       | N/A                              | May be retained indefinitely (if truly anonymous) | N/A                                  |

### Data Security Minimum Standards

For any system handling personal/medical data:

```
Encryption at rest:         AES-256-GCM (database, files, backups)
Encryption in transit:      TLS 1.3 (all internal and external connections)
Access control:             RBAC with principle of least privilege
Authentication:             MFA for all human access, token-based for machine access
Network segmentation:       Database in private subnet, no public IP
Secrets management:         HashiCorp Vault or cloud KMS, never in code/config
Backup encryption:          Encrypted with separate key from production
Audit logging:              Immutable storage, real-time alerting on anomaly
Penetration testing:        Annual minimum, plus after major architecture changes
Vulnerability scanning:     Continuous, with SLA for critical findings (24h)
```

### Breach Response — First 4 Hours

```
Hour 0: Detect & Confirm
  - Is this a confirmed breach? What data? How many subjects?

Hour 1: Contain
  - Revoke compromised credentials
  - Isolate affected systems
  - Stop the exfiltration

Hour 2: Assess
  - Scope: which records, which fields, how many subjects?
  - Sensitivity: Special Care-Required data involved?
  - Root cause: exploited vulnerability? misconfiguration? insider?

Hour 3: Notify (if required)
  - PPC notification within statutory timeframe
  - Data subject notification if risk of harm (identity theft, discrimination)
  - Legal counsel engaged

Hour 4: Document
  - Timeline of events (keep updating)
  - Evidence preservation (logs, system images)
  - Initial containment effectiveness
```

### Privacy-by-Design — 7 Principles (Cavoukian)

1. **Proactive, not reactive.** Prevent privacy issues before they occur.
2. **Privacy as the default.** No action required by the user to protect their privacy.
3. **Privacy embedded into design.** Not an add-on. Core architecture.
4. **Full functionality (positive-sum, not zero-sum).** Privacy AND utility, both.
5. **End-to-end security.** Full lifecycle protection.
6. **Visibility and transparency.** Users can see what's happening with their data.
7. **Respect for user privacy.** User-centric, consent-based, rights-preserved.

### KODA KENKŌ-Specific Privacy Checklist

Before deploying any healthcare AI system:

- [ ] Consent explicitly covers AI/ML use (not just "clinical care" or "research")
- [ ] Training data has documented consent provenance (when, how, what text was shown)
- [ ] Data cannot be re-identified from model outputs (membership inference defense)
- [ ] Model card published: training data composition, limitations, demographic performance
- [ ] Opt-out mechanism documented and tested (what happens when a patient withdraws consent?)
- [ ] Audit trail for every inference: who requested, for which patient, what was the output, was it acted upon?
- [ ] Data residency: all PHI processed and stored within Japan (MHLW expectation, not strict law — but failing it = trust destroyed)
- [ ] Breach response plan tested (tabletop exercise before go-live)

### Cross-Border Data Transfer — Japan Specifics

Under APPI, transfers to countries without "equivalent" protection require:

1. **Data subject consent** (specific, informed, opt-in) to the transfer to a country without equivalent protection, OR
2. **Contract** establishing equivalent protection between transferor and transferee

Safe countries (PPC determination of equivalent protection): EU/EEA, UK

For all other countries (including US): either explicit consent or binding contract.

**Healthcare context (KODA KENKŌ):** Even if APPI allows the transfer, Japanese patients expect medical data stays in Japan. Moving PHI offshore, even legally, is a trust risk that must be weighed against technical benefits.

### Data Minimization — The Best Privacy Tool

Before collecting any data field, ask:

1. Do we absolutely need this for the stated purpose?
2. Could we achieve the same result with less data? Coarser data? Older data?
3. What would break if we didn't collect this?

Every field you don't collect is a field that can't be breached.

## Anti-Patterns

- ❌ "We'll figure out privacy later" — impossible to retrofit
- ❌ Collecting everything "just in case it's useful for ML"
- ❌ Using production medical data for development/testing
- ❌ Storing PHI in logs, error messages, or debug output
- ❌ Sharing full datasets when aggregate statistics would suffice
- ❌ Assuming anonymization is permanent (re-identification techniques advance)
- ❌ Treating privacy as a compliance checkbox, not an architectural principle

---
