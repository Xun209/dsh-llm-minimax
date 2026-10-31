/**
 * 宿主半边的端到端测试：用假的 settings / credentials / connection 服务驱动真实的 apply()，
 * 对 MiniMax **真实接口**走一遍「设置页粘贴 Key → 校验 → 存凭据 → 写路由 → 读额度」。
 *
 * 只有设置了 MINIMAX_TEST_KEY 时才跑联网部分；否则只跑离线部分。
 *   MINIMAX_TEST_KEY="$(cat /tmp/mm_test_token.txt)" node --test test/host.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { apply, CHANNEL } from "../lib/index.js";

const LIVE_KEY = process.env.MINIMAX_TEST_KEY;

function harness({ providers = {}, rpcHandleBroken = false } = {}) {
  const store = new Map();
  const state = { providers: structuredClone(providers), revision: 1, mutations: [] };
  const listeners = new Map();
  let rpcHandler;
  /** 通过 webServer 注册的路由（回退路径或 rpc.handle 的真实实现都会走这里）。 */
  const routes = [];

  const settings = {
    describe() {
      return [{ ns: "include:llm-pi-ai", value: { providers: structuredClone(state.providers) }, revision: state.revision }];
    },
    async mutate(ns, ops, revision) {
      assert.equal(ns, "include:llm-pi-ai");
      assert.equal(revision, state.revision, "写入必须带上 describe 给出的 revision");
      for (const op of ops) {
        assert.equal(op.op, "set");
        const [root, provider, field] = op.path;
        assert.equal(root, "providers");
        state.providers[provider] ??= {};
        state.providers[provider][field] = structuredClone(op.value);
      }
      state.mutations.push(ops);
      state.revision += 1;
      // 真实宿主在表单值变化后向所有人广播 settings/document-updated(ns, revision)。
      for (const fn of listeners.get("settings/document-updated") ?? []) fn(ns, state.revision);
      // 这个事件 Loader 只发给配置所属的 fiber（pi-ai 自己），本插件收不到；模拟也不发。
    },
  };
  const credentials = {
    async resolve(ref) {
      return store.has(ref) ? { value: store.get(ref), source: "store" } : undefined;
    },
    async describe(ref) {
      return { configured: store.has(ref), source: store.has(ref) ? "store" : undefined, writable: true };
    },
    async set(ref, value) {
      store.set(ref, value);
    },
    async unset(ref) {
      store.delete(ref);
    },
  };
  const webServer = {
    register(route) {
      routes.push(route);
      return () => {};
    },
  };
  // 模拟真实宿主：rpc.handle 的实现是 `owner.webServer.register(route)`，owner 是调用方的
  // scope。所以 handle 必须以 scope 为 this 调用，且 scope 里必须有 webServer，否则抛错 ——
  // 这正是线上出现 HTTP 405 的原因（只 inject 了 connection）。
  function makeConnection(owner) {
    return {
      rpc: {
        handle(channel, handler) {
          assert.equal(channel, CHANNEL);
          if (rpcHandleBroken) throw new Error("rpc.handle 在这个版本上不可用");
          if (owner.webServer === undefined) {
            throw new Error('cannot get required service "webServer" in inject');
          }
          rpcHandler = handler;
          owner.webServer.register({ kind: "prefix", path: channel, handler: "rpc.handle" });
          return () => {};
        },
      },
      requestRejection(req) {
        return req.headers["x-test-auth"] === "ok" ? undefined : 401;
      },
    };
  }
  const services = { settings, credentials, webServer };
  const emitted = [];
  const logs = [];
  const ctx = {
    logger: { info: (m) => logs.push(["info", m]), warn: (m) => logs.push(["warn", m]) },
    get: (key) => services[key],
    emit: (name) => emitted.push(name),
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
      return () => {};
    },
    effect: (fn) => fn(),
    inject(keys, fn) {
      const scope = { on: ctx.on, effect: ctx.effect };
      for (const key of keys) {
        scope[key] = key === "connection" ? makeConnection(scope) : services[key];
      }
      fn(scope);
    },
  };
  apply(ctx, {});
  const call = (endpoint, payload) => {
    assert.ok(rpcHandler !== undefined || routes.length > 0, "RPC 频道没有注册上");
    if (rpcHandler !== undefined) return rpcHandler(endpoint, payload, new AbortController().signal, {});
    return viaFallback(routes[0], endpoint, payload);
  };
  return { call, state, store, emitted, logs, routes, connection: makeConnection({ webServer }) };
}

