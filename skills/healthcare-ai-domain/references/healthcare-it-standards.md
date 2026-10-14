# Healthcare IT Standards

## HL7 FHIR in Japan

### Adoption Status
- FHIR R4 is the primary version adopted in Japan. FHIR R5 adoption is emerging.
- **Japanese FHIR Implementation Guides** published by JAMI / HL7 Japan / MHLW.
- MHLW's "Electronic Medical Record Information Exchange Standardization" program pushes FHIR-based interoperability.
- Major Japanese FHIR IG projects:
  - **JP Core (Japanese FHIR Core IG)**: Base profiles for Patient, Observation, MedicationRequest, etc., customized for Japanese healthcare.
  - **JP Medication**: FHIR profiles for Japanese medication prescription and dispensing (院外処方せん).
  - **JP DiagnosticReport**: Radiology and lab report profiles.

### Key Profiles for Japanese Healthcare
- **JP_Patient**: Includes My Number, insurance information, and Japanese name structure (kanji + kana).
- **JP_Observation**: Lab results with JLAC10 coding (Japanese lab code system).
- **JP_MedicationRequest**: Prescription with Japanese-specific drug codes (HOT code, YJ code).
- **JP_Coverage**: Insurance coverage tied to Japanese health insurance types.

### FHIR Endpoints and Patterns
- RESTful API is standard.
- Document exchange via FHIR Document Bundle.
- Subscription-based notifications for real-time data.
- **FHIR-based regional health networks**: Emerging replacement for SS-MIX2 in some regions.

## SS-MIX2 (Standardized Structured Medical Information Exchange 2)

### Overview
- **Japan-specific standard** for storing and exchanging structured medical data.
- **Storage format**: Directory-based with specific folder structure + HL7 v2.5 messages + optional documents.
- **Common gateway for EMR data export**: Most Japanese EMRs support SS-MIX2 export.
- Provides standardized access to: patient demographics, diagnosis (ICD-10), prescriptions, injections, lab results.
- **Legacy critical infrastructure**: Most hospital data extraction for research and analytics goes through SS-MIX2.
- **Gatekeeper solution**: SS-MIX2 is the pragmatic way to get data out of Japanese EMRs when FHIR APIs are unavailable.

### SS-MIX2 and FHIR Bridge
- Common pattern: Extract SS-MIX2 → transform to FHIR → store in FHIR repository.
- SS-MIX2 is read-only export, not an API — transformation layer is needed.

## Coding and Terminology Standards

### ICD-10
- Primary diagnosis coding in Japanese healthcare.
- Modified in Japan with some Japan-specific extensions.
- Used in DPC coding, death certificates, disease registries.

### JLAC10 (Japanese Laboratory Code, 10-digit)
- Standard code for laboratory tests in Japan.
- Encodes: specimen type, analyte, method, result type.
- 10-digit code, widely used in lab ordering and reporting.
- FHIR mapping: JP_Observation uses JLAC10 → LOINC mapping where available.

### HOT Code (HOTコード) and YJ Code (YJコード)
- **HOT code**: Japanese drug master code for prescriptions (Hoken Yakuzai Taishō — Insurance Drug Standard).
- **YJ code**: Yakuji code (薬事コード) for drug identification.
- Used in prescription, dispensing, and claims.

### LOINC
- Adopted for lab test identification in Japanese FHIR profiles.
- JLAC10 → LOINC mapping maintained by JAMI.
- Incomplete mapping: Not all JLAC10 codes have LOINC equivalents.

### SNOMED CT
- Limited direct adoption in Japan.
- JAMI manages SNOMED CT Japan Affiliate License.
- Used primarily in FHIR-based research projects.
- Clinical terminology in production systems is predominantly ICD-10 + Japanese medical term dictionaries.

### MEDIS Standard Master
- The **MEDIS-DC (Medical Information System Development Center)** maintains standardized master tables:
  - Disease name master (傷病名マスタ)
  - Drug master (医薬品マスタ)
  - Medical procedure master (診療行為マスタ)
  - Laboratory test master (検体検査マスタ)
- These masters are the foundational code systems for Japanese EMRs and claims.

## DICOM

### Adoption
- Universal in Japanese radiology. All CT, MRI, CR, DR, US, and nuclear medicine modalities output DICOM.
- PACS systems: Widely deployed in hospitals. Major vendors: Fujifilm, Canon Medical, Konica Minolta.
- **DICOM MWL (Modality Worklist)** and **MPPS (Modality Performed Procedure Step)**: Used in larger hospitals.
- **DICOM Structured Reports**: Limited adoption; most reports are free-text.

### Japan-Specific DICOM Considerations
- Japanese patient name representation: DICOM tag (0010,0010) uses kanji. PACS must handle multi-byte character sets (ISO 2022 IR 87 or Unicode).
- Workflow integration: DICOM worklist typically bridges RIS (Radiology Information System) and modalities.

## IHE Profiles

### Japanese IHE (JAHIS/JIRA/JRS)
- **IHE-Japan**: Promotes IHE integration profiles for Japanese healthcare IT.
- Commonly used IHE profiles:
  - **SWF (Scheduled Workflow)**: Radiology workflow
  - **PIX/PDQ (Patient Identification/Patient Demographics Query)**: Patient matching
  - **XDS (Cross-Enterprise Document Sharing)**: Document exchange across institutions
  - **ATNA (Audit Trail and Node Authentication)**: Security audit
  - **CT (Consistent Time)**: Time synchronization

## Interoperability Initiatives

### My Number Health Insurance Card (マイナ保険証)
- National digital health ID project. Each patient has a unique My Number tied to insurance.
- Mandates EHR-readable health insurance information at point of care.
- **Data scope**: Insurance eligibility, medication history, specific health checkup data.
- Long-term: aims to enable PHR (Personal Health Record) via Mynaportal (マイナポータル).

### National Medical Information Platform (全国医療情報プラットフォーム)
- MHLW's multi-year project to create a national-scale health information exchange.
- Phased rollout beginning 2024-2025.
- FHIR-based architecture envisioned.

## ONC Certification (US Expansion Reference)

If KODA KENKŌ targets US markets, relevant frameworks:
- **ONC Health IT Certification Program** (21st Century Cures Act)
- **HTI-1 / HTI-2 rules**: Updated certification criteria including AI transparency
- **USCDI (US Core Data for Interoperability)**: US equivalent of JP Core
- **TEFCA (Trusted Exchange Framework and Common Agreement)**: National network framework
- Key differences from Japan: Patient access mandate (Information Blocking), FHIR APIs mandatory, C-CDA document exchange

## Standards Selection for KODA KENKŌ

| Layer | Japan First | US Expansion |
|-------|-------------|--------------|
| **Data extraction** | SS-MIX2 + EMR vendor APIs | FHIR APIs (USCDI) |
| **Internal model** | FHIR R4 JP Core | FHIR R4 US Core |
| **Diagnosis coding** | ICD-10 | ICD-10-CM |
| **Lab codes** | JLAC10 → LOINC bridge | LOINC |
| **Drugs** | HOT/YJ codes | RxNorm / NDC |
| **Imaging** | DICOM | DICOM |
| **Documents** | FHIR Document Bundle / SS-MIX2 | C-CDA / FHIR |
| **Patient identity** | My Number + patient ID | MPI + patient ID |
