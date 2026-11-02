#!/usr/bin/env node
// issues.mjs — リポジトリ内 issue 管理の小さな CLI（依存パッケージなし / Node 18+）
// source: https://github.com/tak42/dev-tools （このファイルは install.mjs で配布。直接編集せず dev-tools 側を更新する）
//
//   node scripts/issues.mjs migrate [--dry-run]   旧形式 (0001-closed.md 等) を open/ closed/ + frontmatter に移行
//   node scripts/issues.mjs index                  issues/INDEX.md を再生成
//   node scripts/issues.mjs next                   着手可能 (依存がすべて closed) な open issue を優先度順に表示
//   node scripts/issues.mjs new "タイトル" [--priority P2] [--depends 0001,0003]
//   node scripts/issues.mjs close <id>             closed/ へ移動し closed 日付を記録
//   node scripts/issues.mjs check                  frontmatter の不整合を検査 (CI / pre-commit 用)
//
// 環境変数 ISSUES_DIR で issues ディレクトリを変更可能（既定: ./issues）

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.env.ISSUES_DIR || "issues");
const OPEN = path.join(ROOT, "open");
const CLOSED = path.join(ROOT, "closed");
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
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*?)\s*(#.*)?$/);
    if (!kv) continue;
    let v = kv[2];
    if (v.startsWith("[") && v.endsWith("]")) {
      v = v.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean);
    } else {
      v = unquote(v);
    }
    meta[kv[1]] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}
function unquote(s) {
  return s.replace(/^(["'])(.*)\1$/, "$2");
}
const ORDER = ["id", "title", "status", "priority", "depends_on", "labels", "created", "closed", "acceptance"];
function serialize(meta, body) {
  const keys = [...ORDER.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !ORDER.includes(k))];
  const lines = keys.map((k) => {
    const v = meta[k];
    if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
    const s = String(v ?? "");
    return `${k}: ${/[:#\[\]{}]|^\s|\s$/.test(s) ? JSON.stringify(s) : s}`;
  });
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\s+/, "")}`;
}

// ---------- helpers ----------
const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD (ローカル時刻)
const pad = (n) => String(n).padStart(4, "0");
const normId = (id) => pad(parseInt(String(id), 10));
const ensureDirs = () => [ROOT, OPEN, CLOSED].forEach((d) => fs.mkdirSync(d, { recursive: true }));
const firstHeading = (body) => (body.match(/^#\s+(.+)$/m) || [])[1]?.trim();

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
function nextId(all) {
  const legacy = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).map((f) => parseInt(f, 10)).filter((n) => !isNaN(n)) : [];
  return pad(Math.max(0, ...all.map((i) => parseInt(i.id, 10)), ...legacy) + 1);
}
const prioRank = (p) => (PRIORITIES.includes(p) ? PRIORITIES.indexOf(p) : PRIORITIES.length);
const deps = (i) => [].concat(i.meta.depends_on || []).map(normId);

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
    const m = {
      id,
      title: meta.title || firstHeading(body) || f.replace(/^\d+-?/, "").replace(/\.md$/, "").replace(/-?(open|closed)$/i, "") || "(無題)",
      status: st,
      priority: meta.priority || DEFAULT_PRIORITY,
      depends_on: [].concat(meta.depends_on || []).map(normId),
      labels: [].concat(meta.labels || []),
      created: meta.created || new Date(fs.statSync(src).mtime).toLocaleDateString("sv-SE"),
      ...(st === "closed" ? { closed: meta.closed || new Date(fs.statSync(src).mtime).toLocaleDateString("sv-SE") } : {}),
      acceptance: meta.acceptance || "",
      ...Object.fromEntries(Object.entries(meta).filter(([k]) => !ORDER.includes(k))),
    };
    const dest = path.join(st === "closed" ? CLOSED : OPEN, `${id}.md`);
    console.log(`${dry ? "[dry-run] " : ""}${f}  →  ${path.relative(process.cwd(), dest)}   (${m.title})`);
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
  const { open, ready, blocked, closed, closedIds } = classify(all);
  const rel = (i) => path.relative(ROOT, i.file).split(path.sep).join("/");
  const row = (i) => {
    const d = deps(i);
    const depStr = d.length ? d.map((x) => (closedIds.has(x) ? `~~${x}~~` : x)).join(", ") : "-";
    return `| [${i.id}](${rel(i)}) | ${i.meta.priority || "-"} | ${i.title.replace(/\|/g, "\\|")} | ${depStr} | ${[].concat(i.meta.labels || []).join(", ") || "-"} |`;
  };
  const head = "| ID | 優先度 | タイトル | 依存 | ラベル |\n|---|---|---|---|---|";
  const out = [
    "<!-- 自動生成ファイル: 手で編集しない。`node scripts/issues.mjs index` で再生成 -->",
    "# Issues",
    "",
    `open **${open.length}** 件（着手可能 ${ready.length} / ブロック中 ${blocked.length}） ・ closed ${closed.length} 件`,
    "",
    "## 着手可能（上から順に着手）",
    "",
    ready.length ? [head, ...ready.map(row)].join("\n") : "_なし_",
    "",
    "## ブロック中（依存 issue が未完了）",
    "",
    blocked.length ? [head, ...blocked.map(row)].join("\n") : "_なし_",
    "",
    `## 最近 closed（${Math.min(CLOSED_IN_INDEX, closed.length)} / ${closed.length} 件）`,
    "",
    closed.length
      ? closed.slice(0, CLOSED_IN_INDEX).map((i) => `- [${i.id}](${rel(i)}) ${i.title}${i.meta.closed ? ` — ${i.meta.closed}` : ""}`).join("\n")
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
  for (const i of ready) console.log(`${i.id}\t${i.meta.priority || "-"}\t${i.title}\t${path.relative(process.cwd(), i.file)}`);
}

