# Typography & Formatting — 日本語組版

## The Architecture of Written Japanese

Japanese typography is not "English typography with different characters." It is a fundamentally different visual system. Characters occupy squares (全角), line breaking follows strict rules (禁則処理), and punctuation operates in its own logic. Knowing these rules instinctively — knowing where a line breaks before you type it — is part of being a native writer.

---

## 全角・半角 — The Square and the Rectangle

### Character Widths
```
全角 (zenkaku — full-width): 漢字, ひらがな, カタカナ, 全角英数字
  Each character occupies a square. This is the native Japanese grid.
  例：日本語は全角です
  ＡＢＣ１２３ (full-width Latin — used in vertical text, formal documents)

半角 (hankaku — half-width): Latin letters, Arabic numerals, most code
  Each character occupies a half-width rectangle.
  例: ABC 123 (half-width — standard in horizontal text, code, URLs)
```

### The Mixing Rule
In modern Japanese horizontal text, the convention is:
- Japanese text: full-width (naturally)
- Latin text embedded in Japanese: full-width for document titles, half-width for technical content
- Numerals: full-width in formal documents (１２３), half-width in technical contexts (123)
- URLs, email addresses, code: ALWAYS half-width

```
✅ 正しい:
患者ID「12345」をデータベースに登録してください。
(Japanese text + half-width numbers in technical context)

✅ 正しい:
第１２回日本医療情報学会
(full-width numbers in formal title)

❌ 間違い:
abc@example.com  ← full-width characters in an email address
```

---

## 禁則処理 — Kinsoku Shori (Line-Breaking Rules)

The most important typographic rule in Japanese. Characters that must never appear at line-start or line-end are governed by strict conventions. Native writers feel violations physically.

### 行頭禁則文字 — Characters Forbidden at Line Start

These must NEVER be the first character on a new line:

```
Closing brackets:
  」』）〕］｝＞》. 。

Punctuation:
  、。，．：；？！ゝゞ々〜

Small kana (捨て仮名):
  ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ

Iteration marks:
  々 〻 〳 〵

Warichū closing:
  〙
```

**The rule in practice:**
```
❌ WRONG — line starts with closing bracket:
システムは患者データを暗号化し、安全に保存する
」。また、アクセス制御により不正アクセスを防止
する。

✅ RIGHT — bracket pulled back to previous line:
システムは患者データを暗号化し、安全に保存す
る」。また、アクセス制御により不正アクセスを
防止する。
```
(Both lines slightly overfull — Japanese typesetting allows modest overhang (ぶら下がり) for punctuation, or the bracket stays on the previous line.)

### 行末禁則文字 — Characters Forbidden at Line End

These must NEVER be the last character on a line:

```
Opening brackets:
  「『（〔［｛＜

Currency symbols:
  ￥＄
```

**The rule in practice:**
```
❌ WRONG — line ends with opening bracket:
厚生労働省のガイドライン（
医療AIに関する指針）によれば...

✅ RIGHT — bracket pushed to next line, or previous word pulled back:
厚生労働省のガイドライン
（医療AIに関する指針）によれば...
```

### ぶら下がり (Burasagari) — Hanging Punctuation

Periods and commas can HANG past the right margin slightly. This is considered acceptable, even preferred, over breaking the line awkwardly:

```
許容される (ACCEPTABLE):
これは日本語の文章の例です
。次の文が続きます。

This slight overhang of 。is normal in Japanese typography.
```

### The Numeric Rule
Don't split a number across lines:
```
❌ 患者数は12
   3,456人でした
✅ 患者数は
   123,456人でした
```

### The Unit Rule
Don't separate a number from its unit:
```
❌ 投与量は500
   mgです
✅ 投与量は
   500mgです
```

---

## 約物 — Punctuation (Yakumono)

Japanese punctuation occupies full-width space and has its own logic:

### The Core Punctuation Set
| Character | Name | Function |
|-----------|------|----------|
| 。 | 句点 (kuten) | Period — ends declarative sentences |
| 、 | 読点 (tōten) | Comma — separates clauses, marks breath points |
| 「」 | 鍵括弧 (kagikakko) | Quotation marks — direct speech, emphasis, titles |
| 『』 | 二重鍵括弧 | Double quotes — quotes within quotes, book titles |
| （） | 括弧 (kakko) | Parentheses — supplementary information |
| 【】 | 隅付き括弧 | Thick brackets — emphasis, headings, keywords |
| 〜 | 波ダッシュ | Wave dash — ranges (1〜100), elongation (すごい〜) |
| … | 三点リーダー | Ellipsis — trailing off, pause, omission |
| —— | ダッシュ | Dash — emphasis, aside, interruption |
| ・ | 中黒 (nakaguro) | Interpunct — item separation, foreign name spacing (田中・スミス) |
| 〒 | 郵便マーク | Postal mark — addresses (Japan Post symbol) |

### The Comma — 、vs ,

Most modern technical Japanese uses 、(the Japanese comma). Some technical documents use , (the Western comma) — this is acceptable in IT documentation but reads as "translated" or "Westernized":

