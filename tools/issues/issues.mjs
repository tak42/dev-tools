#!/usr/bin/env node
// issues.mjs — リポジトリ内 issue 管理の小さな CLI（依存パッケージなし / Node 18+）
// source: https://github.com/tak42/dev-tools （このファイルは install.mjs で配布。直接編集せず dev-tools 側を更新する）
//
//   node scripts/issues.mjs story "タイトル" [--wbs 1.2.3]   ストーリーを issues/stories/ に作成（テンプレート付き）
//   node scripts/issues.mjs import <plan.json> [--dry-run]    分解案 (JSON) から issue を一括作成
//   node scripts/issues.mjs new "タイトル" [--priority P1] [--depends 0001,0003] [--parent S001] [--labels a,b] [--context a.ts,b.md]
//   node scripts/issues.mjs next                              着手可能 (依存がすべて closed) な open issue を優先度順に表示
//   node scripts/issues.mjs close <id>                        closed/ へ移動し closed 日付を記録
//   node scripts/issues.mjs index                             issues/INDEX.md を再生成
//   node scripts/issues.mjs check                             frontmatter の不整合を検査 (CI / pre-commit 用)
//   node scripts/issues.mjs migrate [--dry-run]               旧形式 (0001-closed.md 等) を open/ closed/ + frontmatter に移行
//
// 環境変数 ISSUES_DIR で issues ディレクトリを変更可能（既定: ./issues）

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.env.ISSUES_DIR || "issues");
const OPEN = path.join(ROOT, "open");
const CLOSED = path.join(ROOT, "closed");
const STORIES = path.join(ROOT, "stories");
const INDEX = path.join(ROOT, "INDEX.md");
const PRIORITIES = ["P0", "P1", "P2", "P3"];
const DEFAULT_PRIORITY = "P2";
const CLOSED_IN_INDEX = 10;

