# 応物単位くん (`tanikun`) — 初期設計・Coding Agentへの引き継ぎ

> **文書の位置づけ**: この文書は、リポジトリの `docs/INITIAL_DESIGN.md` に配置するための初期案である。実装仕様の確定版ではない。Coding Agentはこれを出発点に、設計上の未解決点を検証・提案し、ADRと小さな実装計画に落とし込むこと。
>
> **重要**: 以下の「決定済み」は議論で合意した基本方針であり、特定のライブラリの現行API・互換性・設定ファイル構文まで実証済みという意味ではない。技術的な不整合が見つかったら、根拠と代替案を示し、無断で置き換えないこと。

## 1. プロジェクト概要・目的

- **サービス名**: 応物単位くん
- **リポジトリ名**: `tanikun`（暫定採用）
- **GitHub Description案**: `A course planning and graduation requirement tracker for university students, built with MoonBit.`
- **対象**: 当初は東京大学の進学後課程、とくに応用物理系の履修・卒業要件管理。将来は他学科・他大学へ拡張できるデータモデル・ルールエンジンにする。ただし初期データ・実装対象を無理に広げない。
- **想定ユーザー**: 開発者本人と少数の友人。大学全体を対象にした公開SaaSは初期目標ではない。
- **開発の価値観**: **ユーザー向け機能はコンパクトに、学習する技術は積極的に取り入れる**。MoonBitを主役に、Local-first、CRDT、E2EE、Passkeys、Cloudflare、Nixによるビルド、TDD、分散システムのテスト・可観測性に取り組む。ただし「技術を盛る」ことを理由に完成可能性・安全性・可用性を犠牲にしない。
- **開発環境の好み**: macOS、Nix Flakes、direnv、Neovim、Coding Agent。CIはGitHub Actionsの**Linux Runner**を中心にし、macOS Runnerの使用を前提にしない。

## 2. ユーザーに提供する機能

1. **5学期分の時間割**を曜日・時限のグリッドで管理。通常科目に加え、集中講義など時間割に置けない科目も登録できる。
2. 学期ごとに履修科目を選択し、**履修予定・履修中・合格・不合格等**の状態や必要な成績情報を管理する。
3. Git管理の**共有科目マスタ**から科目を選べる。ユーザー自身の**独自科目追加**、共有科目の**個別属性上書き**（名称・単位数・曜限・区分等）にも対応する。
4. **学科・コース・適用年度**別の卒業要件を選び、単位集計と充足状況を確認する。確定単位と予定・見込みの単位を明確に区別する。
5. **オフラインで編集できる**。同一ユーザーの複数端末でデータを同期する。
6. **Passkeyでログイン**でき、クラウド側の成績データは**E2EE**で保護される。**既存端末承認による新端末への鍵転送**を標準導線にする。
7. ユーザー自身が**JSON/CSVエクスポート**と、必要に応じて**暗号化バックアップ**を取得できる。

### 明示的に初期対象外／保留

- 複数ユーザーによる同一ドキュメントの共同編集・共有履修計画。
- 大学の履修システムからの自動収集・スクレイピング。
- ユーザーによる卒業要件ルールの自由編集。
- 具体的な応物系の卒業要件条文・科目一覧の網羅的な確定（**意図的に後回し**。最初は架空のテストデータで進める）。
- Durable Objects、WebSocketベースの常時同期。独自HTTP差分同期を学習・実装する。
- SAT/SMTの無条件採用（単位配分・重複計上制約が必要になった場合の発展案）。
- 別プロジェクトで検討しているCloudflare Voidによるポートフォリオサイト。このリポジトリへ混ぜない。

## 3. 技術選定（基本方針）