```
伝統的 (TRADITIONAL): 当該システムは、患者データを収集し、分析する。
技術文書 (TECHNICAL): 当該システムは, 患者データを収集し, 分析する. (acceptable, reads as Western-influenced)
```

For KODA KENKŌ: 、for all official Japanese documents, MHLW submissions, and patient-facing content. , is acceptable for internal technical docs.

### Spacing Between Japanese and Latin Text

When Japanese and Latin (alphabet/numbers) appear together, add a quarter-width space (best practice):

```
✅ これは HTML で書かれた文書です
✅ 患者は 30 名でした
✅ データベースに INSERT 文を実行する

In environments where quarter-space isn't available, use full space or nothing:
✅ これはHTMLで書かれた文書です (acceptable — no space)
✅ これは HTML で書かれた文書です (preferred — quarter-space if available)
```

---

## Vertical Text — 縦書きの組版規則

### Punctuation in Vertical Text
Punctuation shifts to the top-right of the character square:

```
　漢　　文　　が　　縦　　書
　字　　章　　。　　の　　き
　と　　が　　　　　文　　の
　仮　　続　　　　　字　　場
　名　　く　　　　　は　　合
　が　　。　　　　　右　　は
　混　　　　　　　　上　　、
　在　　　　　　　　に　　読
　す　　　　　　　　寄　　点
　る　　　　　　　　る　　や
```

In vertical text, periods and commas sit at the TOP-RIGHT of their square, not bottom-left as in horizontal text.

### Direction Consistency
Within one column/document, NEVER switch between vertical and horizontal mid-document (except for embedded tables, figures, or Western-language quotations).

### Numbers in Vertical Text
Vertical text traditionally uses kanji numerals:
```
横書き: 123人
縦書き: 一二三人 (formal) or １２３人 (现代)
```
Full-width Arabic numerals are increasingly common even in vertical text for readability.

---

## Digital Typography — Web & UI

### Font Choice for Japanese
```
System fonts (safe, universally available):
  Windows: Yu Gothic (游ゴシック), MS Gothic (MS ゴシック)
  macOS/iOS: Hiragino Sans (ヒラギノ角ゴ), Hiragino Mincho (ヒラギノ明朝)
  Android: Noto Sans CJK JP
  Linux: Noto Sans CJK JP, IPAexGothic

Web font stack:
  font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN",
               "Noto Sans CJK JP", "Yu Gothic", sans-serif;

For KODA KENKŌ UI:
  Sans-serif for screens (角ゴシック): Hiragino Sans → Noto Sans CJK JP
  Serif for formal print (明朝): Hiragino Mincho → Noto Serif CJK JP
```

### Line Height
Japanese requires more line height than Latin text:
```
Latin:  line-height: 1.4–1.6
Japanese: line-height: 1.7–2.0 (full-width characters need vertical breathing room)
```

### Font Size Minimums
```
Kanji is complex. At small sizes, strokes blur together.
Minimum readable: 12px for regular text, 10px for captions (with good font)
Accessible minimum: 16px (MHLW readability guidance for patient-facing text)
```

### Ruby/Furigana in HTML
```html
<ruby>診断<rp>(</rp><rt>しんだん</rt><rp>)</rp></ruby>
<!-- Renders: 診断 with しんだん above it -->
```
Use for: medical terminology in patient-facing web pages, rare kanji, names.

---

## Document Formatting — 文書体裁

### The 原稿用紙 (Genkō Yōshi) Legacy
Traditional Japanese manuscript paper (200- or 400-character grid) shaped formatting expectations:
- One character per square
- Paragraph indent: 1 square (1全角 space)
- Punctuation: occupies its own square
- Opening quotes: occupy their own square at line start

Modern word processors inherit these conventions:
```
　日本語の文章では、段落の最初に
1マス分の字下げ（インデント）を
入れます。
```
(Note the 全角 space at the start — this IS the paragraph indent.)

### Business Document Format
```
令和8年5月23日

株式会社コウダソウケン
代表取締役 カルロス 様

拝啓

（本文 — 1字下げ）

　　　　　　　　　　　　　　敬具

（記 — details section, if needed）
```

### MHLW Submission Formatting
Follow the specific format prescribed by each guidance document. Common patterns:
- Title: ゴシック (sans-serif), centered or left-aligned
- Body: 明朝 (serif) for print, ゴシック for digital
- Page numbers: bottom center
- 印鑑欄 (seal field): designated space, often bottom-right of final page

---

## Typographic Antipatterns to Avoid

1. **Double-width Latin in URLs** — ＡＢＣ (full-width) in a URL is a broken URL
2. **Mixed punctuation styles** — Don't use 、in one sentence and , in the next
3. **No line-breaking consideration** — text that ignores 禁則処理 hurts native eyes
4. **Tiny kanji** — below 10px, kanji become illegible smudges
5. **西暦/和暦 confusion** — Choose one date format and stay consistent
6. **Justified Japanese text without proper hyphenation** — Japanese doesn't hyphenate; justified text creates rivers of whitespace. Left-aligned is safer.
