# Translation Methodology — 翻訳方法論

## JA↔EN↔PT with Accuracy, Naturalness, and Cultural Transfer

Translation is not substitution. It is the reconstruction of meaning, feeling, and intent in a different linguistic universe. Japanese and English are maximally distant languages — different word order, different information structure, different cultural presuppositions, different scripts. Translation between them requires not just linguistic competence but cultural and communicative judgment.

---

## The Three Principles of Translation

### 1. Accuracy (正確さ)
Does the translation convey what the source text actually says? No missing content, no added content, no distorted meaning.

### 2. Naturalness (自然さ)
Does the translation sound like it was originally written in the target language? No translationese (翻訳調), no unnatural constructions, no "this was clearly translated" feeling.

### 3. Cultural Transfer (文化的転移)
Does the translation work in the target culture? Are concepts that don't exist in the target culture explained or adapted? Do honorifics, formality levels, and social signals translate?

**The iron triangle:** You can optimize any two at the expense of the third. A perfectly accurate + natural translation may lose cultural nuance. A perfectly accurate + culturally faithful translation may sound unnatural. The skill is knowing which trade-off to make for the context.

---

## English → Japanese — The Pitfalls

### 1. Word Order — SOV vs SVO
```
EN: The system encrypts patient data using AES-256.
JA: システムはAES-256を使用して患者データを暗号化する。
Lit: System (topic) AES-256 using patient-data encrypts.
```
The Japanese reader needs the tools (AES-256) before the object (patient data) before the action (encrypt). Reversing English order produces unnatural Japanese.

### 2. Pronoun Overload
English uses pronouns constantly (it, they, this, that, which). Japanese drops them. Never translate all English pronouns:
```
EN: The AI model analyzes the data. It then generates a report. This report is reviewed by the doctor. They confirm the findings.
BAD JA: AIモデルはデータを分析する。それはレポートを生成する。このレポートは医師によって確認される。彼らは所見を確認する。
GOOD JA: AIモデルはデータを分析し、レポートを生成する。このレポートを医師が確認し、所見を確定する。
```
Good Japanese chains actions with -te forms, drops "it," uses the natural topic-comment flow.

### 3. Definite/Indefinite Articles
Japanese has no "the" or "a." The distinction is either omitted or encoded differently:
```
EN: A doctor reviewed the report. The report was accurate.
JA: 医師がレポートを確認した。レポートは正確だった。
```
The first sentence introduces the doctor (が marks new info). レポート is marked with は in the second sentence because it's now established context. The が→は shift IS the a→the shift.

### 4. Passive Voice Overuse
English technical writing loves passive voice. Japanese tolerates it less in natural writing:
```
EN: The data was encrypted before being transmitted.
OVERLY PASSIVE JA: データは送信される前に暗号化された。
NATURAL JA: データを暗号化した上で送信した。(active — "we encrypted the data and transmitted it")
NATURAL FORMAL JA: データを暗号化した上で送信を行った。
```

---

## Japanese → English — The Pitfalls

### 1. Subject Recovery
Japanese sentences often have no explicit subject. The translator must recover it:
```
JA: 本システムの導入により、診断時間が短縮された。
BAD EN: By the introduction of this system, diagnosis time was shortened.
GOOD EN: The introduction of this system shortened diagnosis time. (active)
GOOD EN (formal): Implementation of this system resulted in reduced diagnosis times.
```

### 2. Topic-Comment → Subject-Predicate
The Japanese は particle frames a topic; English needs a grammatical subject:
```
JA: 医療AIについては、倫理的な課題が残されている。
BAD EN: As for medical AI, ethical challenges remain.
GOOD EN: Ethical challenges remain regarding the use of medical AI.
```

### 3. Nominalization Overload
Japanese academic writing over-nominalizes (〜こと, 〜もの, ということは):
```
JA: 本研究により、AIが診断精度を向上させることが明らかになった。
BAD EN: This research revealed that AI improves diagnostic accuracy. (fine actually)
OVERLY FAITHFUL: This research revealed the fact that AI improves diagnostic accuracy. (too heavy)
```
Most Japanese nominalizers should be eliminated in English translation, not translated as "the fact that" or "the thing of."

