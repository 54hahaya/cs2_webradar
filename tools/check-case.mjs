// 大小写敏感审计（模拟 Linux CI）
//   Windows 文件系统大小写不敏感，import "./App.css" 找不到 app.css 也能跑；
//   GitHub Actions 在 Linux 上构建就会直接报 Module not found。
//   这个脚本用逐字节比较（readdir 返回真实名字）把所有这类问题抓出来。
//
//   node tools/check-case.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

/** 在 dir 里精确查找 entry（大小写敏感）。返回 {exact, ci} */
function lookup(dir, entry) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { exact: null, ci: null };
  }
  const exact = entries.includes(entry) ? entry : null;
  const ci = exact ? null : entries.find((e) => e.toLowerCase() === entry.toLowerCase()) ?? null;
  return { exact, ci };
}

/** 解析 import specifier（相对路径），返回 {ok, resolved, suggestion} */
function resolveSpecifier(fromDir, spec) {
  const segs = spec.split("/");
  let cur = fromDir;

  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    if (s === "." || s === "") continue;
    if (s === "..") {
      cur = path.dirname(cur);
      continue;
    }
    const { exact, ci } = lookup(cur, s);
    if (!exact) return { ok: false, kind: "dir", part: s, dir: cur, suggestion: ci };
    cur = path.join(cur, s);
  }

  const last = segs[segs.length - 1];
  const exts = ["", ".js", ".jsx", ".mjs", ".ts", ".tsx", ".json", ".css"];
  for (const ext of exts) {
    const { exact } = lookup(cur, last + ext);
    if (exact) return { ok: true, resolved: path.join(cur, last + ext) };
  }
  const { ci } = lookup(cur, last + ".jsx");
  const ciAny =
    ci ??
    exts.map((e) => lookup(cur, last + e).ci).find(Boolean) ??
    lookup(cur, last).ci;
  return { ok: false, kind: "file", part: last, dir: cur, suggestion: ciAny };
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ---- 1) import 语句 ----
const srcFiles = walk(path.join(ROOT, "src")).filter((f) => /\.(jsx?|mjs)$/.test(f));
// 三种写法都抓：`from "./x"`、`import "./x"`、`import("./x")`
const importRe = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

for (const f of srcFiles) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(importRe)) {
    const r = resolveSpecifier(path.dirname(f), m[1]);
    const rel = path.relative(ROOT, f);
    if (!r.ok) {
      problems.push(
        `${rel}: import "${m[1]}"  ${r.kind === "dir" ? "目录" : "文件"} "${r.part}" 不存在` +
          (r.suggestion ? `  —— 你是不是想写 "${r.suggestion}"?` : "")
      );
    }
  }
}

// ---- 2) 写死的资源路径 ./assets/... ----
const PUB = path.join(ROOT, "public");
const assetsRe = /["'`](\.\/assets\/[^"'`$]+)["'`]/g;

for (const f of [
  ...walk(path.join(ROOT, "src")),
  path.join(ROOT, "index.html"),
].filter((p) => /\.(jsx?|css|html)$/.test(p))) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(assetsRe)) {
    const segs = m[1].replace(/^\.\//, "").split("/");
    let cur = PUB;
    let bad = null;
    for (const s of segs) {
      const { exact, ci } = lookup(cur, s);
      if (!exact) {
        bad = ci ? `写成 "${s}"，实际是 "${ci}"` : `"${s}" 不存在`;
        break;
      }
      cur = path.join(cur, s);
    }
    if (bad) problems.push(`${path.relative(ROOT, f)}: ${m[1]} -> ${bad}`);
  }
}

// ---- 3) 模板里用到的资源目录，至少目录大小写要一致 ----
for (const dir of ["assets/icons", "assets/characters", "assets/typefaces"]) {
  let cur = PUB;
  const segs = dir.split("/");
  for (const s of segs) {
    const { exact, ci } = lookup(cur, s);
    if (!exact) {
      problems.push(`public/${dir}: 目录 "${s}" ${ci ? `实际是 "${ci}"` : "不存在"}`);
      break;
    }
    cur = path.join(cur, s);
  }
}

// ---- 输出 ----
console.log(`扫描 ${srcFiles.length} 个源文件 + public 资源\n`);
if (problems.length === 0) {
  console.log("OK  没有大小写问题（Linux CI 可以正常构建）");
} else {
  for (const p of problems) console.log("FAIL  " + p);
  console.log(`\n共 ${problems.length} 处问题`);
}
process.exit(problems.length ? 1 : 0);