| 領域                       | 採用方針                                             | コメント                                                             |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Frontend                   | **MoonBit JS target + Rabbita**                      | The Elm Architecture: Model / Msg / Update / View                    |
| UI開発・ビルド             | **Warren**                                           | Rabbitaとの互換性・現行の手順をPhase 0で実証                         |
| Styling                    | **Tailwind CSS v4 + CSS Variables / Design Tokens**  | `.mbt`を含むクラス抽出・ビルド連携を確認                             |
| Domain                     | **Pure MoonBit**                                     | UI、Cloudflare、JS FFIから独立                                       |
| Graduation rules           | **Pure MoonBitの型付きルール評価器**                 | JSONルールセットをバージョン管理                                     |
| CRDT                       | **Automerge（JavaScriptライブラリを薄いFFIで利用）** | ユーザーごとに原則1ドキュメント                                      |
| Local persistence          | **IndexedDB**                                        | Automergeデータ・同期メタデータを保存                                |
| Sync                       | **独自HTTP差分同期**                                 | Changes + server-side sequence cursor; WebSocketなし                 |
| Backend                    | **MoonBit JS target on Cloudflare Workers**          | Worker APIはJS FFIを介す                                             |
| API                        | **REST / versioned DTO / OpenAPI志向**               | OpenAPI生成方式は検証。契約テストを優先してもよい                    |
| Relational DB              | **Cloudflare D1**                                    | ユーザー、セッション、Passkey、所有権、暗号化Changeログ等            |
| Object store               | **Cloudflare R2**                                    | 暗号化Snapshot、必要なバッチ・バックアップ等。初期段階で必須ではない |
| Static hosting             | **Cloudflare Workers Static Assets**                 | 同一Originで配信する案                                               |
| Auth                       | **Passkeys / WebAuthn + opaque Cookie Session**      | WebAuthn暗号検証は監査されたJSライブラリ                             |
| E2EE                       | **AES-256-GCM / Web Crypto API**                     | Document Key + 端末鍵、クライアント側暗号化                          |
| Device enrollment          | **既存端末の承認・鍵転送がメイン**                   | QR/短い照合コード等で鍵相手を認証                                    |
| Optional key recovery      | **WebAuthn PRFは調査・実機検証後に判断**             | 普遍的な復旧手段とみなさない                                         |
| Mandatory recovery key     | **なし**                                             | 全端末とバックアップ喪失時には復旧不能になり得る                     |
| Monorepo                   | **MoonBit Workspace（`moon.work`）**                 | 実際の構文・モジュール依存を現行MoonBitで確認                        |
| Environment/build          | **Nix Flakes + direnv**                              | **Nixは開発環境だけでなくビルドまで管理**                            |
| JS dependencies            | **pnpm + lockfile**                                  | Nixのサンドボックス内でオフラインビルド可能にする                    |
| Commands                   | **just**                                             | ユニット・E2E・ビルドなどを統一                                      |
| CI/CD                      | **GitHub Actions on Linux + Nix cache**              | PRチェックとmainデプロイ。キャッシュはCachix等候補                   |
| IaC                        | **OpenTofu**                                         | D1/R2などのリソース。Wranglerと責務を重複させない                    |
| Deploy                     | **Wrangler**                                         | **Nixビルド済み成果物**をデプロイする方向                            |
| Unit testing               | **MoonBit標準テスト (`moon test`)**                  | TDDの中心                                                            |
| Property-based/model-based | **MoonBit側の生成器またはfast-check**                | CRDT・卒業要件・同期の性質を検証                                     |
| Integration                | **Vitest / Workers Vitest Plugin等**                 | D1/R2・FFI・APIの検証                                                |
| E2E                        | **Playwright**                                       | 時間割操作、オフライン、複数BrowserContext、Passkeys                 |
| Observability              | **Cloudflare Workers Observability + OpenTelemetry** | トレース/ログを中心に段階導入                                        |
| Dashboards                 | **Grafana Cloud第一候補**                            | コスト・保存期間・個人情報の扱いを検討                               |

