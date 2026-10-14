# Clinical Workflows in Japanese Healthcare

## Overview

Japanese clinical workflows differ from Western patterns in several key ways: longer consultation times (or conversely, very short "3-minute consultations" at high-volume clinics), strong reliance on paper/FAX, hanko (判子 / stamp) culture for approvals, and integrated inpatient teams (Kangofu nurses handle broader tasks than Western RNs).

## Outpatient Workflow (外来 / Gairaishin)

### Typical Flow
1. **Reception (受付 / Uketsuke)**: Patient presents insurance card (hokenshō / 保険証). My Number card increasingly used.
2. **Vital signs (バイタル測定)**: Nurses take BP, temp, SpO2, weight.
3. **Waiting (待合 / Machiai)**: Can be hours at popular specialists; appointments are not strict in many settings.
4. **Consultation (診察 / Shinsatsu)**: Doctor sees patient. Duration: 3-10 minutes typical.
5. **Orders (オーダー)**: Tests, imaging, prescriptions ordered — often paper-based in clinics, CPOE in larger hospitals.
6. **Tests/Imaging (検査 / Kensa)**: Done in-house (clinic or hospital), results available same-day or next-day.
7. **Payment (会計 / Kaikei)**: Cash or card at automated payment machine (自動支払機).
8. **Pharmacy (調剤薬局 / Chōzai Yakkyoku)**: Prescriptions filled at external pharmacy (分業 / bungyō — separation of prescribing and dispensing since 1974).

### AI Integration Points
- **Triage**: Pre-consultation symptom checker (問診票 AI)
- **Documentation**: Voice-to-SOAP note for Japanese medical dictation
- **Clinical decision support**: Diagnostic suggestions, drug interaction alerts at order entry
- **Scheduling**: Predictive no-show and dynamic slot allocation

## Inpatient Workflow (入院 / Nyūin)

### Admission
1. **Admission order (入院指示)**: Doctor issues admission order via CPOE or paper.
2. **Hospital ward assignment**: Ward clerk (病棟クラーク) manages bed control.
3. **Admission assessment**: Nurse intake assessment including falls risk, nutrition, pressure ulcer.
4. **Treatment plan (クリニカルパス / Clinical Pathway)**: Standardized care plans common in Japanese hospitals for major procedures.
5. **Daily rounds (回診 / Kaishin)**: Morning and afternoon rounds. Multi-disciplinary team (doctor, nurse, pharmacist, dietitian, rehabilitation therapist).

### Daily Inpatient Process
1. Morning rounds (typically 8-10 AM)
2. Orders (medication changes, tests) placed during/after rounds
3. Laboratory draws (early morning, results by rounds)
4. Medication administration (3x or 4x daily pattern)
5. Rehabilitation sessions (physio/OT/speech)
6. Afternoon rounds (often shorter)
7. Evening medication and vital signs

### Discharge
1. **Discharge planning (退院調整)**: Starts on admission for complex cases. Involves Medical Social Worker (MSW).
2. **Discharge summary (退院時サマリ)**: Dictated or written, sent to referring clinic + patient. Key document for care continuity.
3. **Post-discharge follow-up**: Referral back to clinic (逆紹介 / gyaku-shōkai).
4. **Home care coordination (在宅医療連携)**: For elderly patients — visiting nurse, home helper, day service.

### AI Integration Points
- **Deterioration early warning**: Vital sign trend monitoring
- **LOS prediction**: Length of stay forecasting for bed management
- **Readmission risk**: 30-day readmission prediction
- **Clinical pathway deviation detection**
- **Discharge summary auto-generation**: From structured EMR data

## Clinical Documentation

### SOAP Notes in Japan
- SOAP format is widely used in Japanese hospitals, adapted from US.
- **S (Subjective / 主訴)**: Chief complaint ("CC" / chief complaint is also used). Often abbreviated.
- **O (Objective / 客観的所見)**: Vitals, physical exam findings, lab results.
- **A (Assessment / 評価)**: Diagnosis, differential, clinical reasoning. The most important section.
- **P (Plan / 方針)**: Orders, treatments, next steps.

