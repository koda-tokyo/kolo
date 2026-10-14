# Bilingual Documentation Strategy

## The Japanese-English Documentation Matrix

| Document Type | Japanese | English | Rationale |
|--------------|----------|---------|-----------|
| Regulatory documentation | **Required** | Optional | MHLW requires Japanese. English translation for international partners. |
| Patient-facing UI/help | **Required** | Optional | Japanese healthcare users. English for internationalization. |
| Hospital admin docs | **Required** | Optional | Japanese hospital staff. |
| Developer API docs | Recommended | **Required** | English is the developer lingua franca. Japanese summaries for Japanese engineers. |
| Architecture docs | Optional | **Required** | Internal engineering in English. Japanese executive summaries. |
| Open-source README | Optional | **Required** | English default. Japanese README-ja.md for Japanese community. |
| Internal engineering docs | — | **Required** | English is our engineering language. |
| Code comments | — | **Required** | English. Always. |

## Translation Workflow

### Tier 1: Regulatory & Patient-Facing (Professional Translation)
```
Japanese draft → Professional translator → Subject matter expert review → Legal review → Publish
```
- Use certified medical translators (medical terminology expertise)
- Never MT-only for regulatory documents
- Review cycle: translator → SME → legal → publish
- Cost: higher, but cost of regulatory error is higher

### Tier 2: Developer Documentation (MT + Post-Edit)
```
English draft → MT (DeepL/Claude) → Human post-edit → Technical review → Publish
```
- MT quality is high enough for technical docs
- Human post-editor checks: terminology consistency, code accuracy, tone
- Technical reviewer checks: code examples work, API signatures correct
- Cost: moderate, good for high-volume docs

### Tier 3: Internal & Community (Light Touch)
```
English draft → MT → Quick review → Publish with disclaimer
```
- Acceptable for internal docs, community wiki, non-critical content
- Disclaimer: "This is a machine translation. The English version is authoritative."

## 和製英語 (Wasei-eigo) — Words to Avoid

Japanese-made English compounds that don't mean what they sound like:

| 和製英語 | Literal | Actual Meaning | Use Instead |
|---------|---------|---------------|-------------|
| アテンド | Attend | Escort/accompany | 案内 (guide) |
| スキンシップ | Skinship | Physical bonding | 身体的接触 |
| ペーパードライバー | Paper driver | Licensed but doesn't drive |  inactive driver |
| フリーダイヤル | Free dial | Toll-free number | Toll-free |
| コンセント | Concent | Power outlet | Power outlet |

**Rule:** If a word sounds like English but isn't used by native English speakers, don't use it in English documentation. It confuses international readers.

## Japanese Technical Writing Conventions

### Tone Selection
- **です・ます調** (polite): User guides, patient documents, external communication
- **である調** (plain/academic): Technical specifications, internal documentation, research papers
- **Rule:** When in doubt, use です・ます調 for anything customer-facing

### Document Structure (Japanese)
```
はじめに (Introduction)
├── 本ドキュメントについて (About this document)
├── 対象読者 (Target audience)
└── 前提知識 (Prerequisites)

本編 (Main content)
├── 概要 (Overview)
├── 詳細手順 (Detailed steps)
│   ├── ステップ1: ...
│   └── ステップ2: ...
└── 注意事項 (Cautions/Notes)

付録 (Appendix)
├── トラブルシューティング (Troubleshooting)
├── 用語集 (Glossary)
└── 参考資料 (References)
```

## MHLW-Required Japanese Documentation

For KODA KENKŌ, certain documents MUST exist in Japanese:

1. **取扱説明書 (Instruction Manual)** — For end-users. Must be in Japanese.
2. **添付文書 (Package Insert)** — If classified as medical device. Japanese required.
3. **安全管理に関する手順書 (Safety Management Procedures)** — Per MHLW guidelines.
4. **同意説明文書 (Informed Consent Documentation)** — Patient consent forms, Japanese.
5. **緊急時対応マニュアル (Emergency Response Manual)** — Japanese for hospital staff.

These documents are regulatory requirements, not nice-to-haves. Missing Japanese documentation = regulatory non-compliance.

## Internationalization (i18n) Technical Notes

### Key Management
```
ja.json:
{
  "patient.welcome": "ようこそ、{name}さん",
  "action.submit": "送信",
  "error.required": "必須項目です"
}

en.json:
{
  "patient.welcome": "Welcome, {name}",
  "action.submit": "Submit",
  "error.required": "This field is required"
}
```

### Text Expansion
Japanese text is typically 30-40% shorter than English. UI layouts must accommodate both:
- Japanese label: "患者情報" (4 characters)
- English label: "Patient Information" (20 characters)
- Design for the longer language, or use responsive layouts

### Date/Number Formatting
- Japan: YYYY年MM月DD日, 1,234人, 24時間表記
- English: Month DD, YYYY, 1,234 patients, 12-hour or 24-hour
- Use locale-aware formatting libraries (Intl.DateTimeFormat, Intl.NumberFormat)
- Never hardcode date/number formats

## Documentation Maintenance

### Bilingual Sync
- When English docs update, flag corresponding Japanese docs for review
- Automated CI check: "English file X changed. Japanese file X-ja exists? Updated?"
- Stale Japanese docs are worse than no Japanese docs (misleading information)

### Quality Metrics
- Translation coverage: % of English docs with Japanese versions (target: 100% for Tier 1, 60% for Tier 2)
- Translation staleness: % of Japanese docs >30 days out of sync with English (target: <5%)
- User satisfaction: feedback mechanism on every translated page ("Was this translation helpful?")