// ---------- frontmatter (YAML のごく一部: key: value / key: [a, b]) ----------
function parse(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*?)\s*$/);
    if (!kv) continue;
    let v = kv[2];
    if (v.startsWith('"')) {
      try { v = JSON.parse(v); } catch { v = unquote(v); }
    } else if (v.startsWith("[") && v.endsWith("]")) {
      v = v.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean);
    } else {
      v = unquote(v.replace(/\s+#.*$/, ""));
    }
    meta[kv[1]] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}
function unquote(s) {
  return s.replace(/^(["'])(.*)\1$/, "$2");
}
const ORDER = ["id", "title", "status", "priority", "parent", "wbs", "depends_on", "labels", "created", "closed", "acceptance"];
function serialize(meta, body) {
  const keys = [...ORDER.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !ORDER.includes(k))];
  const lines = keys.map((k) => {
    const v = meta[k];
    if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
    const s = String(v ?? "");
    return `${k}: ${/[:#\[\]{}"]|^\s|\s$/.test(s) ? JSON.stringify(s) : s}`;
  });
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\s+/, "")}`;
}

// ---------- helpers ----------
const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD (ローカル時刻)
const pad = (n) => String(n).padStart(4, "0");
const normId = (id) => pad(parseInt(String(id), 10));
const ensureDirs = () => [ROOT, OPEN, CLOSED].forEach((d) => fs.mkdirSync(d, { recursive: true }));
const firstHeading = (body) => (body.match(/^#\s+(.+)$/m) || [])[1]?.trim();
const list = (v) => [].concat(v ?? []).flatMap((x) => String(x).split(",")).map((s) => s.trim()).filter(Boolean);
const relCwd = (p) => path.relative(process.cwd(), p).split(path.sep).join("/");

function load() {
  const all = [];
  for (const [dir, status] of [[OPEN, "open"], [CLOSED, "closed"]]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      const file = path.join(dir, f);
      const { meta, body } = parse(fs.readFileSync(file, "utf8"));
      all.push({ file, dirStatus: status, meta, body, id: normId(meta.id ?? f), title: meta.title || firstHeading(body) || "(無題)" });
    }
  }
  return all;
}
function loadStories() {
  if (!fs.existsSync(STORIES)) return [];
  return fs.readdirSync(STORIES)
    .filter((f) => /^S\d+.*\.md$/.test(f))
    .sort()
    .map((f) => {
      const file = path.join(STORIES, f);
      const { meta, body } = parse(fs.readFileSync(file, "utf8"));
      return { file, meta, body, id: meta.id || f.replace(/\.md$/, ""), title: meta.title || firstHeading(body) || "(無題)" };
    });
}
function nextId(all) {
  const legacy = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).map((f) => parseInt(f, 10)).filter((n) => !isNaN(n)) : [];
  return pad(Math.max(0, ...all.map((i) => parseInt(i.id, 10)), ...legacy) + 1);
}
const prioRank = (p) => (PRIORITIES.includes(p) ? PRIORITIES.indexOf(p) : PRIORITIES.length);
const deps = (i) => list(i.meta.depends_on).map(normId);

function classify(all) {
  const closedIds = new Set(all.filter((i) => i.dirStatus === "closed").map((i) => i.id));
  const open = all
    .filter((i) => i.dirStatus === "open")
    .sort((a, b) => prioRank(a.meta.priority) - prioRank(b.meta.priority) || a.id.localeCompare(b.id));
  const ready = open.filter((i) => deps(i).every((d) => closedIds.has(d)));
  const blocked = open.filter((i) => !ready.includes(i));
  const closed = all
    .filter((i) => i.dirStatus === "closed")
    .sort((a, b) => String(b.meta.closed || "").localeCompare(String(a.meta.closed || "")) || b.id.localeCompare(a.id));
  return { open, ready, blocked, closed, closedIds };
}

function issueBody({ title, background = "", tasks = [], acceptance = "", context = [], notes = "" }) {
  const bullets = (arr, box) => (arr.length ? arr.map((t) => `- ${box ? "[ ] " : ""}${t}`).join("\n") : `- ${box ? "[ ] " : ""}`);
  return [
    `# ${title}`,
    "",
    "## 背景",
    "",
    background,
    "",
    "## コンテキスト（これ以外は原則読まない）",
    "",
    bullets(context),
    "",
    "## やること",
    "",
    bullets(tasks, true),
    "",
    "## 完了条件",
    "",
    acceptance ? `- [ ] \`${acceptance}\` が成功する` : "- [ ] ",
    "",
    "## メモ",
    "",
    notes,
    "",
  ].join("\n");
}

// ---------- commands ----------
function migrate(dry) {
  if (!fs.existsSync(ROOT)) return console.error(`${ROOT} がありません`);
  ensureDirs();
  const legacy = fs.readdirSync(ROOT).filter((f) => /^\d+.*\.md$/.test(f));
  if (!legacy.length) return console.log("移行対象の旧形式ファイルはありません。");
  const used = new Set(load().map((i) => i.id));
  for (const f of legacy) {
    const src = path.join(ROOT, f);
    const { meta, body } = parse(fs.readFileSync(src, "utf8"));
    const id = normId(f);
    if (used.has(id)) { console.warn(`! ${f}: id ${id} は既に存在するためスキップ`); continue; }
    const st = /closed|done|close/i.test(f) ? "closed" : String(meta.status || "open").toLowerCase() === "closed" ? "closed" : "open";
    const mtime = new Date(fs.statSync(src).mtime).toLocaleDateString("sv-SE");
    const m = {
      ...meta,
      id,
      title: meta.title || firstHeading(body) || f.replace(/^\d+-?/, "").replace(/\.md$/, "").replace(/-?(open|closed)$/i, "") || "(無題)",
      status: st,
      priority: meta.priority || DEFAULT_PRIORITY,
      depends_on: list(meta.depends_on).map(normId),
      labels: list(meta.labels),
      created: meta.created || mtime,
      ...(st === "closed" ? { closed: meta.closed || mtime } : {}),
      acceptance: meta.acceptance || "",
    };
    const dest = path.join(st === "closed" ? CLOSED : OPEN, `${id}.md`);
    console.log(`${dry ? "[dry-run] " : ""}${f}  →  ${relCwd(dest)}   (${m.title})`);
    if (!dry) {
      fs.writeFileSync(dest, serialize(m, body));
      fs.unlinkSync(src);
    }
    used.add(id);
  }
  if (!dry) { writeIndex(); console.log("\nINDEX.md を生成しました。git status で差分を確認してください。"); }
}

