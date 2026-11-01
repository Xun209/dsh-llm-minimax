/**
 * dsh-llm-minimax —— 浏览器半边。
 *
 *   1. 设置 → MiniMax：**直接在页面里粘贴 Key**（自动识别国内 / 国际、先校验再保存），
 *      看模型目录与套餐额度。不需要去改任何配置文件。
 *   2. 输入框工具栏的小标记：有套餐额度时显示文本 5 小时窗口的剩余百分比。
 *   3. 「设置 → 模型」里 MiniMax 卡片下方的一行说明，指回本页。
 *
 * 不实现模型选择器：DSH 的选择器本来就按 provider 分组渲染，`minimax-cn` 路由存在且目录
 * 正确，它就会出现在列表里。Key 只经由宿主写进凭据库，浏览器只拿回末 4 位。
 */

window.__ModuleLoader__.load({
  id: "dsh-llm-minimax",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    const CHANNEL = "/llm-minimax";
    const POLL_MS = 60_000;
    const QUOTA_EVENT = "dsh-llm-minimax:changed";

    // ---------- RPC ----------

    /** 统一返回 `{ ok: true, value }` 或 `{ ok: false, message }`，从不抛。 */
    function call(api, endpoint, payload) {
      const rpc = api && api.connection && api.connection.rpc;
      if (!rpc || typeof rpc.call !== "function") {
        return Promise.resolve({ ok: false, message: "与宿主的连接不可用" });
      }
      return rpc.call(CHANNEL, endpoint, payload === undefined ? {} : payload).then(
        function (result) {
          if (result && result.ok === true) return { ok: true, value: result.value };
          const error = result && result.error;
          return { ok: false, message: (error && error.message) || "请求失败" };
        },
        function (error) {
          return { ok: false, message: (error && error.message) || String(error) };
        }
      );
    }

    /** Key 保存 / 清除后通知页面里其它部件（工具栏标记）立即刷新。 */
    function announceChange() {
      window.dispatchEvent(new CustomEvent(QUOTA_EVENT));
    }

    // ---------- 数据 hooks ----------

    function useQuota(api, region) {
      const [quota, setQuota] = React.useState(null);
      const [pending, setPending] = React.useState(false);
      const alive = React.useRef(true);

      const load = React.useCallback(
        function (force) {
          setPending(true);
          return call(api, "quota", { region: region, force: force === true }).then(function (result) {
            if (!alive.current) return;
            setPending(false);
            if (result.ok) setQuota(result.value);
          });
        },
        [api, region]
      );

      React.useEffect(
        function () {
          alive.current = true;
          void load(false);
          const timer = window.setInterval(function () {
            if (document.visibilityState === "visible") void load(false);
          }, POLL_MS);
          const onChange = function () {
            void load(true);
          };
          window.addEventListener(QUOTA_EVENT, onChange);
          return function () {
            alive.current = false;
            window.clearInterval(timer);
            window.removeEventListener(QUOTA_EVENT, onChange);
          };
        },
        [load]
      );

      return { quota: quota, pending: pending, reload: load };
    }

    function useStatus(api) {
      const [status, setStatus] = React.useState(null);
      const [error, setError] = React.useState(null);
      const reload = React.useCallback(
        function () {
          return call(api, "status", {}).then(function (result) {
            if (result.ok) {
              setStatus(result.value);
              setError(null);
            } else {
              setError(result.message);
            }
          });
        },
        [api]
      );
      React.useEffect(
        function () {
          void reload();
          const onChange = function () {
            void reload();
          };
          window.addEventListener(QUOTA_EVENT, onChange);
          return function () {
            window.removeEventListener(QUOTA_EVENT, onChange);
          };
        },
        [reload]
      );
      return { status: status, error: error, reload: reload };
    }

    // ---------- 样式（只用宿主主题 token） ----------

    const C = {
      text: "var(--dsw-alias-label-primary)",
      sub: "var(--dsw-alias-label-secondary)",
      border: "var(--dsw-alias-border-l1)",
      borderStrong: "var(--dsw-alias-border-l2)",
      layer: "var(--dsw-alias-bg-layer-1)",
      layer2: "var(--dsw-alias-bg-layer-2)",
      brand: "var(--dsw-alias-brand-primary)",
      ok: "var(--dsw-alias-state-success-primary)",
      warn: "var(--dsw-alias-state-warn-primary)",
      error: "var(--dsw-alias-state-error-primary)",
      idle: "var(--dsw-alias-state-idle-primary)",
    };

    const S = {
      page: { display: "flex", flexDirection: "column", gap: 16, color: C.text, fontSize: 13, lineHeight: 1.5 },
      intro: { color: C.sub, fontSize: 13 },
      card: {
        border: "1px solid " + C.border,
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: C.layer,
      },
      head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
      title: { fontSize: 14, fontWeight: 600 },
      sub: { color: C.sub, fontSize: 12 },
      mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 },
      row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
      input: {
        flex: "1 1 260px",
        minWidth: 0,
        height: 32,
        padding: "0 10px",
        borderRadius: 8,
        border: "1px solid " + C.borderStrong,
        background: C.layer2,
        color: C.text,
        fontSize: 13,
        outline: "none",
      },
      select: {
        height: 32,
        padding: "0 8px",
        borderRadius: 8,
        border: "1px solid " + C.borderStrong,
        background: C.layer2,
        color: C.text,
        fontSize: 13,
      },
      primary: {
        height: 32,
        padding: "0 14px",
        borderRadius: 8,
        border: "1px solid " + C.brand,
        background: C.brand,
        color: "#fff",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      },
      button: {
        height: 28,
        padding: "0 10px",
        borderRadius: 8,
        border: "1px solid " + C.borderStrong,
        background: "transparent",
        color: C.text,
        fontSize: 12,
        cursor: "pointer",
      },
      link: { color: C.brand, fontSize: 12, textDecoration: "none" },
      dot: function (color) {
        return { width: 8, height: 8, borderRadius: 999, background: color, flex: "none", display: "inline-block" };
      },
      track: { height: 6, borderRadius: 999, background: C.layer2, overflow: "hidden", border: "1px solid " + C.border },
    };

    function disabledStyle(style, disabled) {
      return disabled ? Object.assign({}, style, { opacity: 0.55, cursor: "default" }) : style;
    }

    function colorForRemaining(remaining) {
      if (typeof remaining !== "number") return C.idle;
      if (remaining <= 10) return C.error;
      if (remaining <= 30) return C.warn;
      return C.ok;
    }

    function countdown(resetsAt) {
      if (typeof resetsAt !== "number") return "";
      const ms = resetsAt - Date.now();
      if (!(ms > 0)) return "即将重置";
      const minutes = Math.floor(ms / 60000);
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      const rest = minutes % 60;
      if (days > 0) return days + " 天 " + hours + " 小时后重置";
      if (hours > 0) return hours + " 小时 " + rest + " 分后重置";
      return Math.max(1, rest) + " 分钟后重置";
    }

    const KEY_KIND_LABEL = { plan: "M Plan 订阅 Key", payg: "按量付费 Key", unknown: "账号 Key" };

    // ---------- 部件 ----------

    function Notice(props) {
      if (!props.note) return null;
      const color = props.note.tone === "ok" ? C.ok : props.note.tone === "error" ? C.error : C.warn;
      return h(
        "div",
        { role: "status", style: { fontSize: 12, color: color, display: "flex", flexDirection: "column", gap: 2 } },
        h("span", null, props.note.text),
        props.note.detail ? h("span", { style: { color: C.sub } }, props.note.detail) : null
      );
    }

    function KeyCard(props) {
      const api = props.api;
      const status = props.status;
      const regions = (status && status.regions) || [];
      const active = regions.filter(function (r) {
        return r.credential && r.credential.configured;
      });

      const [draft, setDraft] = React.useState("");
      const [region, setRegion] = React.useState("auto");
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState(null);
      const [editing, setEditing] = React.useState(false);

      const showForm = editing || active.length === 0;

      function save() {
        if (busy || draft.trim().length === 0) return;
        setBusy(true);
        setNote({ tone: "warn", text: "正在校验 Key…" });
        void call(api, "saveKey", { key: draft, region: region }).then(function (result) {
          setBusy(false);
          if (!result.ok) {
            setNote({ tone: "error", text: "保存失败：" + result.message });
            return;
          }
          const value = result.value;
          if (!value.saved) {
            setNote({ tone: "error", text: value.message, detail: value.detail });
            return;
          }
          setDraft("");
          setEditing(false);
          setNote({
            tone: "ok",
            text:
              "已保存到 " + value.displayName + "（" + value.keyHint + "）。模型选择器里现在可以选 " + value.models.join("、") + "。",
            detail: value.routeOk ? undefined : "注意：模型目录未写入（" + value.routeMessage + "），可在下方点「补写模型目录」。",
          });
          announceChange();
          props.onChanged();
        });
      }

      function clear(r) {
        if (busy) return;
        if (!window.confirm("确定删除本插件在凭据库里保存的 " + r.displayName + " Key 吗？")) return;
        setBusy(true);
        void call(api, "clearKey", { region: r.region }).then(function (result) {
          setBusy(false);
          if (!result.ok) {
            setNote({ tone: "error", text: "删除失败：" + result.message });
          } else {
            const value = result.value;
            if (value.stillActive) {
              // 删掉了库里那份，但环境变量那一层还在生效 —— 必须说清楚，
              // 不能让用户以为已经删干净了（这正是之前的 bug）。
              setNote({
                tone: "warn",
                text: value.removedFromStore
                  ? "已删除本插件保存的那份 Key，但它仍来自环境变量，所以还在生效。"
                  : "这把 Key 来自环境变量，不是本插件保存的，无法在这里删除。",
                detail:
                  "要彻底停用它，请从 shell 配置（如 ~/.zshrc 里的 " +
                  (r.credentialRef || "MINIMAX_API_KEY") +
                  "）或 DSH 的 .env 中移除，然后重启 DSH。",
              });
            } else if (value.cleared) {
              setNote({ tone: "ok", text: "已删除 " + r.displayName + " 的 Key。" });
            } else {
              setNote({ tone: "warn", text: value.message || "没有可删除的 Key。" });
            }
          }
          announceChange();
          props.onChanged();
        });
      }

      function test(r) {
        if (busy) return;
        setBusy(true);
        setNote({ tone: "warn", text: "正在测试 " + r.displayName + "…" });
        void call(api, "testKey", { region: r.region }).then(function (result) {
          setBusy(false);
          const value = result.ok ? result.value : { ok: false, message: result.message };
          setNote({ tone: value.ok ? "ok" : "error", text: r.displayName + "：" + value.message });
        });
      }

      return h(
        "div",
        { style: S.card },
        h(
          "div",
          { style: S.head },
          h("span", { style: S.title }, "API Key"),
          active.length > 0 && !showForm
            ? h(
                "button",
                { type: "button", style: S.button, onClick: function () { setEditing(true); setNote(null); } },
                "更换 / 添加 Key"
              )
            : null
        ),

        active.map(function (r) {
          // 环境变量来的 Key 删不掉（删了会立刻回落到环境变量），所以不给「删除」按钮，
          // 只把来源说清楚，避免出现「点了删除、状态说已删、Key 还在用」。
          const fromEnv = r.fromEnvironment === true;
          return h(
            "div",
            { key: r.region, style: Object.assign({}, S.row, { justifyContent: "space-between" }) },
            h(
              "div",
              { style: S.row },
              h("span", { style: S.dot(C.ok) }),
              h("span", null, r.displayName),
              h("span", { style: S.mono }, r.keyHint || "已配置"),
              r.keyKind ? h("span", { style: S.sub }, KEY_KIND_LABEL[r.keyKind] || "") : null,
              fromEnv
                ? h("span", { style: S.sub }, "来自环境变量 " + (r.credentialRef || ""))
                : r.storedInCredentialStore
                  ? null
                  : h("span", { style: S.sub }, "来源：" + (r.keySource || r.credential.source || "未知"))
            ),
            h(
              "div",
              { style: S.row },
              h(
                "button",
                { type: "button", style: disabledStyle(S.button, busy), disabled: busy, onClick: function () { test(r); } },
                "测试连接"
              ),
              fromEnv
                ? h(
                    "span",
                    {
                      style: Object.assign({}, S.sub, { maxWidth: 220 }),
                      title:
                        "这把 Key 来自环境变量，本插件无法删除。要停用它请从 shell 配置或 DSH 的 .env 中移除后重启。",
                    },
                    "环境变量提供，无法在此删除"
                  )
                : h(
                    "button",
                    { type: "button", style: disabledStyle(S.button, busy), disabled: busy, onClick: function () { clear(r); } },
                    "删除"
                  )
            )
          );
        }),

        showForm
          ? h(
              "form",
              {
                style: { display: "flex", flexDirection: "column", gap: 8 },
                onSubmit: function (event) {
                  event.preventDefault();
                  save();
                },
              },
              h(
                "div",
                { style: S.row },
                h("input", {
                  type: "password",
                  value: draft,
                  autoComplete: "off",
                  spellCheck: false,
                  placeholder: "粘贴 MiniMax API Key（sk-cp- / sk-api- / 账号 Key 均可）",
                  "aria-label": "MiniMax API Key",
                  style: S.input,
                  onChange: function (event) {
                    setDraft(event.target.value);
                  },
                }),
                h(
                  "select",
                  {
                    value: region,
                    "aria-label": "区域",
                    style: S.select,
                    onChange: function (event) {
                      setRegion(event.target.value);
                    },
                  },
                  h("option", { value: "auto" }, "自动识别区域"),
                  h("option", { value: "cn" }, "国内 api.minimaxi.com"),
                  h("option", { value: "intl" }, "国际 api.minimax.io")
                ),
                h(
                  "button",
                  { type: "submit", style: disabledStyle(S.primary, busy || draft.trim().length === 0), disabled: busy || draft.trim().length === 0 },
                  busy ? "校验中…" : "校验并保存"
                ),
                active.length > 0
                  ? h("button", { type: "button", style: S.button, onClick: function () { setEditing(false); setDraft(""); setNote(null); } }, "取消")
                  : null
              ),
              h(
                "div",
                { style: S.sub },
                "Key 会先用 GET /v1/models 校验，通过后保存到本机凭据库（$DSH_HOME/.credentials.yaml），不会写进配置文件，也不会回传到浏览器。还没有 Key？",
                h("a", { href: "https://platform.minimaxi.com/user-center/basic-information/interface-key", target: "_blank", rel: "noreferrer", style: S.link }, " 去 MiniMax 控制台创建 ↗")
              )
            )
          : null,

        h(Notice, { note: note })
      );
    }

    function WindowBar(props) {
      const win = props.window;
      const remaining = win.remainingPercent;
      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 4 } },
        h(
          "div",
          { style: S.head },
          h("span", { style: { fontSize: 12 } }, win.label),
          h("span", { style: Object.assign({}, S.sub, S.mono) }, "剩余 " + remaining + "% · " + countdown(win.resetsAt))
        ),
        h(
          "div",
          { style: S.track },
          h("div", { style: { width: Math.max(2, remaining) + "%", height: "100%", background: colorForRemaining(remaining), borderRadius: 999 } })
        )
      );
    }

    function QuotaCard(props) {
      const { quota, pending, reload } = useQuota(props.api);
      const state = quota ? quota.state : null;
      const pill = {
        plan: ["套餐额度", C.ok],
        payg: ["按量付费", C.brand],
        "no-key": ["未配置 Key", C.idle],
        error: ["读取失败", C.error],
      }[state] || ["读取中", C.idle];

      return h(
        "div",
        { style: S.card },
        h(
          "div",
          { style: S.head },
          h("span", { style: S.title }, "额度"),
          h(
            "div",
            { style: S.row },
            h("span", { style: S.dot(pill[1]) }),
            h("span", { style: S.sub }, pill[0] + (quota && quota.provider && state !== "no-key" ? " · " + quota.provider : "")),
            h("button", { type: "button", style: disabledStyle(S.button, pending), disabled: pending, onClick: function () { void reload(true); } }, pending ? "读取中…" : "刷新")
          )
        ),
        state === "plan"
          ? quota.buckets.map(function (bucket) {
              return h(
                "div",
                { key: bucket.bucket, style: { display: "flex", flexDirection: "column", gap: 8 } },
                quota.buckets.length > 1 ? h("span", { style: { fontSize: 12, fontWeight: 600 } }, bucket.bucketLabel) : null,
                bucket.windows.map(function (win) {
                  return h(WindowBar, { key: win.key, window: win });
                })
              );
            })
          : null,
        state === "payg"
          ? h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 4 } },
              h("span", null, quota.message),
              h("span", { style: S.sub }, quota.detail),
              h("a", { href: quota.consoleUrl, target: "_blank", rel: "noreferrer", style: S.link }, "打开 MiniMax 控制台查看余额 ↗")
            )
          : null,
        state === "no-key" ? h("span", { style: S.sub }, "在上方填入 Key 后显示额度。") : null,
        state === "error"
          ? h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 2 } },
              h("span", { style: { color: C.error } }, quota.message),
              quota.detail ? h("span", { style: S.sub }, String(quota.detail)) : null
            )
          : null,
        h(
          "span",
          { style: S.sub },
          "MiniMax 只为 M Plan / Token Plan 提供额度接口（GET /v1/token_plan/remains）。按量付费 Key 没有公开的余额接口，本插件不会编造数字。"
        )
      );
    }

    function CatalogCard(props) {
      const api = props.api;
      const status = props.status;
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState(null);
      const models = (status && status.models) || [];
      const retired = (status && status.retired) || [];
      const configured = ((status && status.regions) || []).filter(function (r) {
        return r.configured;
      });
      const options = (status && status.contextOptions) || [];
      // 已配置区域里的生效值；两个区域本插件总写成同一档，取第一个有值的。
      const current = (function () {
        for (let i = 0; i < configured.length; i += 1) {
          if (typeof configured[i].contextWindow === "number") return configured[i].contextWindow;
        }
        return undefined;
      })();
      const currentLabel = (function () {
        for (let i = 0; i < options.length; i += 1) {
          if (options[i].id === current) return options[i].label;
        }
        return current === undefined ? "" : String(Math.round(current / 1000)) + "K";
      })();

      function sync(r) {
        setBusy(true);
        void call(api, "sync", { region: r.region }).then(function (result) {
          setBusy(false);
          const value = result.ok ? result.value : { ok: false, reason: result.message };
          setNote(
            value.ok
              ? { tone: "ok", text: value.changed ? r.displayName + "：模型目录已更新。" : r.displayName + "：模型目录已是当前版本。" }
              : { tone: "error", text: r.displayName + "：" + value.reason }
          );
          props.onChanged();
        });
      }

      return h(
        "div",
        { style: S.card },
        h("span", { style: S.title }, "模型目录"),
        // 上下文预算：两个模型都支持 1M，但窗口越大越贵越慢（M3 在 512K 输入处分价格档），
        // 调小等于让 DSH 更早压缩历史。选项来自宿主，不在浏览器里写死。
        h(
          "div",
          { style: { borderTop: "1px solid " + C.border, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 } },
          h(
            "div",
            { style: S.head },
            h("span", { style: { fontSize: 12, fontWeight: 600 } }, "上下文大小"),
            h(
              "span",
              { style: S.sub },
              current === undefined ? "尚未生效" : "当前 " + currentLabel
            )
          ),
          h(
            "div",
            { style: S.row },
            options.map(function (option) {
              const selected = option.id === current;
              return h(
                "button",
                {
                  key: option.id,
                  type: "button",
                  title: option.note,
                  style: disabledStyle(
                    Object.assign({}, S.button, selected ? { borderColor: C.brand, color: C.brand, fontWeight: 600 } : {}),
                    busy || selected || configured.length === 0
                  ),
                  disabled: busy || selected || configured.length === 0,
                  onClick: function () {
                    setBusy(true);
                    setNote(null);
                    void call(api, "setContext", { contextWindow: option.id }).then(function (result) {
                      setBusy(false);
                      if (!result.ok) {
                        setNote({ tone: "error", text: "设置失败：" + result.message });
                        return;
                      }
                      const value = result.value;
                      const changed = (value.results || []).some(function (r) { return r.changed; });
                      setNote({
                        tone: "ok",
                        text: changed
                          ? "已切换到 " + option.label + " 上下文，新会话生效；已有会话在下次压缩后跟上。"
                          : "已经是 " + option.label + " 上下文，无需改动。",
                      });
                      props.onChanged();
                    });
                  },
                },
                option.label
              );
            })
          ),
          h(
            "span",
            { style: S.sub },
            "窗口越大越贵越慢；MiniMax-M3 在 512K 输入以上按更高单价计费。调小只会让 DSH 更早压缩历史，不影响模型本身的能力。"
          )
        ),
        models.map(function (m) {
          return h(
            "div",
            { key: m.id, style: Object.assign({}, S.head, { alignItems: "baseline" }) },
            h("span", { style: S.mono }, m.id),
            h("span", { style: S.sub }, m.note)
          );
        }),
        configured.map(function (r) {
          return h(
            "div",
            { key: r.region, style: Object.assign({}, S.head, { borderTop: "1px solid " + C.border, paddingTop: 8 }) },
            h(
              "div",
              { style: S.row },
              h("span", { style: S.dot(r.catalogCurrent ? C.ok : C.warn) }),
              h("span", null, r.displayName + "（" + r.provider + "）"),
              h("span", { style: S.sub }, r.catalogCurrent ? "目录已是当前版本" : "目录待更新")
            ),
            r.catalogCurrent
              ? null
              : h("button", { type: "button", style: disabledStyle(S.button, busy), disabled: busy, onClick: function () { sync(r); } }, "补写模型目录")
          );
        }),
        h(Notice, { note: note }),
        h(
          "span",
          { style: S.sub },
          "DSH 自带的 MiniMax 目录只到 MiniMax-M3，还列着已退役的 " +
            retired.map(function (m) { return m.id; }).join("、") +
            "（" + (retired[0] ? retired[0].retiredOn : "") + " 退役）。保存 Key 时本插件会把上面的目录写进对应路由，并打开自适应思考，让选择器里的思考档位真正生效；你自己在「设置 → 模型」里加的其它模型会原样保留。"
        )
      );
    }

    function SettingsPage(props) {
      const api = props.api;
      const { status, error, reload } = useStatus(api);
      return h(
        "div",
        { style: S.page },
        h(
          "div",
          { style: S.intro },
          "使用 MiniMax 官方开放平台的 API Key。保存后，MiniMax-M3.1-Flash 与 MiniMax-M3 会出现在输入框的模型选择列表里（MiniMax 国内 / MiniMax 国际分组）。"
        ),
        error ? h("div", { style: { color: C.error, fontSize: 12 } }, "读取状态失败：" + error) : null,
        h(KeyCard, { api: api, status: status, onChanged: reload }),
        h(QuotaCard, { api: api }),
        h(CatalogCard, { api: api, status: status, onChanged: reload })
      );
    }

    // ---------- 工具栏标记 ----------

    /** 模型路由 → 本插件的区域。只有这两条路由属于 MiniMax。 */
    const REGION_OF_PROVIDER = { "minimax-cn": "cn", minimax: "intl" };

    /**
     * 读模型目录服务。它由 dsh-client-ui-model-selection 提供，若尚未注册
     * 则返回 undefined（不抛错）—— 调用方据此先不渲染工具栏控件。
     */
    function resolveModelDirectories(ctx) {
      try {
        return typeof ctx.get === "function" ? ctx.get("modelDirectories", false) : undefined;
      } catch (error) {
        return undefined;
      }
    }

    /**
     * 取某会话的模型目录（与模型选择器同源）。取不到就返回 undefined ——
     * 调用方据此不渲染控件，而不是抛错。
     */
    function directoryFor(directories, sessionId) {
      if (!directories || typeof directories.directoryFor !== "function") return undefined;
      try {
        return directories.directoryFor(sessionId);
      } catch (error) {
        return undefined;
      }
    }

    /**
     * 当前会话选中的模型（与输入框模型选择器同源：modelDirectories 的会话目录）。
     * 拿不到目录时返回 undefined —— 调用方据此「宁可不显示」。
     */
    function useSelectedProvider(directory) {
      const store = directory && directory.store;
      const subscribe = React.useCallback(
        function (fn) {
          return store ? store.subscribe(fn) : function () {};
        },
        [store]
      );
      const read = React.useCallback(
        function () {
          if (!store) return undefined;
          const snapshot = store.getSnapshot();
          // 切换中先按目标模型显示，避免选完要等一拍才出现 / 消失。
          const selection = (snapshot && (snapshot.pending || snapshot.current)) || null;
          return selection ? selection.provider : null;
        },
        [store]
      );
      return React.useSyncExternalStore(subscribe, read, read);
    }

    /**
     * 输入框工具栏标记：只在当前会话选中 MiniMax 模型时出现。
     * 外层只读选择状态；没选 MiniMax 时内层不挂载，也就不会去请求额度。
     */
    function Badge(props) {
      const provider = useSelectedProvider(props.directory);
      const region = provider ? REGION_OF_PROVIDER[provider] : undefined;
      if (region === undefined) return null;
      return h(QuotaBadge, { api: props.api, region: region });
    }

    function QuotaBadge(props) {
      const { quota } = useQuota(props.api, props.region);
      if (!quota || quota.state !== "plan") return null;
      const bucket =
        quota.buckets.find(function (b) { return b.bucket === "general"; }) || quota.buckets[0];
      const win = bucket && (bucket.windows.find(function (w) { return w.key === "interval"; }) || bucket.windows[0]);
      if (!win) return null;
      const tip = quota.buckets
        .map(function (b) {
          return b.windows
            .map(function (w) { return w.label + " 剩余 " + w.remainingPercent + "%（" + countdown(w.resetsAt) + "）"; })
            .join("\n");
        })
        .join("\n");
      return h(
        "span",
        {
          title: "MiniMax 套餐额度\n" + tip,
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            height: 24,
            padding: "0 8px",
            borderRadius: 999,
            border: "1px solid " + C.border,
            color: C.sub,
            fontSize: 11,
            whiteSpace: "nowrap",
            userSelect: "none",
          },
        },
        h("span", { style: S.dot(colorForRemaining(win.remainingPercent)) }),
        "MiniMax " + win.remainingPercent + "%"
      );
    }

    // ---------- 输入框工具栏：上下文大小菜单 ----------

    /**
     * 模型选择器旁边的上下文大小控件。
     *
     * 只在当前会话选中 MiniMax 模型时出现。点击展开一个小菜单选 200K / 512K / 1M。
     *
     * 为什么放在这里而不是模型选择器内部：DSH 的 `selectModel` 只接受
     * { provider, model, reasoningEffort }，**没有按会话设置上下文这一说** ——
     * 上下文是适配器路由里模型条目的属性，改它会写全局路由配置，影响所有用该路由的会话。
     * 所以做成一个与模型选择器并排的独立控件，既不影子化官方座位（那要重写整套菜单），
     * 也让用户一眼看到「上下文和推理等级是两回事，可以分别调」。
     */
    function ContextControl(props) {
      const api = props.api;
      const provider = useSelectedProvider(props.directory);
      const region = provider ? REGION_OF_PROVIDER[provider] : undefined;
      const { status, reload } = useStatus(api);
      const [open, setOpen] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState(null);
      const rootRef = React.useRef(null);

      React.useEffect(
        function () {
          if (!open) return;
          function onDown(event) {
            if (rootRef.current && rootRef.current.contains(event.target)) return;
            setOpen(false);
          }
          function onKey(event) {
            if (event.key === "Escape") setOpen(false);
          }
          document.addEventListener("mousedown", onDown);
          document.addEventListener("keydown", onKey);
          return function () {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
          };
        },
        [open]
      );

      if (region === undefined) return null;

      const options = (status && status.contextOptions) || [];
      // 只看当前这条路由（用户可能国内国际各配一条，它们的档位可以不同）。
      const active = ((status && status.regions) || []).find(function (r) {
        return r.region === region;
      });
      const current = active && typeof active.contextWindow === "number" ? active.contextWindow : undefined;
      const currentLabel = (function () {
        for (let i = 0; i < options.length; i += 1) {
          if (options[i].id === current) return options[i].label;
        }
        return current === undefined ? "上下文" : Math.round(current / 1000) + "K";
      })();

      function choose(option) {
        setBusy(true);
        setNote(null);
        void call(api, "setContext", { contextWindow: option.id }).then(function (result) {
          setBusy(false);
          if (!result.ok) {
            setNote({ tone: "error", text: "设置失败：" + result.message });
            return;
          }
          const value = result.value;
          const changed = (value.results || []).some(function (r) { return r.changed; });
          setNote({
            tone: changed ? "ok" : "warn",
            text: changed ? "已切换到 " + option.label + " 上下文" : "已经是 " + option.label + " 上下文",
          });
          reload();
        });
      }

      return h(
        "div",
        { ref: rootRef, style: { position: "relative" } },
        h(
          "button",
          {
            type: "button",
            title: "上下文大小（影响 DSH 何时压缩历史；越大越贵）",
            "aria-haspopup": "menu",
            "aria-expanded": open,
            disabled: busy || options.length === 0,
            style: disabledStyle(
              Object.assign({}, S.button, { height: 24, padding: "0 8px", fontSize: 11, whiteSpace: "nowrap" }),
              busy || options.length === 0
            ),
            onClick: function () {
              setOpen(function (v) { return !v; });
            },
          },
          "上下文 " + currentLabel
        ),
        open
          ? h(
              "div",
              {
                role: "menu",
                style: {
                  position: "absolute",
                  bottom: "calc(100% + 6px)",
                  right: 0,
                  zIndex: 40,
                  minWidth: 190,
                  padding: 4,
                  borderRadius: 10,
                  border: "1px solid " + C.border,
                  background: C.layer,
                  boxShadow: "0 8px 24px rgba(0,0,0,.18)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                },
              },
              options.map(function (option) {
                const selected = option.id === current;
                return h(
                  "button",
                  {
                    key: option.id,
                    type: "button",
                    role: "menuitemradio",
                    "aria-checked": selected,
                    title: option.note,
                    style: Object.assign(
                      {},
                      S.button,
                      {
                        height: "auto",
                        border: "none",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "6px 8px",
                        background: selected ? C.layer2 : "transparent",
                        color: selected ? C.brand : C.text,
                        fontWeight: selected ? 600 : 400,
                      }
                    ),
                    onClick: function () {
                      choose(option);
                      setOpen(false);
                    },
                  },
                  h("span", null, option.label),
                  h("span", { style: Object.assign({}, S.sub, { fontSize: 11 }) }, option.note)
                );
              }),
              note
                ? h(
                    "div",
                    { style: { fontSize: 11, padding: "4px 8px 2px", color: note.tone === "ok" ? C.ok : C.warn } },
                    note.text
                  )
                : null
            )
          : null
      );
    }

    // ---------- 「设置 → 模型」里的 MiniMax 卡片提示 ----------

    function ProviderCardHint(props) {
      // owner props：{ provider: ConfigurableProviderView, configured, keyConfigured }
      const id = props && props.provider && props.provider.provider;
      if (id !== "minimax-cn" && id !== "minimax") return null;
      return h(
        "div",
        { style: Object.assign({}, S.sub, { padding: "4px 0" }) },
        "MiniMax 的 Key、当前模型目录（含 MiniMax-M3.1-Flash）和套餐额度，也可以在「设置 → MiniMax」页面直接管理。"
      );
    }

    // ---------- 装配 ----------

    return {
      // 只声明真正必需的依赖。`modelDirectories` **不能**写在这里：
      // 客户端模块图的加载顺序取自 package.json 的 dsh.client.inject，而宿主把那份
      // manifest 在进程启动时读一次就缓存（pkgMeta），改它不会即时生效。若把
      // modelDirectories 写成硬依赖而 ui-model-selection 恰好排在后面，
      // cordis 会一直等它 —— 整个 apply 永不执行（连设置页都消失）。
      //
      // 正确做法：apply 照常执行，注册槽时惰性取目录；取不到就只渲染设置页。
      inject: ["slots", "connection"],
      apply(ctx) {
        const api = { connection: ctx.connection };

        ctx.slots.inject("settings.section", function () {
          return ctx.slots.register(
            { name: "settings.section", id: "minimax", order: 12, label: function () { return "MiniMax"; } },
            function () {
              return h(SettingsPage, { api: api });
            }
          );
        });

        // 工具栏上的上下文/额度控件。
        //
        // 用 ctx.inject([...]) 声明 modelDirectories 依赖：cordis 会等该服务就绪
        // 才执行这个回调（服务由 dsh-client-ui-model-selection 注册）。
        // 这**不会**阻塞 apply 的其余部分 —— 设置页等与模型无关的功能照常注册，
        // 即使模型选择器插件尚未就绪也不受影响。
        ctx.inject(["slots", "modelDirectories"], function (scope) {
          const models = scope.get("modelDirectories", false);

          ctx.slots.inject("conversation.input.right", function () {
            return ctx.slots.register(
              {
                name: "conversation.input.right",
                id: "minimax-context",
                order: 55,
                inject: function (sessionId) {
                  return { directory: directoryFor(models, sessionId) };
                },
              },
              function (slotProps) {
                return h(ContextControl, { api: api, directory: slotProps && slotProps.directory });
              }
            );
          });

          ctx.slots.inject("conversation.input.right", function () {
            return ctx.slots.register(
              {
                name: "conversation.input.right",
                id: "minimax-quota",
                order: 60,
                inject: function (sessionId) {
                  return { directory: directoryFor(models, sessionId) };
                },
              },
              function (slotProps) {
                return h(Badge, { api: api, directory: slotProps && slotProps.directory });
              }
            );
          });
        });

        // provider-card 按 settingsNs（= llm-pi-ai 那一行的条目 id）分发；组合里它通常是
        // `include:llm-pi-ai`，直接写在 patch 里时是 `llm-pi-ai`，两个都登记。
        ["include:llm-pi-ai", "llm-pi-ai"].forEach(function (key) {
          ctx.slots.inject("settings.models.provider-card", function () {
            return ctx.slots.register({ name: "settings.models.provider-card", key: key }, function (props) {
              return h(ProviderCardHint, props);
            });
          });
        });
      },
    };
  },
});
