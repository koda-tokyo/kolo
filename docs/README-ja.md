# Kurahi

Kurahiは、Linux / macOS / Windowsでサービスとして常駐する、統制されたエージェントランタイムです。ターミナル、Web UI、CLI、メッセージングパイプ、そして他のエージェントは、いずれもそのクライアントとして動作します。

English: [README.md](../README.md)

- ドキュメント：https://kodasoken.com/kolo
- ソースとリリース：https://github.com/koda-tokyo/kurahi
- 問い合わせとサポート：https://github.com/koda-tokyo/kurahi/issues
- セキュリティ報告：security@kodasoken.com（[SECURITY.md](../SECURITY.md) を参照）
- 日本語ドキュメント：[クイックスタート](ja/QUICKSTART.md) · [セキュリティ概要](ja/security/SECURITY_OVERVIEW.md) · [プライバシー](ja/security/privacy.md) · [さくらのAI Engine](ja/providers/sakura.md)

## Kurahiを選ぶ理由

- **常駐エージェントはセッションをまたいで働き続けます。** 識別名ごとに1つのゲートウェイプロセスがOSのサービスマネージャ配下で動作し、セッションと作業領域を保持し、終了すればOSが再起動します。ターミナルを閉じてもエージェントは止まりません。
- **統制はプロンプトではなくランタイムで強制されます。** スコープ付きペアリング（`observe` < `attach` < `admin` < `owner`）、端末の鍵に紐づく資格情報とローテーションするリフレッシュトークン、ハッシュチェーンされた監査ログ（`kurahi audit verify`）、登録済みファイルの改変を検知すると起動を拒否する起動時整合性ゲート。
- **仕様が明文化されたAPIと、そこから生成されたクライアント。** `GET /doc` でOpenAPI 3.1文書を提供（43操作、それぞれに認証種別と最小スコープを明記）。`@kodasoken/kurahi-client` はこの文書から生成され、乖離があればCIが失敗します。
- **1つのセッションに複数のクライアント。** `attach` スコープを持つ資格情報なら、稼働中のセッションを一覧し、ターミナル、スクリプト、メッセージングパイプを接続できます。接続中のクライアント全員が同じイベントストリームを受け取ります。
- **Code ModeとMCP。** エージェントは1本のスクリプトで多数のツールを1往復で呼び出せます。設定したMCPサーバーのツールは `mcp:<server>:<tool>` という名前で利用できます。
- **エージェント制御。** 実行ごとのステップ上限、同一呼び出しや進捗のないツール呼び出しを止めるループ検出、パスとコマンドに対するパーミッショングロブ、キャンセル可能なジョブレジストリ。

## インストール

インストーラーのバンドルはNode.jsランタイムを同梱しています。npmから入れる場合はNode.js 22.12以上が必要です。

Linux / macOS:

```bash
curl -fsSL https://kodasoken.com/kurahi/install.sh | bash
```

Windows（PowerShell 7またはWindows PowerShell 5.1）:

```powershell
iwr -useb https://kodasoken.com/kurahi/install.ps1 | iex
```

インストーラーは、GitHub ReleasesからOSとCPUに合ったリリースバンドルを選び、展開前に公開された `SHA256SUMS.txt` とSHA-256を照合し、`~/.local/share/kolo/<version>`（Windows: `%LOCALAPPDATA%\KoLo\app\<version>`）に配置して `kolo` コマンドをリンクし、`kurahi init --non-interactive` と `kurahi service install` を実行し、1回限りのペアリング招待コードを表示します。rootや管理者権限では動作せず、github.com以外からは何もダウンロードしません。両スクリプトはこのリポジトリの[`scripts/`](../scripts/) にあり、そのまま配信されています。フラグの一覧は[docs/install/index.md](install/index.md) を参照してください。

npm（グローバル、PATH上にNode.js 22.12以上が必要）:

```bash
npm install -g kurahi
kurahi --version
```

バンドルのダウンロードとチェックサム検証（オフライン / 閉域環境）:

```bash
# ネットワークに接続できるマシンで kolo-<version>-<os>-<arch>.tar.gz（Windows は .zip）と
# SHA256SUMS.txt を https://github.com/koda-tokyo/kurahi/releases/latest から取得
sha256sum -c --ignore-missing SHA256SUMS.txt
bash install.sh --bundle kolo-<version>-linux-x64.tar.gz --sums SHA256SUMS.txt
```

ソースから:

```bash
git clone https://github.com/koda-tokyo/kurahi.git
cd kurahi
pnpm install --frozen-lockfile
pnpm build
node kolo.mjs --version
```