### 4. The 〜的 (teki) Trap
Japanese adds 的 to make nouns adjectival. Don't translate every one:
```
JA: 倫理的課題, 技術的困難, 法的問題
GOOD EN: ethical challenges, technical difficulties, legal issues
BAD EN: ethic-like challenges, technological difficulties (sometimes works, sometimes doesn't)
```

---

## Portuguese ↔ Japanese — Special Considerations

Where Portuguese is relevant:

### Shared Traits (both are pro-drop, both have topic flexibility)
```
PT: (Eu) confirmo os dados do paciente. → Confirmo os dados do paciente.
JA: (私は) 患者データを確認する。→ 患者データを確認する。
Both languages drop subject pronouns naturally — unlike English.
```

### False Friends and Register Mismatches
```
PT "obrigado" = JA "ありがとう" — but:
  PT: used freely in all situations
  JA: すみません (sumimasen — "sorry/excuse me") is often more appropriate than ありがとう
      when someone did something for you that cost them effort
  
PT formal writing uses long sentences with subordination — similar tolerance to Japanese
EN formal writing prefers shorter sentences — different from Japanese

PT sim/não → JA はい/いいえ — but:
  Japanese yes/no answers the LOGICAL question, not the FORM:
  Q: 行かないの？ (Aren't you going?)
  A: はい、行かない (Yes, I'm not going) — "yes" confirms the negative proposition
  This is the opposite of English, and sometimes catches Portuguese speakers too
```

---

## Translation Workflow — For KODA KENKŌ Documents

### Step 1: Identify the genre and audience
- MHLW submission? → Formal である体, legal precision over naturalness
- Patient-facing? → です・ます体, naturalness over literal accuracy, furigana
- Internal technical? → Mix of Japanese + English technical terms as needed
- Investor deck? → Natural, persuasive です・ます体, cultural adaptation matters

### Step 2: Translate at the right level
```
Not: word → word → word
But: concept → concept → concept

Read the entire paragraph in source language.
Understand the message.
Reconstruct the message in target language.
Check against source for accuracy.
Adjust for naturalness.
```

### Step 3: Quality Check
1. **Back-translation check:** Translate back to source language. Same meaning?
2. **Numbers/units:** Correctly converted? (万 vs thousands, 億 vs millions)
3. **Proper nouns:** Correct reading? (人名, 地名, 会社名)
4. **Register consistency:** Same formality level throughout?
5. **Terminology consistency:** Same term translated the same way across the document?

### Step 4: Final Polishing
Read aloud in target language. Does it flow? Does anything snag? Japanese is a spoken language before it is a written one — a sentence that can't be read aloud naturally probably isn't good written Japanese either.

---

## Common Translation Decisions

### To Translate or Not to Translate?
```
Keep in source language:
  - Proper nouns: 田中太郎 → Tanaka Taro (not Taro Tanaka unless Western convention needed)
  - Product names: KODA KENKŌ stays KODA KENKŌ
  - Technical terms with no good equivalent

Translate:
  - All explanatory text
  - UI labels, error messages
  - Legal obligations (must be in governing language)

Provide both:
  - Regulatory citations: 医薬品医療機器等法 (Act on Securing Quality, Efficacy and Safety
    of Products Including Pharmaceuticals and Medical Devices)
```

### Numbers and Units
```
Japanese: 1万 (10,000), 1億 (100,000,000), 1兆 (1,000,000,000,000)
→ Translate: 1万人 → 10,000 people
→ But preserve: 5万円 → JPY 50,000 (approximate) or ¥50,000

Dates: 令和8年5月23日 → May 23, Reiwa 8 (2026)
Japanese year notation: 2026年度 → FY2026 (fiscal year, April 2026-March 2027)
```

---

## The Untranslatable — What to Do

Some concepts have no equivalent. Options:

1. **Loanword:** もったいない → mottainai (the regret of waste; keep Japanese, explain)
2. **Approximate equivalent:** よろしくお願いします → "Thank you in advance" (imperfect but functional)
3. **Cultural footnote:** お疲れ様です → "Good work today" [TN: standard workplace greeting acknowledging shared effort]
4. **Rewrite around it:** 空気を読む → "read the room" / "understand the unspoken context" (the concept survives even if the metaphor changes)

The choice depends on purpose. MHLW submission: approximate equivalent. Cultural document: loanword + explanation. Internal team comms: whichever the team understands.
