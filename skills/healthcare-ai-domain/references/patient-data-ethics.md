# Patient Data Ethics & Privacy

## APPI — Act on the Protection of Personal Information (個人情報保護法)

### Overview
- Japan's comprehensive data protection law. Amended in 2015 (effective 2017), 2020, and 2022.
- **Personal Information Protection Commission (PPC / 個人情報保護委員会)** is the regulatory authority.
- Medical data receives heightened protection under APPI and supplementary guidelines.

### Key Provisions for Healthcare

#### "Special Care-Required Personal Information" (要配慮個人情報)
- Article 2, Paragraph 3: Medical history, health status, genetic data, and other health-related information is **special care-required**.
- Collection requires **explicit opt-in consent** (not implied or opt-out).
- Stricter handling requirements than general personal information.

#### Anonymization and Pseudonymization

| Type | Definition | Consent for Use | Re-identification Risk |
|------|-----------|----------------|----------------------|
| **Personal Information (個人情報)** | Identifiable living individual data | Consent required (with exceptions) | High |
| **Pseudonymously Processed Information (仮名加工情報)** | Data where names etc. removed but with internal key retained | No consent needed for internal use | Medium (internal only) |
| **Anonymously Processed Information (匿名加工情報)** | Data irreversibly de-identified per PPC standards | No consent needed; can share externally | Low |
| **Special Care-Required (要配慮個人情報)** | Medical/health data | Explicit opt-in consent always | — |

- **Anonymization requirements** (Article 36, PPC Rules):
  - Delete name, address, date of birth, My Number, and other direct identifiers.
  - Delete or generalize rare diseases and other quasi-identifiers.
  - Document the anonymization method and publish it when sharing anonymously processed info.
  - Prohibition on re-identification attempts.

#### Cross-Border Data Transfer (Article 28)
- Transfer to foreign third parties requires:
  1. **User consent**: Informed that data goes to a country with potentially different protections.
  2. **OR adequate protections**: The recipient country has equivalent standards (EU/UK recognized) OR contract with PPC-compliant safeguards.
- For health data: Both consent AND adequate contractual safeguards are recommended for KODA KENKŌ if patient data leaves Japan.

### The Three Next-Generation Medical Infrastructure Laws (次世代医療基盤法)

- **Next-Generation Medical Infrastructure Act (2018)**:
  - Authorizes **certified medical data banks (認定匿名加工医療情報作成事業者)** to collect and anonymize medical data from hospitals.
  - Patients can opt out (not opt in — controversial).
  - Anonymized data can be used for research and AI development.
  - Relevant for KODA KENKŌ if sourcing training data from these banks.

#### Medical Ethics Guidelines (医学研究倫理指針)
- **Ethical Guidelines for Medical and Health Research Involving Human Subjects** (人を対象とする医学系研究に関する倫理指針, 2014, revised 2017+2021).
- Merged with epidemiological research guidelines.
- Requirements:
  - **IRB (Institutional Review Board / 倫理審査委員会)** approval for any research involving human subjects data.
  - **Informed consent**: Written consent standard; opt-out with public disclosure sometimes accepted for retrospective studies.
  - **Data handling plan** must be submitted with IRB application.
- AI training on patient data is considered research use and falls under these guidelines.

## Patient Consent Models

### Consent Types in Japanese Healthcare

| Type | Use Case | Requirements |
|------|----------|-------------|
| **Specific informed consent (個別同意)** | Primary research, clinical trials, AI development with identifiable data | Written, specific to purpose |
| **Broad consent (包括同意)** | Data bank donation, large-scale research | Written, describes scope |
| **Opt-out with disclosure (オプトアウト)** | Retrospective chart review | IRB approval + public notice + easy opt-out mechanism |
| **No consent** | Anonymously processed information | Must meet strict anonymization criteria |

### Key Consent Elements for AI
- Purpose: Include specific AI models/use cases (not just "data analysis")
- Data types: Specify clinical text, images, structured data
- Retention period and deletion right
- Whether data may be used for model training, validation, or testing
- Whether the AI model may be commercialized (important distinction)
- Contact information for withdrawal