> 注意: ツールチェーンの版・API・ターゲット対応・Cloudflareの機能は変化する。Coding Agentは**現在の公式ドキュメント／実際のCLIで検証**してから設定ファイルやコードを作ること。特に `moon.work`、`moon.mod`、`moon.pkg`、Rabbita/Warren、Tailwind v4、Workersビルド接続、Vitest Plugin、WebAuthn PRFが要確認。

## 4. アーキテクチャ境界

```text
                         Browser
  ┌──────────────────────────────────────────┐
  │ MoonBit JS + Rabbita + Tailwind          │
  │ UI Model / Msg / Update / View           │
  │         ↓                                │
  │ Application adapters / JS FFI            │
  │   ├─ Automerge ↔ IndexedDB              │
  │   ├─ Web Crypto / key store              │
  │   ├─ WebAuthn                            │
  │   └─ HTTP sync client                    │
  │         ↓ E2EE encrypted changes         │
  └─────────┬────────────────────────────────┘
            │ HTTPS REST + encrypted payload
            ▼
  ┌──────────────────────────────────────────┐
  │ Cloudflare Workers (MoonBit JS + FFI)    │
  │ Session / ownership / sync authorization │
  │ Append-only encrypted change-log         │
  │ Keys envelopes and snapshot metadata     │
  │         ├─ D1: relational metadata       │
  │         └─ R2: encrypted snapshots       │
  └──────────────────────────────────────────┘

  Pure shared MoonBit modules:
    domain ── requirements
      │          │
      └──── contracts / sync protocol
  (no dependency from shared pure logic onto Web APIs)
```

- **Domain**は `Course` / `CourseOffering` / `Enrollment` / `Semester` / `AcademicProfile` を区別する。科目マスタとユーザーの履修状態を混同しない。
- 科目識別子は**安定・名前空間付き**とし、マスタ改訂・ユーザー独自科目・上書き属性を扱えるようにする。ユーザーの上書きは必要なら**sparse diff**として保持。
- 卒業要件評価は、`MinimumCredits` / `AllCourses` / `All` / `Any` / `AtLeast`等の型付き式を第一案とする。区分による単位の重複計上は安易に認めない。実際のルールの仕様が確定するまで、架空のフィクスチャで進める。
- UIの一時状態とAutomergeに永続化する状態を分ける。**集計・判定などの派生値はCRDTに保存しない**。
- `requirements`の判定結果はクライアント上で計算。Workersは成績の平文にアクセスしない。

## 5. Repository構成（案。過度な先行分割はしない）

```text
tanikun/
├── moon.work                     # 現行書式を検証
├── flake.nix
├── flake.lock
├── .envrc
├── justfile
├── package.json
├── pnpm-lock.yaml
├── apps/
│   ├── web/                      # MoonBit + Rabbita + Tailwind
│   │   ├── moon.mod
│   │   ├── app/                   # Model / Msg / Update / View
│   │   ├── pages/                 # timetable / requirements / settings
│   │   ├── adapters/              # MoonBitのFFI呼出し側
│   │   ├── bridges/               # TS/JS: automerge, crypto, idb, webauthn
│   │   └── styles/
│   └── api/                      # MoonBit Workers
│       ├── moon.mod
│       ├── routes/
│       ├── services/
│       ├── adapters/              # D1/R2/session/Worker API
│       └── bridges/
├── packages/
│   ├── domain/                   # Pure MoonBit
│   ├── requirements/             # Pure MoonBit
│   ├── contracts/                # API DTO / serialization
│   └── sync/                     # Protocol / cursor / envelope metadata
├── data/
│   ├── courses/                 # versioned master JSON
│   └── rulesets/                # versioned requirements JSON
├── tests/
│   ├── integration/
│   ├── crdt/
│   ├── security/
│   ├── differential/
│   └── e2e/
├── infra/
│   ├── opentofu/
│   └── migrations/
├── docs/
│   ├── INITIAL_DESIGN.md
│   ├── adr/
│   ├── threat-model/
│   └── experiments/
└── .github/workflows/
```