/** 用一个假的 IncomingMessage / ServerResponse 驱动回退路由，返回解析后的 result。 */
async function viaFallback(route, endpoint, payload, { auth = "ok", rpcId = "r1" } = {}) {
  const body = Buffer.from(JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload }));
  const req = {
    method: "POST",
    url: `${CHANNEL}/${endpoint}`,
    headers: { "content-type": "application/json", "x-test-auth": auth },
    async *[Symbol.asyncIterator]() {
      yield body;
    },
  };
  const res = {
    status: 0,
    body: "",
    writeHead(status) {
      this.status = status;
    },
    end(text) {
      this.body = text ?? "";
    },
  };
  await route.handler(req, res);
  if (res.status !== 200) return { httpStatus: res.status, text: res.body };
  const envelope = JSON.parse(res.body);
  assert.equal(envelope.type, "server-response");
  assert.equal(envelope.rpcId, rpcId);
  return envelope.result;
}

test("RPC 频道注册上了：rpc.handle 拿得到 webServer（修复线上 HTTP 405）", () => {
  const h = harness();
  assert.equal(h.routes.length, 1, "频道应恰好注册一次");
  assert.equal(h.routes[0].path, CHANNEL);
  assert.equal(h.routes[0].handler, "rpc.handle", "正常版本走 connection.rpc.handle");
});

