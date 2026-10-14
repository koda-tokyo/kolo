# Regulatory Compliance Engineering — MHLW, PMD Act, SaMD & Quality Systems

## Purpose
Engineer compliance into healthcare AI systems from requirements through validation, not retrospectively. Covers Japanese pharmaceutical/medical device regulation (PMD Act), Software as a Medical Device (SaMD) frameworks, MHLW submission pathways, quality management systems (ISO 13485, JIS Q 13485), clinical validation requirements, and post-market surveillance. Built for KODA KENKŌ and any healthcare AI system operating in Japanese regulated space.

## Triggers
Use this skill for:
- MHLW regulatory strategy and submission planning
- PMD Act classification (is this a medical device? what class?)
- SaMD (Software as a Medical Device) compliance
- Quality Management System design (ISO 13485)
- Clinical validation protocol design
- Regulatory documentation: 承認申請書, 添付資料, サマリー
- Post-market surveillance (PMS) and vigilance reporting
- AI-as-medical-device lifecycle management
- GxP compliance (GCP, GMP, GQP, GVP)
- Any prompt involving: MHLW, PMD Act, 薬機法, SaMD, 医療機器, approval, 承認, clinical trial, 治験, ISO 13485, QMS, quality system, post-market, vigilance, adverse event, 不具合

## Core Knowledge

### PMD Act (薬機法) — Regulatory Framework

The Pharmaceuticals and Medical Devices Act governs all medical devices in Japan, including software.

**Medical Device Definition (Article 2, Paragraph 4):**
> Equipment or instruments intended for use in the diagnosis, treatment, or prevention of disease in humans or animals, or intended to affect the structure or function of the body.

**Key Point:** Software that provides diagnostic or therapeutic recommendations IS a medical device under PMD Act. An LLM that suggests diagnoses to doctors — regulated. An LLM that summarizes medical literature without making clinical suggestions — may not be regulated.

### Device Classification & AI

| Class | Risk | Examples | Conformity Route |
|-------|------|----------|-----------------|
| **Class I** (一般) | Minimal | Medical calculators, simple reference tools | Self-declaration (自己認証) |
| **Class II** (管理) | Low-Medium | Diagnostic support with human override, triage assistants | Third-party certification (第三者認証) — JQA, TÜV |
| **Class III** (高度管理) | Medium-High | AI primary diagnosis, treatment planning without human override | MHLW approval (承認) — PMDA review |
| **Class IV** (高度管理) | Highest | Life-sustaining devices, AI-controlled drug delivery | MHLW approval (承認) — PMDA review |

**For KODA KENKŌ AI systems:**
- Diagnostic support WITH human doctor confirmation → likely Class II
- Autonomous diagnosis or treatment recommendation → likely Class III
- Medical literature search/summarization without clinical recommendation → may not be a medical device at all

### AI-Specific Regulatory Challenges

1. **Continuous learning:** Traditional devices are static. AI models that update post-approval need a change management plan. "Locked" models (frozen at approval) are the current standard. "Adaptive" models (continuously learning) are not yet fully addressed by PMD Act.

2. **Explainability:** PMDA expects you to explain how the AI reaches conclusions. The black box problem is not an excuse — you need post-hoc explainability (SHAP, LIME, attention visualization) AND documented performance boundaries.

3. **Data provenance:** Training data origin, composition, and labeling methodology must be documented. Data that doesn't represent the Japanese population is a specific concern.

4. **Bias and fairness:** Must demonstrate performance across demographic subgroups relevant to the Japanese population (age, sex, region). Foreign-trained models adapted for Japan need specific validation.

### QMS — ISO 13485 / JIS Q 13485 Minimum Structure

For Class II+ devices, a Quality Management System is mandatory:

```
1. Quality Manual — top-level policies, scope, exclusions
2. Document Control — SOPs, templates, versioning
3. Design Controls — user needs → design inputs → design outputs → verification → validation
4. Risk Management — ISO 14971 integration, FMEA, hazard analysis
5. Purchasing Controls — vendor qualification, component traceability
6. Production Controls — build processes, configuration management
7. Measurement & Analysis — monitoring, internal audit, CAPA
8. Non-Conforming Product — detection, containment, disposition
9. Corrective & Preventive Action (CAPA) — root cause, fix, verify
10. Management Review — quarterly review, resource allocation, quality objectives
```

