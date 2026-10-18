import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(
  fs.readFileSync(
    new URL("./fixtures/schema-original.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  fs.readFileSync(
    new URL("../database/002-operation-recovery.sql", import.meta.url),
    "utf8",
  ),
);
const workflows = ["02-execute-offboarding", "03-scheduled-reset"].map((n) =>
  JSON.parse(
    fs.readFileSync(
      new URL("../automation/n8n/n8n-" + n + ".json", import.meta.url),
    ),
  ),
);
for (const w of workflows) {
  const names = new Set(w.nodes.map((n) => n.name));
  assert.equal(names.size, w.nodes.length);
  for (const [name, c] of Object.entries(w.connections)) {
    assert(names.has(name));
    for (const out of c.main)
      for (const edge of out) assert(names.has(edge.node));
  }
  for (const n of w.nodes) {
    if (n.type.endsWith(".httpRequest")) {
      const response = n.parameters.options.response.response;
      assert.equal(response.responseFormat, "text");
      assert.equal(response.fullResponse, true);
      assert.equal(
        response.outputPropertyName,
        "body",
        `${w.name}: ${n.name} must expose body`,
      );
    }
    if (n.onError === "continueErrorOutput")
      assert(w.connections[n.name].main[1].length);
    if (n.parameters.onError) throw Error("Misplaced onError");
  }
}
// n8n text responses use data unless outputPropertyName explicitly overrides it.
function httpResponse(node, statusCode, body) {
  const options = node.parameters.options?.response?.response ?? {};
  assert.equal(options.responseFormat, "text");
  assert.equal(options.fullResponse, true);
  return {
    statusCode,
    [options.outputPropertyName ?? "data"]: JSON.stringify(body),
  };
}
const defaultNode = {
  parameters: {
    options: {
      response: { response: { responseFormat: "text", fullResponse: true } },
    },
  },
};
assert.deepEqual(httpResponse(defaultNode, 200, { ok: true }), {
  statusCode: 200,
  data: '{"ok":true}',
});
const customNode = structuredClone(defaultNode);
customNode.parameters.options.response.response.outputPropertyName = "custom";
assert.deepEqual(httpResponse(customNode, 200, { ok: true }), {
  statusCode: 200,
  custom: '{"ok":true}',
});
let execution = 0;
const external = { erp: false, gcp: new Map() };
let failGcp = true;
const writes = { erp: 0, gcp: 0 };
async function run(w, body = {}, options = {}) {
  const outputs = {};
  const $execution = { id: "sim-" + ++execution };
  const $ = (name) => ({ first: () => outputs[name][0], all: () => outputs[name] });
  const env = { GCP_PROJECT_ID: "test-project", ...options.env };
  const evaluate = (v, $json) =>
    typeof v === "string" && v.startsWith("={{")
      ? new Function("$json", "$", "$execution", "$env", "return (" + v.slice(3, -2) + ");")($json, $, $execution, env)
      : v;
  let name = "Receive Request", input = [{json:{ body, webhookUrl: "http://test" }}], hops = 0;
  while (name) {
    assert(++hops < 90, "Graph did not terminate");
    const n = w.nodes.find(n => n.name === name);
    let value = input, branch = 0;
    if (n.type.endsWith(".code")) {
      value = new Function("$json", "$", "$execution", "$env", "$input", n.parameters.jsCode)(input[0]?.json, $, $execution, env, {all:()=>input});
    } else if (n.type.endsWith(".if")) {
      branch = evaluate(n.parameters.conditions.conditions[0].leftValue,input[0].json) ? 0 : 1;
    } else if (n.type.endsWith(".postgres")) {
      options.onPostgres?.(n.name);
      value = (await db.query(n.parameters.query,evaluate(n.parameters.options.queryReplacement,input[0].json))).rows.map(json=>({json}));
    } else if (n.type.endsWith(".httpRequest")) {
      value = input.map(item => {
        const erp=n.name.startsWith("ERP"), connector=erp?"erp":"gcp", reset=w.name.endsWith("Reset");
        const target=erp?null:(item.json.expected_email ?? $('GCP Context').first().json.expected_email);
        assert(erp || /^iamhr-[a-z-]+@test-project\.iam\.gserviceaccount\.com$/.test(target));
        options.onHttp?.(n.name,target);
        let reply;
        if(n.parameters.method === "GET") {
          reply=httpResponse(n,200,erp ? reset?{reset_baseline:!external.erp}:{license_status:external.erp?"REVOKED":"ACTIVE"} : {email:options.inspectEmail??target,disabled:external.gcp.get(target)??false});
        } else {
          writes[connector]++;
          if(!erp && failGcp) reply=httpResponse(n,403,{});
          else {
            if(erp) external.erp=!reset; else external.gcp.set(target,!reset);
            reply=httpResponse(n,200,erp ? reset?{reset:true}:{license_status:"REVOKED"}:{});
          }
        }
        return {json:reply};
      });
    } else if(n.type.endsWith(".respondToWebhook")) {
      return evaluate(n.parameters.responseBody,input[0].json);
    }
    outputs[name]=value;
    const edge=w.connections[name]?.main[branch]?.[0];
    input=value;
    name=edge?.node;
  }
  throw Error("No response");
}
const first = await run(workflows[0], {
  target_email: "john.carter@demo-corp.com",
});
assert.equal(first.operation.status, "partial");
assert.equal(first.dashboard.employees[0].status, "PARTIAL");
failGcp = false;
const second = await run(workflows[0], {
  target_email: "john.carter@demo-corp.com",
  operation_id: first.operation.id,
});
assert.equal(second.success, true);
assert.equal(second.dashboard.employees[0].status, "OFFBOARDED");
assert.deepEqual(writes, { erp: 1, gcp: 2 });
await run(workflows[0], { target_email: "john.carter@demo-corp.com" });
assert.deepEqual(writes, { erp: 1, gcp: 2 });
const reset = await run(workflows[1]);
assert.equal(reset.operation.status, "succeeded");
assert(reset.dashboard.employees.every((e) => e.status === "ACTIVE"));
const beforeResetWrites=writes.gcp;
for(const [,id] of [
 ["john.carter@demo-corp.com","iamhr-john-carter"], ["sarah.connor@demo-corp.com","iamhr-sarah-connor"],
 ["tchalla.udaku@demo-corp.com","iamhr-tchalla-udaku"], ["ellen.ripley@demo-corp.com","iamhr-ellen-ripley"],
 ["arthur.dent@demo-corp.com","iamhr-arthur-dent"], ["marty.mcfly@demo-corp.com","iamhr-marty-mcfly"],
 ["dana.scully@demo-corp.com","iamhr-dana-scully"]
]) external.gcp.set(`${id}@test-project.iam.gserviceaccount.com`,true);
const batch=await run(workflows[1]);
assert.equal(batch.success,true);
assert.equal(writes.gcp-beforeResetWrites,7);
assert.equal(batch.operation.connectors.find(c=>c.name==="gcp").writes,1);
assert.equal((await db.query("SELECT count(*)::int n FROM iam_step_events WHERE operation_id=$1 AND connector='gcp' AND phase='write' AND status='succeeded'",[batch.operation.id])).rows[0].n,1);
const beforeNoOp=writes.gcp;
const noOp=await run(workflows[1]);
assert.equal(noOp.success,true);
assert.equal(writes.gcp,beforeNoOp);
assert.equal(noOp.operation.connectors.find(c=>c.name==="gcp").writes,0);
const stale = await run(workflows[0], {
  target_email: "john.carter@demo-corp.com",
  operation_id: first.operation.id,
});
assert.equal(stale.code, "OPERATION_EXPIRED");
const invalid = await run(workflows[0], { target_email: "not an email" });
assert.equal(invalid.http_status, 400);
// Reproduce the original missing-body defect through the graph, not a forced body fixture.
const brokenOffboard = structuredClone(workflows[0]);
delete brokenOffboard.nodes.find((n) => n.name === "ERP Inspect").parameters
  .options.response.response.outputPropertyName;
const broken = await run(brokenOffboard, {
  target_email: "ellen.ripley@demo-corp.com",
});
assert.equal(broken.success, false);
assert.equal(broken.operation.status, "partial");
const brokenErp = broken.operation.connectors.find((c) => c.name === "erp");
assert.equal(brokenErp.status, "failed");
assert.equal(brokenErp.writes, 0);
assert.equal(brokenErp.detail.code, "STATE_READ_FAILED");
const brokenReset = structuredClone(workflows[1]);
delete brokenReset.nodes.find((n) => n.name === "ERP Inspect").parameters
  .options.response.response.outputPropertyName;
const resetFailure = await run(brokenReset);
assert.equal(resetFailure.success, false);
assert.equal(resetFailure.operation.status, "partial");
assert.equal(
  resetFailure.operation.connectors.find((c) => c.name === "erp").detail.code,
  "STATE_READ_FAILED",
);
// Exercise the actual exported code, with no n8n runtime or external transport.
const codeNode = (workflow, name, input, context = {}, env = {GCP_PROJECT_ID:"test-project"}) => {
  const node = workflow.nodes.find(n => n.name === name);
  const items = input.map(json => ({json}));
  const lookup = name => ({first:()=>({json:context[name]?.[0]}),all:()=> (context[name]??[]).map(json=>({json}))});
  return new Function("$json", "$input", "$", "$env", "$execution", node.parameters.jsCode)(input[0],{all:()=>items},lookup,env,{id:"unit"}).map(i=>i.json);
};
const expected = [
  ["john.carter@demo-corp.com","iamhr-john-carter"],
  ["sarah.connor@demo-corp.com","iamhr-sarah-connor"],
  ["tchalla.udaku@demo-corp.com","iamhr-tchalla-udaku"],
  ["ellen.ripley@demo-corp.com","iamhr-ellen-ripley"],
  ["arthur.dent@demo-corp.com","iamhr-arthur-dent"],
  ["marty.mcfly@demo-corp.com","iamhr-marty-mcfly"],
  ["dana.scully@demo-corp.com","iamhr-dana-scully"]
];
for (const [email,id] of expected) {
  const [target]=codeNode(workflows[0],"Validate Request",[{body:{target_email:email}}]);
  assert.equal(target.account_id,id);
  assert.equal(target.expected_email,`${id}@test-project.iam.gserviceaccount.com`);
}
for (const email of [undefined,"john-carter@demo-corp.com","john.carter@other.com","constructor","outsider@demo-corp.com"]) {
  assert.equal(codeNode(workflows[0],"Validate Request",[{body:{target_email:email}}])[0].code,"TARGET_NOT_ALLOWED");
  let calls=0;
  const result=await run(workflows[0],{target_email:email},{onHttp:()=>calls++});
  assert.equal(result.http_status,400);
  assert.equal(calls,0);
}
assert.equal(codeNode(workflows[0],"Validate Request",[{body:{target_email:expected[0][0]}}],{},{} )[0].code,"INVALID_GCP_PROJECT");
// Invalid preflight must not claim, probe, write or append audit records.
const snapshot=async()=>{
 const result={};
 for(const table of ['iam_runtime','iam_operations','iam_steps','iam_step_events','employees','audit_log'])
  result[table]=(await db.query(`SELECT * FROM ${table}`)).rows;
 return result;
};
for(const body of [{}, {target_email:"outsider@demo-corp.com"}, {target_email:" john.carter@demo-corp.com"}, {target_email:"JOHN.CARTER@demo-corp.com"}]) {
 const before=await snapshot(), beforeWrites={...writes}; let pg=0,http=0;
 const reply=await run(workflows[0],body,{onPostgres:()=>pg++,onHttp:()=>http++});
 assert.equal(reply.code,"TARGET_NOT_ALLOWED"); assert.equal(reply.http_status,400);
 assert.equal(pg,0); assert.equal(http,0); assert.deepEqual(writes,beforeWrites);
 assert.deepEqual(await snapshot(),before);
}
for(const project of [undefined,null,"","bad/project","short"," project-id","UPPERCASE-PROJECT"]) {
 const before=await snapshot(), beforeWrites={...writes}; let pg=0,http=0;
 const reply=await run(workflows[0],{target_email:expected[0][0]},{env:{GCP_PROJECT_ID:project},onPostgres:()=>pg++,onHttp:()=>http++});
 assert.equal(reply.code,"INVALID_GCP_PROJECT"); assert.equal(reply.http_status,500);
 assert.equal(pg,0); assert.equal(http,0); assert.deepEqual(writes,beforeWrites);
 assert.deepEqual(await snapshot(),before);
 assert.equal(reply.error,"GCP project configuration is invalid.");
}
const [validated]=codeNode(workflows[0],"Validate Request",[{body:{target_email:expected[0][0]}}]);
const [carried]=codeNode(workflows[0],"GCP Context",[{target_email:expected[0][0],prior_status:"unknown",account_id:"untrusted",expected_email:"untrusted"}],{"Validate Request":[validated]},{});
assert.equal(carried.account_id,validated.account_id);
assert.equal(carried.expected_email,validated.expected_email);
assert.equal(carried.gcp_project_id,validated.gcp_project_id);
assert.equal(carried.prior_status,"unknown");
console.log("PASS: controlled offboarding preflight rejects invalid targets/projects before any SQL or HTTP; ledger/employees/audit unchanged; validated identity carried without rederivation.");
const emails=expected.map(([email])=>email);
const resetContext={"Validate Request":[{kind:"reset"}]};
const [resetTargets]=codeNode(workflows[1],"Reset Targets",[{emails}],resetContext);
assert.equal(new Set(resetTargets.targets.map(t=>t.account_id)).size,7);
for(const invalid of [emails.slice(1),[...emails,emails[0]],[emails[0],...emails.slice(0,6)], [...emails.slice(0,6),"john.carter@other.com"], undefined]) {
  assert.throws(()=>codeNode(workflows[1],"Reset Targets",[{emails:invalid}],resetContext),/INVALID_RESET_TARGETS/);
}
for(const workflow of workflows) {
  const broken=structuredClone(workflow);
  const node=broken.nodes.find(n=>n.name===(workflow===workflows[0]?"Validate Request":"Reset Targets"));
  node.parameters.jsCode=node.parameters.jsCode.replace('"iamhr-sarah-connor"','"iamhr-john-carter"');
  if(workflow===workflows[0]) assert.equal(codeNode(broken,node.name,[{body:{target_email:emails[0]}}])[0].code,"INVALID_SYNTHETIC_MAPPING");
  else assert.throws(()=>codeNode(broken,node.name,[{emails}],resetContext),/INVALID_SYNTHETIC_MAPPING/);
  const missing=structuredClone(workflow);
  const missingNode=missing.nodes.find(n=>n.name===node.name);
  missingNode.parameters.jsCode=missingNode.parameters.jsCode.replace(/  "dana.scully@demo-corp.com": "iamhr-dana-scully"\n/, "");
  if(workflow===workflows[0]) assert.equal(codeNode(missing,node.name,[{body:{target_email:emails[0]}}])[0].code,"INVALID_SYNTHETIC_MAPPING");
  else assert.throws(()=>codeNode(missing,node.name,[{emails}],resetContext),/INVALID_SYNTHETIC_MAPPING/);
}
const [john]=codeNode(workflows[0],"Validate Request",[{body:{target_email:emails[0]}}]);
for (const [label, state] of [
  ["missing", {}], ["null", {disabled:null}],
  ["string", {disabled:"false"}], ["number", {disabled:0}],
  ["false", {disabled:false}], ["true", {disabled:true}],
]) {
  const malformed=typeof state.disabled!=="boolean";
  for (const prior_status of ["pending", "unknown"]) {
    const [probe]=codeNode(workflows[0],"GCP Check State",[{
      statusCode:200,body:JSON.stringify({email:john.expected_email,...state}),
    }],{"GCP Context":[{...john,prior_status}]});
    const uncertain=prior_status==="unknown";
    const message=`disabled=${label}, prior_status=${prior_status}`;
    assert.equal(probe.mutate,!malformed&&!uncertain&&state.disabled===false,message);
    assert.equal(probe.status,uncertain?"unknown":!malformed&&state.disabled?"succeeded":"failed",message);
    assert.equal(probe.detail.code,malformed?"STATE_READ_FAILED":uncertain?"OPERATOR_REVIEW_REQUIRED":state.disabled?"ALREADY_IN_DESIRED_STATE":"WRITE_REQUIRED",message);
  }
}
console.log("PASS: offboarding GCP state requires boolean disabled; malformed states cannot authorize writes; false requires write, true skips write, unknown remains blocked.");
for(const email of [john.expected_email.replace("test-project","wrong-project"),john.expected_email+".evil",john.expected_email.replace("john-carter","sarah-connor")]) {
  const [probe]=codeNode(workflows[0],"GCP Check State",[{statusCode:200,body:JSON.stringify({email,disabled:false})}],{"GCP Context":[john]});
  assert.equal(probe.mutate,false);
}
const targets=resetTargets.targets;
const responses=targets.map(t=>({statusCode:200,body:JSON.stringify({email:t.expected_email,disabled:true})}));
for(const ctx of [targets.map(t=>({...t,prior_status:"unknown"})),targets]) {
  const replies=ctx===targets?responses.slice(1):responses;
  const [probe]=codeNode(workflows[1],"GCP Check State",replies,{"GCP Context":ctx});
  assert.equal(probe.status,"unknown"); assert.equal(probe.mutate,false);
}
const wrongResponse=structuredClone(responses);wrongResponse[0].body=wrongResponse[1].body;
assert.equal(codeNode(workflows[1],"GCP Check State",wrongResponse,{"GCP Context":targets})[0].mutate,false);
const [probe]=codeNode(workflows[1],"GCP Check State",responses,{"GCP Context":targets});
assert.equal(probe.mutate,true);
assert.equal(codeNode(workflows[1],"GCP Expand Writes",[{}],{"GCP Check State":[probe]}).length,7);
for (const code of [429,500,0]) {
  const result=codeNode(workflows[1],"GCP Classify Write",[{statusCode:code}],{"GCP Expand Writes":[targets[0]]})[0];
  assert.equal(result.status,"unknown");
}
assert.equal(codeNode(workflows[1],"GCP Classify Write",[],{"GCP Expand Writes":[targets[0]]})[0].status,"unknown");
let invalidResetCalls=0;
await db.exec("INSERT INTO employees(full_name,email,access_groups) VALUES ('External','outsider@example.com','')");
await assert.rejects(run(workflows[1],{},{onHttp:()=>invalidResetCalls++}),/INVALID_RESET_TARGETS/);
assert.equal(invalidResetCalls,0);
await db.exec("DELETE FROM employees WHERE email='outsider@example.com'");
const recorded=reset.operation.connectors.find(c=>c.name==="gcp");
assert.equal(recorded.writes,1); // one authorization for the batch
assert.equal((await db.query("SELECT count(*)::int n FROM iam_step_events WHERE operation_id=$1 AND connector='gcp' AND phase='write' AND status='started'",[reset.operation.id])).rows[0].n,1);
console.log("PASS: exact seven-account mapping; foreign/missing/colliding targets; duplicate IDs; exact project/domain; batch uncertainty and aggregate authorization.");
const getWorkflow = JSON.parse(
  fs.readFileSync(
    new URL(
      "../automation/n8n/n8n-01-get-dashboard-data.json",
      import.meta.url,
    ),
  ),
);
const dashboard = (
  await db.query(
    getWorkflow.nodes.find((n) => n.type.endsWith(".postgres")).parameters
      .query,
  )
).rows[0].data;
assert.equal(dashboard.maintenance, true);
assert.equal(dashboard.employees.length, 7);
console.log(
  "PASS: eight explicit body mappings; default data and custom response properties; missing-body regressions in offboarding/reset; workflow 01 dashboard.",
);
console.log(
  "PASS: workflow graph simulation with PostgreSQL functions and mocked HTTP: first attempt, selective resume, repeated delivery, reset, stale cycle, invalid input.",
);
await db.close();