test("rpc.handle 不可用时退回 webServer 前缀路由，协议与鉴权保持一致", async () => {
  const h = harness({ rpcHandleBroken: true });
  assert.equal(h.routes.length, 1);
  const route = h.routes[0];
  assert.equal(typeof route.handler, "function", "回退路由是真实的 HTTP handler");

  const status = await viaFallback(route, "status", {});
  assert.equal(status.ok, true);
  assert.equal(status.value.regions[0].provider, "minimax-cn");

  const denied = await viaFallback(route, "status", {}, { auth: "nope" });
  assert.equal(denied.httpStatus, 401, "没有浏览器会话必须被拒");

  const unknown = await viaFallback(route, "nope", {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "gateway/not-found");
});

test("RPC 结果总是 { ok, value } / { ok: false, error } 信封", async () => {
  const h = harness();
  const status = await h.call("status", {});
  assert.equal(status.ok, true);
  assert.equal(status.value.regions.length, 2);
  assert.equal(status.value.regions[0].provider, "minimax-cn");
  assert.equal(status.value.regions[0].configured, false);

  const unknown = await h.call("nope", {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "gateway/not-found");
});

test("没有 Key 时额度为 no-key，且不发请求", async () => {
  const h = harness();
  const quota = await h.call("quota", {});
  assert.equal(quota.value.state, "no-key");
});

test("不像 Key 的输入在发请求前就被拒，凭据库不被写", async () => {
  const h = harness();
  const result = await h.call("saveKey", { key: "abc def ghi" });
  assert.equal(result.ok, true);
  assert.equal(result.value.saved, false);
  assert.equal(h.store.size, 0);
});

test("已有路由启动时自动对齐目录，并保留用户自己的字段和模型", async () => {
  const h = harness({
    providers: {
      "minimax-cn": {
        apiKeyEnv: "MY_MINIMAX_KEY",
        retryPolicy: { mode: "normal", maxRetries: 2 },
        models: [{ id: "MiniMax-M2.7" }, { id: "custom-1", name: "自定义" }],
      },
    },
  });
  // apply 里的对齐是异步的，等它落盘。
  await new Promise((r) => setTimeout(r, 20));
  const route = h.state.providers["minimax-cn"];
  assert.deepEqual(route.models.map((m) => m.id), ["MiniMax-M3.1-Flash", "MiniMax-M3", "custom-1"]);
  assert.equal(route.apiKeyEnv, "MY_MINIMAX_KEY", "用户自定义的凭据引用不能被覆盖");
  assert.deepEqual(route.retryPolicy, { mode: "normal", maxRetries: 2 }, "其它字段不能被动");
  assert.equal(h.state.mutations.length, 1, "写入后的 volatile-update 不应再触发第二次写入");
  assert.equal(h.state.providers.minimax, undefined, "没配置过的国际路由不能凭空创建");
});

test("按量付费 Key 的额度状态不发请求、如实说明", { skip: false }, async () => {
  const h = harness({ providers: { "minimax-cn": {} } });
  h.store.set("MINIMAX_CN_API_KEY", "sk-api-0000000000000000");
  const quota = await h.call("quota", { region: "cn" });
  assert.equal(quota.value.state, "payg");
  assert.equal(quota.value.keyKind, "payg");
  assert.match(quota.value.consoleUrl, /minimaxi\.com/);
  assert.equal(JSON.stringify(quota).includes("sk-api-0000000000000000"), false, "Key 不能出现在给浏览器的结果里");
});

test("联网：无效 Key 两个区域都校验失败，什么都不写", { skip: LIVE_KEY === undefined }, async () => {
  const h = harness();
  const result = await h.call("saveKey", { key: "sk-api-definitely-not-valid-000000" });
  assert.equal(result.value.saved, false);
  assert.match(result.value.detail, /MiniMax 国内/);
  assert.equal(h.store.size, 0);
  assert.deepEqual(h.state.providers, {});
});

test("联网：真实 Key 自动识别国内 → 存凭据 → 建路由 → 读到套餐额度", { skip: LIVE_KEY === undefined }, async () => {
  const h = harness();
  const saved = await h.call("saveKey", { key: "  " + LIVE_KEY + "\n", region: "auto" });
  assert.equal(saved.ok, true);
  assert.equal(saved.value.saved, true, JSON.stringify(saved.value));
  assert.equal(saved.value.region, "cn");
  assert.equal(saved.value.provider, "minimax-cn");
  assert.equal(saved.value.upstreamHasFlash, true, "上游 /v1/models 应包含 MiniMax-M3.1-Flash");
  assert.equal(JSON.stringify(saved).includes(LIVE_KEY), false, "Key 不能回传浏览器");

  assert.equal(h.store.get("MINIMAX_CN_API_KEY"), LIVE_KEY, "规整后的 Key 写进约定的凭据引用");
  const route = h.state.providers["minimax-cn"];
  assert.equal(route.apiKeyEnv, "MINIMAX_CN_API_KEY");
  assert.deepEqual(route.models.map((m) => m.id), ["MiniMax-M3.1-Flash", "MiniMax-M3"]);
  assert.ok(h.emitted.includes("llm/adapters-updated"));

  const status = await h.call("status", {});
  const cn = status.value.regions.find((r) => r.region === "cn");
  assert.equal(cn.configured, true);
  assert.equal(cn.credential.configured, true);
  assert.equal(cn.catalogCurrent, true);
  assert.equal(cn.keyHint, "••••" + LIVE_KEY.slice(-4));

  const quota = await h.call("quota", { force: true });
  assert.equal(quota.value.state, "plan", JSON.stringify(quota.value));
  const general = quota.value.buckets.find((b) => b.bucket === "general");
  assert.ok(general, "应有文本桶");
  const interval = general.windows.find((w) => w.key === "interval");
  assert.equal(interval.windowMs, 5 * 3_600_000);
  assert.ok(interval.remainingPercent >= 0 && interval.remainingPercent <= 100);

  const tested = await h.call("testKey", { region: "cn" });
  assert.equal(tested.value.ok, true);

  const cleared = await h.call("clearKey", { region: "cn" });
  assert.equal(cleared.value.cleared, true);
  assert.equal(h.store.has("MINIMAX_CN_API_KEY"), false);
  assert.equal((await h.call("quota", { region: "cn" })).value.state, "no-key");
});

test("联网：国内 Key 强制选国际区域会被拒（2049），不写入", { skip: LIVE_KEY === undefined }, async () => {
  const h = harness();
  const result = await h.call("saveKey", { key: LIVE_KEY, region: "intl" });
  assert.equal(result.value.saved, false);
  assert.match(result.value.detail, /区域/);
  assert.equal(h.store.size, 0);
});
