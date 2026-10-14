# MHLW Regulatory Framework for AI Medical Devices

## MHLW Structure and Role

- **Ministry of Health, Labour and Welfare (MHLW / 厚生労働省)** — Japan's healthcare regulator.
- **Pharmaceuticals and Medical Devices Agency (PMDA / 独立行政法人医薬品医療機器総合機構)** — MHLW's review/approval body for drugs and medical devices; equivalent to FDA CDRH.
- **Pharmaceutical Affairs and Food Sanitation Council (PAFSC)** — advisory body for final approval decisions.

## PMD Act (Pharmaceutical and Medical Device Act / 薬機法)

- Originally the Pharmaceutical Affairs Law (PAL); comprehensively revised in 2014 and renamed PMD Act.
- **2019 amendment** explicitly recognized Software as a Medical Device (SaMD), adding "programs" to the definition of medical devices.
- Article 2, Paragraph 4: Medical devices include "machines, instruments, or programs" intended for diagnosis, treatment, or prevention of disease in humans or animals.
- **Risk-based classification**: Class I (lowest) through Class IV (highest). Most AI-based diagnostic/decision-support SaMD falls into Class II or Class III.

## SaMD Classification for AI

| Class | Examples | Regulatory Path |
|-------|----------|----------------|
| **Class I** | General wellness apps, simple calculators | Self-declaration (Todokede / 届出) |
| **Class II** | AI-assisted imaging detection (CADe), triage tools | Third-party certification (Ninsho / 認証) via Registered Certification Bodies |
| **Class III** | AI diagnostic decision support, treatment planning AI | PMDA review + MHLW approval (Shonin / 承認) |
| **Class IV** | AI-controlled implantable devices, life-sustaining AI | Full PMDA review + MHLW approval |

### Key Determination: Is it SaMD?
- **MHLW Notification 2014-0312**: Clarifies when software qualifies as a medical device.
- If the software provides diagnosis, treatment guidance, or clinical decision support → SaMD.
- If the software only stores/transfers data without clinical interpretation → NOT SaMD.
- AI that generates diagnostic findings, risk scores, or treatment recommendations is presumptively SaMD.

## Clinical Trial Requirements for AI

- **GCP (Good Clinical Practice)**: Required for Class III/IV SaMD.
- **MHLW Ministerial Ordinance on GCP for Medical Devices (MHLW Ordinance No. 36, 2005)**.
- AI-specific considerations:
  - **Performance evaluation** replaces traditional "clinical trial" in some SaMD contexts per MHLW guidelines.
  - Standalone performance testing with retrospective data may suffice for lower-risk SaMD.
  - **Reader studies** are common for AI imaging devices.
  - **Algorithm change protocol**: Pre-specified plan for updates (locked vs. adaptive algorithms).
  - **Training data documentation**: Source, demographics, annotation quality, bias assessment.

## GxP Requirements

| GxP | Scope | Japanese Regulation |
|-----|-------|-------------------|
| **GCP** | Clinical trials | MHLW Ordinance No. 36 (2005) |
| **GMP / QMS** | Manufacturing / Quality Management | MHLW Ordinance No. 169 (2004) — aligned with ISO 13485 |
| **GVP** | Good Vigilance Practice | MHLW Ordinance No. 135 (2005) |
| **GPSP** | Good Post-marketing Study Practice | MHLW Ordinance No. 171 (2004) |

- **QMS (Quality Management System)**: ISO 13485:2016 + MHLW Ordinance No. 169. Applies to SaMD developers.
- **Design controls**: Required throughout software lifecycle.
- **Software as a manufacturing process**: AI model training and validation procedures are considered part of QMS.

## AI-Specific Regulatory Guidance

### MHLW AI Guidelines (2018-2023)
- **"Guidelines for Medical Devices Using Artificial Intelligence"** (MHLW, 2017, revised 2019).
- **"Concept Paper on AI-based Medical Devices"** — PMDA scientific board discussions.
- Key principles:
  1. **Locked vs. adaptive AI**: Locked algorithms follow standard SaMD pathway. Continuous-learning/adaptive AI requires additional safeguards (pre-specified change control plan).
  2. **Black box problem**: Explainability requirements are proportional to risk class. Higher risk = more explainability needed.
  3. **Data quality and bias**: Training data must represent Japanese patient demographics. Foreign-trained models need local validation.
  4. **Performance metrics**: Sensitivity, specificity, AUC, and clinical utility endpoints required.
  5. **Labeling**: Intended use, limitations, target population, and operating point explicitly stated.

### PMDA Consultation Pathways
- **Pre-submission consultation (Sodan / 相談)**: Recommended before formal submission.
- **Fast-track pathways**: SAKIGAKE (突破力) designation for innovative devices; conditional early approval.
- **Orbis-type collaborations**: PMDA participates in some international harmonization efforts.

## Post-Market Surveillance (PMS)

- **GVP (Good Vigilance Practice)**: Mandatory adverse event reporting.
- **Post-marketing clinical study (GPSP)**: May be required as condition of approval for innovative SaMD.
- **Real-world performance monitoring**: MHLW increasingly expects ongoing performance data for AI devices.
- **Recall and field safety corrective actions**: Required for algorithm defects affecting clinical safety.
- **Manufacturer registration renewal**: Every 5 years (with QMS inspection).

## International Harmonization

- **IMDRF (International Medical Device Regulators Forum)**: Japan is a member. IMDRF SaMD Working Group documents are influential.
- **IMDRF SaMD N12** (Clinical Evaluation) and **N41** (Classification) are directly referenced by MHLW/PMDA.
- **Harmonization by doing (HBD)**: Some joint PMDA-FDA reviews.

## Checklist: SaMD Regulatory Pathway

1. Determine device classification (I–IV)
2. Confirm SaMD status per MHLW Notification 2014-0312
3. Establish QMS per MHLW Ordinance No. 169 (ISO 13485)
4. Compile technical documentation (design, risk management, verification/validation)
5. Conduct performance evaluation / clinical trial
6. PMDA pre-submission consultation
7. Submit application (Todokede / Ninsho / Shonin per classification)
8. Obtain approval
9. Initiate GVP post-market surveillance
10. Plan for labeled updates vs. change submission for algorithm modifications

## References
- PMD Act (Act No. 145, 1960, as amended): https://www.japaneselawtranslation.go.jp/
- MHLW SaMD Notification 2014-0312
- PMDA: https://www.pmda.go.jp/
- IMDRF SaMD documents: https://www.imdrf.org/
