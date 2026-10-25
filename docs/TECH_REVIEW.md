# 技術選定レビュー（Phase 0 前精査）

> **この文書の位置づけ**: Phase 0 前の技術レビューです。`docs/INITIAL_DESIGN.md` §12「仕様・ライブラリの現在性を検証」への回答として、2026-10-17 時点の事実と未確認項目をまとめています。現在の構成は [Phase 0](PHASE_0.md) と [Phase 1](PHASE_1.md) を参照してください。
>
> **方法と限界**: Web 検索が使えなかったため、公式ドキュメント・公式リポジトリを直接参照した。**実際の CLI 実行や手元でのビルドは未実施**。したがって「公式資料で確認済み」と「実機で要検証」を明確に区別する。実機検証は Phase 0 のスパイクで行う。

## 1. 結論サマリ

| 領域                   | 判定                     | 要点                                                                                                                                                       |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MoonBit ツールチェーン | **維持・微修正**         | `moon.work` / `moon.mod` / `moon.pkg` は **JSON 廃止で DSL**。`preferred_target` / `supported_targets` が現行。beta-preview。                              |
| Rabbita                | 維持                     | `moonbit-community/rabbita`。Elm/Bonsai 風。TEA。約15KB min+gzip。                                                                                         |
| Warren                 | **位置づけ修正**         | Rabbita 同梱のビルド/開発サーバーツール。`moon install moonbit-community/warren`。`cmd/browser`(js)/`cmd/server`(wasm,native) 規約。                       |
| MoonBit JS FFI         | 維持                     | JS 向け FFI は `extern "js"` / `"Module" "fn"` / `#external`。ABI 表を確認。Automerge/WebCrypto/IDB/WebAuthn は薄い FFI で包める。                         |
| Cloudflare Workers     | **要検証（最大リスク）** | Workers は `export default { fetch }` の ES モジュール。MoonBit JS 出力はそのままでは default エクスポートしないため**薄い JS エントリで包む**必要が高い。 |
| Static Assets          | 維持                     | `assets.directory` / `run_worker_first` / `binding: "ASSETS"`。                                                                                            |
| テスト                 | **名称変更**             | `@cloudflare/vitest-plugin`（`@cloudflare/vitest-pool-workers` は旧）。Miniflare でローカル実行。                                                          |
| Automerge              | 微修正                   | `@automerge/automerge` は 3 系。Repo を使わず core の changes API で独自 HTTP 同期する方針は維持可能。                                                     |
| Tailwind CSS v4        | **要検証**               | v4.3。Vite プラグイン＋CSS ファースト。クラス検出は自動だが **`.mbt` を拾うかは要検証**（`@source` 指定が必要かも）。                                      |
| Nix                    | **要検証**               | MoonBit の公式 Nix パッケージは未確認。公式 tarball（`cli.moonbitlang.com`、`.sha256` あり）を固定して derivation を自作するのが現実的。                   |
| Auth / E2EE            | 維持                     | いずれもブラウザ API。PRF は**実機検証が必須**（ページ確認できず）。                                                                                       |

### `INITIAL_DESIGN.md` への修正提案（確定分）

- §3 表内 `moon.work`/`moon.mod`/`moon.pkg` は **JSON ではなく DSL**。
- 「Vitest / Workers Vitest Plugin 等」→ **`@cloudflare/vitest-plugin`**（旧 pool-workers は非推奨）。
- Warren は「Rabbita と独立したツール」ではなく **Rabbita リポジトリ同梱のスキャフォールド/ビルド**。
- MoonBit は **beta-preview** であることを明記（後方互換は「真剣に評価」だが破壊的変更はありうる）。

## 2. MoonBit ツールチェーン