`pnpm build && node scripts/bundle.mjs` を実行すると、インストーラーが使うものと同じバンドルが `release/` に生成されます（[docs/PACKAGING.md](PACKAGING.md)）。

## 初回起動

新しく使い始める方が覚える必要があるコマンドは `kurahi init` だけです。状態ディレクトリ、設定、ゲートウェイトークンを作成し、診断を実行して、次に打つコマンドを表示します。

```bash
kurahi init --name alice --lang ja
```

```
state      /home/alice/.kolo
config     /home/alice/.kolo/kolo.json
token      /home/alice/.kolo/secrets/gateway.token (created, 0600)
workspace  /home/alice/.kolo/workspace
identity   alice
bind       loopback
port       18789
provider   not chosen (kurahi onboard, or kurahi secrets)
doctor     ok

next:
  kurahi service install --id alice  run the gateway under the OS service manager
  kurahi health                      one status line from the gateway
  kurahi onboard                     choose a model provider
  kurahi pair invite --scope attach  invitation for a second device or terminal
  kurahi tui                         talk to the agent
```

続けて:

```bash
kurahi service install --id alice     # systemd (Linux) / launchd (macOS) / タスク スケジューラ (Windows)
kurahi health                         # 稼働中のゲートウェイから 1 行のステータス
kurahi pair invite --scope attach     # 1 回限りのコード (kpi_...) を表示。保存されるのはハッシュのみ
kurahi attach --list                  # この資格情報で見えるセッション
kurahi tui                            # このターミナルでエージェントと対話
```

プロンプトなしで実行する場合：`kurahi init --non-interactive --name alice --bind loopback --provider sakura`（トークンは `SAKURA_API_KEY` から読み取ります）。日本語メッセージは `--lang ja` または `KOLO_LANG=ja` で指定します。ゲートウェイが起動していなければ `kurahi health` がその旨と起動コマンドを表示します。

終了コードは全コマンド共通です：`0` 成功、`1` エラー、`2` 使い方の誤り、`3` ゲートウェイに到達不可、`4` 認証失敗。

## 主な概念

| 用語              | 意味                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 識別名 (Identity) | 常駐エージェント1体の名前（`alice`、`ops-bot`）。識別名ごとに独立したサービス、状態ディレクトリ、ポートを持ちます。使える文字は `a-z`、`0-9`、`-`、`_` で1〜32文字。                                          |
| `KOLO_HOME`       | その識別名が所有するすべてを収める1つのディレクトリ。`~/.kolo`（Windows: `%LOCALAPPDATA%\KoLo`）。2つ目以降の識別名は `~/.kolo-<id>`。プログラム本体以外はここ以外に書き込みません。                         |
| ゲートウェイ      | 常駐プロセス。既定ではループバックにのみバインドし、HTTPとWebSocketを提供し、エージェントを実行し、セッションを保持し、監査ログを書きます。                                                                    |
| セッション        | エージェントが参加している会話（`agent:alice:main`）。セッションはゲートウェイ内に存在し、ターミナル、パイプ、他のエージェントがそこに接続します。                                                                |
| 招待 (Invitation) | 1回限りのペアリングコード（`kpi_...`）。スコープ、有効期限（既定10分）、任意でセッションの許可リストを持ちます。作成者が持つ以上の権限は決して付与しません。                                                  |
| 端末 (Device)     | ペアリング済みのクライアント。固有のEd25519鍵と、`KOLO_HOME/secrets/devices/` 配下の資格情報ファイルを持ちます。短命のアクセストークン（既定1時間）とローテーションするリフレッシュトークン（既定30日）。 |
| ジョブ (Job)      | エージェントの1回の実行。queued → running → 終了状態。`/api/jobs` で一覧とキャンセルができ、キャンセルは監査されます。                                                                                          |
| プラグイン        | プロセス内で読み込まれる拡張。`KoLo.plugin.json` マニフェストと設定用JSONスキーマを同梱します。チャネル、プロバイダー、ツール、同梱の運用プラグインはすべてプラグインです。                                     |
| MCPサーバー      | ゲートウェイが接続する外部ツールサーバー（`kurahi mcp add`）。そのツールは `mcp:<server>:<tool>` として現れ、実行系のツールは名前で許可しない限り隠されます。                                                    |
| Code Mode         | `code_mode_run` ツール。モデルが1本のスクリプトを書き、`tools.*` 経由で多数のツールを呼び、値を返します。N往復の代わりに1往復、既定60秒の実時間上限付き。                                                  |

