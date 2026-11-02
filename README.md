# dev-tools

AI（GitHub Copilot など）と一緒に開発するための、共通の開発基盤ファイル置き場。
各プロジェクトにはインストーラでファイルを配布し、更新も同じインストーラで行う。

## 構成

```
dev-tools/
├── install.mjs                          対象リポジトリへの導入・更新
├── tools/
│   └── issues/issues.mjs                issue 管理 CLI（配布先では scripts/issues.mjs）
└── templates/
    └── copilot-instructions.issues.md   Copilot 向け issue 運用ルール
```

必要なのは Node.js 18 以上だけです（追加パッケージは不要）。

## プロジェクトへの導入・更新

```bash
git clone https://github.com/tak42/dev-tools.git
node dev-tools/install.mjs ../my-project --dry-run   # 何が変わるか確認
node dev-tools/install.mjs ../my-project             # 実行
```

更新するときは、dev-tools を `git pull` してから同じコマンドを再実行します。何度実行しても結果は同じです。

| 対象リポジトリのファイル | インストーラの動作 |
|---|---|
| `scripts/issues.mjs` | 最新版で上書き（配布物なので直接編集しない） |
| `.github/copilot-instructions.md` | `<!-- dev-tools:issues:start/end -->` の間だけを差し替え。それ以外の記述はそのまま残す |
| `issues/open/`, `issues/closed/` | なければ作成 |
| `issues/INDEX.md` | 再生成 |
| `package.json` | あれば `"issue"` スクリプトを追加（`npm run issue next` で呼べる） |

## issue 管理（tools/issues）

```
issues/
├── INDEX.md        自動生成。人間はこれだけ見る
├── open/0002.md    ファイル名は ID のみ。状態は frontmatter で管理
└── closed/0001.md
```

```yaml
---
id: 0002
title: パスワードリセット機能
status: open
priority: P1          # P0〜P3
depends_on: [0001]    # すべて closed になると「着手可能」に移る
labels: [auth]
created: 2026-11-02
acceptance: "npm test が通り、/reset で 200 が返る"
---
```

| やりたいこと | コマンド（対象リポジトリで実行） |
|---|---|
| 旧形式（`0001-closed.md` など）から移行 | `node scripts/issues.mjs migrate --dry-run` → `migrate` |
| 一覧を再生成 | `node scripts/issues.mjs index` |
| 次にやる issue | `node scripts/issues.mjs next` |
| 追加 | `node scripts/issues.mjs new "タイトル" --priority P1 --depends 0002 --labels auth` |
| 完了 | `node scripts/issues.mjs close 2` |
| 整合性チェック | `node scripts/issues.mjs check`（不整合があれば終了コード 1） |

### 移行後に一度だけ行うこと

`depends_on` と `acceptance` は自動では埋まりません。Copilot Chat（Agent モード）に次のように依頼します。

> issues/INDEX.md と issues/open/ の各ファイルを読み、本文から判断できる範囲で
> frontmatter の depends_on・priority・acceptance を埋めてください。
> 判断できないものは空のままにし、最後に node scripts/issues.mjs index と check を実行してください。

以降は Copilot 向けルールにより、Copilot は INDEX.md と対象の issue だけを読むため、読み込むトークン量が抑えられます。

## 方針

- AI が機械的にこなせる処理（一覧作り、次タスクの判定、状態変更）はスクリプトに寄せ、AI のコンテキストを消費させない。
- 人間は生成されたビュー（INDEX.md）を見て、元ファイルを直接整理しない。
- 将来のループ開発（1 タスクずつ自動実装）に備え、「次にやること」と「完了条件」を機械可読にしておく。