- 現状: **beta-preview**。ターゲットは `wasm` / `wasm-gc` / `js` / `native`（`llvm` は実験的）。公式 docs。
- インストール: `curl -fsSL https://cli.moonbitlang.com/install/unix.sh | bash`。バイナリは `https://cli.moonbitlang.com/binaries/latest/moonbit-<os>-<arch>.tar.gz` と `.sha256` が配布される（**Nix はこれを使う**）。
- コマンド: `build` / `check` / `run` / `clean` / `new` / `bench` / `fmt` / `version` / `test` / `login` / `register` / `publish` / `add` / `remove` / `tree` / `update` / `doc` / `install`。
- **ワークスペース (`moon.work`)**: `members = [ "./mod_a", "./mod_b" ]`。`moon work init` / `moon work use` / `moon work sync`。ルートで `moon check --target all` 等を実行。→ `INITIAL_DESIGN.md` の「moon.work の構文を検証」は**解決**。
- **モジュール (`moon.mod`)**: 現行は DSL。主要フィールド: `name`（必須）、`version`、`import { "user/pkg@0.1.0" }`、`preferred_target = "js"`、`supported_targets = "+js+wasm-gc"`、`source`、`warnings`、`rule(...)`、`scripts`。**`moon.mod.json` は通常コマンドで受理されない**（`moon fmt` で移行）。
- **パッケージ (`moon.pkg`)**: `import { "path" @alias }`、`pkgtype(kind: "executable" | "library" | "foreign_library")`、`targets`（js/wasm/wasm-gc/debug/release の条件付きコンパイル）、`supported_targets`、`warnings`、`virtual`、`rule`/`dev_build`。JS 出力は `link: { "js": { "exports": [...], "format": "esm" } }`。
- ローカル依存は `moon.mod` の path 依存ではなく **`moon.work` 経由**が推奨。

影響: `packages/domain` / `requirements` / `contracts` / `sync` をワークスペースの members にして、`preferred_target` を各モジュールで指定する形が素直。`moon.work` は `members` のみ。

## 3. Rabbita と Warren

- **Rabbita** (`github.com/moonbit-community/rabbita`): Elm/Bonsai 風の宣言的 UI。旧名 Rabbit-TEA。`Msg` による更新、`@rabbita.create_pure_state`、`Val[Html]`。約15KB min+gzip（DCE 込み）。`server`（Moonback による SSR）と `vite-plugin`、`rui` も同梱。
- **Warren**: `moon install moonbit-community/warren`。ブラウザ専用またはフルスタックの MoonBit アプリを開発・ビルドする。規約:
  - エントリは**パッケージディレクトリ**。`cmd/browser`（既定、常に `js`）、`cmd/server`（任意、既定 `wasm`、`--server-target native` 可）。
  - `warren dev` / `warren build`。`public/`、`dist/`、`index.js`、`index.html` を生成。ブラウザ専用時は内蔵 dev サーバ（既定 `127.0.0.1:4300`）＋ライブリロード。
  - `--bundle` で **ネイティブ単一実行ファイル**に静的資産を埋め込む（配布形態の選択肢）。
  - `--build-only` は JSON 結果を出力（**Nix から成果物パスを拾うのに使える**）。
- Rabbita リポジトリの `moon.work` 実例（members の書き方）を確認済み。

影響: §5 の「`apps/web` に `app/ pages/ adapters/ bridges/ styles/`」は Warren の `cmd/browser` 規約と整合させる必要がある（エントリは `cmd/browser`）。Tailwind を Warren 経由でどう回すかは **要検証**（Rabbita の `vite-plugin` を使う手もある）。

## 4. MoonBit JS FFI

- 外部型: `#external type T`（JS では `any`）。
- 外部関数（JS）: `fn cos(d : Double) -> Double = "Math" "cos"` または `extern "js" fn ... = #|(d) => Math.cos(d)`。
- **JS ABI**（重要）: `Bool`→`boolean`、`Int32/UInt32/Float/Double`→`number`、`String`→`string`、`Bytes`/`FixedArray[Byte]`→`Uint8Array`、`FixedArray[T]`→`T[]`、`FuncRef[T]`→`Function`、定数 `enum`→`number`。`Array[T]` は FFI では非推奨（`FixedArray[T]` を使う）。
- エクスポート: `#export_name("name")`（`foreign_library` パッケージ）または `link.js.exports`。`format` は `esm`/`cjs`/`iife`。

影響: Automerge（`Uint8Array` の changes）、Web Crypto（`ArrayBuffer`）、IndexedDB（`#external` ハンドル）、WebAuthn はいずれも **薄い FFI ラッパで包める**。バイナリは `Bytes`⇄`Uint8Array` で素直に渡せる。

