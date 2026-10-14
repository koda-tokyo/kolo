# Medical Japanese — 医療日本語

## The Language of Clinical Practice

Medical Japanese is the operational language of KODA KENKŌ. It spans three domains: clinical documentation (what doctors write), MHLW regulation (what the government requires), and patient communication (what patients understand). Each uses fundamentally different Japanese.

---

## Clinical Documentation — カルテ・診療録

### SOAP Note Format
```
S (Subjective — 主観的情報):
「3日前より発熱、咳あり」
"Fever and cough for 3 days" (patient's own words or description)

O (Objective — 客観的情報):
体温38.5°C, BP 130/85, SpO2 96% (room air)
右肺野に湿性ラ音を聴取 (Wet crackles auscultated in right lung field)

A (Assessment — 評価):
#1 市中肺炎疑い (Suspected community-acquired pneumonia)
#2 高血圧症 (Hypertension — ongoing)

P (Plan — 計画):
1. 胸部XP → 血液検査 (CBC, CRP, 血液培養)
2. ABPC/SBT 1.5g 1日2回点滴静注 (Ampicillin/Sulbactam IV)
3. 経過観察入院 (Admission for observation)
```

### Key Documentation Vocabulary
| Japanese | Reading | English |
|----------|---------|---------|
| 主訴 | shuso | chief complaint |
| 現病歴 | genbyōreki | history of present illness |
| 既往歴 | kiōreki | past medical history |
| 家族歴 | kazokureki | family history |
| 内服薬 | naihukuyaku | oral medications |
| アレルギー | arerugī | allergies |
| バイタルサイン | baitaru sain | vital signs |
| 意識レベル | ishiki reberu | level of consciousness |
| 所見 | shoken | findings |
| 疑い | utagai | suspected (diagnosis) |
| 否定できず | hitei dekizu | cannot be ruled out |
| 経過観察 | keika kansatsu | follow-up observation |
| 要精査 | yōseisa | requires further investigation |

### The JCS (Japan Coma Scale) — Uniquely Japanese
```
JCS 0: 清明 (alert)
JCS 1: 見当識障害ありだが、呼びかけに応答 (confused but responds to calling)
JCS 2: 痛み刺激に反応 (responds to pain)
JCS 3: 痛み刺激に反応しない (no response to pain)
JCS 100: 痛み刺激に払いのける動作 (moves to remove pain stimulus)
JCS 200: 四肢を動かす、顔をしかめる (moves limbs, grimaces)
JCS 300: まったく動かない (no movement at all)
```

Japanese hospitals use JCS, not GCS (Glasgow Coma Scale). Interoperability with international systems requires understanding both.

---

## MHLW Regulatory Japanese

MHLW documents use a distinct bureaucratic register characterized by:
- Extremely long sentences with nested clauses
- Nominalizing constructions (〜こと, 〜もの)
- Obligation expressions (〜なければならない, 〜ものとする, 〜こととする)
- Archaic connectives (並びに, 且つ, 及び, 又は)
- Formalized definitions (〜という, 〜と定義する, 〜をいう)

### The Hierarchy of Legal Connectives

| Connective | Strength | Usage |
|------------|----------|-------|
| 及び (oyobi) | Simple "and" | Joining items of equal weight |
| 並びに (narabini) | "And also" (larger grouping) | Used to separate larger subdivisions: A及びB並びにC |
| 又は (matawa) | Simple "or" | Choice between items |
| 若しくは (moshikuwa) | "Or else" (smaller grouping) | Used within a group: A若しくはB又はC |
| 且つ (katsu) | "And at the same time" | Adding simultaneous condition |
| 乃至 (naishi) | "Through/from...to" | Range: 5年乃至10年 (5 to 10 years) |

**The nesting rule:**
```
A若しくはB又はC → (A OR B) OR C  — small OR within, big OR between groups
A及びB並びにC → (A AND B) AND C  — small AND within, big AND between groups
```

This is the exact opposite reading of how English "and/or" nesting normally works. Getting this wrong changes legal meaning.

### Standard MHLW Phrases in Medical Device Regulation

```
〜しなければならない — MUST (mandatory — strongest)
〜ものとする — SHALL (prescriptive)
〜こととする — is to be (less mandatory, procedural)
〜ことが望ましい — it is desirable that (recommendation)
〜に努める — shall endeavor to (aspirational)

例: 医療機器プログラムの製造販売業者は、当該プログラムの
品質管理を適切に実施しなければならない。
"The manufacturer/distributor of medical device programs MUST 
appropriately implement quality control for said program."
```

---

## Patient-Facing Communication

This is categorically different from clinical documentation. The same condition described three ways:

**Clinical (doctor-to-doctor):**
```
上気道炎の所見あり。
Amoxicillin 250mg 1日3回 5日間 処方。
経過観察。増悪時には再診のこと。
```

**Explanation to patient (standard, direct):**
```
風邪の症状がありますね。
抗生物質を5日分出しますので、1日3回飲んでください。
悪くなったら、また来てください。
```

**Explanation to patient (soft, building rapport):**
```
ちょっと風邪をひかれているようですね。
お薬を5日分お出ししますので、朝・昼・晩の
お食事のあとにお飲みいただけますか。
万が一、症状がひどくなられるようでしたら、
遠慮なくまたいらしてくださいね。
```

### Key Differences in Patient-Facing Japanese
1. **Avoid medical kanji without furigana** — 嚥下困難 (dysphagia) → 飲み込みにくさ (difficulty swallowing)
2. **Use です・ます体** — always polite, never blunt
3. **Soften imperatives** — 飲んでください → 飲んでいただけますか (can you take it?)
4. **Frame observations tentatively** — 風邪です → 風邪のようですね (it appears to be a cold)
5. **Use いただく/くださる patterns** — patient is the recipient of care, the doctor is the humble provider

### The イヤな言葉 (Words Patients Don't Want to Hear)
```
癌 (gan — cancer) → 悪性腫瘍 (akusei shuyō — malignant tumor — slightly softer)
                        → 「あまり良くない結果が出ています」(The results aren't very good — contextual)
死亡 (shibō — death) → お亡くなりになる (o-nakunari-ni-naru — to pass away — respectful)
```

---

## Pharmaceutical Japanese

### Prescription Format (処方箋)
```
Rp. アセトアミノフェン錠 200mg
    1回1錠 1日3回 食後 (毎食後)
    5日分
    → アセトアミノフェン (acetaminophen — katakana)
    → 200mg tablet
    → 1 tablet 3 times daily after meals
    → 5 days supply
```

### Drug Name Etymology
Japanese drug names come from three traditions:
- **INN transliteration (WHO):** アセトアミノフェン (acetaminophen), オセルタミビル (oseltamivir)
- **Japanese brand names:** カロナール (Calonal — acetaminophen brand in Japan)
- **Japanese traditional (漢方薬):** 葛根湯 (kakkontō), 小青竜湯 (shōseiryūtō)

---

## The 医療事故 (Medical Incident) Register

When documenting adverse events, Japanese uses specific passive/respectful constructions:

```
患者A氏が転倒された。直ちに医師に報告、診察を行った。
骨折は認められなかったが、念のため経過観察入院とした。
ご家族に状況を説明し、ご理解をいただいた。

NOT: 患者が転倒した (too blunt for an incident report)
USE: 患者A氏が転倒された (respectful passive — the patient experienced a fall)
```

The passive here does not mean "the patient was caused to fall." It means "I report this event with respect toward the patient." This is the 被害の受身 (adversative passive) — a uniquely Japanese way of framing an unfortunate event while maintaining respect for those affected.
