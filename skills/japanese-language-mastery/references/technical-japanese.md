# Technical Japanese — 技術日本語

## The Language of Engineering, IT, and Science

Technical Japanese is a register, not a vocabulary list. It inherits the precision of Sino-Japanese kanji compounds, the terseness of English loanwords in katakana, and the logical structure of academic Japanese. For KODA KENKŌ, this is the language of architecture documents, API specs, MHLW technical submissions, and engineering discussions.

---

## Lexical Architecture — The Three Strata

Every technical concept maps onto three lexical layers:

| Stratum | Script | Character | Example |
|---------|--------|------------|---------|
| 漢語 (Kango) | Kanji | Sino-Japanese, formal, precise | 暗号化 (angōka — encryption) |
| 外来語 (Gairaigo) | Katakana | Western loanword, modern, international | エンクリプション (enkuri pushon — encryption) |
| 和語 (Wago) | Hiragana + Kanji | Native Japanese, everyday, explanatory | 暗号にする (angō-ni suru — to make into code) |

**When to use which:**
- Technical documentation, patents, MHLW: 漢語 compounds (暗号化、認証、送信)
- Software development, API docs, internal engineering: Mix of 漢語 + 外来語 (データベースを暗号化する)
- Explaining to non-technical stakeholders: 和語 paraphrases (データを守るために暗号を使います)

---

## Essential Technical Vocabulary by Domain

### Software Engineering
| Japanese | Reading | English | Usage |
|----------|---------|---------|-------|
| 実装 | jissō | implementation | 機能を実装する (implement a feature) |
| 展開 | tenkai | deploy | 本番環境に展開する (deploy to production) |
| 保守 | hoshu | maintenance | システム保守 (system maintenance) |
| 検証 | kenshō | verification | 動作検証 (operation verification) |
| 再現 | saigen | reproduce | バグを再現する (reproduce a bug) |
| 改修 | kaishū | fix/modify | コードを改修する (modify code) |
| 移行 | ikō | migration | データ移行 (data migration) |
| 冗長化 | jōchōka | redundancy | サーバーを冗長化する (make servers redundant) |
| 可用性 | kayōsei | availability | 高可用性 (high availability) |
| 耐障害性 | taishōgaisei | fault tolerance | 耐障害性の確保 (ensuring fault tolerance) |

### Data & Database
| Japanese | Reading | English |
|----------|---------|---------|
| 整合性 | seigōsei | consistency/integrity |
| 永続化 | eizokuka | persistence |
| 索引 | sakuin | index |
| 正規化 | seikika | normalization |
| 非正規化 | hiseikika | denormalization |
| 複製 | fukusei | replication |
| 分散 | bunsan | distributed |
| 問合せ | toiawase | query |
| 障害回復 | shōgai kaifuku | disaster recovery |

### AI/ML
| Japanese | Reading | English |
|----------|---------|---------|
| 学習 | gakushū | learning/training |
| 推論 | suiron | inference |
| 深層学習 | shinsō gakushū | deep learning |
| 自然言語処理 | shizen gengo shori | natural language processing |
| 画像診断 | gazō shindan | diagnostic imaging |
| 精度 | seido | accuracy/precision |
| 訓練データ | kunren dēta | training data |
| 過学習 | ka-gakushū | overfitting |
| 汎化性能 | hanka seinō | generalization performance |
| 説明可能性 | setsumei kanōsei | explainability |

### Security
| Japanese | Reading | English |
|----------|---------|---------|
| 脆弱性 | zeijakusei | vulnerability |
| 認証 | ninshō | authentication |
| 認可 | ninka | authorization |
| 暗号化 | angōka | encryption |
| 復号 | fukugō | decryption |
| 署名 | shomei | signature |
| 改ざん | kaizan | tampering |
| 漏洩 | rōei | leak/disclosure |
| 不正アクセス | fusei akusesu | unauthorized access |
| 脅威 | kyōi | threat |

---

## The Kanji Compound Pattern — 漢語の造語力

Sino-Japanese technical vocabulary is powerfully compositional. Two kanji combine to form precise concepts:

```
暗 (dark/hidden) + 号 (sign/number) → 暗号 (cipher/code)
暗号 + 化 (transform) → 暗号化 (encryption)
暗号化 + 鍵 (key) → 暗号化鍵 (encryption key)
暗号化 + 方式 (method) → 暗号化方式 (encryption method)
```

