---
name: story-to-issues
description: issues/stories/ のユーザーストーリーを、AI が 1 セッションで実装・検証できる issue に分解する。ユーザーがストーリー ID（例 S001）を指定して分解を求めたときに使う。
disable-model-invocation: true
---

# ストーリーを issue に分解する

ユーザーが指定したストーリー（`issues/stories/<ID>.md`）を読み、分解案を作り、**ユーザーの承認を得てから** issue を作成する。この Skill ではコードを書かない。

## 手順

1. **ストーリーを読む**
   `issues/stories/<ID>.md` を読む。次のどれかが空なら、分解せずにユーザーへ不足を伝えて止まる。
   - ストーリー
   - 受け入れ条件（Given/When/Then が 1 行以上）

2. **必要な範囲だけ調べる**
   読むのは「参照」節に書かれた箇所と、そこから直接たどれるファイルだけにする。リポジトリ全体を探索しない。
   既存 issue との重複は `issues/INDEX.md` だけで確認する。

3. **分解案を書く**
   `issues/plans/<ID>.json` に、[plan-example.json](plan-example.json) と同じ形式で書く。粒度の基準:
   - 1 issue = 1 回の作業セッションで実装と検証が終わる大きさ
   - `context`（読むべきファイル・仕様の箇所）は最大 5 件。超えるなら分割する
   - `acceptance` は 1 つのコマンドで成否を判定できるものにする（テスト名を指定するなど）。判定できなければ、先にテストを書く issue を作る
   - 1 つの振る舞いを縦に通す切り方を優先し、レイヤーだけで横に切らない
   - 不明点が大きいものは調査 issue にする（`acceptance` は「メモ節に結論を記載」でもよい）
   - 受け入れ条件はどれかの issue で必ず満たされるようにし、「対象外」の内容は含めない
   - 既存 issue への依存は `"depends_on": ["0012"]` のように ID で書く

4. **ユーザーに確認する（ここで必ず止まる）**
   次の表と、気になった点（仕様の曖昧さ、分割に迷った箇所）を示し、承認か修正指示を待つ。

   | key | タイトル | 優先度 | 依存 | 完了条件 |
   |---|---|---|---|---|

5. **承認されたら作成する**
   ```
   node scripts/issues.mjs import issues/plans/<ID>.json --dry-run
   node scripts/issues.mjs import issues/plans/<ID>.json
   node scripts/issues.mjs check
   ```
   エラーが出たら JSON を直して再実行する。作成された issue の ID 範囲をユーザーに伝えて終わる。