各MoonBitパッケージは現行ツールチェーンに従って `moon.pkg` 等を置く。`packages/solver`（SAT/SMT実験）など、**使わないモジュールは先に作らない**。

## 6. Local-first / HTTP同期の設計で詰めること

- ドキュメントは**ユーザーごとに原則1つ**、5学期のデータをまとめて持つ。最大で概ね150科目程度を想定。マスタはアプリ同梱のJSON、ユーザー差分だけCRDTへ。
- Automerge ChangeをHTTP経由で送受信。サーバーは暗号化されたChangeを保存するため**Changeの内容や依存関係を検証できない**ことに注意。
- D1にドキュメントごとの単調増加サーバーシーケンス（Cursor）を設け、**ページング、重複排除、再試行の冪等性、原子的な採番と保存**を保証する。Change IDやリクエストIDは暗号化レコードと独立した**公開メタデータ**として扱うか要検討。
- オフラインからの復帰、複数端末からの同時送信、順序の入れ替わり、ネットワーク切断、重複配信、途中ページ取得、競合更新を想定する。
- E2EE下でSnapshotを作るのは**クライアント**。SnapshotがカバーするChange範囲、サーバーCursorとの対応、Snapshot公開・ガベージコレクション・整合性を設計する。サーバーは暗号化Snapshotの正しさを自力で検証できない。
- **悪意ある／障害を起こしたサーバーによる巻き戻し、レコード欠落、Change改ざん、順序操作**の扱いを明文化する。AES-GCMだけでは履歴の完全性・鮮度まで保証できない。端末署名、ハッシュ連鎖、ローカル高水位などの案を比較する。
- Change本文、Snapshot本文、暗号鍵、科目名、成績などの平文はサーバーに置かない。暗号文サイズ・アクセス時刻・ID等の**メタデータ漏洩は別途評価**する。

## 7. 認証・E2EE・鍵管理の設計で詰めること

### 認証

- Passkey/WebAuthnでアカウント認証し、別途Cookie Sessionを発行する。推奨Cookie属性は `__Host-` prefix、`HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`、`Domain`なし。
- D1にはセッショントークンそのものではなくハッシュ等を保存。失効、ログアウト、複数Passkey、紛失後のアカウント復旧、CSRF/Origin検証、レート制限、Document ownership・BOLA防止を設計する。
- **認証できることと復号できることは別**。Passkey認証だけではDocument Keyを復元できない。

### 暗号化

- 各ユーザードキュメントにランダムな**Document Encryption Key (DEK)** を発行。クライアントのWeb Crypto APIでAES-256-GCM暗号化。
- 端末ごとの鍵（公開鍵暗号／ECDH等の方式は設計検証）を生成し、DEKを端末向けに安全にラップした**Key Envelope**を扱う。
- 既存端末で新端末の公開鍵を**人手で認証できる形**（QR、短い確認コード、双方操作等）で確認後、鍵転送する。サーバーが任意の公開鍵を差し替えて鍵を取得できる構成にしない。
- 鍵の永続化方法として非extractable `CryptoKey` + IndexedDBを第一候補とするが、ブラウザのオリジン・XSS・再インストール・ストレージ削除に関する限界を脅威モデルに記す。
- AES-GCMのnonceを鍵ごとに再利用しない。暗号文の再送では**同一暗号文を再利用**し、再暗号化時は新しいnonceを生成。AADに文書ID、暗号方式／鍵バージョン、レコード種別等の適切なメタデータを束縛する。
- 鍵ローテーション／端末失効の意味（以後の更新を読めなくするのか、過去データも再暗号化するのか）、バージョン管理を区別して設計する。

### 復旧・バックアップ