function writeIndex() {
  ensureDirs();
  const all = load();
  const stories = loadStories();
  const { open, ready, blocked, closed, closedIds } = classify(all);
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
  const esc = (s) => String(s).replace(/\|/g, "\\|");
  const row = (i) => {
    const d = deps(i);
    const depStr = d.length ? d.map((x) => (closedIds.has(x) ? `~~${x}~~` : x)).join(", ") : "-";
    return `| [${i.id}](${rel(i.file)}) | ${i.meta.priority || "-"} | ${esc(i.title)} | ${i.meta.parent || "-"} | ${depStr} |`;
  };
  const head = "| ID | 優先度 | タイトル | 親 | 依存 |\n|---|---|---|---|---|";
  const storyRows = stories.map((s) => {
    const kids = all.filter((i) => i.meta.parent === s.id);
    const done = kids.filter((i) => i.dirStatus === "closed").length;
    const prog = kids.length ? `${done}/${kids.length}` : "-";
    return `| [${s.id}](${rel(s.file)}) | ${esc(s.title)} | ${s.meta.wbs || "-"} | ${s.meta.status || "-"} | ${prog} |`;
  });
  const out = [
    "<!-- 自動生成ファイル: 手で編集しない。`node scripts/issues.mjs index` で再生成 -->",
    "# Issues",
    "",
    `open **${open.length}** 件（着手可能 ${ready.length} / ブロック中 ${blocked.length}） ・ closed ${closed.length} 件 ・ ストーリー ${stories.length} 件`,
    "",
    "## 着手可能（上から順に着手）",
    "",
    ready.length ? [head, ...ready.map(row)].join("\n") : "_なし_",
    "",
    "## ブロック中（依存 issue が未完了）",
    "",
    blocked.length ? [head, ...blocked.map(row)].join("\n") : "_なし_",
    "",
    "## ストーリー",
    "",
    stories.length ? ["| ID | タイトル | WBS | 状態 | 進捗 |\n|---|---|---|---|---|", ...storyRows].join("\n") : "_なし_",
    "",
    `## 最近 closed（${Math.min(CLOSED_IN_INDEX, closed.length)} / ${closed.length} 件）`,
    "",
    closed.length
      ? closed.slice(0, CLOSED_IN_INDEX).map((i) => `- [${i.id}](${rel(i.file)}) ${i.title}${i.meta.closed ? ` — ${i.meta.closed}` : ""}`).join("\n")
      : "_なし_",
    "",
  ].join("\n");
  fs.writeFileSync(INDEX, out);
  return out;
}

function next() {
  const { ready, blocked } = classify(load());
  if (!ready.length) {
    console.log(blocked.length ? "着手可能な issue はありません（すべて依存待ち）。" : "open な issue はありません。");
    return;
  }
  for (const i of ready) console.log(`${i.id}\t${i.meta.priority || "-"}\t${i.title}\t${relCwd(i.file)}`);
}

function writeIssue(id, f) {
  const meta = {
    id,
    title: f.title,
    status: "open",
    priority: f.priority || DEFAULT_PRIORITY,
    ...(f.parent ? { parent: f.parent } : {}),
    depends_on: f.depends_on || [],
    labels: f.labels || [],
    created: today(),
    acceptance: f.acceptance || "",
  };
  const file = path.join(OPEN, `${id}.md`);
  fs.writeFileSync(file, serialize(meta, issueBody(f)));
  return file;
}

