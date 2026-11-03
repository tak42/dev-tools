<!-- dev-tools が生成したファイルです。手で編集しても、次回の install.mjs 実行で上書きされます。 -->
# 開発基盤（dev-tools）の使い方

このリポジトリには [tak42/dev-tools](https://github.com/tak42/dev-tools) の開発基盤が導入されています。
issue をリポジトリ内のファイルで管理し、GitHub Copilot と一緒に 1 件ずつ実装していくための仕組みです。

- 導入バージョン: `{{VERSION}}`
- 必要なもの: Node.js 18 以上（追加パッケージは不要）

## 基本の流れ

| # | 誰が | やること | 方法 |
|---|---|---|---|
| 1 | 人間 | ストーリーを書く | `node scripts/issues.mjs story "タイトル" --wbs 1.2.3` で作られたファイルを埋める |
| 2 | AI | issue への分解案を出す | Copilot Chat で `/story-to-issues S001` |
| 3 | 人間 | 分解案をレビューして承認する | 粒度・依存・完了条件を確認。ここで直すのが一番安い |
| 4 | AI | issue を一括作成する | 承認すると自動で実行される |
| 5 | AI | issue を 1 件ずつ実装する | Copilot Chat で「次の issue をやって」 |
| 6 | 人間 | 進捗を見る | `issues/INDEX.md` を開く |

人間が見るのは **`issues/INDEX.md` だけ**で足ります。issue ファイルを手で並べ替えたり移動したりする必要はありません。

## ストーリーの書き方

`issues/stories/S001.md` のテンプレートにある、次の 4 項目を埋めます。

| 項目 | 書くこと | 例 |
|---|---|---|
| ストーリー | 誰が、何のために、何をしたいか | 会員として、パスワードを忘れても自分で復旧するために、メールで再設定したい |
| 受け入れ条件 | Given / When / Then を 1 行ずつ | Given 登録済みメール When 再設定を申請 Then 30 分有効なリンクが届く |
| 参照 | 設計書・既存コードの**場所**（中身はコピーしない） | `docs/spec/auth.md` の 3.2 |
| 対象外 | 今回やらないこと | SMS での再設定 |

受け入れ条件とストーリーが空のままだと、AI は分解を始めずに止まります。

## コマンド一覧

すべてリポジトリのルートで実行します。`package.json` がある場合は `npm run issue <コマンド>` でも呼べます。

| やりたいこと | コマンド |
|---|---|
| ストーリーを作る | `node scripts/issues.mjs story "タイトル" [--wbs 1.2.3]` |
| 分解案から issue を一括作成 | `node scripts/issues.mjs import issues/plans/S001.json [--dry-run]` |
| issue を 1 件追加 | `node scripts/issues.mjs new "タイトル" [--priority P1] [--depends 0002] [--parent S001] [--context src/a.ts]` |
| 次にやる issue を表示 | `node scripts/issues.mjs next` |
| issue を完了にする | `node scripts/issues.mjs close <ID>` |
| 一覧（INDEX.md）を再生成 | `node scripts/issues.mjs index` |
| 整合性をチェック | `node scripts/issues.mjs check` |
| 旧形式（`0001-open.md` など）から移行 | `node scripts/issues.mjs migrate [--dry-run]` |

frontmatter を手で書き換えたときは、`index` を実行して INDEX.md を更新してください。

## Copilot Chat での使い方

| 依頼 | 動き |
|---|---|
| `/story-to-issues S001` | ストーリーを読み、分解案を表で示して承認を待つ。承認後に issue を作成する |
| 「次の issue をやって」 | `next` の先頭の issue を 1 件だけ実装し、完了条件のコマンドで確認して close する |
| 「issue 0012 をやって」 | 指定した issue を 1 件だけ実装する |

完了条件を満たせなかった場合、AI は close せずに issue の「メモ」節へ理由と残作業を書いて止まります。

## ファイル構成

```
DEV-TOOLS.md                      このファイル（dev-tools が生成）
scripts/issues.mjs                issue 管理コマンド（dev-tools が配布）
.github/
├── copilot-instructions.md       dev-tools のルールはマーカーで囲まれた部分だけ
└── skills/
    ├── story-to-issues/          ストーリー分解の手順（dev-tools が配布）
    └── work-on-issue/            issue 実装の手順（dev-tools が配布）
issues/
├── INDEX.md                      一覧（自動生成。手で編集しない）
├── stories/S001.md               ストーリー（人間が書く）
├── plans/S001.json               承認済みの分解案（記録として残る）
├── open/0002.md                  未完了の issue
└── closed/0001.md                完了した issue
```

### issue ファイルの形式

```yaml
---
id: 0002
title: 再設定メール送信 API
status: open                      # open / closed（ディレクトリと一致させる）
priority: P1                      # P0（最優先）〜 P3
parent: S001                      # 親ストーリー
depends_on: [0001]                # すべて closed になると「着手可能」になる
labels: [auth]
created: 2026-11-02
acceptance: npm test -- reset-api # 1 つのコマンドで成否を判定できるもの
---
```

本文の「コンテキスト（これ以外は原則読まない）」節には、AI が読むべきファイルを最大 5 件まで書きます。AI がコードを探し回るのを防ぎ、トークン消費を抑えるためです。

## 編集してよいファイル・いけないファイル

| ファイル | 扱い |
|---|---|
| `DEV-TOOLS.md`、`scripts/issues.mjs`、`.github/skills/` 内の dev-tools 由来の Skill | 編集しない。次回の更新で上書きされる。変更したいときは dev-tools 側を直す |
| `.github/copilot-instructions.md` の `<!-- dev-tools:issues:start/end -->` の間 | 編集しない。マーカーの外側は自由に書いてよい |
| `issues/INDEX.md` | 編集しない。コマンドで再生成される |
| `issues/stories/`、`issues/open/`、`issues/closed/` の中身 | 編集してよい。移動・リネームはコマンドで行う |
| `.github/skills/` 内のプロジェクト独自の Skill | 自由に追加・編集してよい。dev-tools は触れない |

## 更新方法

dev-tools の新しい版を取り込むときは、dev-tools 側で次を実行します。

```bash
cd <dev-tools のパス>
git pull
node install.mjs <このリポジトリのパス> --dry-run   # 何が変わるか確認
node install.mjs <このリポジトリのパス>
```

何度実行しても結果は同じです。プロジェクト独自の記述や issue の中身は変更されません。

## 困ったとき

| 症状 | 対処 |
|---|---|
| INDEX.md が古い | `node scripts/issues.mjs index` |
| `next` で何も出ない | すべての open issue が依存待ち。INDEX.md の「ブロック中」で依存先を確認する |
| `check` がエラーになる | メッセージに出たファイルの frontmatter を直す（ID の重複、status とディレクトリの不一致など） |
| `import` がエラーになる | 分解案の JSON を直す（完了条件の欠落、依存の循環、コンテキストが 5 件超など） |
| Copilot Chat の `/` メニューに Skill が出ない | VS Code と Copilot 拡張を更新し、`.github/skills/` が存在するか確認する |