### Design History File (DHF) — What Goes In

For an AI medical device:

```
DHF-001: User Needs Specification
  - Clinical problem statement
  - Intended use, indications for use
  - User population (clinicians? patients? both?)
  - Use environment (hospital? clinic? home?)

DHF-002: Design Input Requirements
  - Performance requirements (sensitivity ≥ X%, specificity ≥ Y%)
  - Safety requirements (failure modes, fallback behavior)
  - Usability requirements (workflow integration, training time)
  - Regulatory requirements (applicable standards, guidance)

DHF-003: Design Output / Technical Specification
  - Model architecture, base model selection rationale
  - Training data specification (source, size, composition, preprocessing)
  - Training methodology (LoRA, full fine-tune, hyperparameters)
  - Evaluation methodology (holdout set, cross-validation, benchmarks)

DHF-004: Design Review Records
  - Architecture review sign-off
  - Clinical advisor review sign-off
  - Regulatory advisor review sign-off

DHF-005: Verification Protocol & Results
  - Unit tests for inference pipeline
  - Integration tests for API/model serving
  - Performance verification against design inputs

DHF-006: Clinical Validation Protocol & Results
  - Study design (retrospective? prospective? RCT?)
  - Primary endpoints
  - Sample size justification
  - Statistical analysis plan
  - Results (per subgroup, with confidence intervals)
  - Clinical significance interpretation

DHF-007: Risk Management File (ISO 14971)
  - Hazard identification
  - Risk estimation (severity × probability)
  - Risk control measures
  - Residual risk evaluation
  - Benefit-risk analysis

DHF-008: Labeling
  - Instructions for Use (IFU)
  - Indications, contraindications, warnings, precautions
  - Performance characteristics disclosure
  - Training requirements

DHF-009: Design Transfer to Production
  - Model weights with version hash
  - Serving infrastructure specification
  - Monitoring and alerting configuration
```

### MHLW Submission — Key Documents

For Class III/IV PMDA review:

| Document (Japanese) | English | Key Content |
|---------------------|---------|-------------|
| 承認申請書 | Application Form | Device name, classification, intended use, manufacturer |
| 添付資料 イ | Attachment イ — Origin/Background | Why this device, clinical need, development history |
| 添付資料 ロ | Attachment ロ — Manufacturing | Manufacturing process, quality control, sterilization if applicable |
| 添付資料 ハ | Attachment ハ — Safety | Pre-clinical safety data, biocompatibility, electrical safety |
| 添付資料 ニ | Attachment ニ — Performance | Bench testing, accuracy, reliability, clinical validation |
| 添付資料 ホ | Attachment ホ — Risk Analysis | ISO 14971 risk management summary, benefit-risk |
| 添付資料 ヘ | Attachment ヘ — Clinical Evidence | Clinical study design, results, statistical analysis |
| サマリー | Summary of Technical Documentation (STED) | Condensed engineering overview for reviewer |

### Pre-Submission Consultation (対面助言)

Before formal submission, PMDA offers pre-submission consultations:
- **Types:** Formal (60-90 min meeting with written record), informal (phone/email), prior assessment consultation
- **Cost:** ¥200,000-500,000 depending on type
- **Timing:** Schedule 2-3 months in advance
- **Value:** De-risks the actual submission. PMDA tells you what they'll want to see. USE THIS.

### Post-Market Surveillance (PMS)

Once approved, ongoing obligations:

```
1. Adverse Event Reporting
   - Death or serious health threat: 15 days
   - Other serious events: 30 days
   - Non-serious: periodic report
   
2. Periodic Safety Update
   - Class III/IV: every 2 years for first 6 years, then per re-certification
   - Class II: per certification body requirements
   
3. Change Management
   - "Minor change" notification (軽微変更届): 30 days before
   - "Partial change" approval (一部変更承認): PMDA review (6-12 months)
   - Model update = likely "partial change" if performance characteristics change
   
4. Recertification / Renewal
   - Class III/IV: approval valid for 5-7 years, then renewal review
   - Must demonstrate continued safety and effectiveness
```

### Clinical Validation — AI Medical Device

