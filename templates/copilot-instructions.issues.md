## Issue 管理

- 作業単位は `issues/` で管理する。全体の把握は `issues/INDEX.md` だけを読み、`issues/open/`・`issues/closed/` を一覧のために走査しない。
- issue の実装は Skill `work-on-issue`、ストーリーの分解は Skill `story-to-issues` の手順に従う。
- issue の作成・完了・一覧更新は必ず `node scripts/issues.mjs` を使い、ファイルの手動移動や `INDEX.md` の手動編集はしない。
- `scripts/issues.mjs` と `.github/skills/` 内の dev-tools 由来の Skill は配布物なので編集しない。
