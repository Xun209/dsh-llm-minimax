/**
 * MiniMax 官方开放平台的静态事实表 + 纯函数。
 *
 * 只放「由官方文档或实测确认、不依赖网络」的事实，以及不碰宿主的纯逻辑，
 * 这样单测不需要宿主、不需要联网。
 *
 * 事实来源（2026-10-30 核对，带实测）：
 * - 模型清单 https://platform.minimax.io/docs/faq/models
 *   Available LLM 只有 MiniMax-M3.1-Flash 与 MiniMax-M3；M2.x 全系已 Retired。
 *   实测 GET https://api.minimaxi.com/v1/models 也把 M3.1-Flash 排在第一位。
 * - 端点：DSH 内置 `minimax-cn` 路由走 Anthropic 兼容端点 https://api.minimaxi.com/anthropic，
 *   内置 Anthropic SDK 发 `x-api-key`，实测 200。
 * - 思考（实测，Anthropic 协议）：
 *     M3.1-Flash  thinking.disabled → HTTP 400「requires adaptive thinking」；
 *                 adaptive + output_config.effort(low…max) → 200；省略 thinking → 200。
 *     M3          disabled / adaptive / 省略 → 均 200。
 * - 配额：GET /v1/token_plan/remains 失败也回 HTTP 200，结果在 base_resp.status_code。
 * - Key 校验：GET /v1/models，有效 Key → 200；无效 → 401；跨区域（国内 Key 打国际）→ 401 + 2049。
 */

/** 两个区域对应 DSH 内置的两条 pi-ai 目录路由。 */
export const ROUTES = {
  cn: {
    region: "cn",
    provider: "minimax-cn",
    displayName: "MiniMax 国内",
    /** 推理端点（pi-ai 目录自带，这里只用于展示）。 */
    baseURL: "https://api.minimaxi.com/anthropic",
    /** 配额与 Key 校验用的 API 根。 */
    apiRoot: "https://api.minimaxi.com",
    /** 凭据引用名：与 DSH「设置 → 模型」页派生的 `<ROUTE>_API_KEY` 一致。 */
    env: "MINIMAX_CN_API_KEY",
    keyConsole: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    balanceConsole: "https://platform.minimaxi.com/user-center/payment/balance",
  },
  intl: {
    region: "intl",
    provider: "minimax",
    displayName: "MiniMax 国际",
    baseURL: "https://api.minimax.io/anthropic",
    apiRoot: "https://api.minimax.io",
    env: "MINIMAX_API_KEY",
    keyConsole: "https://platform.minimax.io/user-center/basic-information/interface-key",
    balanceConsole: "https://platform.minimax.io/user-center/payment/balance",
  },
};

/** 区域的优先顺序：自动识别与「当前区域」都先看国内。 */
export const REGIONS = ["cn", "intl"];

/**
 * 当前有效的模型目录。
 *
 * 上下文 1,000,000 与最大输出 524,288 来自官方 max_tokens 说明：「M3.1-Flash 与 M3
 * 推荐 131072、最大 524288」。maxTokens 取推荐值：DSH 把它当默认输出上限，取上限
 * 会让每个请求都申请远超所需的输出额度。
 *
 * reasoningEfforts 的语义（pi-ai）：键是选择器档位，值是发上线的字符串；
 * `off: null` 表示「提供关闭档」，不写 off 表示「不提供关闭档」。
 */
export const MODELS = [
  {
    id: "MiniMax-M3.1-Flash",
    name: "MiniMax-M3.1-Flash",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    input: ["text", "image"],
    // 始终思考、无法关闭（disabled 会 400），所以**不提供 off 档**。
    reasoningEfforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
    note: "1M 上下文 · 始终思考，深度可调 · 当前主力",
  },
  {
    id: "MiniMax-M3",
    name: "MiniMax-M3",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    input: ["text", "image"],
    // 自适应思考，可以关闭。
    reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
    note: "1M 上下文 · 自适应思考，可关闭",
  },
];