**This is the native mode of technical Japanese.** Once you know the component kanji, you can decode and compose technical terms without memorizing each one.

### Productive Technical Suffixes
```
〜化 (-ka) — -ization: 自動化 (automation), 最適化 (optimization), 標準化 (standardization)
〜性 (-sei) — -ity/-ness: 信頼性 (reliability), 拡張性 (scalability), 安全性 (safety)
〜率 (-ritsu) — rate: 稼働率 (uptime rate), 圧縮率 (compression ratio), 的中率 (accuracy rate)
〜式 (-shiki) — method/system: 二段階認証方式 (two-factor authentication method)
〜型 (-gata) — type/model: 分散型 (distributed type), 集中型 (centralized type)
〜層 (-sō) — layer: 暗号化層 (encryption layer), 抽象化層 (abstraction layer)
〜基盤 (-kiban) — platform/infrastructure: クラウド基盤 (cloud infrastructure)
〜環境 (-kankyō) — environment: 開発環境 (development environment), 本番環境 (production environment)
```

---

## Technical Document Patterns

### Bug Report (バグ報告)
```
現象 (genshō): 【発生している問題の簡潔な説明】
再現手順 (saigen tejun):
1. 【手順1】
2. 【手順2】
期待される動作 (kitai-sareru dōsa): 【本来期待される動作】
実際の動作 (jissai no dōsa): 【実際に発生している動作】
環境 (kankyō): 【OS, ブラウザ, バージョンなど】
```

### Architecture Decision Record (ADR) — アーキテクチャ決定記録
```
タイトル: 【決定内容の要約】
状況 (jōkyō): 【現在の状況と課題】
決定 (kettei): 【採用する方針】
根拠 (konkyo): 【なぜこの決定を下したか】
結果 (kekka): 【決定によって生じる結果】
代替案 (daitai-an): 【検討した他の選択肢と不採用の理由】
```

### API Documentation
```
エンドポイント: GET /api/v1/patients/{patient_id}
説明: 指定された患者IDの基本情報を返します
パラメータ:
  patient_id (必須, UUID): 患者識別子
レスポンス:
  200: 患者情報オブジェクト
  404: 指定された患者が見つかりません
  500: サーバーエラー
認証: Bearer トークンが必要
```

---

## Code Comments in Japanese

Japanese engineering teams commonly mix English and Japanese:

```python
# 患者データのバリデーション
def validate_patient_data(data: dict) -> bool:
    """患者データがMHLW基準を満たしているか検証する"""
    # TODO: 2026年度のガイドラインに対応する
    if not data.get("patient_id"):
        raise ValueError("patient_idは必須です")
    
    # 年齢が有効範囲内かチェック
    age = data.get("age")
    if age is not None and not (0 <= age <= 130):
        return False
    
    return True
```

**Style conventions:**
- Comments: Japanese for domain logic explanation, English for technical implementation notes
- Variable names: English (standard industry practice)
- Error messages (user-facing): Japanese
- Error messages (developer-facing): Japanese or English depending on team composition
- Docstrings: Japanese for KODA KENKŌ internal, bilingual for open source

---

## Reading Technical Japanese — The Skill

When reading MHLW technical documents, JIS standards, or Japanese engineering papers:

1. **Identify the kanji compounds first** — they carry the technical meaning
2. **Katakana words mark foreign concepts** — treat them as the original English terms in most cases
3. **The verb at the end of each clause** — work backward from it
4. **〜こと, 〜もの, 〜ため, 〜場合** — these nominalizers frame everything before them

### Example: MHLW Medical Device Guidelines
```
医療機器プログラムの性能評価においては、
当該プログラムが意図する使用目的に照らして、
期待される性能を達成していることを
統計学的に有意な方法で検証しなければならない。

Parsing:
[医療機器プログラムの性能評価においては、]
In the performance evaluation of medical device programs,

[当該プログラムが意図する使用目的に照らして、]
In light of the intended use purpose of said programs,

[期待される性能を達成していることを]
That expected performance is being achieved (nominalized as こと)

[統計学的に有意な方法で検証しなければならない。]
Must be verified in a statistically significant manner.
```

The sentence builds context for 4 clauses before reaching the main verb phrase 検証しなければならない (must verify). This is perfectly normal Japanese — each clause adds precision to the verification requirement.
