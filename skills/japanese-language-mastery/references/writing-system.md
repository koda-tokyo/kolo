# Writing System — 漢字・仮名・表記

## The Tripartite System

Japanese uses three scripts simultaneously, sometimes in the same sentence. This is not complication — it is information architecture. Each script carries a different semantic load:

| Script | Type | Particles | Semantic Load | Example |
|--------|------|------------|--------------|---------|
| 漢字 (Kanji) | Logographic | Content words: nouns, verb/adjective stems | Meaning, etymology, disambiguation | 患者, 診断する, 高い |
| ひらがな (Hiragana) | Syllabic | Function words: particles, inflections, native words | Grammar, flow, softness | は, が, を, だろう, かもしれない |
| カタカナ (Katakana) | Syllabic | Loanwords, emphasis, technical terms, onomatopoeia | Foreignness, sharpness, technicality | データ, サーバー, カルテ, ビックリ |

**The native reader parses these simultaneously.** When I read `患者データをサーバーに保存する`, I process: 患者=patient (content via kanji), データ=data (foreign/technical via katakana), を=(object particle via hiragana), サーバー=server (foreign/technical), に=(location particle), 保存=save (content via kanji), する=do (grammar via hiragana). The script choice IS the parse.

---

## Kanji — 漢字

### The Six Categories (六書 / りくしょ)

The traditional classification of kanji formation, from the Han dynasty 説文解字 (Shuōwén Jiězì, ~100 CE):

**1. 象形 (Shōkei) — Pictographs:** Stylized pictures of objects.
- 日 (sun), 月 (moon), 山 (mountain), 川 (river), 人 (person), 木 (tree)
- ~4% of all kanji

**2. 指事 (Shiji) — Ideographs:** Abstract concepts indicated by simple marks.
- 一 (one), 上 (up/above), 下 (down/below), 本 (root/origin — tree with mark at root)
- ~1% of all kanji

**3. 会意 (Kaii) — Compound Ideographs:** Two or more pictographs combined to suggest meaning.
- 休 (rest) = 人 (person) + 木 (tree) — person leaning against a tree
- 森 (forest) = 木 (tree) × 3 — many trees
- 明 (bright) = 日 (sun) + 月 (moon)
- ~13% of all kanji

**4. 形声 (Keisei) — Phono-Semantic Compounds:** One part hints at meaning (部首/radical), one at sound (音符/phonetic component). By far the most common.
- 肝 (liver) = 肉⺼ (flesh radical) + 干 (phonetic: kan)
- 銅 (copper) = 金 (metal radical) + 同 (phonetic: dō)
- 診 (diagnose) = 言 (speech radical) + 㐱 (phonetic: shin)
- ~82% of all kanji — this is how most kanji work

**5. 転注 (Tenchū) — Derivative Characters:** Existing character repurposed with extended/derived meaning.
- 楽 (music) → also means "comfort/ease" (the joy music brings)
- Very rare (~0.5%)

**6. 仮借 (Kasha) — Phonetic Loan:** Character borrowed purely for sound, ignoring original meaning.
- 亜米利加 (A-me-ri-ka) — each kanji used only for sound
- Rare for established readings but this is how ateji (当て字) works

### Key Radicals for Our Work (KODA KENKŌ)

```
肉/⺼ — flesh, body parts: 肝 (liver), 肺 (lung), 脳 (brain), 腸 (intestine)
疒   — sickness, illness: 病 (illness), 症 (symptom), 痛 (pain), 癌 (cancer)
言   — speech, language: 診 (diagnose), 説 (explain), 話 (talk), 議 (discuss)
金   — metal, money: 医 (doctor, from 酉+殳+匸 — but contains the 'medicine' component)
⺡/水 — water, liquid: 液 (fluid), 注 (inject), 治 (treat/cure)
薬   — medicine (itself a radical compound: 艹+楽): 薬剤 (medication)
```

### On'yomi vs Kun'yomi — The Anglo-Saxon vs. Latinate Analogy

Just as English has Anglo-Saxon words (ask, begin, kingly) and Latinate words (inquire, commence, regal), Japanese has:

| | 音読み (On'yomi) | 訓読み (Kun'yomi) |
|---|---|---|
| Origin | Borrowed Chinese reading | Native Japanese reading |
| Register | Formal, technical, compound words | Everyday, standalone, emotional |
| Usage | 保存 (hozon — save/store) | 保つ (tamotsu — to keep/maintain) |
| Like | "commence" (Latinate, formal) | "begin" (Germanic, everyday) |