### Template Consent Fields (minimum)
1. Study title / purpose
2. Principal investigator + institution
3. Data items collected
4. Data handling method (anonymization level, storage, access controls)
5. Data sharing: internal / external / third-party
6. Retention period and disposal method
7. Voluntary participation and withdrawal right (with consequences — i.e., data already used in model training cannot be removed, but future data won't be collected)
8. Benefit/risk disclosure
9. Commercialization disclosure (will the resulting AI be sold?)
10. Contact for complaints/questions

## AI-Specific Ethics: Right to Explanation

### Japanese Context
- **No statutory "right to explanation of automated decisions" in APPI** (unlike GDPR Article 22).
- However, **medical ethics principles** create a de facto requirement:
  - Physician's duty to explain treatment rationale (Medical Care Act Article 1-4 / 医療法).
  - If AI influences clinical decisions, physician must be able to explain the basis.
  - **Shared decision-making (共同意思決定 / SDM)** is standard practice — AI that cannot be explained undermines this.

### MHLW Guidance on AI Clinical Use
- AI output should be interpretable by clinicians.
- Over-reliance risk: "Automation bias" warning in AI labeling.
- AI as "decision support" not "decision replacement" — clinical responsibility always rests with the licensed physician.

## Medical Ethics Principles

### Four Pillars (Beauchamp & Childress, applied to Japan)

1. **Beneficence (善行 / Zenkō)**: AI must demonstrate clinical benefit beyond current standard of care. Evidence threshold depends on risk class.
2. **Non-maleficence (無危害 / Mugai)**: Safety assessment. False negatives and false positives both have clinical consequences. Risk mitigation: human override, confidence scores, uncertainty communication.
3. **Autonomy (自律尊重 / Jiritsu Sonchō)**: Patient consent and right to refuse AI-assisted care. Information disclosure.
4. **Justice (正義 / Seigi)**: Equitable access. AI should not widen healthcare disparities. Training data must represent Japanese population demographics (age, region, socioeconomic status).

### Japan-Specific Ethical Considerations
- **Group harmony (和 / Wa)** and family decision-making: Family consent is often sought alongside patient consent in Japan, especially for elderly patients.
- **Non-disclosure of diagnosis (病名告知)**: Physicians sometimes withhold cancer diagnosis at family request — AI recommendation systems must be configurable for these cultural patterns without violating ethical obligations.
- **Aging population**: AI must account for geriatric-specific factors (polypharmacy, atypical presentation, functional status, cognitive decline).

## Cross-Border Data Transfer for Japanese Health Data

### Permitted Pathways
1. **Patient consent** + disclosure of destination country protections.
2. **Anonymously processed information** (strict PPC standard) — no consent needed for transfer.
3. **Adequacy decision countries**: EU/EEA, UK (Japan has mutual adequacy recognition with EU since 2019 under GDPR).
4. **Contractual safeguards**: Data transfer agreement meeting PPC guidelines.

### Practical Guidance for KODA KENKŌ
- If cloud infrastructure is outside Japan: Ensure APPI Article 28 compliance (consent or equivalent safeguards).
- Consider Japan-region cloud deployment (AWS Tokyo, GCP Osaka/Tokyo, Azure Japan East/West) to simplify compliance.
- Document data flow: Where does training data originate? Where is model training? Where is inference? Each step may have different regulatory requirements.

## Data Minimization Principle

- Collect only data necessary for the specific AI purpose.
- Data retention limits: Train → validate → test → deploy. Beyond that, delete or fully anonymize.
- Avoid data lake accumulation of identifiable clinical data without specific purpose.
- **PPC guideline**: Purpose specification and limitation is core to APPI compliance.

## Breach Reporting

- **APPI breach notification**: Required for incidents involving special care-required information.
- Report to PPC within statutory timeframe (3-5 days for serious breaches, 30 days for others).
- Notify affected individuals when risk of harm exists.
- Health data breach: Consider also notifying the hospital/data provider under contractual obligations.
