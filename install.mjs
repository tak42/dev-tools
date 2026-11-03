#!/usr/bin/env node
// install.mjs — dev-tools の開発基盤ファイルを対象リポジトリへ導入・更新する
//
//   node install.mjs <対象リポジトリのパス> [--dry-run]
//
// 何度実行しても同じ結果になる（冪等）。更新時も同じコマンドを再実行する。
//   - DEV-TOOLS.md                       : 使い方ドキュメント。最新版で上書き（既存の README.md には触れない）
//   - scripts/issues.mjs                 : 最新版で上書き
//   - .github/copilot-instructions.md    : マーカー間のブロックだけを差し替え（他の記述は保持）
//   - .github/skills/<dev-tools の Skill> : 最新版で上書き（dev-tools にない Skill には触れない）
//   - issues/open, closed, stories       : なければ作成
//   - issues/INDEX.md                    : 再生成
//   - package.json                       : あれば "issue" スクリプトを追加（既存なら変更しない）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const START = "<!-- dev-tools:issues:start -->";
const END = "<!-- dev-tools:issues:end -->";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const targetArg = args.find((a) => !a.startsWith("--"));
if (!targetArg) {
  console.log("使い方: node install.mjs <対象リポジトリのパス> [--dry-run]");
  process.exit(1);
}
const target = path.resolve(targetArg);
if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  console.error(`ディレクトリが見つかりません: ${target}`);
  process.exit(1);
}
if (path.resolve(target) === path.resolve(HERE)) {
  console.error("dev-tools 自身には導入できません。対象リポジトリのパスを指定してください。");
  process.exit(1);
}

const log = (msg) => console.log(`${dry ? "[dry-run] " : ""}${msg}`);
const rel = (p) => path.relative(target, p).split(path.sep).join("/");
const write = (file, content) => {
  if (dry) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const eol = (s) => s.replace(/\r\n/g, "\n");

// 1. scripts/issues.mjs
{
  const src = fs.readFileSync(path.join(HERE, "tools/issues/issues.mjs"), "utf8");
  const dest = path.join(target, "scripts/issues.mjs");
  const cur = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
  if (cur === null) log(`作成   ${rel(dest)}`);
  else if (eol(cur) !== eol(src)) log(`更新   ${rel(dest)}`);
  else log(`変更なし ${rel(dest)}`);
  if (cur === null || eol(cur) !== eol(src)) write(dest, src);
}

// 2. .github/copilot-instructions.md（マーカー間を差し替え）
{
  const tpl = fs.readFileSync(path.join(HERE, "templates/copilot-instructions.issues.md"), "utf8").trim();
  const block = `${START}\n${tpl}\n${END}`;
  const dest = path.join(target, ".github/copilot-instructions.md");
  const cur = fs.existsSync(dest) ? eol(fs.readFileSync(dest, "utf8")) : null;
  let next;
  if (cur === null) {
    next = `# Copilot instructions\n\n${block}\n`;
    log(`作成   ${rel(dest)}`);
  } else if (cur.includes(START) && cur.includes(END)) {
    next = cur.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
    log(next === cur ? `変更なし ${rel(dest)}` : `更新   ${rel(dest)}（dev-tools ブロックのみ）`);
  } else {
    next = `${cur.replace(/\s*$/, "")}\n\n${block}\n`;
    log(`追記   ${rel(dest)}（末尾に dev-tools ブロックを追加）`);
  }
  if (next !== cur) write(dest, next);
}

// 3. Skills（templates/skills/<name>/ → .github/skills/<name>/）
{
  const srcRoot = path.join(HERE, "templates/skills");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const skill of fs.readdirSync(srcRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const srcDir = path.join(srcRoot, skill);
    const destDir = path.join(target, ".github/skills", skill);
    const srcFiles = walk(srcDir).map((f) => path.relative(srcDir, f));
    let changed = 0;
    for (const f of srcFiles) {
      const src = fs.readFileSync(path.join(srcDir, f), "utf8");
      const dest = path.join(destDir, f);
      const cur = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
      if (cur === null || eol(cur) !== eol(src)) { write(dest, src); changed++; }
    }
    // dev-tools 側で削除されたファイルを片付ける
    if (fs.existsSync(destDir)) {
      for (const f of walk(destDir).map((p) => path.relative(destDir, p))) {
        if (!srcFiles.includes(f)) { if (!dry) fs.unlinkSync(path.join(destDir, f)); changed++; }
      }
    }
    log(`${changed ? (fs.existsSync(destDir) || dry ? "同期  " : "作成  ") : "変更なし"} ${rel(destDir)}/${changed ? `（${changed} ファイル）` : ""}`);
  }
}

// 4. issues ディレクトリ
const issuesDir = path.join(target, "issues");
for (const d of ["open", "closed", "stories"]) {
  const p = path.join(issuesDir, d);
  if (!fs.existsSync(p)) {
    log(`作成   ${rel(p)}/`);
    write(path.join(p, ".gitkeep"), "");
  }
}

// 5. package.json に "issue" スクリプト
{
  const pkg = path.join(target, "package.json");
  if (fs.existsSync(pkg)) {
    const raw = fs.readFileSync(pkg, "utf8");
    const json = JSON.parse(raw);
    json.scripts ??= {};
    if (!json.scripts.issue) {
      json.scripts.issue = "node scripts/issues.mjs";
      const indent = (raw.match(/^[ \t]+(?=")/m) || ["  "])[0];
      write(pkg, JSON.stringify(json, null, indent) + "\n");
      log(`追記   package.json に "issue" スクリプト`);
    }
  }
}

// 6. DEV-TOOLS.md（ルート直下。README.md とは別ファイル）
{
  let version = "unknown";
  try {
    version = execFileSync("git", ["-C", HERE, "log", "-1", "--format=%h (%cs)"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || version;
  } catch {}
  const src = fs.readFileSync(path.join(HERE, "templates/DEV-TOOLS.md"), "utf8").replace("{{VERSION}}", version);
  const dest = path.join(target, "DEV-TOOLS.md");
  const cur = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
  if (cur === null) log(`作成   ${rel(dest)}`);
  else if (eol(cur) !== eol(src)) log(`更新   ${rel(dest)}`);
  else log(`変更なし ${rel(dest)}`);
  if (cur === null || eol(cur) !== eol(src)) write(dest, src);
}

// 7. 旧形式の検出 と INDEX 生成
const legacy = fs.existsSync(issuesDir) ? fs.readdirSync(issuesDir).filter((f) => /^\d+.*\.md$/.test(f)) : [];
if (!dry) {
  execFileSync(process.execPath, [path.join(target, "scripts/issues.mjs"), "index"], { cwd: target, stdio: "ignore" });
  log(`生成   issues/INDEX.md`);
}

console.log("\n完了しました。");
if (legacy.length) {
  console.log(`\n旧形式の issue が ${legacy.length} 件あります（例: ${legacy.slice(0, 3).join(", ")}）。対象リポジトリで次を実行してください:`);
  console.log("  node scripts/issues.mjs migrate --dry-run");
  console.log("  node scripts/issues.mjs migrate");
}
console.log("\n使い方は対象リポジトリの DEV-TOOLS.md を参照してください。");
console.log("差分は対象リポジトリで git status / git diff で確認してください。");