**For KODA KENKŌ:** Medical and technical terminology overwhelmingly uses on'yomi in kanji compound words. MHLW documents are kanji-dense with Sino-Japanese vocabulary. Patient-facing communication uses more kun'yomi and hiragana-heavy constructions. This is the same register difference as "myocardial infarction" vs. "heart attack."

---

## Hiragana — ひらがな

### Origin
Derived from cursive (草書) forms of kanji. Each hiragana is a simplified, flowing version of a kanji that had that sound:
- あ ← 安, い ← 以, う ← 宇, え ← 衣, お ← 於
- Developed by court women in the Heian period (~800-900 CE) who were excluded from kanji education

### The Hiragana Syllabary (五十音図)

```
      a     i     u     e     o
∅   あ    い    う    え    お
k   か    き    く    け    こ
s   さ    し    す    せ    そ
t   た    ち    つ    て    と
n   な    に    ぬ    ね    の
h   は    ひ    ふ    へ    ほ
m   ま    み    む    め    も
y   や          ゆ          よ
r   ら    り    る    れ    ろ
w   わ                        を
n   ん
```

**Voiced (濁音):** か→が, さ→ざ, た→だ, は→ば
**Semi-voiced (半濁音):** は→ぱ
**Palatalized (拗音):** きゃ, きゅ, きょ, しゃ, しゅ, しょ, etc.

### Small Characters
```
っ (small tsu) — geminate consonant (doubled)
The silence is the sound. かった (katta) ≠ かた (kata)

ゃ, ゅ, ょ — palatalization (ya, yu, yo combined with i-column)
きょう (kyō) — an entire syllable compressed into two mora
```

---

## Katakana — カタカナ

### Origin
Derived from fragments (偏旁) of kanji. Angular, simplified — the "monospace" of Japanese:
- ア ← 阿 (left side), イ ← 伊 (left side), ウ ← 宇 (top)

### Usage Domains
```
1. Loanwords (外来語): コンピュータ, データベース, アルゴリズム
2. Foreign names/places: スミス, ロンドン, ブラジル
3. Technical/scientific terms: ガン (cancer — in medical contexts alongside 癌)
4. Emphasis (like ITALICS): それはダメです (that is NOT okay)
5. Onomatopoeia: ドキドキ (heart pounding), ザーザー (heavy rain)
6. Animal/plant names (in biological contexts): イヌ, ネコ, サクラ
```

### The Medical Katakana Phenomenon
Japanese medicine uses katakana extensively for:
- Drug names: アセトアミノフェン (acetaminophen), イブプロフェン (ibuprofen)
- Anatomical terms (alongside kanji): メディカル, クリニカル
- Equipment: レントゲン (Röntgen/X-ray), カテーテル (catheter)
- Procedure names: オペ (operation/surgery), カルテ (patient chart, from German Karte)

**Why?** Medical terminology in Japanese comes from three sources: Chinese (kanji), German (katakana — Japan studied medicine from Germany in Meiji era), and English (katakana — postwar). The katakana layer is thickest in modern hospital practice.

---

## Writing Direction

```
縦書き (tategaki) — Vertical, top-to-bottom, right-to-left
  Traditional: novels, newspapers, formal letters, some government documents
  Columns ordered right→left, text within column top→bottom

横書き (yokogaki) — Horizontal, left-to-right, top-to-bottom  
  Modern: websites, technical documents, most business documents, code
  MHLW digital documents are predominantly yokogaki
```

**The rule for KODA KENKŌ:** Technical documentation, code, and digital UI use yokogaki. Formal correspondence with traditional institutions may use tategaki. When in MHLW context: default to yokogaki for digital, verify format for paper submissions.

---

## Okurigana — The Bridge

The hiragana trailing a kanji that shows how it's inflected:
```
食べる (ta-beru) — 食 is the kanji for "eat," べる shows the verb form
高い (taka-i) — 高 is the kanji for "tall/expensive," い shows adjective form
診断する (shindan-suru) — 診断 is the noun, する makes it a verb
```

Okurigana ARE the grammar. Without them, you can't tell tense, polarity, or part of speech.

---

## Furigana — The Safety Net

Small kana above/beside kanji showing pronunciation. Essential for:
- Rare kanji or names
- Medical terms patients might not know
- Children's materials
- Accessibility for non-native readers

```
 しんだん
  診  断
```

For KODA KENKŌ patient-facing materials: always include furigana for medical kanji.
