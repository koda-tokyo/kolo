---
summary: "さくらのAI Engine: 国内ホストのOpenAI互換モデル。無償枠あり。評価用の標準プロファイル"
read_when:
  - 新規インストールで標準のモデルプロバイダーを設定する
  - データを国内に留めたい
title: "さくらのAI Engine"
---

# さくらのAI Engine

さくらのAI Engine は、さくらインターネットが国内で運用する推論サービスです。OpenAI 互換の Chat Completions API を提供しており、Kurahi は標準の `openai-completions` アダプターでそのまま接続します。`kurahi init` が最初に提示するプロファイルで、評価利用の標準です。無償枠で始められ、プロンプトは国外に出ません。

英語版: [Sakura AI Engine](/providers/sakura)

## 確認済みの事実（2026-10-13 時点、公式ページより）

| 項目                       | 値                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| ベース URL                 | `https://api.ai.sakura.ad.jp/v1`                                                                                                                 |
| チャットエンドポイント     | `POST https://api.ai.sakura.ad.jp/v1/chat/completions`                                                                                           |
| 認証                       | `Authorization: Bearer <APIトークン>`（コントロールパネルで発行）                                                                                |
| Kurahi の標準モデル        | `sakura/gpt-oss-120b`                                                                                                                            |
| プリセットに含む他のモデル | `llm-jp-3.1-8x13b-instruct`、`Kimi-K2.6`（パブリックプレビュー）                                                                                 |
| 無償枠                     | `gpt-oss-120b` で月 3,000 リクエストまで。翌月に自動リセット。超過後はレート制限がかかり、従量課金に自動で切り替わることはありません             |
| 従量課金（gpt-oss-120b）   | 入力 1 万トークンあたり 0.15 円、出力 1 万トークンあたり 0.75 円（税込）                                                                         |
| 公式ページ                 | https://ai.sakura.ad.jp/sakura-ai/ai-engine/ ・ API リファレンス https://manual.sakura.ad.jp/api/cloud/portal/ai-engine-inference-api/index.html |

利用可能なモデルはコントロールパネルの表示が正です。Kurahi のプリセットには上記のモデルが入っており、`kolo.json` の `models.providers.sakura.models` に追加できます。

## 登録とトークンの取得

1. さくらインターネットの会員 ID を作成します（電話番号認証が必要）。
2. さくらのクラウドのプロジェクトを作成します（クレジットカードの登録が必要ですが、無償枠の範囲では課金されません）。
3. コントロールパネル https://secure.sakura.ad.jp/ai/ にログインし、API トークンを発行します。

## Kurahi の設定

初回起動時（対話形式）:

```bash
kurahi init          # 「Sakura AI Engine」を選び、トークンを貼り付ける
```

プロンプトなし:

```bash
SAKURA_API_KEY=<トークン> kurahi init --non-interactive --provider sakura
```

既存のインストールに追加する場合:

```bash
kurahi onboard --auth-choice sakura-api-key
# または
kurahi secrets set SAKURA_API_KEY --stdin
kurahi config set agents.defaults.model.primary sakura/gpt-oss-120b
```

トークンは `KOLO_HOME` 配下の認証プロファイル `sakura:default`（ファイル権限 0600）に保存され、`kolo.json` には書き込まれません。環境変数 `SAKURA_API_KEY` でも指定できます。

確認:

```bash
kurahi models list         # sakura/gpt-oss-120b が available として表示される
kurahi tui --message "一行で挨拶してください"
```

## 評価者向けの補足

- 無償枠はトークン数ではなくリクエスト数で消費されます。長い会話でも 1 ターン = 1 リクエストです。
- サービスは国内（さくらインターネットのデータセンター）で運用されています。規制対象データを送る前に、提供元の最新の利用規約とデータ取り扱いの記載を確認してください。
- 月間の無償枠を使い切ったときに別のプロバイダーへ切り替えるには、`agents.defaults.model.fallbacks` を設定します（[Models](/providers/models) を参照）。