function create(title, opts) {
  if (!title) return console.error('使い方: new "タイトル" [--priority P1] [--depends 0001,0002]');
  ensureDirs();
  const id = nextId(load());
  const meta = {
    id, title, status: "open",
    priority: opts.priority || DEFAULT_PRIORITY,
    depends_on: (opts.depends || "").split(",").filter(Boolean).map(normId),
    labels: (opts.labels || "").split(",").filter(Boolean),
    created: today(),
    acceptance: "",
  };
  const body = `# ${title}\n\n## 背景\n\n\n## やること\n\n- [ ] \n\n## 完了条件\n\n- [ ] \n\n## メモ\n\n`;
  const file = path.join(OPEN, `${id}.md`);
  fs.writeFileSync(file, serialize(meta, body));
  writeIndex();
  console.log(path.relative(process.cwd(), file));
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
  const errs = [];
  const ids = new Map();
  for (const i of all) {
    const f = path.relative(process.cwd(), i.file);
    if (ids.has(i.id)) errs.push(`${f}: id ${i.id} が重複 (${ids.get(i.id)})`);
    ids.set(i.id, f);
    if (i.meta.status && i.meta.status !== i.dirStatus) errs.push(`${f}: status=${i.meta.status} だが ${i.dirStatus}/ にある`);
    if (i.meta.priority && !PRIORITIES.includes(i.meta.priority)) errs.push(`${f}: priority は ${PRIORITIES.join("/")} のいずれか`);
    for (const d of deps(i)) if (!ids.has(d) && !all.some((x) => x.id === d)) errs.push(`${f}: depends_on の ${d} が存在しない`);
  }
  const legacy = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).filter((f) => /^\d+.*\.md$/.test(f)) : [];
  for (const f of legacy) errs.push(`${f}: 旧形式のまま (migrate を実行)`);
  if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
  console.log(`OK (${all.length} 件)`);
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
  case "migrate": migrate(!!opts["dry-run"]); break;
  case "index": writeIndex(); console.log(path.relative(process.cwd(), INDEX)); break;
  case "next": next(); break;
  case "new": create(pos.join(" "), opts); break;
  case "close": close(pos[0]); break;
  case "check": check(); break;
  default:
    console.log("commands: migrate [--dry-run] | index | next | new \"タイトル\" [--priority P1] [--depends 0001] [--labels a,b] | close <id> | check");
}