## 5. Cloudflare Workers / D1 / R2 / Static Assets

- Worker エントリは ES モジュールで `export default { async fetch(request, env) {...} }`。
- **Static Assets**: wrangler 設定の `assets.directory`、`not_found_handling`、`binding: "ASSETS"`、`run_worker_first`（例 `["/api/*"]`）。同一 Origin 配信は §3 の方針どおり可能。
- `compatibility_date` 必須。D1 は SQLite、R2 はオブジェクトストア。
- **最大リスク**: MoonBit の JS 出力は**名前付きエクスポートの ES モジュール**であり、Workers が要求する `export default { fetch }` を直接は出さない可能性が高い。→ **手書きの `index.js`（または `.mjs`）シム**で MoonBit 出力を import して `export default { fetch }` を組み立てる方式を推奨。ここは Phase 0 で必ず検証する。

## 6. テスト

- **MoonBit**: `moon test`（`--target` 指定可）。`packages/domain` などのユニット・性質テストの中心。`packages` 単位で `max-concurrent-tests` も設定可能。
- **Workers**: **`@cloudflare/vitest-plugin`**（`@cloudflare/vitest-pool-workers` から改名・移行。2026-08-20 更新）。Miniflare で D1 などのバインディング込みに**完全ローカル**実行。
- **E2E**: Playwright。Chromium 主軸。
- `nix flake check` に載せられる決定的テスト（domain/requirements）と、ブラウザ・ローカルサーバが必要なテストを分離する。

## 7. Automerge

- `@automerge/automerge` は **3 系**（2→3 の移行ガイドあり）。
- データ型: maps / lists / text / counters / timestamps / bytes / scalars。JS では proxy で object/Array として見える。`ImmutableString`、`Counter`、`Date` など。
- 参照実装: `@automerge/automerge-repo` に `IndexedDBStorageAdapter`（`@automerge/automerge-repo-storage-indexeddb`）や `BroadcastChannelNetworkAdapter` がある。
- **方針との整合**: §6 は「Automerge Repo 同期を使わず、changes + サーバ cursor の独自 HTTP 差分同期」としている。これは core の `save`/`load`/`getChanges`/`applyChanges`（changes 取得・適用）＋ IndexedDB 保存で実現できる。Repo を使うなら**ストレージアダプタだけ流用**する選択肢もある。どちらにするかは Phase 3 の設計で確定。
- 留意: change ハッシュはクライアントから見える公開メタデータ。§6 の「Change ID を公開メタデータとして扱うか要検討」は **change ハッシュを公開メタデータにする**のが素直。

## 8. Tailwind CSS v4

- 現行 **v4.3**。Vite なら `@tailwindcss/vite` を `plugins` に追加し、CSS に `@import "tailwindcss";`。設定は CSS ファースト（`@theme` 等）。
- クラス検出は**自動**（"detecting classes in source files"）。ただし `.gitignore` を尊重し、既定で走査する拡張子に `.mbt` が含まれるかは**要検証**。→ `@source "**/*.mbt"` などの明示指定が必要か、Phase 0 で確認。

## 9. Nix / ビルド

- MoonBit の**公式 Nix パッケージは未確認**。現実的なのは:
  - 公式 tarball（`cli.moonbitlang.com/binaries/latest/moonbit-<os>-<arch>.tar.gz`。`.sha256` あり）を `fetchurl` 相当で固定し、`buildInputs` に置く derivation を自作。
  - あるいは `install/unix.sh` が何をするかを読んで再現する。
- JS 側は `nodejs` + `pnpm`。オフラインビルドは `pnpm fetch`/`pnpm install --offline` と固定した `pnpm-lock.yaml` で成立させ、`node_modules` を Nix サンドボックスへ持ち込む（`pnpmDeps` 相当の固定）。
- 成果物: `nix build .#web` / `.#api` / `.#release` は Warren / wrangler の出力を包む。Warren の `--build-only` JSON からパスを取るのが確実。
- **要検証**: MoonBit ツールチェーンが初回にネットワーク（mooncakes.io の依存取得）を要求しないか。依存を `moon.work` + vendored `~/.moon` でオフライン化できるか。

