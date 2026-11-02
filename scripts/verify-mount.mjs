#!/usr/bin/env node
/**
 * 装完/升级完跑一次，确认插件已挂载且宿主补丁已生效。只读，不改任何文件。
 *
 *   node scripts/verify-mount.mjs [--profile desktop] [--home <DSH_HOME>] [--bin <dsh/package.json>] [--host <node_modules/@deepseek-ai>] [--mount-only]
 *
 * 默认检查：
 *   1. profile 登记并安装 dsh-purge，宿主未 skip 该 bundle
 *   2. 组装结果包含带 inject 的 dsh-purge 本体，无重复 id 或 entry not found
 *   3. 桌面宿主的全部补丁已生效；pending/unmatched/missing_file 会失败
 *   4. applied.json 与 installed-rev 对齐当前插件版本和安装修订号
 *
 * --host 显式指定宿主；--bin 同时定位装配模块和宿主。两者都未指定时，
 * 从 profile 或桌面安装定位。--mount-only 只检查前两项。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const NAME = "dsh-purge";
const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const home = path.resolve(argOf("--home", process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || "", ".dsh")));
const profileName = argOf("--profile", "desktop");
const profileDir = path.join(home, "profiles", profileName);
const binPkg = argOf("--bin", "");
const explicitHost = argOf("--host", "");
const mountOnly = argv.includes("--mount-only");

function fail(msg) {
  process.stdout.write(`FAIL  ${msg}\n`);
  process.exit(1);
}
function ok(msg) {
  process.stdout.write(`ok    ${msg}\n`);
}

if (!fs.existsSync(path.join(profileDir, "package.json"))) fail(`找不到 profile: ${profileDir}`);

const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, "package.json"), "utf8"));
const bundles = manifest?.dsh?.profile?.bundles;
if (!Array.isArray(bundles)) fail(`${profileDir}/package.json 里没有 dsh.profile.bundles`);
if (!bundles.includes(NAME)) fail(`dsh.profile.bundles 里没有 ${NAME} —— pnpm add / npm install 不会写这一笔，用 dsh plugin add 或手工加上`);
ok(`bundles 里有 ${NAME}`);

const installedPkg = path.join(profileDir, "node_modules", NAME, "package.json");
if (!fs.existsSync(installedPkg)) fail(`${installedPkg} 不存在：依赖没装上，或装到了别的 profile`);
const installedRoot = path.dirname(installedPkg);
const plugin = JSON.parse(fs.readFileSync(installedPkg, "utf8"));
if (!plugin?.dsh?.bundle?.patch) fail(`${NAME} 的 package.json 没声明 dsh.bundle.patch —— 这一层会被宿主直接跳过`);
ok(`${NAME} ${plugin.version}，声明 dsh.bundle.patch = ${plugin.dsh.bundle.patch}`);

function bootAt(aiBase) {
  return aiBase ? path.join(aiBase, "dsh-app-boot", "lib", "index.js") : "";
}

function findBootFromSeed(seed) {
  const rel = path.join("@deepseek-ai", "dsh-app-boot", "lib", "index.js");
  let dir = seed;
  for (let i = 0; i < 6; i += 1) {
    for (const fp of [path.join(dir, rel), path.join(dir, "node_modules", rel)]) {
      if (fs.existsSync(fp)) return fp;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return "";
}

async function findDesktopHost() {
  const locator = path.join(installedRoot, "lib", "desktop.js");
  if (!fs.existsSync(locator)) return "";
  const desktop = await import(pathToFileURL(locator).href);
  const roots = desktop.listDesktopPackageRoots({ discover: true });
  return roots.find((root) => fs.existsSync(bootAt(root))) || "";
}

let aiBase = explicitHost ? path.resolve(explicitHost) : "";
let bootPath = bootAt(aiBase);
if (!bootPath || !fs.existsSync(bootPath)) {
  bootPath = "";
  if (!explicitHost && binPkg) bootPath = findBootFromSeed(path.dirname(path.resolve(binPkg)));
  if (!bootPath && !explicitHost && !binPkg) {
    const anchor = path.join(profileDir, "node_modules", "@deepseek-ai", "dsh", "package.json");
    if (fs.existsSync(anchor)) bootPath = findBootFromSeed(path.dirname(anchor));
  }
  if (!bootPath && !explicitHost && !binPkg) {
    try {
      aiBase = await findDesktopHost();
      bootPath = bootAt(aiBase);
    } catch (error) {
      process.stdout.write(`warn  桌面定位器不可用: ${error && error.message}\n`);
    }
  }
  if (bootPath) aiBase = path.resolve(bootPath, "..", "..", "..");
}
if (!bootPath || !fs.existsSync(bootPath)) {
  fail("找不到宿主的 @deepseek-ai/dsh-app-boot；用 --host <.../node_modules/@deepseek-ai> 或 --bin <宿主 dsh/package.json> 指定");
}
if (!fs.existsSync(path.join(aiBase, "dsh-agent-instructions", "lib"))) {
  fail(`宿主目录无效: ${aiBase}（缺 dsh-agent-instructions/lib）；用 --host 指定 .../node_modules/@deepseek-ai`);
}
const boot = await import(pathToFileURL(bootPath).href);
ok(`宿主装配模块: ${bootPath}`);

// 宿主以 dsh/package.json 为 require 锚点解析所有 @deepseek-ai/* bundle。
const anchorPkg = binPkg ? path.resolve(binPkg) : path.join(aiBase, "dsh", "package.json");
if (!fs.existsSync(anchorPkg)) fail(`找不到宿主 dsh/package.json（试过 ${anchorPkg}），用 --bin 指定`);
const loaded = boot.loadProfile("dsh", profileName, anchorPkg, home);
const skipped = (loaded.skippedBundles || []).find((s) => s.packageName === NAME || JSON.stringify(s).includes(NAME));
if (skipped) fail(`bundle 被宿主跳过: ${skipped.reason} —— 这一层没参与组装，UI 上可能仍显示已安装`);
ok(`bundle 没有被 skip（installAnchor = ${anchorPkg}）`);

const warnings = [];
const rows = boot.composeEntries([[...loaded.layers.flatMap((l) => l.patches), ...loaded.patches]], (...a) => warnings.push(a.join(" ")));
const purgeRows = rows.filter((r) => String(r.id ?? "").startsWith(NAME));
const body = purgeRows.find((r) => r.id === NAME);
if (!body) fail(`组装结果里没有 id=${NAME} 的本体行（只有 ${purgeRows.map((r) => r.id).join(", ") || "无"}）—— bundle 只贡献 patch 层，entry 行必须由某个 patch 文件自己 insert`);
ok(`本体行存在，inject = ${JSON.stringify(body.inject ?? [])}`);

const counts = new Map();
for (const r of rows) if (r.id) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
const dups = [...counts].filter(([, n]) => n > 1);
if (dups.length) fail(`组装结果有重复 id: ${JSON.stringify(dups)} —— 运行期会 failed`);
ok(`无重复 id（共 ${rows.length} 行）`);

const notFound = warnings.filter((w) => w.includes(`entry "${NAME}" not found`));
if (notFound.length) fail(`装配警告: ${notFound[0]} —— 补丁指向了不存在的本体行，升级插件后重试`);
if (warnings.length) process.stdout.write(`warn  其他装配警告: ${warnings.join(" | ")}\n`);

if (mountOnly) {
  process.stdout.write("\n装配检查通过；--mount-only 已跳过宿主补丁与应用戳检查。\n");
  process.exit(0);
}

// patchStatus 的目标文件含 DSH_HOME 下的共享预设；必须跟随 --home，不能读真实主目录。
process.env.DSH_HOME = home;
let core;
try {
  core = await import(pathToFileURL(path.join(installedRoot, "lib", "core.js")).href);
} catch (error) {
  fail(`无法载入已安装插件的宿主检查模块: ${error && error.message}`);
}
if (!Array.isArray(core.ALL_PATCHES) || typeof core.patchStatus !== "function" || typeof core.targetFiles !== "function") {
  fail(`${installedRoot}/lib/core.js 缺少 ALL_PATCHES/patchStatus/targetFiles，无法验证宿主是否生效`);
}
ok(`宿主补丁目录: ${aiBase}（${core.ALL_PATCHES.length} 条）`);

const hostFailures = [];
let status;
try {
  // targetFiles 同时验证宿主布局；patchStatus 使用全部补丁，不用子集代替。
  core.targetFiles(aiBase);
  status = await core.patchStatus(aiBase, core.ALL_PATCHES);
} catch (error) {
  fail(`读取宿主补丁状态失败: ${error && error.message}；检查 --host 是否指向当前安装`);
}
const tally = {};
for (const patch of core.ALL_PATCHES) {
  const value = status[patch.id] ?? "missing_status";
  tally[value] = (tally[value] ?? 0) + 1;
}
process.stdout.write(`info  补丁状态计数: ${Object.entries(tally).map(([key, n]) => `${key}=${n}`).join(", ")}\n`);
const badStates = ["pending", "unmatched", "missing_file", "missing_status"];
for (const state of badStates) {
  const ids = core.ALL_PATCHES.map((p) => p.id).filter((id) => (status[id] ?? "missing_status") === state);
  if (ids.length) hostFailures.push(`宿主补丁 ${state}: ${ids.join(", ")}；在 dsh-purge 设置中点「应用」(Apply)，重启后重跑检查`);
}

const stampDir = path.join(home, NAME);
const stampPath = path.join(stampDir, "applied.json");
const revPath = path.join(stampDir, "installed-rev");
let stamp = null;
try {
  stamp = JSON.parse(fs.readFileSync(stampPath, "utf8"));
} catch (error) {
  hostFailures.push(`应用戳 ${stampPath} 缺失或无效（${error.code || error.message}）；点「应用」(Apply) 生成当前版本戳`);
}
let rev = "";
try {
  rev = fs.readFileSync(revPath, "utf8").trim();
} catch {
  // 下方统一报告缺失，避免误读其他 DSH_HOME 的戳。
}
if (stamp && String(stamp.version || "") !== String(plugin.version || "")) {
  hostFailures.push(`应用戳版本陈旧: applied.json=${stamp.version || "空"}，已安装=${plugin.version}；点「应用」(Apply) 刷新`);
}
if (stamp && !String(stamp.sha || "").trim()) hostFailures.push("applied.json.sha 为空；点「应用」(Apply) 重新生成");
if (!rev) hostFailures.push(`安装修订号 ${revPath} 缺失或为空；点「应用」(Apply) 生成`);

const sameRev = (a, b) => {
  if (!a || !b) return false;
  if (a === b) return true;
  const bothSha = /^[0-9a-f]{7,40}$/i.test(a) && /^[0-9a-f]{7,40}$/i.test(b);
  return bothSha && (a.startsWith(b) || b.startsWith(a));
};
if (stamp?.sha && rev) {
  const sha = String(stamp.sha).trim();
  const applyRev = `apply:${plugin.version}`;
  if (rev.startsWith("apply:") && rev !== applyRev) {
    hostFailures.push(`installed-rev 陈旧: ${rev}，当前应为 ${applyRev}；点「应用」(Apply) 刷新`);
  } else if (rev === "applied") {
    hostFailures.push("installed-rev 只有旧占位值 applied，无法对齐当前版本；点「应用」(Apply) 刷新");
  } else if (!(sha === applyRev && (rev === applyRev || !rev.startsWith("apply:"))) && !sameRev(sha, rev)) {
    hostFailures.push(`应用戳与安装修订号不对齐: applied.json.sha=${sha}，installed-rev=${rev}；点「应用」(Apply) 刷新`);
  }
}
if (hostFailures.length) {
  for (const message of hostFailures) process.stdout.write(`FAIL  ${message}\n`);
  process.exit(1);
}
ok(`应用戳对齐 ${NAME} ${plugin.version}，installed-rev = ${rev}`);
process.stdout.write("\n装配与宿主生效检查通过。\n");