- **ユーザーにリカバリーキーの保管を強制しない**。
- メインの端末追加・復旧導線は、**復号可能な既存端末から新端末への承認付き鍵転送**。
- **WebAuthn PRF**は、対応端末・ブラウザ・同期Passkey・Credentialごとの出力／バックアップ後の再現性を**実機検証**。PRFは補助手段であり、普遍的な端末喪失時復旧を保証しない。PRF出力をサーバーに渡さない。
- **JSON/CSVエクスポート**（平文ファイルの取扱い注意）と**暗号化バックアップ**をユーザー操作で生成できるようにする。暗号化バックアップにパスフレーズを使うならArgon2id等のKDFを比較・設計する。
- **全端末を失い、利用可能なPRFやバックアップもない場合、暗号化データは復旧不能**。再入力・データリセット導線を用意し、UX上も明示する。
- **E2EEの保証範囲**を明確にする。Web配信された悪意あるJS・XSSは脅威になり、IndexedDB内のAutomergeデータを平文で置くならローカル保存はE2EE保護対象外。端末側の保存時暗号化を採用するかは別の判断として扱う。
- 暗号プリミティブは自作しない。脅威モデル、プロトコル、相互運用テスト、セキュリティレビューを先行する。

## 8. Nix・CI/CD方針

- `nix develop`（開発環境）、`nix build .#web` / `.#api` / `.#release`（成果物）、`nix flake check`（可能な範囲のビルド・静的チェック・単体テスト）を目標とする。
- **Nixはビルドまで責任を持つ**。`flake.lock`と`pnpm-lock.yaml`などを固定し、Nixサンドボックスから必要なネットワークダウンロードなしでMoonBit JSとTailwindの成果物を生成する。再現可能性とmacOS/Linuxでの対応範囲を明示する。
- CIは`ubuntu-latest`等Linux中心。PR: format/check/unit/property/integration/代表的なPlaywright E2E/build。main: リリース用検証・ビルド成果物の再利用とデプロイ。重いテストは手動・定期実行への切り分けも可。
- Nixバイナリキャッシュ（Cachixまたは同等）を比較。**高速化とRunner枠消費節約**を重視する。
- **OpenTofuはD1/R2等のリソース宣言、Wranglerはビルド済みWorker/静的成果物のデプロイ**。同一リソースを二重管理しない。D1 schema migrationは専用の運用経路を持つ。
- 本番認証情報はGitHub SecretsやOIDC連携等の実際の対応状況に応じて管理。秘密情報をNix store、ログ、PR artifactに埋め込まない。

## 9. TDD・テスト戦略

**Red → Green → Refactor**を基本とし、テストを各Phaseの最後にまとめて追加しない。

| 層                      | 主な対象                          | 重要な性質・シナリオ                                               |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------ |
| Unit / MoonBit          | Domain, requirements, update      | 状態遷移、単位計算、バリデーション、決定性                         |
| Property-based          | Requirement evaluator, model      | 入力順序の非依存性、非負性、ルールの不変条件（前提条件を明示）     |
| Integration / Vitest    | FFI, Workers, D1/R2               | API契約、DBトランザクション、失敗時の整合性                        |
| CRDT / Model-based      | Automerge replica, sync           | Convergence、重複再送、順序違い、通信断、再接続、cursorページング  |
| Security                | Sessions, authorization, E2EE     | 越権アクセス拒否、認証状態、改ざん拒否、鍵転送の相手認証、復号失敗 |
| E2E / Playwright        | Time-table, offline, multi-device | 登録/編集/5学期/集中講義、オフライン保存、2ブラウザ間同期、復旧UI  |
| Differential（発展）    | MoonBit target variants           | JS/Wasm/Nativeで同じルール結果になるか                             |
| Fault injection（発展） | Sync, crypto backup               | 途中失敗、再送、レコード欠落、snapshot不整合                       |

