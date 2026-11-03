import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(fs.readFileSync(new URL('./fixtures/schema-original.sql',import.meta.url),'utf8'));
await db.exec(fs.readFileSync(new URL('../database/002-operation-recovery.sql',import.meta.url),'utf8'));
const call=async(sql,args=[]) => (await db.query(sql,args)).rows[0].data;
const begin=(email,owner,id=null,kind='offboard')=>call('SELECT iam_begin($1,$2,$3,$4) data',[kind,email,id,owner]);
const next=(id,owner)=>call('SELECT iam_next($1,$2) data',[id,owner]);
const write=(id,owner,c)=>call('SELECT iam_mark_write($1,$2,$3) data',[id,owner,c]);
const record=(id,owner,c,s)=>call('SELECT iam_record($1,$2,$3,$4,$5) data',[id,owner,c,s,JSON.stringify({code:'TEST'})]);
let b=await begin('john.carter@demo-corp.com','test-1');const id=b.operation_id;
assert(b.accepted);assert.equal((await begin('sarah.connor@demo-corp.com','other')).code,'OPERATION_BUSY');
assert.equal((await next(id,'test-1')).connector,'erp');await write(id,'test-1','erp');await record(id,'test-1','erp','succeeded');
assert.equal((await next(id,'test-1')).connector,'gcp');await write(id,'test-1','gcp');await record(id,'test-1','gcp','failed');
assert.equal((await next(id,'test-1')).operation.status,'partial');
b=await begin('john.carter@demo-corp.com','test-2',id);assert(b.accepted);
assert.equal((await next(id,'test-2')).connector,'gcp');await write(id,'test-2','gcp');await record(id,'test-2','gcp','succeeded');
let done=(await next(id,'test-2')).operation;assert.equal(done.status,'succeeded');
assert.equal(done.connectors.find(c=>c.name==='erp').writes,1);assert.equal(done.connectors.find(c=>c.name==='postgres').writes,1);
assert.equal((await begin('john.carter@demo-corp.com','test-3')).replayed,true);
// A burst of deliveries must not create attempts, writes, events or audits
// for a completed operation. This is ledger deduplication, not HTTP throttling.
const ledgerState=async()=>{
 const tables=['iam_runtime','iam_operations','iam_steps','iam_step_events','employees','audit_log'];
 return Object.fromEntries(await Promise.all(tables.map(async table=>[
  table,(await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows
 ])));
};
const beforeReplays=await ledgerState();
const replays=await Promise.all(Array.from({length:16},(_,i)=>
 begin('john.carter@demo-corp.com',`replay-burst-${i}`,i%2===0?id:null)));
assert(replays.every(reply=>reply.accepted===false && reply.replayed===true && reply.operation.id===id));
assert.deepEqual(await ledgerState(),beforeReplays);
console.log('PASS: 16 repeated completed deliveries, with/without operation_id, leave the entire ledger, employees and audit unchanged (not an HTTP rate limiter).');
b=await begin('sarah.connor@demo-corp.com','test-4');const second=b.operation_id;
await next(second,'test-4');await write(second,'test-4','erp');await record(second,'test-4','erp','unknown');
await next(second,'test-4');await record(second,'test-4','gcp','succeeded');await next(second,'test-4');
assert.equal((await begin('*','reset-1',null,'reset')).code,'RECONCILIATION_REQUIRED');
b=await begin('sarah.connor@demo-corp.com','test-5',second);assert(b.accepted);
assert.equal((await next(second,'test-5')).prior_status,'unknown');
await assert.rejects(write(second,'test-5','erp'),/Write not allowed/);
await record(second,'test-5','erp','unknown');await next(second,'test-5');
await call('SELECT iam_resolve_unknown($1,$2,$3) data',[second,'erp','Confirmed execution stopped; remote state inspected.']);
await begin('sarah.connor@demo-corp.com','test-6',second);await next(second,'test-6');await record(second,'test-6','erp','succeeded');await next(second,'test-6');
b=await begin('*','reset-2',null,'reset');const reset=b.operation_id;assert(b.accepted);
await next(reset,'reset-2');await record(reset,'reset-2','erp','succeeded');await next(reset,'reset-2');await record(reset,'reset-2','gcp','failed');
assert.equal((await next(reset,'reset-2')).operation.status,'partial');
assert.equal((await begin('ellen.ripley@demo-corp.com','blocked')).code,'RESET_PENDING');
await begin('*','reset-3',reset,'reset');assert.equal((await next(reset,'reset-3')).connector,'gcp');await record(reset,'reset-3','gcp','succeeded');await next(reset,'reset-3');
assert.equal((await begin('john.carter@demo-corp.com','stale',id)).code,'OPERATION_EXPIRED');
const dash=await call('SELECT iam_dashboard() data');assert.equal(dash.employees.length,7);assert(dash.employees.every(e=>e.status==='ACTIVE'));assert.equal(dash.metrics.successful_count,2);
b=await begin('ellen.ripley@demo-corp.com','crash');await next(b.operation_id,'crash');await write(b.operation_id,'crash','erp');
assert.equal((await begin('*','reset-block',null,'reset')).code,'OPERATION_BUSY');
await call('SELECT iam_release_stopped($1) data',['crash']);
const snapshot=await call('SELECT iam_snapshot($1) data',[b.operation_id]);assert.equal(snapshot.connectors.find(c=>c.name==='erp').status,'unknown');
console.log('PASS: resume skips ERP/Postgres; concurrent attempts blocked; completed delivery deduplicated; unknown writes blocked; reset blocks/recovers; stale operation rejected; stopped execution preserved; dashboard metrics.');
await db.close();