/**
 * 已退役模型。官方公告：2026-10-19 起对新用户关闭，2026-11-18 正式退役；
 * M Plan 下旧名字自动路由到 M3.1 Flash，按量付费请求退役后会失败。
 * 不写进目录，只用于提示，以及从用户目录里清掉它们。
 */
export const RETIRED_MODELS = [
  { id: "MiniMax-M2.7", retiredOn: "2026-11-18" },
  { id: "MiniMax-M2.7-highspeed", retiredOn: "2026-11-18" },
  { id: "MiniMax-M2.5", retiredOn: "2026-11-18" },
  { id: "MiniMax-M2.5-highspeed", retiredOn: "2026-11-18" },
];

/** 本插件认得的全部 id：这些 id 由本插件管理，其余 id 视为用户自己加的，原样保留。 */
export const KNOWN_MODEL_IDS = new Set([...MODELS.map((m) => m.id), ...RETIRED_MODELS.map((m) => m.id)]);

/**
 * 可选上下文预算。
 *
 * 官方两个模型都支持 1M 上下文，但**上下文不是免费**的：
 *   - 越大越容易在单请求里塞进更多历史 → 更贵、更慢；
 *   - MiniMax-M3 在 **512K 输入**处价格分档（超过后输入/输出单价翻倍），其他档位同理；
 *   - DSH 按 contextWindow 决定何时压缩历史，调小等于更早压缩、更省。
 * 所以这里给的是「DSH 侧愿意用多大窗口」，而不是模型能力上限。
 */
export const CONTEXT_OPTIONS = [
  { id: 200_000, label: "200K", note: "最省，适合日常对话" },
  { id: 512_000, label: "512K", note: "M3 的价格分档线" },
  { id: 1_000_000, label: "1M", note: "模型上限，长文档与大型代码库" },
];

/** 默认 1M：与模型能力一致，避免用户还没选就被悄悄限流。 */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;

/** 把任意输入规整成一档合法值；不认识就用默认。 */
export function normalizeContextWindow(value) {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_CONTEXT_WINDOW;
  // 精确命中优先；否则取不超过它的最大档位（用户若手填 400000，落到 200K 更安全）。
  const exact = CONTEXT_OPTIONS.find((option) => option.id === n);
  if (exact !== undefined) return exact.id;
  const lower = [...CONTEXT_OPTIONS].reverse().find((option) => option.id <= n);
  return lower === undefined ? DEFAULT_CONTEXT_WINDOW : lower.id;
}

/**
 * 写进 `llm-pi-ai.providers[<route>].models` 的条目。
 *
 * `compat.forceAdaptiveThinking`：pi-ai 对目录外的 Anthropic 模型默认走「预算式思考」
 * （thinking.enabled + budget_tokens），选择器里的档位到不了服务端。打开它后 pi-ai 改发
 * `thinking: {type: "adaptive"}` + `output_config.effort`，档位真正生效（已实测 200）。
 *
 * @param contextWindow - 生效的上下文预算；省略用默认。
 */
export function piAiModelEntries(contextWindow = DEFAULT_CONTEXT_WINDOW) {
  const window = normalizeContextWindow(contextWindow);
  return MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    contextWindow: window,
    maxTokens: m.maxTokens,
    input: [...m.input],
    reasoningEfforts: { ...m.reasoningEfforts },
    compat: { forceAdaptiveThinking: true },
  }));
}

/**
 * 目标目录 = 本插件管理的模型 + 用户自己加的其它模型（原样保留，排在后面）。
 * 已退役的 id 被丢掉；本插件管理的 id 用当前定义覆盖。
 *
 * @param current - 已存的目录。
 * @param contextWindow - 生效的上下文预算；省略时沿用已存的值，再退回默认。
 *   这样用户自己在「设置 → 模型」里改过的容量不会被启动时的自动对齐抹掉。
 */