- Unit Testは実装モジュールの近くに置き、クロスコンポーネントテストは`tests/`に置く。
- Playwrightは**Chromiumを日常CIの主軸**、Firefox/WebKitやPasskey実機互換は別枠で検証する。
- 同期プロトコルと暗号は**安全性・生存性の不変条件を文章にしてから**実装する。
- E2Eはブラウザ外の暗号処理／API偽装に依存しすぎず、少なくとも一部は本物のWorker相当Runtimeを使う。
- `nix flake check`に含めやすい決定的テストと、ローカルサーバー・ブラウザが必要なテストを区別する。

## 10. 可観測性・プライバシー

- Cloudflare WorkersのLogs / Tracesを第一段階として使い、適宜OpenTelemetryでアプリ固有Span・Metricsを追加する。Grafana Cloudは第一候補だが、コスト・無料枠・保存期間は後で決める。
- 観測例: リクエスト遅延・エラー、D1/R2アクセス、同期成功率・リトライ・転送Change数、Automergeマージ時間、卒業要件計算時間、暗号化／復号処理時間、端末追加フローの失敗率。
- **成績・科目名・復号済みCRDT・Document Key・秘密鍵・PRF出力・Session TokenをTelemetryに記録しない**。ID・URL・暗号文サイズ等のメタデータも必要最小限に限定する。
- ブラウザ↔Workersの処理はトレースコンテキストで関連付ける設計を検討。ただし異なる端末間の非同期処理は単一のSpan木になるとは限らず、関連イベント／リンクで扱う。

## 11. 推奨実装順序と完了条件

**各PhaseでTDDを実施し、CIでLinuxビルドを守る。** 詳細はCoding Agentとの設計で変更可能だが、変更理由をADRに記録する。

### Phase 0 — 開発基盤・最小垂直スライス

- `moon.work`、MoonBit、Rabbita/Warren、Tailwind v4、Nix/direnv、pnpm、just、最小Playwright、GitHub Actions Linuxを統合。
- **Done**: macOSで開発でき、CI Linuxで `nix build .#web` と最小テストが通る。Warren/Tailwind/MoonBit依存のNixオフラインビルド成立を確認。

### Phase 1 — Pure Domainと卒業要件評価

- Course/Offering/Enrollment等と架空の卒業要件ルールを実装。単体・性質テストを先に書く。
- **Done**: 入力データから確定/見込単位、架空の卒業要件の充足状況を決定的に算出。

### Phase 2 — 時間割UI

- 5学期のグリッド、科目選択・編集、独自科目・上書き。まずインメモリ状態で動作。
- **Done**: 主要ユーザーフローをPlaywrightで通す。

### Phase 3 — Local-first

- Automerge / IndexedDB / Elm stateとの接続。
- **Done**: オフライン編集がリロード後も残る。複数Replicaで収束する。

### Phase 4 — Workers / HTTP差分同期

- API contract、D1変更ログ、sequence cursor、認可を見据えたリソース境界。ローカル限定の開発用認証で検証。
- **Done**: 2つのブラウザが変更を交換し収束。重複・通信断を含むテストが通る。
- **注意**: E2EE自体はPhase 6でも、暗号文を前提とした封筒・メタデータ設計を**この段階より前に**決定する。本番の平文ユーザーデータを扱わない。

### Phase 5 — Passkeys / Session / Authorization

- WebAuthn登録・ログイン、opaque Cookie Session、所有権・セッション失効。PRF検証のスパイク。
- **Done**: ログインと他ユーザードキュメントへの越権アクセス拒否をテスト。

### Phase 6 — E2EE / Device enrollment

- AES-GCM、DEK、Key Envelope、鍵管理、既存端末の承認付き鍵転送。PRFの補助利用は検証結果次第。
- **Done**: サーバーが平文を得ずに複数端末間同期が可能。失敗／改ざん／不正端末に関するテストが通る。

### Phase 7 — Backup / R2 Snapshot / Recovery UX

- JSON/CSV、任意暗号化バックアップ、Snapshot生成・検証、復元、鍵喪失・リセット導線。
- **Done**: バックアップから再現でき、Snapshot + 変更ログで復旧できる。

