import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const schema = [read('./fixtures/schema-original.sql'), read('../database/002-operation-recovery.sql'), read('../database/003-handover-delivery.sql')];
const recoverySql = read('../automation/sql/handover-recover-request-1.sql');
const template = JSON.parse(read('../automation/n8n/handover-request-1-recovery.template.json'));
const digest = 'a'.repeat(64);
const fixture = {snapshot_digest:digest,visitor_email:'recipient@example.com',employee:{full_name:'Dana Scully',email:'dana.scully@demo-corp.com',access_groups:'Compliance, Research, General',status:'OFFBOARDED'},content:'- Original validated draft.\n- Assign ownership.\n- Document handover.'};

async function database() {
 const db=new PGlite();for(const sql of schema) await db.exec(sql);
 await db.exec(`UPDATE employees SET status='OFFBOARDED' WHERE email='dana.scully@demo-corp.com';
 INSERT INTO iam_operations(id,cycle,kind,target_email,status,attempts) VALUES(158,1,'offboard','dana.scully@demo-corp.com','succeeded',2);
 INSERT INTO iam_steps(operation_id,connector,ordinal,status,writes) VALUES (158,'postgres',1,'succeeded',1),(158,'erp',2,'succeeded',1),(158,'gcp',3,'succeeded',1);
 INSERT INTO iam_handover_requests(id,operation_id,cycle,target_email,recipient,owner,status,authorized_at,finished_at,result_code)
 VALUES(1,158,1,'dana.scully@demo-corp.com','recipient@example.com','15122','unknown',clock_timestamp(),clock_timestamp(),'SEND_UNCONFIRMED');
 INSERT INTO audit_log(id,target_email,action,status,detail) VALUES(178,'dana.scully@demo-corp.com','Handover Report','Needs Review','{"handover_request_id":"1","execution_id":"15122","outcome":"unknown"}');
 SELECT setval('audit_log_id_seq',178);`);
 await db.query(`INSERT INTO audit_log(target_email,action,status,requester,detail) VALUES('dana.scully@demo-corp.com','Handover Recovery Approved','Approved','operator',$1::jsonb)`,[JSON.stringify({recovery_key:'request-1-execution-15122-once',snapshot_digest:digest,decision:'AUTHENTICATION_REJECTED_NO_ACCEPTANCE'})]);
 await db.exec(recoverySql);return db;
}
async function call(db,owner,hash=digest){return (await db.query('SELECT iam_handover_recover_request_1($1,$2) data',[owner,hash])).rows[0].data;}
let sends=0;
async function run(db,owner,options={}) {
 const w=structuredClone(template);w.nodes.find(n=>n.name==='Restricted Snapshot').parameters.jsonOutput=JSON.stringify(fixture);
 const nodes=Object.fromEntries(w.nodes.map(n=>[n.name,n]));const outputs={};let name='Manual Start',input=[{json:{}}];
 const $=n=>({first:()=>outputs[n][0]});
 const evaluate=(v,j)=>typeof v==='string'&&v.startsWith('={{')?new Function('$json','$','$execution','return ('+v.slice(3,-2)+')')(j,$,{id:owner}):v;
 for(let hop=0;name;hop++) {
  assert(hop<30);const n=nodes[name];let output=input,branch=0;
  try {
   if(n.type.endsWith('.set')) {let j=evaluate(n.parameters.jsonOutput,input[0].json);if(typeof j==='string')j=JSON.parse(j);output=[{json:j}];}
   else if(n.type.endsWith('.if'))branch=evaluate(n.parameters.conditions.conditions[0].leftValue,input[0].json)?0:1;
   else if(n.type.endsWith('.postgres')) {
    if(options.failRecord&&n.name==='Record Accepted')throw Error('mock result failure');
    output=(await db.query(n.parameters.query,evaluate(n.parameters.options.queryReplacement,input[0].json))).rows.map(json=>({json}));
   } else if(n.type.endsWith('.gmail')) {
    assert(!n.retryOnFail);sends++;
    const h=(await db.query('SELECT * FROM iam_handover_requests WHERE id=1')).rows[0];assert.equal(h.owner,owner);assert.equal(h.status,'sending');
    assert.equal(evaluate(n.parameters.sendTo,input[0].json),fixture.visitor_email);
    assert.equal(evaluate(n.parameters.subject,input[0].json),'IAM-HR | Handover draft - Dana Scully');
    assert.equal(n.parameters.emailType,'text');assert(evaluate(n.parameters.message,input[0].json).includes(fixture.content));
    if(options.sendError)throw Error('mock uncertain Gmail');output=[{json:options.missingReceipt?{}:{id:'mock-gmail-id'}}];
   }
  }catch{assert.equal(n.onError,'continueErrorOutput');branch=1;output=[{json:{error:'mock error omitted'}}];}
  outputs[name]=output;input=output;name=w.connections[name]?.main[branch]?.[0]?.node;
 }
 return input[0].json;
}

const db=await database();
try {
 const before=(await db.query('SELECT row_to_json(o) data FROM iam_operations o WHERE id=158')).rows;
 const audit=(await db.query('SELECT row_to_json(a) data FROM audit_log a WHERE id=178')).rows;
 const originalCreated=(await db.query('SELECT created_at FROM iam_handover_requests WHERE id=1')).rows[0];
 assert.equal((await call(db,'15122')).authorized,false);
 assert.equal((await call(db,'15123','b'.repeat(64))).authorized,false);
 await db.exec('UPDATE iam_runtime SET reset_pending=true');assert.equal((await call(db,'15123')).authorized,false);
 await db.exec('UPDATE iam_runtime SET reset_pending=false');
 const r=await run(db,'15123');assert.equal(r.code,'HANDOVER_ACCEPTED');assert.equal(sends,1);
 assert.equal((await run(db,'15124')).code,'RECOVERY_BLOCKED_OR_UNCERTAIN');assert.equal(sends,1);
 assert.equal((await db.query("SELECT count(*) count FROM audit_log WHERE action='Handover Recovery Authorized'")).rows[0].count,1);
 assert.equal((await db.query('SELECT count(*) count FROM iam_handover_requests')).rows[0].count,1);
 assert.deepEqual((await db.query('SELECT created_at FROM iam_handover_requests WHERE id=1')).rows[0],originalCreated);
 assert.deepEqual((await db.query('SELECT row_to_json(o) data FROM iam_operations o WHERE id=158')).rows,before);
 assert.deepEqual((await db.query('SELECT row_to_json(a) data FROM audit_log a WHERE id=178')).rows,audit);
 console.log('PASS: exact request/old-owner/evidence/digest/eligibility guards, one reservation and one recovery sender; original audit/offboarding preserved.');
}finally{await db.close();}
for(const scenario of [{sendError:true},{missingReceipt:true},{failRecord:true}]) {
 const db=await database();try {
  const before=sends;await run(db,'15123',scenario);assert.equal(sends,before+1);
  const state=(await db.query('SELECT status FROM iam_handover_requests WHERE id=1')).rows[0].status;
  assert.equal(state,scenario.failRecord?'sending':'unknown');
  await run(db,'15124');assert.equal(sends,before+1);
  assert.equal((await call(db,'15123')).authorized,false);
 }finally{await db.close();}
}
assert(!template.nodes.some(n=>n.type.endsWith('.webhook')||n.name.includes('Generate')));
console.log('PASS: Gmail mock only; timeout/missing receipt/result failure stay fenced; no Gemini, public endpoint or automatic retry.');