export function mergeModels(current, contextWindow) {
  const extras = Array.isArray(current)
    ? current.filter(
        (entry) =>
          entry !== null && typeof entry === "object" && typeof entry.id === "string" && !KNOWN_MODEL_IDS.has(entry.id),
      )
    : [];
  return [...piAiModelEntries(windowToApply(current, contextWindow)), ...extras];
}

/**
 * 决定这次写入用哪个上下文：显式传入 > 已存目录里的值 > 默认。
 * 已存值取第一个托管模型的 contextWindow —— 本插件总是把所有模型写成同一档。
 */
function windowToApply(current, explicit) {
  if (explicit !== undefined) return normalizeContextWindow(explicit);
  const managed = Array.isArray(current)
    ? current.find((entry) => entry !== null && typeof entry === "object" && KNOWN_MODEL_IDS.has(entry.id))
    : undefined;
  return managed?.contextWindow === undefined
    ? DEFAULT_CONTEXT_WINDOW
    : normalizeContextWindow(managed.contextWindow);
}

/**
 * 已存的目录是否已经等于目标目录。
 *
 * 读回来的值经过 schema 物化（空字典会变成 `{}`、缺省数组会变成 `[]`），所以只比较本插件
 * 关心的字段，否则每次启动都会判定「不同」并白写一次设置。
 */
export function catalogUpToDate(current, contextWindow) {
  if (!Array.isArray(current)) return false;
  const desired = mergeModels(current, contextWindow);
  if (current.length !== desired.length) return false;
  return desired.every((entry, index) =>
    KNOWN_MODEL_IDS.has(entry.id) ? sameManagedEntry(current[index], entry) : current[index] === entry,
  );
}

function sameManagedEntry(actual, expected) {
  if (actual === null || typeof actual !== "object") return false;
  return (
    actual.id === expected.id &&
    (actual.name ?? actual.id) === expected.name &&
    actual.contextWindow === expected.contextWindow &&
    actual.maxTokens === expected.maxTokens &&
    sameList(actual.input, expected.input) &&
    sameEfforts(actual.reasoningEfforts, expected.reasoningEfforts) &&
    actual.compat?.forceAdaptiveThinking === expected.compat.forceAdaptiveThinking
  );
}

function sameList(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameEfforts(a, b) {
  if (a === null || typeof a !== "object") return false;
  const keysA = Object.keys(a).filter((key) => a[key] !== undefined);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysB.every((key) => key in a && (a[key] ?? null) === (b[key] ?? null));
}

/** 配额桶名；general 是文本/编码池，video 是视频池。 */
export const QUOTA_BUCKETS = { general: "文本", video: "视频" };

/**
 * 规整用户粘贴进来的 Key：去掉首尾空白、`Bearer ` 前缀和成对引号。
 * 返回 undefined 表示「不像一把 Key」（空串或带内部空白）。
 */
export function normalizeKey(raw) {
  if (typeof raw !== "string") return undefined;
  let key = raw.trim();
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, "").trim();
  if (key.length >= 2 && ((key[0] === '"' && key.at(-1) === '"') || (key[0] === "'" && key.at(-1) === "'"))) {
    key = key.slice(1, -1).trim();
  }
  if (key.length < 8 || /\s/.test(key)) return undefined;
  return key;
}

/**
 * 仅凭 Key 前缀判断计费形态 —— 零网络请求。
 * 官方：M Plan Key 为 `sk-cp-`，按量付费 Key 为 `sk-api-`，分开计费、不可互换。
 * 其它形态（例如账号级 JWT）无法从字面判断，交给实际响应。
 */
export function keyKindOf(key) {
  if (typeof key !== "string" || key.length === 0) return "unknown";
  if (key.startsWith("sk-cp-")) return "plan";
  if (key.startsWith("sk-api-")) return "payg";
  return "unknown";
}

/** 只露出末 4 位，供界面区分「是哪一把 Key」。 */
export function keyHintOf(key) {
  if (typeof key !== "string" || key.length < 8) return "••••";
  return "••••" + key.slice(-4);
}

