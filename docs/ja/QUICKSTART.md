---
summary: "1 ページ: インストール、初回起動、端末のペアリング、セッション接続、アンインストール"
read_when:
  - Kurahi を 1 ページ分の時間で試したい
title: "クイックスタート"
---

# Kurahi クイックスタート (1 ページ)

English: [Quickstart](/QUICKSTART)

必要なもの: Linux / macOS / Windows 10・11（インストーラーのバンドルは Node.js ランタイムを同梱。npm パッケージから入れる場合は Node.js 22.12 以上）、モデルプロバイダーのトークン（さくらのAI Engine の無償枠で始められます。[さくらのAI Engine](/ja/providers/sakura) を参照）。

## 1. インストール (2 分)

Linux / macOS:

```bash
curl -fsSL https://kodasoken.com/kurahi/install.sh | bash
```

Windows (PowerShell):

```powershell
iwr -useb https://kodasoken.com/kurahi/install.ps1 | iex
```

インストーラーは公開された SHA-256（`SHA256SUMS.txt`）でダウンロードを検証し、`kolo` コマンドを配置し、`kurahi init` を実行し、ゲートウェイをユーザーサービスとして登録し、ペアリング用の招待コードを表示します。閉域環境では、バンドルと `SHA256SUMS.txt` をダウンロードして `install.sh --bundle <ファイル> --sums SHA256SUMS.txt` を実行します。

## 2. 初回起動

インストーラーが実行しなかった場合、または設定を変えたい場合:

```bash
kurahi init --lang ja             # 識別名、接続範囲、プロバイダー (最初の候補はさくらのAI Engine)
kurahi service install            # systemd / launchd / タスク スケジューラでゲートウェイを常駐
kurahi health --lang ja           # 「ゲートウェイ 正常 · エージェント 1 · …」
kurahi tui --message "一行で挨拶してください"
```

日本語表示は `--lang ja` または環境変数 `KOLO_LANG=ja` で指定します。

プロンプトなし: `SAKURA_API_KEY=<トークン> kurahi init --non-interactive --name alice --provider sakura`

### スマートフォンをつなぐ (5 分)

`kurahi init` の最後の質問でスマートフォンをつなぐと、QR コードが表示されます。読み取ってメッセージを 1 通送ると、常駐エージェントが WhatsApp、Telegram、LINE、またはスマートフォンのブラウザーで応答します。あとからでも `kurahi connect telegram` (または `whatsapp`、`line`、`web`) で実行できます。手順: [スマートフォンをつなぐ](/ja/start/phone)。

## 3. 別の端末やターミナルをペアリングする

ゲートウェイが動いているマシンで:

```bash
kurahi pair invite --scope attach        # 1 回限りのコードを表示。スコープ: observe < attach < admin < owner
```

もう一方の端末（同じネットワーク、またはトンネル経由）で、Kurahi アプリか `kurahi pair redeem <コード> --url http://<ホスト>:<ポート>` でコードを引き換えます。資格情報はその端末の鍵に紐づき、自動的に失効し、`kurahi pair revoke <id>` で取り消せます。

## 4. 稼働中のセッションに接続する

```bash
kurahi attach --list                     # 接続できるセッション
kurahi attach alice                      # エージェントのメインセッション (複数ターミナルから同時に可)
echo "status?" | kurahi attach alice     # 1 行送って返答を表示し、切断
```

## 5. 確認とサポート

```bash
kurahi doctor --lang ja                  # 診断と修復
kurahi audit verify                      # ハッシュチェーンされた監査ログ
kurahi support --lang ja                 # 事実の一覧 + マスク済み診断バンドル (チケット添付用)
```

## 6. アンインストール

```bash
kurahi uninstall --all --yes --dry-run   # 表示: サービス定義、状態ディレクトリ、作業領域
kurahi uninstall --all --yes
rm -rf ~/.local/share/kolo ~/.local/bin/kolo        # プログラム本体 (Windows: %LOCALAPPDATA%\Kurahi)
```

Kurahi が書き込むのは `KOLO_HOME`（`~/.kolo`、Windows は `%LOCALAPPDATA%\Kurahi`）とインストール先だけです。それ以外には触れません。

終了コードは全コマンド共通: 0 成功、1 エラー、2 使い方の誤り、3 ゲートウェイに到達不可、4 認証失敗。
