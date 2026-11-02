/**
 * 纯逻辑单测：只覆盖「会静默撒谎或静默丢数据」的地方，不依赖宿主、不联网。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTEXT_OPTIONS,
  DEFAULT_CONTEXT_WINDOW,
  KNOWN_MODEL_IDS,
  MODELS,
  RETIRED_MODELS,
  catalogUpToDate,
  estimatePace,
  failureOf,
  keyHintOf,
  keyKindOf,
  mergeModels,
  normalizeContextWindow,
  normalizeKey,
  piAiModelEntries,
  projectBucket,
} from "../lib/catalog.js";

// 2026-10-30 用真实套餐 Key 抓到的响应（时间戳原样保留）。
const LIVE_REMAINS = {
  model_remains: [
    {
      start_time: 1793339966314,
      end_time: 1793357966314,
      remains_time: 17999996,
      current_interval_total_count: 0,
      current_interval_usage_count: 0,
      model_name: "general",
      current_weekly_total_count: 0,
      current_weekly_usage_count: 0,
      weekly_start_time: 1793339966314,
      weekly_end_time: 1793944766314,
      weekly_remains_time: 604799996,
      current_interval_status: 1,
      current_interval_remaining_percent: 99,
      current_weekly_status: 1,
      current_weekly_remaining_percent: 99,
    },
  ],
  base_resp: { status_code: 0, status_msg: "success" },
};

test("keyKindOf 按官方前缀区分计费形态", () => {
  assert.equal(keyKindOf("sk-cp-abc"), "plan");
  assert.equal(keyKindOf("sk-api-abc"), "payg");
  assert.equal(keyKindOf("eyJhbGciOi.payload.sig"), "unknown");
  assert.equal(keyKindOf(""), "unknown");
  assert.equal(keyKindOf(undefined), "unknown");
});

test("normalizeKey 容忍常见的粘贴噪声，拒绝不像 Key 的输入", () => {
  assert.equal(normalizeKey("  sk-api-abcdefgh  "), "sk-api-abcdefgh");
  assert.equal(normalizeKey("Bearer sk-cp-abcdefgh"), "sk-cp-abcdefgh");
  assert.equal(normalizeKey('"sk-api-abcdefgh"'), "sk-api-abcdefgh");
  assert.equal(normalizeKey("sk-api abc defgh"), undefined, "内部空白说明粘错了");
  assert.equal(normalizeKey("short"), undefined);
  assert.equal(normalizeKey(""), undefined);
  assert.equal(normalizeKey(42), undefined);
});

test("keyHintOf 只露出末 4 位", () => {
  assert.equal(keyHintOf("sk-api-1234567890wxyz"), "••••wxyz");
  assert.equal(keyHintOf("abc"), "••••");
});

test("failureOf：HTTP 200 里的 base_resp 失败必须被识别", () => {
  assert.equal(failureOf(LIVE_REMAINS), undefined);
  assert.equal(failureOf({ base_resp: { status_code: 2062 } }).kind, "no-plan");
  assert.equal(failureOf({ base_resp: { status_code: "2062" } }).kind, "no-plan", "字符串码也要认");
  assert.equal(failureOf({ base_resp: { status_code: 1004, status_msg: "login fail" } }).kind, "auth");
  assert.equal(failureOf({ base_resp: { status_code: 2049, status_msg: "invalid api key" } }).kind, "auth");
  assert.equal(failureOf({ base_resp: { status_code: 1008 } }).kind, "balance");
  const other = failureOf({ base_resp: { status_code: 1234, status_msg: "boom" } });
  assert.equal(other.kind, "error");
  assert.match(other.message, /boom/);
  assert.equal(failureOf(undefined), undefined);
});

test("failureOf：/v1 与 /anthropic 的 error 信封（含末尾错误码）", () => {
  // 实测：国内 Key 打国际 /v1/models
  const crossRegion = failureOf({
    type: "error",
    error: { type: "authorized_error", message: "invalid api key (2049)", http_code: "401" },
  });
  assert.equal(crossRegion.kind, "auth");
  assert.equal(crossRegion.code, 2049);
  const unknown = failureOf({ type: "error", error: { type: "invalid_request_error", message: "bad things" } });
  assert.equal(unknown.kind, "error");
  assert.equal(unknown.code, -1);
});

test("projectBucket：真实响应 → 5 小时 + 每周两个窗口，剩余 99%", () => {
  const projected = projectBucket(LIVE_REMAINS.model_remains[0]);
  assert.equal(projected.bucketLabel, "文本");
  const [interval, weekly] = projected.windows;
  assert.equal(interval.key, "interval");
  assert.equal(interval.label, "文本 5 小时");
  assert.equal(interval.remainingPercent, 99);
  assert.equal(interval.usedPercent, 1, "remaining_percent 是剩余，必须反相成已用");
  assert.equal(interval.windowMs, 5 * 3_600_000);
  assert.equal(weekly.key, "weekly");
  assert.equal(weekly.windowMs, 7 * 24 * 3_600_000);
});

test("projectBucket：video 桶的区间按实际算（24 小时），不能写死 5 小时", () => {
  const projected = projectBucket({
    model_name: "video",
    start_time: 0,
    end_time: 24 * 3_600_000,
    current_interval_remaining_percent: 100,
    current_interval_status: 1,
    current_interval_total_count: 3,
    current_weekly_total_count: 21,
  });
  assert.match(projected.windows[0].label, /视频 24 小时/);
});

test("projectBucket：「不在套餐内」的桶必须丢弃，不能显示成满额度", () => {
  assert.equal(
    projectBucket({
      model_name: "general",
      current_interval_total_count: 0,
      current_weekly_total_count: 0,
      current_interval_status: 3,
      current_weekly_status: 3,
      current_interval_remaining_percent: 100,
      current_weekly_remaining_percent: 100,
    }),
    null,
  );
  assert.equal(projectBucket(null), null);
  assert.equal(projectBucket("nope"), null);
});

test("模型目录：M3.1-Flash 在列，退役的 M2.x 不在列", () => {
  const ids = MODELS.map((m) => m.id);
  assert.deepEqual(ids, ["MiniMax-M3.1-Flash", "MiniMax-M3"]);
  for (const retired of RETIRED_MODELS) assert.ok(!ids.includes(retired.id));
  for (const model of MODELS) {
    assert.ok(model.contextWindow > 0 && model.maxTokens > 0 && model.maxTokens <= model.contextWindow);
    assert.ok(model.input.includes("text"));
  }
});

test("思考档位：M3.1-Flash 不能有 off（实测 disabled → 400），M3 可以", () => {
  const flash = MODELS.find((m) => m.id === "MiniMax-M3.1-Flash");
  assert.ok(!("off" in flash.reasoningEfforts));
  const m3 = MODELS.find((m) => m.id === "MiniMax-M3");
  assert.ok("off" in m3.reasoningEfforts);
  assert.equal(m3.reasoningEfforts.off, null, "pi-ai 规定只有 off 可以留空");
  // pi-ai 校验：除 off 外每个档位都要有非空线上值。
  for (const model of MODELS) {
    for (const [level, wire] of Object.entries(model.reasoningEfforts)) {
      if (level === "off") continue;
      assert.equal(typeof wire, "string");
      assert.ok(wire.length > 0);
    }
  }
});

test("piAiModelEntries 打开 forceAdaptiveThinking，且返回独立副本", () => {
  const entries = piAiModelEntries();
  for (const entry of entries) assert.equal(entry.compat.forceAdaptiveThinking, true);
  entries[0].input.push("video");
  assert.deepEqual(piAiModelEntries()[0].input, ["text", "image"], "调用方改副本不能污染常量");
});

test("mergeModels：替换内置 / 退役条目，保留用户自己加的模型", () => {
  const current = [
    { id: "MiniMax-M2.7", contextWindow: 204800 },
    { id: "MiniMax-M3" },
    { id: "my-finetune", name: "我的微调", contextWindow: 32000 },
  ];
  const merged = mergeModels(current);
  assert.deepEqual(
    merged.map((m) => m.id),
    ["MiniMax-M3.1-Flash", "MiniMax-M3", "my-finetune"],
  );
  assert.equal(merged[2], current[2], "用户条目原样保留（同一对象）");
  assert.deepEqual(mergeModels(undefined).map((m) => m.id), ["MiniMax-M3.1-Flash", "MiniMax-M3"]);
  assert.ok(KNOWN_MODEL_IDS.has("MiniMax-M2.7-highspeed"));
});

test("catalogUpToDate：自己写的目录读回来（含 schema 物化的多余字段）算最新", () => {
  assert.equal(catalogUpToDate(undefined), false);
  assert.equal(catalogUpToDate([]), false);
  const written = mergeModels(undefined);
  // 模拟 schema 物化：多出空 compat 字段、数组被复制。
  const readBack = written.map((m) => ({
    ...m,
    input: [...m.input],
    reasoningEfforts: { ...m.reasoningEfforts },
    compat: { ...m.compat, chatTemplateKwargs: {}, chatTemplateArgs: {} },
  }));
  assert.equal(catalogUpToDate(readBack), true);

  const extra = { id: "my-finetune" };
  assert.equal(catalogUpToDate([...readBack, extra]), true, "用户条目不影响判定");

  const stale = readBack.map((m) => ({ ...m }));
  stale[0] = { ...stale[0], maxTokens: 999 };
  assert.equal(catalogUpToDate(stale), false);

  const withRetired = [{ id: "MiniMax-M2.7" }, ...readBack];
  assert.equal(catalogUpToDate(withRetired), false, "还留着退役模型就要更新");

  const noAdaptive = readBack.map((m) => ({ ...m, compat: {} }));
  assert.equal(catalogUpToDate(noAdaptive), false);
});

test("上下文档位：只有三档，默认 1M", () => {
  assert.deepEqual(CONTEXT_OPTIONS.map((o) => o.id), [200000, 512000, 1000000]);
  assert.equal(DEFAULT_CONTEXT_WINDOW, 1000000);
});

test("normalizeContextWindow 规整各种输入", () => {
  assert.equal(normalizeContextWindow(512000), 512000);
  assert.equal(normalizeContextWindow("200000"), 200000);
  // 不认识的数值：取不超过它的最大档，避免用户手填一个超能力值。
  assert.equal(normalizeContextWindow(400000), 200000);
  assert.equal(normalizeContextWindow(1), 1000000, "太小也对不上档位时退回默认");
  assert.equal(normalizeContextWindow(99999999), 1000000);
  assert.equal(normalizeContextWindow(undefined), 1000000);
  assert.equal(normalizeContextWindow("abc"), 1000000);
  assert.equal(normalizeContextWindow(null), 1000000);
});

test("piAiModelEntries 按给定上下文写出所有模型", () => {
  const entries = piAiModelEntries(200000);
  assert.equal(entries.length, 2);
  for (const entry of entries) assert.equal(entry.contextWindow, 200000);
});

test("mergeModels 未显式指定时，沿用已存目录里的上下文（不覆盖用户的修改）", () => {
  // 用户在「设置 → 模型」里把窗口改成了 512K。
  const current = [
    { id: "MiniMax-M3.1-Flash", contextWindow: 512000 },
    { id: "custom-1", contextWindow: 8000 },
  ];
  const merged = mergeModels(current);
  assert.equal(merged[0].contextWindow, 512000, "用户改过的值必须保留");
  assert.equal(merged[1].contextWindow, 512000, "同插件管理的模型共用一档");

  // 显式指定时以指定为准。
  assert.equal(mergeModels(current, 200000)[0].contextWindow, 200000);

  // 空目录用默认。
  assert.equal(mergeModels(undefined)[0].contextWindow, DEFAULT_CONTEXT_WINDOW);
});

test("catalogUpToDate 能识别上下文变化", () => {
  const current = mergeModels(undefined, 1000000);
  assert.equal(catalogUpToDate(current, 1000000), true);
  assert.equal(catalogUpToDate(current, 512000), false, "换成别的档位必须判为需要更新");
  assert.equal(catalogUpToDate(current), true, "不指定时沿用已存值，视为最新");
});

// ---------- 用量速度与耗尽预估 ----------

test("estimatePace：无历史时用窗口平均速度（开箱即用）", () => {
  const now = 1_000_000_000;
  const win = {
    key: "interval",
    label: "文本 5 小时",
    remainingPercent: 85,
    usedPercent: 15,
    startedAt: now - 5 * 3_600_000, // 窗口已过去 5 小时
    resetsAt: now + 1 * 3_600_000,
  };
  const pace = estimatePace(win, [], now);
  assert.equal(pace.basis, "average");
  assert.equal(pace.ratePerHour, 3); // 15% / 5 小时
  assert.equal(pace.usedPercent, 15);
  assert.equal(pace.remainingPercent, 85);
  // 剩 85%，每小时 3% → 约 28.3 小时用完
  assert.ok(Math.abs(pace.exhaustsInMs / 3_600_000 - 85 / 3) < 1e-6);
  // 距重置 1 小时，按速度会用到 15% + 3% = 18%
  assert.ok(Math.abs(pace.atResetPercent - 18) < 1e-6);
  assert.equal(pace.willExhaustBeforeReset, false);
});

test("estimatePace：有足够采样时用近期速度", () => {
  const now = 10_000_000_000;
  const win = {
    remainingPercent: 80,
    usedPercent: 20,
    startedAt: now - 4 * 3_600_000,
    resetsAt: now + 1 * 3_600_000,
  };
  // 采样点落在最近一小时内：86% → 80%，一小时掉 6 个点 → 6 %/小时
  const samples = [
    { t: now - 120 * 60_000, remainingPercent: 92 },
    { t: now - 60 * 60_000, remainingPercent: 86 },
    { t: now, remainingPercent: 80 },
  ];
  const pace = estimatePace(win, samples, now);
  assert.equal(pace.basis, "recent");
  assert.equal(pace.ratePerHour, 6);
  assert.ok(Math.abs(pace.exhaustsInMs / 3_600_000 - 80 / 6) < 1e-6);
  assert.ok(Math.abs(pace.atResetPercent - 26) < 1e-6);
});

test("estimatePace：采样跨度太短时退回窗口平均速度", () => {
  const now = 5_000_000_000;
  const win = { remainingPercent: 90, usedPercent: 10, startedAt: now - 4 * 3_600_000, resetsAt: now + 3_600_000 };
  // 两个采样只隔 1 分钟 → 推不出斜率
  const samples = [
    { t: now - 60_000, remainingPercent: 91 },
    { t: now, remainingPercent: 90 },
  ];
  const pace = estimatePace(win, samples, now);
  assert.equal(pace.basis, "average");
});

test("estimatePace：按速度会在重置前用完时给出告警", () => {
  const now = 2_000_000_000;
  const win = { remainingPercent: 10, usedPercent: 90, startedAt: now - 4 * 3_600_000, resetsAt: now + 30 * 60_000 };
  // 90% / 4 小时 = 22.5 %/小时；剩 10% → 27 分钟用完，而重置还有 30 分钟
  const pace = estimatePace(win, [], now);
  assert.equal(pace.willExhaustBeforeReset, true);
  assert.ok(pace.exhaustsInMs < 30 * 60_000);
  // 到重置时会用到 90 + 22.5*0.5 = 101.25%
  assert.ok(pace.atResetPercent > 100);
});

test("estimatePace：没有消耗时不编造耗尽时间", () => {
  const now = 3_000_000_000;
  const win = { remainingPercent: 100, usedPercent: 0, startedAt: now - 3_600_000, resetsAt: now + 3_600_000 };
  const pace = estimatePace(win, [], now);
  assert.equal(pace.ratePerHour, 0);
  assert.equal(pace.exhaustsInMs, undefined, "没有消耗就不该说「多久用完」");
  assert.equal(pace.atResetPercent, 0);
});

test("estimatePace：窗口刚开始时数据不足，返回未知的速度", () => {
  const now = 4_000_000_000;
  const win = { remainingPercent: 100, usedPercent: 0, startedAt: now - 60_000, resetsAt: now + 5 * 3_600_000 };
  const pace = estimatePace(win, [], now);
  assert.equal(pace.basis, "none");
  assert.equal(pace.ratePerHour, undefined);
  assert.equal(pace.exhaustsInMs, undefined);
});

test("两个窗口的曲线互不干扰：每周窗口用自己的采样，不会套上 5 小时的速度", () => {
  const now = 20_000_000_000;
  // 5 小时窗口：过去 30 分钟从 90% 掉到 80% → 20 %/小时
  const intervalWin = {
    key: "interval", remainingPercent: 80, usedPercent: 20,
    startedAt: now - 4 * 3_600_000, resetsAt: now + 1 * 3_600_000,
  };
  // 每周窗口：一周用掉 25 个点，窗口平均 ≈ 0.149 %/小时；最近一天掉 5 个点
  const weeklyWin = {
    key: "weekly", remainingPercent: 75, usedPercent: 25,
    startedAt: now - 7 * 24 * 3_600_000, resetsAt: now + 3 * 24 * 3_600_000,
  };
  const intervalSamples = [
    { t: now - 30 * 60_000, remainingPercent: 90 },
    { t: now, remainingPercent: 80 },
  ];
  const weeklySamples = [
    { t: now - 24 * 3_600_000, remainingPercent: 80 },
    { t: now, remainingPercent: 75 },
  ];

  const intervalPace = estimatePace(intervalWin, intervalSamples, now);
  const weeklyPace = estimatePace(weeklyWin, weeklySamples, now);

  assert.equal(intervalPace.ratePerHour, 20);
  assert.equal(weeklyPace.ratePerHour, 5 / 24);
  assert.ok(weeklyPace.ratePerHour < 1, "每周窗口的速率是个位数量级，不是 5 小时那个");

  // 若把 5 小时的采样错喂给每周窗口，就会得到 20 %/小时、并在 3 天后推出荒谬数字。
  const wrongPace = estimatePace(weeklyWin, intervalSamples, now);
  assert.equal(wrongPace.ratePerHour, 20, "这正是修复前的错误路径");
  assert.ok(wrongPace.atResetPercent > 1000, "错用采样会推出离谱的「重置时用到」百分比");
});
