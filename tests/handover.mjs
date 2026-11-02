import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
await db.exec(read('./fixtures/schema-original.sql'));
await db.exec(read('../database/002-operation-recovery.sql'));
await db.exec(read('../database/003-handover-delivery.sql'));
const w = JSON.parse(read('../automation/n8n/n8n-04-handover-report.json'));
const nodes = Object.fromEntries(w.nodes.map(n => [n.name, n]));
const email = 'dana.scully@demo-corp.com';
await db.exec(`UPDATE employees SET status='OFFBOARDED' WHERE email='${email}';
 INSERT INTO iam_operations(id,cycle,kind,target_email,status) SELECT 158,cycle,'offboard','${email}','succeeded' FROM iam_runtime;
 INSERT INTO iam_steps(operation_id,connector,ordinal,status,writes) VALUES
 (158,'postgres',1,'succeeded',1),(158,'erp',2,'succeeded',1),(158,'gcp',3,'succeeded',1);`);
const call = async (sql,args=[]) => (await db.query(sql,args)).rows[0].data;
const reserve = (recipient,owner='owner',target=email,id=158) => call('SELECT iam_handover_reserve($1,$2,$3,$4) data',[id,target,recipient,owner]);
const authorize = (id,owner='owner') => call('SELECT iam_handover_authorize($1,$2) data',[id,owner]);
const finish = (id,state,msg=null,owner='owner') => call('SELECT iam_handover_finish($1,$2,$3,$4) data',[id,owner,state,msg]);
const ledgerBefore = (await db.query('SELECT row_to_json(o) data FROM iam_operations o')).rows;
const stepsBefore = (await db.query('SELECT row_to_json(s) data FROM iam_steps s ORDER BY ordinal')).rows;
const runtimeBefore = (await db.query('SELECT row_to_json(r) data FROM iam_runtime r')).rows;
let execution=0;
const providers={gemini:0,gmail:0};
async function run(recipient, options={}) {
 const outputs={}; const owner='mock-'+(++execution);
 const $=name=>({first:()=>outputs[name][0],all:()=>outputs[name]});
 const evaluate=(value,json)=>typeof value==='string'&&value.startsWith('={{')
  ?new Function('$json','$','$execution','return ('+value.slice(3,-2)+')')(json,$,{id:owner}):value;
 // Model n8n's Header Auth admission: an unauthenticated request never enters the graph.
 if(options.auth===false) {assert.equal(nodes['Receive Request'].parameters.authentication,'headerAuth');return {code:'UNAUTHORIZED'};}
 let name='Receive Request';let input=[{json:{body:{operation_id:'158',target_email:email,visitor_email:recipient,...options.body}}}];
 for(let hops=0;name;hops++) {
  assert(hops<60);const n=nodes[name];let output=input,branch=0;
  try {
   if(n.type.endsWith('.code')) output=new Function('$json','$','$execution',n.parameters.jsCode)(input[0].json,$,{id:owner});
   else if(n.type.endsWith('.if')) branch=evaluate(n.parameters.conditions.conditions[0].leftValue,input[0].json)?0:1;
   else if(n.type.endsWith('.postgres')) {
    if(options.failNode===name) throw Error('simulated database failure');
    output=(await db.query(n.parameters.query,evaluate(n.parameters.options.queryReplacement,input[0].json))).rows.map(json=>({json}));
   } else if(n.name==='Generate Report (Gemini)') {
    providers.gemini++;assert.equal(input[0].json.employee.email,email);
    if(options.generationError) throw Error('simulated provider error');
    output=[{json:{candidates:[{finishReason:'STOP',content:{parts:[{text:'- Verify evidence.\n- Assign ownership.\n- Document handover.'}]}}]}}];
   } else if(n.name==='Send Email') {
    providers.gmail++;
    const h=(await db.query('SELECT status FROM iam_handover_requests WHERE owner=$1',[owner])).rows[0];assert.equal(h.status,'sending');
    if(options.sendError) throw Error('possible send, transport timeout');
    output=[{json:options.missingReceipt?{}:{id:'mock-message-'+owner}}];
   } else if(n.type.endsWith('.respondToWebhook')) {
    const result=evaluate(n.parameters.responseBody,input[0].json);
    return typeof result==='string'?JSON.parse(result):result;
   }
  } catch {
   assert.equal(n.onError,'continueErrorOutput',name);output=[{json:{error:'redacted'}}];branch=1;
  }
  outputs[name]=output;input=output;name=w.connections[name]?.main[branch]?.[0]?.node;
 }
 throw Error('Workflow ended without response');
}
try {
 assert(!nodes['Send Email'].retryOnFail);
 for(const n of w.nodes) {
  if(n.onError==='continueErrorOutput') assert(w.connections[n.name].main[1]?.length);
  for(const branch of w.connections[n.name]?.main??[]) for(const edge of branch) assert(nodes[edge.node]);
 }
 const before={...providers};
 for(const visitor of ['a@example.com,b@example.com','a@example.com\r\nBcc:x@example.com','a@example.com\n','a@example.com;other@example.com','"a"@example.com']) assert.equal((await run(visitor)).code,'INVALID_REQUEST');
 assert.equal((await run('a@example.com',{body:{target_email:'outsider@example.com'}})).code,'INVALID_REQUEST');
 assert.equal((await run('a@example.com',{body:{target_email:'arthur.dent@demo-corp.com'}})).code,'HANDOVER_NOT_ELIGIBLE');
 assert.equal((await run('a@example.com',{auth:false})).code,'UNAUTHORIZED');
 await db.exec("UPDATE iam_operations SET status='partial' WHERE id=158");
 assert.equal((await run('partial@example.com')).code,'HANDOVER_NOT_ELIGIBLE');
 await db.exec("UPDATE iam_operations SET status='succeeded',cycle=cycle-1 WHERE id=158");
 assert.equal((await run('stale@example.com')).code,'HANDOVER_NOT_ELIGIBLE');
 await db.exec('UPDATE iam_operations SET cycle=cycle+1 WHERE id=158');
 assert.deepEqual(providers,before);
 console.log('PASS: invalid recipient/auth/partial/stale/divergent target never reaches providers.');
 assert.equal((await run(' Visitor@Example.com ')).code,'HANDOVER_ACCEPTED');
 const calls={...providers};assert.equal((await run('visitor@example.com')).repeated,true);assert.deepEqual(providers,calls);
 assert.equal((await run('uncertain@example.com',{sendError:true})).code,'HANDOVER_UNKNOWN');
 const afterUnknown={...providers};assert.equal((await run('uncertain@example.com')).code,'HANDOVER_UNKNOWN');assert.deepEqual(providers,afterUnknown);
 assert.equal((await run('no-receipt@example.com',{missingReceipt:true})).code,'HANDOVER_UNKNOWN');
 assert.equal((await run('generation@example.com',{generationError:true})).code,'HANDOVER_FAILED_BEFORE_SEND');
 const afterGeneration={...providers};assert.equal((await run('generation@example.com')).repeated,true);assert.deepEqual(providers,afterGeneration);
 assert.equal((await run('audit-failure@example.com',{failNode:'Record Accepted'})).code,'HANDOVER_UNKNOWN');
 const afterAudit={...providers};assert.equal((await run('audit-failure@example.com')).code,'HANDOVER_IN_PROGRESS');assert.deepEqual(providers,afterAudit);
 assert.equal((await run('authorization-error@example.com',{failNode:'Authorize Email'})).code,'HANDOVER_UNKNOWN');
 assert.equal((await run('authorization-error@example.com')).code,'HANDOVER_PREPARING');
 console.log('PASS: graph mocks prove successful/repeated send, uncertainty, missing receipt, pre-send failure, authorization/audit failure and no automatic duplicate.');
 const reserved=await reserve('ownership@example.com');assert(reserved.acquired);
 assert.equal((await authorize(reserved.request_id,'foreign-owner')).authorized,false);
 assert.equal((await authorize(reserved.request_id)).authorized,true);
 assert.equal((await authorize(reserved.request_id)).authorized,false);
 await assert.rejects(finish(reserved.request_id,'failed_before_send'));
 await finish(reserved.request_id,'unknown');
 assert.equal((await reserve('ownership@example.com')).acquired,false);
 const changed=await reserve('eligibility-change@example.com');
 await db.exec('UPDATE iam_runtime SET reset_pending=true');
 assert.equal((await authorize(changed.request_id)).authorized,false);
 await db.exec('UPDATE iam_runtime SET reset_pending=false');
 assert.equal((await reserve('eligibility-change@example.com')).code,'HANDOVER_FAILED_BEFORE_SEND');
 const used=Number((await db.query('SELECT count(*) count FROM iam_handover_requests')).rows[0].count);
 await db.query('UPDATE iam_handover_config SET max_reservations=$1',[used]);
 const exhausted={...providers};assert.equal((await run('limit@example.com')).code,'HANDOVER_LIMIT_REACHED');assert.deepEqual(providers,exhausted);
 assert.equal((await reserve('visitor@example.com')).code,'HANDOVER_ACCEPTED');
 assert.equal(Number((await db.query('SELECT count(*) count FROM iam_handover_requests')).rows[0].count),used);
 await db.exec("UPDATE iam_handover_requests SET created_at=clock_timestamp()-interval '25 hours'");
 assert.equal((await reserve('next-window@example.com')).acquired,true);
 assert.deepEqual((await db.query('SELECT row_to_json(o) data FROM iam_operations o')).rows,ledgerBefore);
 assert.deepEqual((await db.query('SELECT row_to_json(s) data FROM iam_steps s ORDER BY ordinal')).rows,stepsBefore);
 assert.deepEqual((await db.query('SELECT row_to_json(r) data FROM iam_runtime r')).rows,runtimeBefore);
 console.log('PASS: ownership/transitions, eligibility recheck, failed/unknown quota accounting, rolling window and offboarding ledger/runtime preservation.');
} finally {await db.close();}
