# Grammar Foundations — 文法・統語論

## The Architecture of Japanese

Japanese grammar is not "English grammar with different words." It is a fundamentally different architecture. Understanding this architecture is the difference between composing in Japanese and translating into it.

---

## The Typological Profile

**SOV (Subject-Object-Verb):** The verb comes last. The most important word in any Japanese sentence is the LAST word. Everything before the verb is context. A native listener waits for the verb.

```
私は        毎日          病院で        患者データを    確認する。
Watashi-wa  mainichi      byōin-de      kanja-dēta-o    kakunin-suru
I (TOPIC)   every-day     hospital-at   patient-data   confirm
"I confirm patient data at the hospital every day."
Lit: "As for me, every day at the hospital patient data confirm."
```

**Key structural properties:**
- **Left-branching:** Modifiers precede what they modify. Relative clauses come before the noun.
- **Head-final:** The head (main element) comes at the end of phrases — particles after nouns, verbs after objects, sentence-final particles after everything.
- **Topic-comment structure:** The は-marked topic frames the conversation domain; the comment (rest of sentence) is what you say about it.
- **Pro-drop:** Subjects are omitted when clear from context. A sentence can be just a verb.

---

## Particles — 助詞 (Joshi) — The Logical Scaffolding

Particles are postpositions that mark grammatical function. They are NOT optional decoration — they ARE the syntax.

### Case Particles (格助詞)

| Particle | Function | The Feel |
|----------|----------|----------|
| が (ga) | Subject (doer), exhaustive listing | "THIS ONE (and not another)" |
| を (wo/o) | Direct object | The thing being acted upon |
| に (ni) | Goal, location of existence, time point, indirect object | Point toward which action is directed |
| で (de) | Location of action, means/method, cause | Where/how the action happens |
| へ (e) | Direction (more poetic than に) | "Toward" — direction with feeling |
| と (to) | "And" (exhaustive), "with," quotative | Complete listing, companion, or what was said |
| から (kara) | From (origin, time, cause) | Starting point |
| より (yori) | Than, from (formal) | Comparison, formal point of departure |
| まで (made) | Until, up to | Endpoint |
| の (no) | Possession, attribution, nominalization | "Of," "belonging to," or making a clause into a noun |

### The は vs が Distinction — The Heart of Japanese

This is the single most important grammatical distinction. It is not translatable into English. It must be felt.

**は (wa) — Topic particle:** "As for X, here is what I have to say..."
```
私は学生です。
As for me, (I am) a student.
→ We were talking about me. Here's my status.
```

**が (ga) — Subject particle:** "X is the one that..."
```
私が学生です。
I am the one who is a student.
→ Among multiple people, I'M the student.
```

**The practical test:**
- Q: お仕事は何ですか？ (What is your job?) — Topic: "As for your work..."
- A: 私は医者です (I am a doctor) — Topic continues, comment added
- Q: 誰が医者ですか？ (Who is the doctor?) — Subject: "Which person is the doctor?"
- A: 私が医者です (I am the doctor) — I am the one

**When both appear:**
```
象は鼻が長い。
Zō-wa hana-ga nagai.
Elephant-TOPIC nose-SUBJECT long
"As for elephants, (their) noses are long."
→ Multiple subjects in one sentence: は for the big topic, が for the specific attribute
```

### Sentence-Final Particles (終助詞)

These encode the speaker's attitude, relationship to the listener, and gender signaling:

| Particle | Function | Register |
|----------|----------|----------|
| か (ka) | Question | Neutral/polite |
| ね (ne) | Seeking agreement, softening | Casual/friendly |
| よ (yo) | Providing new information, emphasis | Assertive |
| わ (wa) | Softening (feminine-coded, increasingly gender-neutral) | Soft |
| ぞ (zo) | Strong emphasis (masculine-coded) | Forceful/casual |
| な (na) | Reflection to self, mild prohibition | Casual (male-coded for reflection) |
| よね (yone) | Seeking agreement about shared knowledge | Friendly |

---

## Verb Conjugation — 活用 (Katsuyō)

Japanese verbs conjugate for:
- **Polarity:** affirmative/negative
- **Tense:** non-past/past (NOT present/future — "non-past" covers both)
- **Aspect:** plain, continuous (-teiru), completive (-teshimau), experiential (-takotogaaru)
- **Voice:** active, passive, causative, causative-passive
- **Modality:** potential, volitional, imperative, conditional, provisional

### Verb Classes

**Godan (五段) / u-verbs:** Stem ends in consonant. Five vowel shifts.
```
書く (kak-u → to write)
Negative:    書かない (kaka-nai)
Polite:      書きます (kaki-masu)
Dictionary:  書く (kak-u)
Conditional: 書けば (kake-ba)
Volitional:  書こう (kako-u)
```