### Phase 8 — リリース品質・IaC・Observability

- OpenTofu、Wranglerデプロイフロー、Cloudflare Logs/Traces、OpenTelemetry→Grafana Cloud等、テスト拡充、実科目データ/適用要件。
- **Done**: 本番へのデプロイ再現性、主要エラーの観測、友人向け利用導線を確保。

> OpenTofuによるリソース作成や最小ログは、それぞれリソースや障害解析が必要になったPhaseで**前倒し導入**してよい。Phase 8まで先送りしない。

## 12. Coding Agentに依頼する作業

**今すぐ大量のコードを書く前に、設計の具体化と検証を進めたい。** 次の順序で支援すること。

1. **仕様・ライブラリの現在性を検証**: MoonBit Workspace/module/package、Rabbita/Warren、Cloudflare WorkersへのMoonBit JS接続、Tailwind v4連携、Automerge JS FFI、Nixでのオフラインビルド。調査結果には公式資料・実際に試したコマンド・バージョンを示す。
2. **不足する設計判断を抽出**し、「決定済み / 仮決定 / 要調査 / 意図的保留」を分ける。既決方針を独断で変更しない。
3. **ADR案**を提案する。とくにMonorepo依存規則、Domain schema、Rule AST、Automerge JSON schema、同期のIdempotency/Cursor/Compaction、E2EE Key Envelope/Enrollment/Threat Model、Auth/session/CSRF、Nix build graph、Test pyramid。
4. **Phase 0を具体化**: 実際に動く最小ディレクトリ、Nix Flake outputs、pnpm固定方法、`moon.work`設定、`just`コマンド、Actions workflowの案を示す。
5. **小さな縦切り実装計画**: 各変更をTDDで進めるテスト先行のIssue単位に分割し、Done条件を付ける。
6. コード変更に進む際は、小さな変更・テスト・ビルドで検証し、**macOS専用の環境をCI必須にしない**。

### Coding Agentへの追加ガードレール

- **ユーザーが重視する技術選定を尊重**。理由なしにHono・React・Next.js・Prisma・Durable Objects・Automerge Repo同期へ置換しない。
- 互換性や成熟度の問題がある場合は、検証結果と候補を提示して決定を仰ぐ。
- 卒業要件の具体的な学則・科目情報の入力を、Phase 0–2の前提にしない。架空データでよい。
- セキュリティを「あとから考える」ものにしない。特に同期プロトコルはE2EEに移行できる境界で設計する。
- 本番データの暗号化前保管、秘密情報のハードコード、暗号プリミティブの自作は禁止。
- 判断が必要な場合は**推奨案とトレードオフ**を先に提示し、単なる選択肢の羅列にしない。
- 過度な抽象化を避け、使うことが決まった技術から段階的に導入する。

## 13. 最初に詰めたい論点（優先順位）

1. **MoonBit + Rabbita + Warren + Tailwind v4 + NixがLinuxでビルドできるか**。失敗した場合の最小限の調整。
2. **MoonBit Workspaceの実際の構文・モジュール依存方法**、JS FFIでどのディレクトリ・成果物境界を切るべきか。
3. **AutomergeのローカルデータSchemaとMoonBitモデルの変換**。変更競合時のUI上の意味。
4. **E2EE付きHTTP同期の外形仕様**。公開メタデータ、Idempotency、Change依存、Snapshot、サーバーの悪意・障害をどう扱うか。
5. **Passkeyと端末鍵のライフサイクル**。端末追加の本人確認、PRFの限界、バックアップ復元。
6. **Nix flake outputsとCIテスト階層**。PR実行コストと信頼性の両立。
7. **可観測性の導入順序・漏洩しないTelemetry schema**。

---

**望む次の成果物**: まずは _「設計上の論点表 + 推奨ADR一覧 + Phase 0の実装可能なリポジトリ構成とTDDタスクリスト」_ を作ってほしい。その内容を確認してから骨格を実装する。