`KOLO_HOME` の構成:

```
kolo.json                 設定（秘密情報は名前で参照し、ここには保存しない）
secrets/                  gateway.token (0600)、devices/<fingerprint>.json、credentials.json（ハッシュのみ）
agents/<id>/sessions/     会話の記録。アップロードされることはない
workspace/                エージェントの作業ディレクトリと指示ファイル
audit/                    ハッシュチェーンされた監査ログ。月ごとに 1 ファイル
logs/                     日ごとのゲートウェイ ログ。秘密情報はマスク済み
run/                      gateway.lock、jobs.json
service/                  サービス定義と直近のインストール時のポート
support/                  kurahi support が書き出すマスク済みバンドル
```

スコープ（すべてのHTTPルートとWebSocketメソッドで強制されます）:

| スコープ  | できること                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `observe` | 読み取り：ヘルス、メトリクス、一覧、履歴、`/api/pair/me`                                              |
| `attach`  | observeに加えてセッションの操作：チャット、エージェントターン、`/tools/invoke`、`/v1/*`、Code Mode  |
| `admin`   | attachに加えてゲートウェイの管理：設定、cron、ペアリング、プラグインの再読み込み                     |
| `owner`   | ゲートウェイトークンファイル（`KOLO_HOME/secrets/gateway.token`）。ペアリングでは決して付与されない |

必要な最小スコープを満たさない資格情報はHTTPでは `403`、WebSocketでは `missing scope: <scope>` を受け取ります。失効済みのリフレッシュトークンが再利用されると、その資格情報ファミリー全体が取り消されます。`gateway.pairing.reconsentDays`（既定90日）を超えた端末は再ペアリングが必要です。詳細：[docs/cli/pair.md](cli/pair.md)、[docs/cli/attach.md](cli/attach.md)。

## セキュリティ

セキュリティ質問票への回答は[セキュリティ概要](ja/security/SECURITY_OVERVIEW.md)、データの取り扱いは[プライバシー](ja/security/privacy.md) を参照してください。脆弱性の報告はsecurity@kodasoken.comへ。手順と目標期間は[SECURITY.md](../SECURITY.md) にあります。

マシンの外に出る通信は、いずれも設定した後にのみ発生します:

| 通信                           | 宛先                                          | 止め方                                   |
| ------------------------------ | --------------------------------------------- | ---------------------------------------- |
| モデルへのリクエスト           | 設定したプロバイダー                          | `local` プロファイル                     |
| メッセージングチャネル        | そのチャネルのサービス                        | チャネルを有効にしない                   |
| 更新確認（バージョン情報のみ） | パッケージレジストリ（npmインストールのみ） | `update.checkOnStart: false`             |
| ローカルネットワークへの告知  | mDNS経由でLAN                               | `gateway.discovery.mdns.mode: "off"`     |
| インストーラー                 | github.com（インストール時のみ）              | `--bundle` によるオフラインインストール |

テレメトリ、アナリティクス、クラッシュレポートはありません。ゲートウェイは実行時にベンダーへ接続しません。サポートバンドルはローカルに書き出され、チケットに添付した場合にだけ外に出ます。

検証できる性質:

```bash
kurahi audit verify            # ハッシュチェーンを再走査。最初の切れ目で終了コード 1
kurahi integrity status        # 登録済みファイルすべてのダイジェストを照合。不一致なら終了コード 3
kurahi pair devices            # 資格情報を持つ端末、スコープ、最終アクセス
kurahi secrets list            # 名前とバックエンドのみ。値は決して表示しない
```

完全な削除:

```bash
kurahi uninstall --all --yes --dry-run      # サービス、状態ディレクトリ、作業領域を一覧表示。削除はしない
kurahi uninstall --all --yes
rm -rf ~/.local/share/kolo ~/.local/bin/kolo    # プログラム本体 (Windows: %LOCALAPPDATA%\KoLo)
```

これらのパス以外には何も残りません。削除したゲートウェイが発行した資格情報は無効になります。

## この先

設定、CLIリファレンス、HTTP / WebSocket API、運用、プラグイン、互換性、ライセンスと商標、コントリビューション、サポートと評価については、英語版[README.md](../README.md) の後半を参照してください。ライセンスの構成（MIT / FSL-1.1-Apache-2.0 / プロプライエタリ）は[LICENSING.md](../LICENSING.md)、商標は[TRADEMARKS.md](../TRADEMARKS.md)、評価ライセンスは[EVALUATION_LICENSE.md](EVALUATION_LICENSE.md) にあります。