## 10. Auth / E2EE

- Passkeys/WebAuthn はブラウザ API なので MoonBit からは FFI 呼び出し。暗号は Web Crypto。
- **PRF** は公式ページ（passkeys.dev）が 404 のため**未確認**。W3C WebAuthn L3 / FIDO `hmac-secret` を一次情報として、**対応端末・ブラウザ・同期 Passkey・バックアップ後の再現性を実機検証**する（§7 の方針どおり補助手段に留める）。
- 認証セッションの Cookie 属性（`__Host-`、`HttpOnly`、`Secure`、`SameSite=Lax`）は §7 のまま維持。

## 11. 可観測性

- Cloudflare Workers Observability + OpenTelemetry。§10 の「秘密情報・平文を Telemetry に載せない」を維持。ここは Phase 8 まで先送り可。

## 12. Phase 0 でやるべき検証スパイク（優先順）

| #   | スパイク                         | 検証すること                                                                                                                                     | 失敗時の代替                    |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| S1  | MoonBit(js) → Workers            | `#export_name`/`link.js.exports` の出力を薄い JS シムで `export default { fetch }` にして `wrangler dev` で動くか。Node API に依存していないか。 | シムを厚くする / wasm-gc を検討 |
| S2  | Rabbita + Warren 最小            | `warren new` → `warren dev --browser-entry main` → `warren build` が動くか。生成物のパス。                                                       | Vite 直叩き                     |
| S3  | Tailwind v4 × `.mbt`             | `.mbt` 内のクラスが抽出されるか。`@source` が要るか。                                                                                            | `@source` 明示 / CLI で個別生成 |
| S4  | Nix × MoonBit                    | tarball 固定でオフラインビルドが成立するか。mooncakes 取得が要るか。                                                                             | 依存を vendoring                |
| S5  | Automerge core + IndexedDB       | MoonBit FFI 経由で `save`/`load`/`getChanges`/`applyChanges` が `Uint8Array` で往復するか。                                                      | JS 側にロジックを寄せる         |
| S6  | `@cloudflare/vitest-plugin` + D1 | D1 バインディング込みのテストが完全ローカルで動くか。                                                                                            | pool-workers 据え置き（短期的） |

## 13. `INITIAL_DESIGN.md` への具体的修正（提案）

1. §3: `moon.mod`/`moon.pkg` は DSL。`preferred_target`/`supported_targets` を採用。MoonBit は beta-preview。
2. §3: Vitest は `@cloudflare/vitest-plugin`。
3. §3/§5: Warren は Rabbita 同梱。エントリ規約は `cmd/browser` / `cmd/server`。
4. §4: Workers エントリは MoonBit JS 直接ではなく**薄い JS シム経由**を前提にする（ADR 候補）。
5. §6: Automerge は 3 系。change ハッシュを公開メタデータに。
6. §8: Nix は MoonBit 公式 tarball を固定する自作 derivation 前提。初回ネットワーク要件を封印する。

## 14. 未確認（実機で確認が必要）

- MoonBit の正確なバージョン（FFI ドキュメントは v0.10.4 に言及）。
- Workers への MoonBit 出力の載せ方（S1）。
- Tailwind の `.mbt` 走査（S3）。
- Nix での MoonBit オフライン化（S4）。
- WebAuthn PRF の実機挙動（S6 とは別、Phase 5）。
- `moon test` の JS ターゲットでの挙動と、性質テスト用ライブラリ（fast-check 相当）の有無。

---

## 出典（2026-10-17 参照）

- MoonBit docs: `https://docs.moonbitlang.com/en/latest/`（language/ffi, toolchain/moon/{workspace,module,package,commands}）
- MoonBit download: `https://www.moonbitlang.com/download/`
- Rabbita: `https://github.com/moonbit-community/rabbita`（README, `moon.work`, `warren/README.md`）
- Cloudflare Workers: `https://developers.cloudflare.com/workers/static-assets/`, `.../workers/testing/vitest-integration/`
- Automerge: `https://automerge.org/docs/reference/documents/`, `https://automerge.org/docs/tutorial/local-sync/`
- Tailwind CSS: `https://tailwindcss.com/docs/installation/using-vite`