### Other Documentation Types
- **入院診療計画書 (Inpatient Treatment Plan)**: Required within 7 days of admission.
- **カンファレンス記録 (Conference/Minutes Record)**: Multi-disciplinary team discussions.
- **看護記録 (Nursing Notes)**: Often use SOAP or focus charting.
- **経過記録 (Progress Notes / Keika Kiroku)**: Daily or event-based.
- **手術記録 (Operative Note)**: Surgeon's operative report.
- **紹介状 (Referral Letter / Shōkaijō)**: Sent to higher-level facility.
- **返書 (Reply Letter / Hensho)**: Reply from specialist back to referring doctor.

### Key Documentation Challenge
- Heavy use of **Japanese medical abbreviations** (e.g., "W.N.L." = within normal limits, "s/o" = suspect of, "r/o" = rule out), many are unique to Japanese medicine or borrowed English abbreviations used differently.
- **Hanko (判子) culture**: Signatures are stamp-based, not password/credential-based — implications for audit trails and non-repudiation in AI-assisted documentation.

## Medication Management

### Prescribing
- **Internal dispensing (院内処方)**: Hospital dispenses meds (declining but still common in clinics).
- **External pharmacy (院外処方)**: Prescription filled at community pharmacy (now ~75%+ of prescriptions).
- **Prescription format**: Includes drug name (generic or brand), dosage, duration. Often handwritten in clinics.
- **Generic substitution (ジェネリック医薬品)**: Doctor must explicitly permit/deny generic substitution on each Rx.

### Medication Safety
- **Multi-drug combinations (多剤併用)**: Common in elderly patients — polypharmacy alert systems are key AI use case.
- **Yakuzai (薬剤) department**: Hospital pharmacists review all inpatient orders.
- **Injection and infusion management**: Nurses prepare and administer. AI can check compatibility, rate, and 6R (Right patient, drug, dose, time, route, documentation).

## Laboratory and Radiology Workflows

### Lab Orders
- **Order-entry -> specimen collection -> lab processing -> result reporting**: Results typically auto-populate EMR.
- **Panic values (異常値報告)**: Lab calls floor directly for critical results.
- **Reference ranges**: Japan-specific; may differ from Western ranges for some tests (e.g., creatinine reflects smaller body habitus).

### Radiology
- **Modality mix**: CT is very high per capita in Japan. MRI also widely available.
- **Reading workflow**: Radiologist reads → report dictated → transcribed → verified → available in EMR.
- **Double-reading**: Common for cancer screening programs (胃がん検診 / gastric cancer screening, 肺がん検診 / lung cancer screening).
- **AI in rad workflow**: Triage (worklist prioritization), CADe (detection), quantification (volumetry), report generation.

## Referral Letter and Discharge Summary

### Referral Letter (紹介状)
- Formal document with clinical history, findings, reason for referral, and questions.
- Legal document; physician name + hanko.
- Often the only data received by referral center — quality varies widely.
- AI: Extract key findings from free-text referral letters and pre-populate EMR fields.

### Discharge Summary (退院時サマリ)
- Must include: admission/discharge dates, diagnosis (admission + discharge), procedures, hospital course, discharge medications, follow-up plan.
- Often the most detailed clinical summary available for a patient episode.
- AI: Auto-generate structured summaries from EMR data, reduce physician documentation burden.

## AI Workflow Integration Principles

1. **Don't slow down the physician**: Japanese outpatient doctors see 30-50+ patients/day. AI must be sub-second or background.
2. **Hanko-compatible**: If AI generates documentation, the approval/review path must respect hanko culture or provide digital equivalent (電子署名).
3. **Japanese NLP is non-trivial**: Segmentation (分かち書き), entity extraction, abbreviation normalization are harder than in English.
4. **FAX is still pervasive**: Many clinic-hospital communications use FAX. PDF/OCR pipeline may be needed.
5. **Staff roles differ**: Nurses (看護師), clerks (事務), radiology technicians (放射線技師), clinical engineers (臨床工学技士) each have distinct workflows and scope.