/**
 * 把 `/v1/token_plan/remains` 的一个 model_remains 桶投影成窗口。
 *
 * 三个必须做对的语义（每个做错都会让面板撒谎）：
 *   1. `*_remaining_percent` 是**剩余**，不是已用 —— 要反相；
 *   2. 区间长度按 start/end 实算（general 5 小时、video 24 小时），不能写死；
 *   3. 「不在套餐内」的桶：两窗口 status 都是 3、总量 0、剩余 100% —— 看似全新额度，必须丢弃。
 */
export function projectBucket(bucket) {
  if (bucket === null || typeof bucket !== "object") return null;
  const name = typeof bucket.model_name === "string" ? bucket.model_name : "unknown";
  const start = num(bucket.start_time);
  const end = num(bucket.end_time);
  const weeklyStart = num(bucket.weekly_start_time);
  const weeklyEnd = num(bucket.weekly_end_time);

  const notInPlan =
    num(bucket.current_interval_total_count) === 0 &&
    num(bucket.current_weekly_total_count) === 0 &&
    num(bucket.current_interval_status) === 3 &&
    num(bucket.current_weekly_status) === 3;
  if (notInPlan) return null;

  const windows = [];
  const intervalRemaining = num(bucket.current_interval_remaining_percent);
  if (intervalRemaining !== undefined) {
    windows.push(windowOf("interval", intervalLabel(name, start, end), intervalRemaining, start, end));
  }
  const weeklyRemaining = num(bucket.current_weekly_remaining_percent);
  if (weeklyRemaining !== undefined) {
    windows.push(windowOf("weekly", "每周", weeklyRemaining, weeklyStart, weeklyEnd));
  }
  if (windows.length === 0) return null;
  return { bucket: name, bucketLabel: QUOTA_BUCKETS[name] ?? name, windows };
}

function windowOf(key, label, remaining, start, end) {
  const remainingPercent = clampPercent(remaining);
  return {
    key,
    label,
    remainingPercent,
    usedPercent: 100 - remainingPercent,
    resetsAt: end,
    windowMs: start !== undefined && end !== undefined && end > start ? end - start : undefined,
  };
}

function intervalLabel(bucketName, start, end) {
  const bucketLabel = QUOTA_BUCKETS[bucketName] ?? bucketName;
  if (start === undefined || end === undefined || end <= start) return `${bucketLabel} 区间`;
  return `${bucketLabel} ${Math.round((end - start) / 3_600_000)} 小时`;
}

function num(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * 从 MiniMax 响应里取出失败语义。两种信封都认：
 *   - 配额/原生接口：HTTP 200 + `base_resp.status_code != 0`
 *   - /v1/* 与 /anthropic/*：`{ error: { type, message } }`，message 末尾常带「(2049)」
 * 返回 undefined 表示响应体本身不是失败。
 */
export function failureOf(body) {
  if (body === null || typeof body !== "object") return undefined;
  const status = num(body?.base_resp?.status_code);
  let code = status !== undefined && status !== 0 ? status : undefined;
  let message = typeof body?.base_resp?.status_msg === "string" ? body.base_resp.status_msg : "";
  if (code === undefined && body.error !== null && typeof body.error === "object") {
    message = typeof body.error.message === "string" ? body.error.message : "";
    const bracket = /\((\d{3,5})\)\s*$/.exec(message);
    code = bracket ? Number(bracket[1]) : -1;
  }
  if (code === undefined) return undefined;
  if (code === 2062) {
    // 官方：查询用量时，2062 也表示「没有生效中的 M Plan 订阅」。
    return { kind: "no-plan", code, message: "没有生效中的 M Plan / Token Plan 订阅" };
  }
  if (code === 2049) return { kind: "auth", code, message: "Key 无效，或不属于这个区域（国内与国际的 Key 不通用）" };
  if (code === 1004) return { kind: "auth", code, message: "Key 被拒绝：已失效、已删除或填写有误" };
  if (code === 1008) return { kind: "balance", code, message: "账户余额不足" };
  return { kind: "error", code, message: message || `MiniMax 返回错误（${code}）` };
}