**Ichidan (一段) / ru-verbs:** Stem ends in vowel. One vowel shift (drop -ru).
```
食べる (tabe-ru → to eat)
Negative:    食べない (tabe-nai)
Polite:      食べます (tabe-masu)
Dictionary:  食べる (tabe-ru)
Conditional: 食べれば (tabe-reba)
Volitional:  食べよう (tabe-you)
```

**Irregular:** する (suru — to do) and 来る (kuru — to come).

### Key Forms for KODA KENKŌ

**-te form (て形) — The connective:** Links clauses, forms requests, progressive aspect.
```
データを確認して、結果を報告します。
Data-wo kakunin-shite, kekka-wo hōkoku-shimasu.
"After confirming the data, (I) will report the results."
```

**Passive (受身形) — What is done to the subject:**
```
患者データが第三者に閲覧された。
Kanja-dēta-ga daisansha-ni etsuran-sareta.
"Patient data was viewed by a third party."
→ Essential for incident reports, vulnerability disclosures
```

**Causative (使役形) — Making/letting someone do:**
```
医師にデータを確認させた。
Ishi-ni dēta-wo kakunin-saseta.
"(I) had the doctor confirm the data."
```

**Causative-passive (使役受身形) — Being made to do:**
```
毎日残業させられる。
Mainichi zangyō-saserareru.
"(I) am made to work overtime every day."
→ One word encodes: "caused by another + receiving the action + it's unpleasant"
```

---

## Adjectives — The Two Classes

**i-adjectives (イ形容詞):** Native Japanese. Behave like verbs — they conjugate.
```
高い (takai — expensive/tall)
高くない (takakunai — not expensive)
高かった (takakatta — was expensive)
高くなかった (takakunakatta — was not expensive)
```

**na-adjectives (ナ形容詞):** Sino-Japanese (mostly). Behave like nouns — need な to modify.
```
静かだ (shizuka-da — it is quiet)
静かな病室 (shizuka-na byōshitsu — a quiet hospital room)
静かではない (shizuka-dewanai — it is not quiet)
静かだった (shizuka-datta — it was quiet)
```

---

## Clause Structure — The Nesting Instinct

Japanese is left-branching. Modifiers come BEFORE what they modify. This means relative clauses nest before the noun:

```
私が昨日確認した患者データは暗号化されている。
[Watashi-ga kinō kakunin-shita] kanja-dēta-wa angōka-sareteiru.
[I-SUBJ yesterday confirm-did] patient-data-TOPIC encrypted-is
"The patient data that I confirmed yesterday is encrypted."
```

The relative clause `私が昨日確認した` (that I confirmed yesterday) comes before `患者データ` (patient data). In English it comes after. This nesting is the fundamental rhythm of written Japanese.

**Deep nesting (legal/academic Japanese):**
```
当社が開発した医療AIシステムが生成した診断支援情報を
医師が確認した上で最終診断を行うことが求められる。

"When using diagnostic support information generated by 
the medical AI system developed by our company, it is 
required that a physician confirm it before making the 
final diagnosis."
```

The sentence builds context layer by layer before arriving at the main verb 求められる (is required). This is not bad style — it IS Japanese style. The reader/brain holds the nested clauses in working memory until the verb resolves the sentence.

---

## The Copula — だ・です・である

The copula (X is Y) has three register forms, all incommensurable:

| Form | Register | Usage |
|------|----------|-------|
| だ (da) | Casual/plain | Internal monologue, close friends, dictionary definitions |
| です (desu) | Polite | Standard conversation, business communication |
| である (dearu) | Formal/written | Academic papers, formal reports, legal documents |

**For KODA KENKŌ:**
- Patient-facing: です・ます
- Internal documentation: である体
- MHLW submissions: である体 (formal written) or です・ます体 depending on document type
- Code comments: だ体 or plain form (terse, natural for engineers)

---

## Negation — The Many Ways to Say No

Japanese negation is graduated. There is no single word for "not" — the negation IS the conjugation:

```
確認する (confirm) → 確認しない (not confirm — plain)
                    → 確認しません (not confirm — polite)
                    → 確認できない (cannot confirm — potential negative)
                    → 確認してはいけない (must not confirm — prohibitive)
                    → 確認しなくてはいけない (must confirm — double negative = obligation)
```

The double negative for obligation is uniquely Japanese in feel:
```
報告しなければならない。
Hōkoku-shinakereba-naranai.
"If (I) don't report, it won't do." → "I must report."
```

The indirectness of the construction is deliberate. It presents obligation as a logical consequence, not a command. This is the native way to express "must."
