## Issue 管理ルール

このリポジトリの作業単位は `issues/` 配下の Markdown ファイルで管理する。

### 読み方（トークン節約のため厳守）

- まず `issues/INDEX.md` だけを読む。全 issue を一覧するために `issues/open/` や `issues/closed/` を走査しない。
- 作業対象の issue ファイルだけを開く。
- `issues/closed/` は、ユーザーが求めた場合か、依存 issue の経緯を確認する必要がある場合にだけ読む。
- 次にやるべき issue は `node scripts/issues.mjs next` で取得する（先頭行が最優先）。

### 書き方

- issue の作成: `node scripts/issues.mjs new "タイトル" --priority P1 --depends 0003`
- issue の完了: 完了条件をすべて満たしたことを確認してから `node scripts/issues.mjs close <id>`
- ファイルの手動移動・リネームや、`INDEX.md` の手動編集はしない（スクリプトが再生成する）。
- frontmatter を手で編集したら `node scripts/issues.mjs index` を実行する。
- frontmatter のキー: `id, title, status, priority(P0〜P3), depends_on, labels, created, closed, acceptance`
- 1 つの issue は 1 回の作業セッションで終わる粒度にする。大きければ子 issue に分割し、`depends_on` でつなぐ。
- 作業中に得た知見や未解決事項は、その issue の「メモ」節に追記する。
- `scripts/issues.mjs` は dev-tools から配布されたファイルなので編集しない。

### 完了の定義

- issue の「完了条件」をすべて満たしている。
- テスト・lint が通る（コマンドはプロジェクトの README / package.json を参照）。
- 満たせない場合は close せず、メモ節に理由と残作業を書く。
