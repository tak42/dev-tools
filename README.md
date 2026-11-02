# dev-tools

AI（GitHub Copilot など）と一緒に開発するための、共通の開発基盤ファイル置き場。
各プロジェクトにはインストーラでファイルを配布し、更新も同じインストーラで行う。

## 構成

```
dev-tools/
├── install.mjs                               対象リポジトリへの導入・更新
├── tools/
│   └── issues/issues.mjs                     issue 管理 CLI（配布先では scripts/issues.mjs）
└── templates/
    ├── copilot-instructions.issues.md        常時読み込まれる最小限のルール（数行）
    └── skills/
        ├── story-to-issues/                  ストーリー → issue 分解（人間が /story-to-issues で呼ぶ）
        │   ├── SKILL.md
        │   └── plan-example.json
        └── work-on-issue/                    issue を 1 件実装して close（将来のループ 1 回分）
            └── SKILL.md
```

必要なのは Node.js 18 以上だけです（追加パッケージは不要）。

### 何をどこに置くかの線引き

| 種類 | 置き場所 | 基準 |
|---|---|---|
| 常時ルール | `copilot-instructions.md` | 毎回必要で数行に収まるものだけ。常に読み込まれトークンを消費するため |
| 手順 | Skill | 複数ステップの作業。必要なときだけ読み込まれる。VS Code・Copilot CLI・GitHub.com のいずれでも使える |
| 入力の形 | テンプレート（Skill 内、または CLI が生成） | ストーリーや issue の必須項目を固定し、AI への入力のばらつきをなくす |
| 機械的な処理 | `issues.mjs` | 一覧・次タスク判定・状態変更・整合性チェック。AI のコンテキストを使わせない |

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
| `.github/skills/story-to-issues/` 等 | dev-tools の Skill を最新版に同期。プロジェクト独自の Skill には触れない |
| `issues/open/`, `closed/`, `stories/` | なければ作成 |
| `issues/INDEX.md` | 再生成 |
| `package.json` | あれば `"issue"` スクリプトを追加（`npm run issue next` で呼べる） |

## 使い方の流れ

```
① 人間: ストーリーを書く        node scripts/issues.mjs story "パスワード再設定" --wbs 1.2.3
                                 → issues/stories/S001.md（テンプレート付き）を埋める
② AI:   分解案を出す            Copilot Chat で /story-to-issues S001
                                 → issues/plans/S001.json を作り、表で確認を求めて止まる
③ 人間: 分解案をレビュー        粒度・依存・完了条件を直す。ここで直すのが一番安い
④ AI:   issue を一括作成        承認すると import が実行される
⑤ AI:   1 件ずつ実装            「次の issue をやって」→ Skill work-on-issue
⑥ 人間: INDEX.md で進捗を見る   ストーリーごとの進捗（例 2/3）も表示される
```

WBS のワークパッケージは「ストーリー（親）」、AI の作業単位は「issue（子）」として階層で持ちます。WBS 番号はストーリーの `wbs` に書けば INDEX に表示されます。

## issue 管理（tools/issues）

```
issues/
├── INDEX.md          自動生成。人間はこれだけ見る
├── stories/S001.md   ストーリー（親）
├── plans/S001.json   承認済みの分解案（記録として残る）
├── open/0002.md      ファイル名は ID のみ。状態は frontmatter で管理
└── closed/0001.md
```

```yaml
---
id: 0002
title: 再設定メール送信 API
status: open
priority: P1                 # P0〜P3
parent: S001                 # 親ストーリー
depends_on: [0001]           # すべて closed になると「着手可能」に移る
labels: [auth]
created: 2026-11-02
acceptance: npm test -- reset-api   # 1 つのコマンドで成否を判定できるもの
---
```

issue の本文には「コンテキスト（これ以外は原則読まない）」節があり、AI が読むべきファイルを最大 5 件まで指定します。AI がコードを探し回るのを防ぎ、トークン消費を抑えるためです。

| やりたいこと | コマンド（対象リポジトリで実行） |
|---|---|
| ストーリー作成 | `node scripts/issues.mjs story "タイトル" --wbs 1.2.3` |
| 分解案から一括作成 | `node scripts/issues.mjs import issues/plans/S001.json --dry-run` → `--dry-run` なしで実行 |
| 1 件追加 | `node scripts/issues.mjs new "タイトル" --priority P1 --depends 0002 --parent S001 --context src/a.ts` |
| 次にやる issue | `node scripts/issues.mjs next` |
| 完了 | `node scripts/issues.mjs close 2` |
| 一覧を再生成 | `node scripts/issues.mjs index` |
| 整合性チェック | `node scripts/issues.mjs check`（不整合があれば終了コード 1） |
| 旧形式から移行 | `node scripts/issues.mjs migrate --dry-run` → `migrate` |

`import` は、完了条件の欠落、存在しない依存、依存の循環、5 件を超えるコンテキストをエラーにします。

### 旧形式から移行した後に一度だけ行うこと

`depends_on` と `acceptance` は自動では埋まりません。Copilot Chat（Agent モード）に次のように依頼します。

> issues/INDEX.md と issues/open/ の各ファイルを読み、本文から判断できる範囲で
> frontmatter の depends_on・priority・acceptance を埋めてください。
> 判断できないものは空のままにし、最後に node scripts/issues.mjs index と check を実行してください。

## 方針

- AI が機械的にこなせる処理（一覧作り、次タスクの判定、状態変更）はスクリプトに寄せ、AI のコンテキストを消費させない。
- 常時読み込むルールは最小限にし、手順は必要なときだけ読み込まれる Skill に置く。
- 人間は生成されたビュー（INDEX.md）を見て、元ファイルを直接整理しない。
- 人間は「何を作るか（ストーリーと受け入れ条件）」と「分解案のレビュー」に集中し、実装と状態管理は AI とスクリプトに任せる。
- 将来のループ開発（1 タスクずつ自動実装）に備え、「次にやること」と「完了条件」を機械可読にしておく。
