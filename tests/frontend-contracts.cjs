const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const repo = require("node:path").resolve(__dirname, "..");
const localRequire = createRequire(repo + "/package.json");
const ts = localRequire("typescript");
const { PGlite } = require("@electric-sql/pglite");
let checks = 0;
let transport;
let timerCallback;
let timerCleared = false;
const fakeEnvironment = {
  N8N_GET_DATA_URL: "https://automation.invalid/dashboard",
  N8N_OFFBOARD_URL: "https://automation.invalid/offboard",
  N8N_REPORT_URL: "https://automation.invalid/report",
};
function load(relative, overrides = {}) {
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(repo + "/" + relative, "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  vm.runInNewContext(
    code,
    {
      exports,
      Error,
      URL,
      Request,
      Response,
      AbortController,
      DOMException,
      process: { env: fakeEnvironment },
      setTimeout: (callback) => {
        timerCallback = callback;
        timerCleared = false;
        return 1;
      },
      clearTimeout: () => {
        timerCleared = true;
      },
      fetch: (...args) => transport(...args),
      require: (name) =>
        name === "@/lib/iam-hr-upstream" ? upstream : name === "@/lib/iam-hr" ? library : name === "@/lib/synthetic-targets" ? synthetic : localRequire(name),
      ...overrides,
    },
    { filename: relative },
  );
  return exports;
}
const library = load("lib/iam-hr.ts");
const synthetic = load("lib/synthetic-targets.ts");
const upstream = load("lib/iam-hr-upstream.ts");
const action = load("app/api/iam-hr/action/route.ts");
const route = load("app/api/iam-hr/route.ts");
const check = async (name, fn) => {
  await fn();
  checks++;
  console.log("PASS:", name);
};
const respond = (data, status = 200) => {
  transport = async () => Response.json(data, { status });
};
const post = (type, body) =>
  action.POST(
    new Request("http://local.invalid/api/iam-hr/action?type=" + type, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const email = "john.carter@demo-corp.com";
(async () => {
  await check("route methods isolate dashboard reads from actions", () => {
    assert.equal(typeof route.GET, "function");
    assert.equal(route.POST, undefined); // Next returns 405 for unsupported methods.
    assert.equal(typeof action.POST, "function");
    assert.equal(action.GET, undefined);
  });
  const db = new PGlite();
  try {
    await db.exec(
      fs.readFileSync(__dirname + "/fixtures/schema-original.sql", "utf8"),
    );
    await db.exec(
      fs.readFileSync(
        __dirname + "/../database/002-operation-recovery.sql",
        "utf8",
      ),
    );
    const call = async (sql, args = []) =>
      (await db.query(sql, args)).rows[0].data;
    const dashboard = () => call("SELECT iam_dashboard() data");
    const next = (id, owner) =>
      call("SELECT iam_next($1,$2) data", [id, owner]);
    const record = (id, owner, connector, status) =>
      call("SELECT iam_record($1,$2,$3,$4,$5) data", [
        id,
        owner,
        connector,
        status,
        "{}",
      ]);
    await check(
      "workflow 01 SQL dashboard normalizes twice and retains recovery metadata",
      async () => {
        const raw = await dashboard();
        respond(raw);
        const response = await route.GET();
        assert.equal(response.status, 200);
        const normalized = library.normalizeDashboard(await response.json());
        assert.equal(normalized.employees.length, 7);
        assert.equal(library.hasRecoveryContract(normalized), true);
        assert.equal(normalized.metrics.avg_processing_ms, null);
        assert.equal(response.headers.get("cache-control"), "no-store");
      },
    );
    const begin = await call("SELECT iam_begin($1,$2,$3,$4) data", [
      "offboard",
      email,
      null,
      "contract-1",
    ]);
    const id = begin.operation_id;
    await next(id, "contract-1");
    await record(id, "contract-1", "erp", "succeeded");
    await next(id, "contract-1");
    await record(id, "contract-1", "gcp", "failed");
    const partial = (await next(id, "contract-1")).operation;
    const partialReply = {
      success: false,
      operation: partial,
      status: "partial",
      dashboard: await dashboard(),
    };
    await check(
      "spoofed client/proxy headers cannot replace server webhook auth or enter the offboard payload",
      async () => {
        const previousKey = fakeEnvironment.N8N_WEBHOOK_KEY;
        const testKey = "synthetic-test-only-webhook-key";
        fakeEnvironment.N8N_WEBHOOK_KEY = testKey;
        let calls = 0;
        transport = async (url, init) => {
          calls++;
          assert.equal(url, fakeEnvironment.N8N_OFFBOARD_URL);
          assert.equal(init.method, "POST");
          const headers = new Headers(init.headers);
          assert.equal(headers.get("X-N8N-Webhook-Secret"), testKey);
          for (const header of ["Forwarded", "X-Forwarded-For", "X-Real-IP", "CF-Connecting-IP", "X-IAM-Client-IP"])
            assert.equal(headers.get(header), null);
          assert.deepEqual(JSON.parse(init.body), {
            target_email: email,
            operation_id: String(id),
          });
          return Response.json(partialReply);
        };
        try {
          for (const claimedIp of ["198.51.100.10", "127.0.0.1", "198.51.100.10, 127.0.0.1"]) {
            const response = await action.POST(new Request("http://local.invalid/api/iam-hr/action?type=offboard", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Forwarded: `for=${claimedIp}`,
                "X-Forwarded-For": claimedIp,
                "X-Real-IP": claimedIp,
                "CF-Connecting-IP": claimedIp,
                "X-IAM-Client-IP": claimedIp,
                "X-N8N-Webhook-Secret": "attacker-controlled-value",
              },
              body: JSON.stringify({ target_email: email, operation_id: id, client_ip: claimedIp }),
            }));
            assert.equal(response.status, 200);
            assert(!JSON.stringify(await response.json()).includes(testKey));
          }
          // These calls reach a mock: header isolation does not prove rate limiting.
          assert.equal(calls, 3);
        } finally {
          if (previousKey === undefined) delete fakeEnvironment.N8N_WEBHOOK_KEY;
          else fakeEnvironment.N8N_WEBHOOK_KEY = previousKey;
        }
      },
    );
    await check("repeated dashboard GET stays read-only, ignoring action query and forwarded identity", async () => {
      const before = await db.query("SELECT to_jsonb(t) AS row FROM iam_operations t ORDER BY id");
      let calls = 0;
      transport = async (url, init) => {
        calls++;
        assert.equal(url, fakeEnvironment.N8N_GET_DATA_URL);
        assert.equal(init.method, "GET");
        assert.equal(init.body, undefined);
        assert.equal(new Headers(init.headers).get("X-Forwarded-For"), null);
        return Response.json(partialReply.dashboard);
      };
      for (let i = 0; i < 3; i++) {
        const response = await route.GET(new Request("http://local.invalid/api/iam-hr?type=offboard", {
          headers: { "X-Forwarded-For": "127.0.0.1", "CF-Connecting-IP": "198.51.100.10" },
        }));
        assert.equal(response.status, 200);
        assert.equal((await response.json()).employees.length, 7);
      }
      assert.equal(calls, 3);
      assert.deepEqual(await db.query("SELECT to_jsonb(t) AS row FROM iam_operations t ORDER BY id"), before);
    });
    await check(
      "HTTP 200 partial snapshot remains partial and operation_id is forwarded",
      async () => {
        transport = async (url, init) => {
          assert.equal(JSON.parse(init.body).operation_id, String(id));
          assert.equal(init.cache, "no-store");
          return Response.json(partialReply);
        };
        const response = await post("offboard", {
          target_email: email,
          operation_id: String(id),
        });
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.success, false);
        assert.equal(
          library.normalizeOffboarding(data, email).employees[0].Status,
          "PARTIAL",
        );
      },
    );
    await check(
      "legacy offboarding success without operation/dashboard is rejected",
      async () => {
        respond({ success: true, message: "Offboarding Complete" });
        assert.equal(
          (await post("offboard", { target_email: email })).status,
          502,
        );
      },
    );
    await check("contradictory success is rejected", async () => {
      respond({ ...partialReply, success: true });
      assert.equal(
        (await post("offboard", { target_email: email })).status,
        502,
      );
    });
    await check(
      "foreign selected employee is rejected before upstream",
      async () => {
        transport = () => { throw new Error("Unexpected upstream"); };
        assert.equal(
          (await post("offboard", { target_email: "other@example.com" }))
            .status,
          400,
        );
      },
    );
    await check("allowlisted but mismatched response is rejected", async () => {
      respond(partialReply);
      assert.equal((await post("offboard", {target_email:"sarah.connor@demo-corp.com"})).status,502);
    });
    await check("malformed connector list is rejected", async () => {
      const raw = structuredClone(partialReply);
      raw.dashboard.employees[0].operation.connectors = [];
      respond(raw);
      assert.equal(
        (await post("offboard", { target_email: email })).status,
        502,
      );
    });
    await call("SELECT iam_begin($1,$2,$3,$4) data", [
      "offboard",
      email,
      id,
      "contract-2",
    ]);
    await next(id, "contract-2");
    await record(id, "contract-2", "gcp", "unknown");
    const unknown = (await next(id, "contract-2")).operation;
    await check(
      "unknown operation remains uncertain, without invented success",
      async () => {
        respond({
          success: false,
          operation: unknown,
          dashboard: await dashboard(),
        });
        const response = await post("offboard", {
          target_email: email,
          operation_id: String(id),
        });
        assert.equal(response.status, 200);
        assert.equal(
          (await response.json()).dashboard.employees[0].Status,
          "UNKNOWN",
        );
      },
    );
    await call("SELECT iam_resolve_unknown($1,$2,$3) data", [
      id,
      "gcp",
      "Simulated stopped execution and inspected state.",
    ]);
    await call("SELECT iam_begin($1,$2,$3,$4) data", [
      "offboard",
      email,
      id,
      "contract-3",
    ]);
    await next(id, "contract-3");
    await record(id, "contract-3", "gcp", "succeeded");
    const complete = (await next(id, "contract-3")).operation;
    const completeDashboard = await dashboard();
    await check(
      "completed operation and real processing metric agree",
      async () => {
        respond({
          success: true,
          operation: complete,
          dashboard: completeDashboard,
        });
        const response = await post("offboard", {
          target_email: email,
          operation_id: String(id),
        });
        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.dashboard.employees[0].Status, "OFFBOARDED");
        assert.equal(data.dashboard.metrics.successful_count, 1);
        assert.equal(
          data.dashboard.metrics.avg_processing_ms,
          complete.processing_ms,
        );
      },
    );
    const reset = await call("SELECT iam_begin($1,$2,$3,$4) data", [
      "reset",
      "*",
      null,
      "contract-reset",
    ]);
    await next(reset.operation_id, "contract-reset");
    await record(reset.operation_id, "contract-reset", "erp", "succeeded");
    await next(reset.operation_id, "contract-reset");
    await record(reset.operation_id, "contract-reset", "gcp", "succeeded");
    await next(reset.operation_id, "contract-reset");
    await check(
      "workflow 03 reset removes prior operations and advances cycle",
      async () => {
        const normalized = library.normalizeDashboard(await dashboard());
        assert.equal(normalized.cycle, "2");
        assert(
          normalized.employees.every(
            (employee) =>
              employee.Status === "ACTIVE" && employee.Operation === null,
          ),
        );
      },
    );
    await check("HTTP errors preserve status and code", async () => {
      for (const status of [400, 409, 429, 500, 503]) {
        respond(
          { success: false, code: "OPERATION_BUSY", error: "OPERATION_BUSY" },
          status,
        );
        const response = await post("offboard", { target_email: email });
        assert.equal(response.status, status);
        await assert.rejects(
          library.readApiResponse(response),
          /OPERATION_BUSY/,
        );
      }
    });
    await check(
      "empty/HTML bodies never count as success and retain HTTP errors",
      async () => {
        for (const [status, body, expected] of [
          [200, "", 502],
          [200, "<html>ok</html>", 502],
          [502, "<html>bad gateway</html>", 502],
          [429, "", 429],
          [204, null, 502],
        ]) {
          transport = async () => new Response(body, { status });
          const response = await post("offboard", { target_email: email });
          assert.equal(response.status, expected);
          assert.equal((await response.json()).success, false);
        }
      },
    );
    await check("timeout covers body consumption and returns 504", async () => {
      transport = async (_url, init) => ({
        status: 200,
        text: async () => {
          assert.equal(timerCleared, false);
          timerCallback();
          assert.equal(init.signal.aborted, true);
          throw new DOMException("Aborted", "AbortError");
        },
      });
      const response = await post("offboard", { target_email: email });
      assert.equal(response.status, 504);
      assert.equal((await response.json()).code, "OPERATION_TIMEOUT");
      assert.equal(timerCleared, true);
    });
    await check(
      "legacy aliases/n8n wrappers remain readable but cannot enable actions",
      () => {
        const data = library.normalizeDashboard({
          data: [
            {
              json: {
                Nome: "Legacy",
                "E-mail": "legacy@example.com",
                state: "active",
                Grupos: ["A", "B"],
              },
            },
          ],
        });
        assert.equal(data.employees[0].FullName, "Legacy");
        assert.equal(data.employees[0].Status, "ACTIVE");
        assert.equal(library.hasRecoveryContract(data), false);
      },
    );
    await check(
      "malformed dashboard cannot masquerade as an empty employee list",
      async () => {
        for (const raw of [
          { success: true },
          { employees: [null] },
          { employees: [{}] },
          { employees: [], cycle: "1" },
          { employees: [], error: "failed" },
        ]) {
          respond(raw);
          assert.equal((await route.GET()).status, 502);
        }
      },
    );
    await check(
      "invalid input is rejected before any upstream call",
      async () => {
        transport = () => {
          throw new Error("Unexpected upstream call");
        };
        for (const body of [
          null,
          [],
          {},
          { target_email: "invalid" },
          { target_email: email, operation_id: "x" },
        ]) {
          assert.equal((await post("offboard", body)).status, 400);
        }
        assert.equal((await post("invalid", {})).status, 400);
      },
    );
    await check("handover and legacy route reject repeated/active/foreign requests without upstream", async () => {
      transport = () => { throw new Error("Unexpected delivery"); };
      const legacy = load("app/api/lead-capture/route.ts");
      for (let attempt = 0; attempt < 5; attempt++) {
        for (const target of ["John Carter", "Arthur Dent", "External User"]) {
          const response = await post("report", { target_employee: target, visitor_email: "visitor@example.com" });
          assert.equal(response.status, 403);
          assert.equal((await response.json()).code, "HANDOVER_DISABLED");
          assert.equal((await legacy.POST()).status, 403);
        }
      }
    });
    await check("concurrent handover requests cannot bypass disablement using forged proxy headers and never read the body", async () => {
      let upstreamCalls = 0;
      let bodyReads = 0;
      transport = () => { upstreamCalls++; throw new Error("Unexpected delivery"); };
      const legacy = load("app/api/lead-capture/route.ts");
      const requests = Array.from({ length: 16 }, (_, i) => ({
        url: "http://local.invalid/api/iam-hr/action?type=report",
        headers: new Headers({
          "X-Forwarded-For": `198.51.100.${i + 1}, 127.0.0.1`,
          "CF-Connecting-IP": "127.0.0.1",
        }),
        json: async () => { bodyReads++; throw new Error("Body must not be read"); },
      }));
      const replies = await Promise.all(requests.flatMap(request => [action.POST(request), legacy.POST(request)]));
      for (const response of replies) {
        assert.equal(response.status, 403);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.equal((await response.json()).code, "HANDOVER_DISABLED");
      }
      assert.equal(bodyReads, 0);
      assert.equal(upstreamCalls, 0);
    });
    await check("handover query admits only exact allowlisted OFFBOARDED employees", async () => {
      const sql = fs.readFileSync(repo + "/automation/sql/handover-eligible.sql", "utf8");
      assert.equal((await db.query(sql, [email])).rows.length, 0); // reset restored ACTIVE
      await db.query("UPDATE employees SET status='OFFBOARDED' WHERE email=$1", [email]);
      assert.equal((await db.query(sql, [email])).rows.length, 1);
      for (const target of [null, "john-carter@demo-corp.com", "john.carter@other.com", "missing@demo-corp.com"])
        assert.equal((await db.query(sql, [target])).rows.length, 0);
      await db.exec("INSERT INTO employees(full_name,email,status,access_groups) VALUES ('External','outsider@example.com','OFFBOARDED','')");
      assert.equal((await db.query(sql, ["outsider@example.com"])).rows.length, 0);
    });
    await check("application uses the exact seven synthetic account IDs", () => {
      assert.deepEqual(Object.entries(synthetic.SYNTHETIC_TARGETS), [
        ["john.carter@demo-corp.com", "iamhr-john-carter"],
        ["sarah.connor@demo-corp.com", "iamhr-sarah-connor"],
        ["tchalla.udaku@demo-corp.com", "iamhr-tchalla-udaku"],
        ["ellen.ripley@demo-corp.com", "iamhr-ellen-ripley"],
        ["arthur.dent@demo-corp.com", "iamhr-arthur-dent"],
        ["marty.mcfly@demo-corp.com", "iamhr-marty-mcfly"],
        ["dana.scully@demo-corp.com", "iamhr-dana-scully"]
      ]);
    });
    await check("offboarding allowlist rejects foreign and colliding addresses before upstream", async () => {
      transport = () => { throw new Error("Unexpected upstream"); };
      for (const target_email of ["john-carter@demo-corp.com", "john.carter@other.com", "outsider@demo-corp.com", "constructor@demo-corp.com"])
        assert.equal((await post("offboard", { target_email })).status, 400);
    });
    await check("frontend posts to action path and preserves dashboard cache/reconciliation path", async () => {
      const React = localRequire("react");
      let hook = 0;
      let requests = 0;
      const cacheKeys = [];
      const component = load("components/ph3/iam-hr-demo.tsx", {
        fetch: async (url, init) => {
          requests++;
          assert.equal(url, "/api/iam-hr/action?type=offboard");
          assert.equal(init.method, "POST");
          assert.deepEqual(JSON.parse(init.body), { target_email: email, operation_id: String(id) });
          assert.equal(new Headers(init.headers).get("X-N8N-Webhook-Secret"), null);
          return Response.json(partialReply);
        },
        require: (name) => {
          if (name === "react") return { ...React, useState: initial => [hook++ === 0 ? email : initial, () => {}] };
          if (name === "swr") return { useSWRConfig: () => ({ mutate: async (key, callback) => {
            cacheKeys.push(key);
            if (callback) return callback();
          } }) };
          if (name === "@/lib/iam-hr") return library;
          if (name.startsWith("@/components/ui/")) return { Button: () => null, Input: () => null };
          return localRequire(name);
        },
      });
      const tree = component.IamHrDemo({ employees: library.normalizeDashboard(partialReply.dashboard).employees, isLoading: false });
      function findAction(node) {
        if (!node || typeof node !== "object") return;
        if (node.props?.onClick?.name === "handleOffboarding") return node.props.onClick;
        for (const child of React.Children.toArray(node.props?.children)) {
          const found = findAction(child);
          if (found) return found;
        }
      }
      const click = findAction(tree);
      assert.equal(typeof click, "function");
      await click();
      assert.equal(requests, 1);
      assert.deepEqual(cacheKeys, ["/api/iam-hr"]);
    });
    // Render only the component with seeded selection; all network hooks are stubbed.
    await check(
      "partial/success UI keeps connector states and gates handover",
      () => {
        const React = localRequire("react");
        const { renderToStaticMarkup } = localRequire("react-dom/server");
        let hook = 0;
        const component = load("components/ph3/iam-hr-demo.tsx", {
          require: (name) => {
            if (name === "react")
              return {
                ...React,
                useState: (initial) => [
                  hook++ === 0 ? email : initial,
                  () => {},
                ],
              };
            if (name === "swr")
              return {
                useSWRConfig: () => ({
                  mutate: () => {
                    throw new Error("Unexpected mutation");
                  },
                }),
              };
            if (name === "@/lib/iam-hr") return library;
            if (name.startsWith("@/components/ui/"))
              return {
                Button: (props) => React.createElement("button", props),
                Input: (props) => React.createElement("input", props),
              };
            return localRequire(name);
          },
        });
        const render = (raw) => {
          hook = 0;
          return renderToStaticMarkup(
            React.createElement(component.IamHrDemo, {
              employees: library.normalizeDashboard(raw).employees,
              isLoading: false,
            }),
          );
        };
        const partialHtml = render(partialReply.dashboard);
        assert(partialHtml.includes("Resume pending connectors"));
        assert(partialHtml.includes("Offboarding partially completed"));
        assert(!partialHtml.includes("Access Revoked Successfully"));
        assert(!partialHtml.includes("Send handover report"));
        const successHtml = render(completeDashboard);
        assert(successHtml.includes("Access Revoked Successfully"));
        assert(!successHtml.includes("Send handover report"));
        assert(successHtml.includes("Public handover delivery is disabled"));
        assert(successHtml.includes("GCP IAM (synthetic employee identity)"));
      },
    );
    console.log(
      `PASS: ${checks} local frontend/API contract groups; fetch fully mocked, PostgreSQL in memory.`,
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