function create(title, opts) {
  if (!title) return console.error('使い方: new "タイトル" [--priority P1] [--depends 0001,0002] [--parent S001] [--labels a,b] [--context a.ts,b.md]');
  ensureDirs();
  const file = writeIssue(nextId(load()), {
    title,
    priority: opts.priority,
    parent: opts.parent,
    depends_on: list(opts.depends).map(normId),
    labels: list(opts.labels),
    context: list(opts.context),
    acceptance: opts.acceptance,
  });
  writeIndex();
  console.log(relCwd(file));
}

function importPlan(planPath, dry) {
  if (!planPath) return console.error("使い方: import <plan.json> [--dry-run]");
  let plan;
  try { plan = JSON.parse(fs.readFileSync(planPath, "utf8")); } catch (e) { console.error(`読み込み失敗: ${e.message}`); process.exit(1); }
  const items = plan.issues || [];
  const errs = [];
  if (!items.length) errs.push("issues が空です");
  if (plan.parent && !loadStories().some((s) => s.id === plan.parent)) errs.push(`parent の ${plan.parent} が issues/stories/ にありません`);
  const keys = new Set();
  items.forEach((it, n) => {
    const where = `issues[${n}]${it.key ? ` (${it.key})` : ""}`;
    if (!it.key) errs.push(`${where}: key がありません`);
    if (keys.has(it.key)) errs.push(`${where}: key が重複`);
    keys.add(it.key);
    if (!it.title) errs.push(`${where}: title がありません`);
    if (!it.acceptance) errs.push(`${where}: acceptance（完了を判定するコマンド）がありません`);
    if (it.priority && !PRIORITIES.includes(it.priority)) errs.push(`${where}: priority は ${PRIORITIES.join("/")}`);
    if (list(it.context).length > 5) errs.push(`${where}: context が 5 件を超えています（issue を分割してください）`);
  });
  const existing = new Set(load().map((i) => i.id));
  items.forEach((it) => {
    for (const d of list(it.depends_on)) {
      if (!keys.has(d) && !(/^\d+$/.test(d) && existing.has(normId(d)))) errs.push(`${it.key}: depends_on の ${d} が計画内にも既存 issue にもありません`);
    }
  });
  // 循環チェック
  const graph = Object.fromEntries(items.map((it) => [it.key, list(it.depends_on).filter((d) => keys.has(d))]));
  const state = {};
  const visit = (k, stack) => {
    if (state[k] === 2) return;
    if (state[k] === 1) { errs.push(`依存関係が循環しています: ${[...stack, k].join(" → ")}`); return; }
    state[k] = 1;
    graph[k].forEach((d) => visit(d, [...stack, k]));
    state[k] = 2;
  };
  Object.keys(graph).forEach((k) => visit(k, []));
  if (errs.length) { console.error(errs.join("\n")); process.exit(1); }

  ensureDirs();
  let id = parseInt(nextId(load()), 10);
  const map = Object.fromEntries(items.map((it) => [it.key, pad(id++)]));
  for (const it of items) {
    const depIds = list(it.depends_on).map((d) => (keys.has(d) ? map[d] : normId(d)));
    const line = `${map[it.key]}  ${it.priority || DEFAULT_PRIORITY}  ${it.title}${depIds.length ? `  (依存: ${depIds.join(", ")})` : ""}`;
    console.log(`${dry ? "[dry-run] " : ""}${line}`);
    if (!dry) {
      writeIssue(map[it.key], {
        ...it,
        parent: it.parent || plan.parent,
        depends_on: depIds,
        labels: list(it.labels),
        context: list(it.context),
        tasks: [].concat(it.tasks || []),
      });
    }
  }
  if (!dry) {
    if (plan.parent) {
      const s = loadStories().find((x) => x.id === plan.parent);
      if (s) fs.writeFileSync(s.file, serialize({ ...s.meta, status: "split" }, s.body));
    }
    writeIndex();
    console.log(`\n${items.length} 件作成しました。`);
  }
}

