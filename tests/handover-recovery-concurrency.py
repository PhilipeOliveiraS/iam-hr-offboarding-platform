"""Request-1 authorization race in disposable Postgres; no external providers."""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import time
import uuid

name = 'iam-hr-handover-test-recovery-' + uuid.uuid4().hex[:10]
root = Path(__file__).resolve().parents[1]


def sql(text):
    return subprocess.run(['docker','exec','-i',name,'psql','-X','-qAt',
        '-v','ON_ERROR_STOP=1','-U','postgres'],input=text,text=True,
        capture_output=True,check=True).stdout.strip()


def result(text):
    out=sql(text)
    return json.JSONDecoder().raw_decode(out[out.index('{'):])[0]


subprocess.run(['docker','run','--detach','--name',name,'--network','none',
    '--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust',
    'postgres:16-alpine'],check=True,capture_output=True)
try:
    for attempt in range(40):
        try:
            sql('SELECT 1;')
            break
        except subprocess.CalledProcessError:
            time.sleep(0.25)
    else:
        raise RuntimeError('Disposable Postgres did not start')
    for path in ['tests/fixtures/schema-original.sql','database/002-operation-recovery.sql','database/003-handover-delivery.sql']:
        sql((root/path).read_text())
    sql("""UPDATE employees SET status='OFFBOARDED' WHERE email='dana.scully@demo-corp.com';
    INSERT INTO iam_operations(id,cycle,kind,target_email,status,attempts) VALUES(158,1,'offboard','dana.scully@demo-corp.com','succeeded',2);
    INSERT INTO iam_steps(operation_id,connector,ordinal,status,writes) VALUES(158,'postgres',1,'succeeded',1),(158,'erp',2,'succeeded',1),(158,'gcp',3,'succeeded',1);
    INSERT INTO iam_handover_requests(id,operation_id,cycle,target_email,recipient,owner,status,authorized_at,finished_at,result_code)
     VALUES(1,158,1,'dana.scully@demo-corp.com','recipient@example.com','15122','unknown',clock_timestamp(),clock_timestamp(),'SEND_UNCONFIRMED');
    INSERT INTO audit_log(id,target_email,action,status,detail) VALUES(178,'dana.scully@demo-corp.com','Handover Report','Needs Review','{"handover_request_id":"1","execution_id":"15122","outcome":"unknown"}');
    SELECT setval('audit_log_id_seq',178);""")
    digest='a'*64
    detail=json.dumps({'recovery_key':'request-1-execution-15122-once','snapshot_digest':digest,'decision':'AUTHENTICATION_REJECTED_NO_ACCEPTANCE'})
    sql("INSERT INTO audit_log(target_email,action,status,requester,detail) VALUES('dana.scully@demo-corp.com','Handover Recovery Approved','Approved','operator','"+detail+"'::jsonb);")
    sql((root/'automation/sql/handover-recover-request-1.sql').read_text())
    snapshot="""SELECT jsonb_build_object('operation',(SELECT to_jsonb(o) FROM iam_operations o WHERE id=158),
    'steps',(SELECT jsonb_agg(s ORDER BY ordinal) FROM iam_steps s WHERE operation_id=158),
    'audit178',(SELECT to_jsonb(a) FROM audit_log a WHERE id=178),
    'reservation_count',(SELECT count(*) FROM iam_handover_requests),
    'created_at',(SELECT created_at FROM iam_handover_requests WHERE id=1));"""
    before=result(snapshot)

    def claim(owner):
        r=result("BEGIN; SELECT iam_handover_recover_request_1('"+str(owner)+"','"+digest+"'); SELECT pg_sleep(0.1); COMMIT;")
        return owner,r

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        claims=list(pool.map(claim,range(20000,20012)))
    accepted=[owner for owner,r in claims if r.get('authorized')]
    assert len(accepted)==1
    assert sql("SELECT count(*) FROM audit_log WHERE action='Handover Recovery Authorized';")=='1'
    assert result(snapshot)==before
    winner=accepted[0]
    sql("SELECT iam_handover_finish(1,'"+str(winner)+"','unknown',NULL);")
    assert not claim(21000)[1]['authorized']
    assert not claim(winner)[1]['authorized']
    assert result(snapshot)==before
    print('PASS: 12 concurrent recovery claims authorize one mock sender and append one authorization audit.')
    print('PASS: new unknown stays fenced; reservation count/timestamp, original audit, operation and connector counters unchanged.')
    print('No Gmail/Gemini calls; isolated PostgreSQL only.')
finally:
    subprocess.run(['docker','rm','--force',name],check=True,capture_output=True)
