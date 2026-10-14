# Japan Healthcare System Structure

## Universal Health Insurance (国民皆保険)

### Structure
- **Universal coverage since 1961** — every resident must enroll in a public health insurance plan.
- Two-tier system:
  - **Employees' Health Insurance (健康保険 / Kenkō Hoken)**: For employed workers and dependents. Managed by Japan Health Insurance Association (協会けんぽ) or union-managed plans (組合健保).
  - **National Health Insurance (国民健康保険 / Kokumin Kenkō Hoken)**: For self-employed, unemployed, and retirees. Managed by municipalities.
  - **Latter-Stage Elderly Healthcare System (後期高齢者医療制度)**: For 75+ year-olds (and 65-74 with certain disabilities).
- **Co-pay**: 30% for working-age, 20% for 70-74, 10% for 75+ (income-dependent caps).
- **High-Cost Medical Expense Benefit (高額療養費制度)**: Monthly out-of-pocket cap based on income bracket.

### Fee Schedule
- **Uniform national fee schedule (診療報酬点数表)**: All procedures and drugs are priced uniformly across Japan.
- Revised every 2 years by MHLW Central Social Insurance Medical Council (中医協 / Chūikyō).
- AI/SaMD reimbursement is an emerging topic — no general AI-specific fee codes yet in 2025, but specific SaMD products receive DPC add-on or itemized reimbursement.

## Hospital and Clinic Ecosystem

### Hospital Types
| Type | Beds | Characteristics |
|------|------|----------------|
| **Clinic (診療所 / クリニック)** | <20 beds (usually 0) | Primary care, specialist outpatient |
| **Small Hospital** | 20-199 beds | General acute care |
| **Large Hospital** | 200+ beds | Specialized care, teaching hospitals |
| **University Hospital (大学病院)** | 300-1,000+ beds | Tertiary/quaternary care, research |
| **Special Functioning Hospital (特定機能病院)** | Designated | Advanced care, MHLW-approved |

### Patient Flow
- **Free access**: Patients can visit any clinic or hospital, any specialty, without referral.
- **Referral fees (紹介状なしの追加負担)**: ¥5,000-¥10,000 surcharge at large hospitals (200+ beds) without referral letter.
- **Gatekeeping**: Weak compared to NHS/gatekeeper systems. Most patients self-refer.
- **Average length of stay**: ~16 days (much longer than OECD average of ~8 days), reflecting rehabilitation and social admission patterns.
- **Clinic-first pattern**: Most encounters are at clinics (~70% of outpatient visits). Hospitals handle inpatient and complex care.

## DPC (Diagnosis Procedure Combination) Payment

### Overview
- **DPC/PDPS (包括評価 / Per-Diem Payment System)**: Introduced 2003, modeled loosely on US DRG but fundamentally per-diem, not per-case.
- Applies to acute inpatient care at DPC-participating hospitals.
- **Mixed payment**:
  - **DPC component (包括)**: Per-diem fixed payment based on diagnosis group + hospital factor + length-of-stay stage.
  - **Fee-for-service component (出来高)**: Surgery, anesthesia, rehabilitation, expensive tests billed separately.
- Three LOS stages with decreasing per-diem rates (incentivizes shorter stays).
- **Impact on AI**: AI that reduces LOS (e.g., early discharge prediction) or optimizes DPC coding has direct financial value.
- DPC data is a major source for healthcare AI training (National DPC Database).

## Electronic Health Record Adoption

### Current State (2025)
- **Hospital EHR adoption**: ~50-60% in large hospitals (>400 beds), ~30-40% in smaller hospitals.
- **Clinic EHR adoption**: ~50-55%. Many clinics use standalone EMR rather than integrated EHR.
- **Major vendors**: Fujitsu (HOPE), NEC (MegaOak), SBS (ID-Link), M3 (M3 DigiKarute).
- **Interoperability challenge**: Low. Different vendor systems rarely communicate directly.
- **Regional Health Information Networks (地域医療情報連携ネットワーク)**: Government-pushed but fragmented. Examples: Ajisai Net (Nagasaki), Human Bridge (Kyoto).
- **My Number Health Insurance Card (マイナ保険証)**: Government push since 2023 to integrate health insurance with national ID. Major interoperability initiative.
- **Cloud EMR adoption**: Accelerating but faces data residency and security concerns.

## Key Institutions

### Regulators
- **MHLW (厚生労働省)**: Ministry — policy, legislation, fee schedule.
- **PMDA (PMDA / 医薬品医療機器総合機構)**: Device/drug review and approval, safety surveillance.

### Professional Bodies
- **JMA (日本医師会 / Japan Medical Association)**: Influential physician association, significant political power.
- **JAMI (日本医療情報学会 / Japan Association for Medical Informatics)**: Health informatics standards.
- **JAHIS (保健医療福祉情報システム工業会)**: Healthcare IT industry association.

### Research / Data
- **NDB (National Database of Health Insurance Claims and Specific Health Checkups / レセプト情報・特定健診等情報データベース)**: The national claims database. Administered by MHLW.
- **DPC Database**: Acute inpatient data from DPC hospitals. Administered by MHLW, research use through application.
- **NCD (National Clinical Database)**: Surgical registry managed by surgical societies.

## Key System Features Relevant to AI

1. **Fee-for-service incentives**: High volume of tests and imaging creates large datasets — but also overutilization concerns.
2. **Long hospital stays**: Opportunity for AI-driven LOS optimization, readmission prediction.
3. **Aging population (超高齢社会)**: 29%+ over 65. AI for chronic disease management, polypharmacy, frailty assessment.
4. **Workforce shortage**: Physician and nursing shortage drives interest in AI-assisted triage, documentation, and workflow.
5. **Language/notation**: All clinical documentation is in Japanese. AI must handle Japanese medical NLP. Kanji terminology is dense and ambiguous.
6. **No patient portal mandate**: Unlike US (21st Century Cures Act), Japan has no strong patient-access mandate for medical records yet.