**Retrospective Study (minimum for Class II):**
- Existing data (medical records, images)
- Show AI performance vs. ground truth (human expert consensus)
- Subgroup analysis (age, sex, comorbidity, severity)
- Publication in peer-reviewed journal strongly recommended

**Prospective Observational Study (Class III minimum):**
- Real-time AI predictions in clinical workflow
- AI output NOT used for clinical decisions (shadow mode)
- Compare AI recommendation vs. actual clinical decision
- Measure: agreement rate, time to diagnosis, potential for improved outcomes

**Randomized Controlled Trial (Class III/IV, high-risk):**
- Clinicians randomized to AI-assisted vs. standard care
- Primary endpoint: clinical outcome (not just accuracy)
- Requires: large sample, multi-center, IRB approval at each site
- Cost: ¥100M-500M+. Time: 2-4 years.

### Regulatory Strategy Decision Tree

```
Is the software intended for diagnosis/treatment/prevention?
  NO → Not a medical device. General product liability only.
  YES → Proceed.
  
Is it decision SUPPORT (doctor makes final decision)?
  YES → Class II likely. Third-party certification route.
  NO → Proceed.
  
Is it decision MAKING (AI output is the clinical decision)?
  YES → Class III likely. PMDA approval route.
  
Does failure risk death or irreversible harm?
  YES → Class IV. Highest regulatory burden.
  NO → Class III.
  
Can you start as Class I (informational tool) and upgrade later?
  YES → Start here. Collect real-world evidence. Upgrade classification when data supports it.
```

### Minimum Compliance Calendar (1-3 Person Startup)

```
Monthly:
  - Document control review (any uncontrolled changes?)
  - CAPA review (any open corrective actions?)

Quarterly:
  - Management review (are quality objectives being met?)
  - Training records update
  - Supplier evaluation

Bi-annual:
  - Internal audit (someone who didn't build the system audits it)
  - Risk management review (any new hazards identified?)
  - Post-market data review (any signal in complaint data?)

Annual:
  - Full QMS audit (internal or external consultant)
  - Clinical performance review (is the model still performing?)
  - Regulatory intelligence scan (any new MHLW guidance affecting us?)
  - Data privacy audit (any changes in data handling?)
  - Penetration test + security assessment
```

### Japanese Regulatory Intelligence Resources

- **PMDA website:** https://www.pmda.go.jp/ — guidance, standards, review reports
- **MHLW notifications (通知):** Regulatory updates, guidance clarifications
- **MED (Medical Device Evaluation Division):** Handles PMD Act approvals
- **JIRA (Japan Federation of Medical Devices Associations):** Industry guidance
- **IMDRF (International Medical Device Regulators Forum):** International SaMD guidance (IMDRF/SaMD WG/N10-N23)
- **Key IMDRF documents for AI:**
  - N12: SaMD Clinical Evaluation
  - N23: SaMD Clinical Investigation
  - N41: SaMD Machine Learning-enabled (2019) — foundational
  - N47: MLMD Clinical Evaluation (2021) — key for AI

## Decision Framework

When evaluating a regulatory pathway, prioritize:

1. **Patient safety** (can't be compromised — this is the entire point)
2. **Time to market** (what's the fastest path to regulated deployment?)
3. **Evidence burden** (how much clinical data do we need, and do we have it?)
4. **Maintainability** (ongoing compliance cost for a small team)
5. **Upgrade path** (can we start at lower classification and move up?)

**The best regulatory strategy is rarely "go for full PMDA approval immediately."** It's usually: start at a lower classification with strong human-in-the-loop, collect real-world evidence, then upgrade classification when the clinical and business case supports it.

## Anti-Patterns

- ❌ "We'll handle regulation after the product works" — regulation IS part of the product
- ❌ Building the AI without a documented Design History File (retrospective = impossible)
- ❌ Training on data without documented consent for the specific use case
- ❌ Assuming overseas approval (FDA, CE) translates to Japan (it helps but doesn't substitute)
- ❌ No clinical advisor on the team (regulatory reviewers will ask who your clinical expert is)
- ❌ Skipping pre-submission consultation (false economy — costs ¥300K, saves ¥10M+ in rejected submission costs)
- ❌ Deploying without a post-market surveillance plan (PMS is not optional, it's statutory)

---