const STORY_TEMPLATE = (title) => `# ${title}

## ストーリー

<!-- 〈誰〉として、〈目的〉のために、〈何〉がしたい。 -->


## 受け入れ条件

<!-- Given 〈前提〉 When 〈操作〉 Then 〈結果〉 を 1 行ずつ。テストに落とせる粒度で。 -->
- Given  When  Then

## 参照

<!-- 設計書・仕様書・既存コードの該当箇所。中身はコピーせず場所だけ書く。 -->
-

## 対象外

<!-- 今回やらないこと。AI が範囲を広げないための柵。 -->
-

## 補足

`;

function story(title, opts) {
  if (!title) return console.error('使い方: story "タイトル" [--wbs 1.2.3]');
  fs.mkdirSync(STORIES, { recursive: true });
  const n = Math.max(0, ...loadStories().map((s) => parseInt(String(s.id).replace(/^S/, ""), 10) || 0)) + 1;
  const id = `S${String(n).padStart(3, "0")}`;
  const file = path.join(STORIES, `${id}.md`);
  fs.writeFileSync(file, serialize({ id, title, status: "draft", ...(opts.wbs ? { wbs: opts.wbs } : {}), created: today() }, STORY_TEMPLATE(title)));
  writeIndex();
  console.log(relCwd(file));
}

function close(idArg) {
  if (!idArg) return console.error("使い方: close <id>");
  const id = normId(idArg);
  const i = load().find((x) => x.id === id && x.dirStatus === "open");
  if (!i) return console.error(`open に ${id} が見つかりません`);
  const meta = { ...i.meta, id, status: "closed", closed: today() };
  const dest = path.join(CLOSED, path.basename(i.file));
  fs.writeFileSync(dest, serialize(meta, i.body));
  fs.unlinkSync(i.file);
  writeIndex();
  console.log(`closed: ${id} ${i.title}`);
}

function check() {
  const all = load();
  const storyIds = new Set(loadStories().map((s) => s.id));
  const errs = [];
  const ids = new Map();
  for (const i of all) {
    const f = relCwd(i.file);
    if (ids.has(i.id)) errs.push(`${f}: id ${i.id} が重複 (${ids.get(i.id)})`);
    ids.set(i.id, f);
    if (i.meta.status && i.meta.status !== i.dirStatus) errs.push(`${f}: status=${i.meta.status} だが ${i.dirStatus}/ にある`);
    if (i.meta.priority && !PRIORITIES.includes(i.meta.priority)) errs.push(`${f}: priority は ${PRIORITIES.join("/")} のいずれか`);
    if (i.meta.parent && !storyIds.has(i.meta.parent)) errs.push(`${f}: parent の ${i.meta.parent} が issues/stories/ にない`);
    for (const d of deps(i)) if (!all.some((x) => x.id === d)) errs.push(`${f}: depends_on の ${d} が存在しない`);
  }
  const legacy = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).filter((f) => /^\d+.*\.md$/.test(f)) : [];
  for (const f of legacy) errs.push(`${f}: 旧形式のまま (migrate を実行)`);
  if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
  console.log(`OK (issue ${all.length} 件 / ストーリー ${storyIds.size} 件)`);
}

// ---------- main ----------
const [cmd, ...rest] = process.argv.slice(2);
const opts = {};
const pos = [];
for (let k = 0; k < rest.length; k++) {
  if (rest[k].startsWith("--")) {
    const key = rest[k].slice(2);
    opts[key] = rest[k + 1] && !rest[k + 1].startsWith("--") ? rest[++k] : true;
  } else pos.push(rest[k]);
}
switch (cmd) {
  case "story": story(pos.join(" "), opts); break;
  case "import": importPlan(pos[0], !!opts["dry-run"]); break;
  case "new": create(pos.join(" "), opts); break;
  case "next": next(); break;
  case "close": close(pos[0]); break;
  case "index": writeIndex(); console.log(relCwd(INDEX)); break;
  case "check": check(); break;
  case "migrate": migrate(!!opts["dry-run"]); break;
  default:
    console.log("commands: story | import <plan.json> [--dry-run] | new | next | close <id> | index | check | migrate [--dry-run]");
}
