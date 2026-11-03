"""Real Postgres concurrency checks in an explicitly supplied disposable container.

No HTTP/providers or production database connections. Container lifecycle is external.
"""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import sys
import uuid

container = sys.argv[1]
assert container.startswith('iam-hr-handover-test-')
inspection = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
assert inspection['HostConfig']['NetworkMode'] == 'none'
assert inspection['HostConfig']['Tmpfs'].get('/var/lib/postgresql/data') is not None
root = Path(__file__).resolve().parents[1]
database = 'handover_' + uuid.uuid4().hex
subprocess.run(['docker','exec',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
                '-U','postgres','-c','CREATE DATABASE '+database],check=True,capture_output=True)


def sql(text):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt',
                             '-v', 'ON_ERROR_STOP=1', '-U', 'postgres','-d',database], input=text,
                            text=True, capture_output=True, check=True)
    return result.stdout.strip()


def result(text):
    output = sql(text)
    return json.JSONDecoder().raw_decode(output[output.index('{'):])[0]


sql((root / 'tests/fixtures/schema-original.sql').read_text())
sql((root / 'database/002-operation-recovery.sql').read_text())
sql((root / 'database/003-handover-delivery.sql').read_text())
sql("""UPDATE employees SET status='OFFBOARDED' WHERE email='dana.scully@demo-corp.com';
INSERT INTO iam_operations(id,cycle,kind,target_email,status)
 SELECT 158,cycle,'offboard','dana.scully@demo-corp.com','succeeded' FROM iam_runtime;
INSERT INTO iam_steps(operation_id,connector,ordinal,status,writes) VALUES
 (158,'postgres',1,'succeeded',1),(158,'erp',2,'succeeded',1),(158,'gcp',3,'succeeded',1);""")
snapshot_sql = """SELECT json_build_object('operations',(SELECT json_agg(o) FROM iam_operations o),
 'steps',(SELECT json_agg(s ORDER BY ordinal) FROM iam_steps s),
 'runtime',(SELECT json_agg(r) FROM iam_runtime r));"""
before = result(snapshot_sql)


def reserve(recipient):
    assert recipient.replace('@', '').replace('.', '').replace('-', '').isalnum()
    return result("BEGIN; SELECT iam_handover_reserve(158,'dana.scully@demo-corp.com','"
                  + recipient + "','concurrent-owner'); SELECT pg_sleep(0.1); COMMIT;")


with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    same = list(pool.map(reserve, ['same@example.com'] * 12))
assert sum(r['acquired'] for r in same) == 1
assert len({r['request_id'] for r in same}) == 1
request_id = same[0]['request_id']


def authorize(_):
    return result("BEGIN; SELECT iam_handover_authorize(" + request_id
                  + ",'concurrent-owner'); SELECT pg_sleep(0.1); COMMIT;")


with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    authorizations = list(pool.map(authorize, range(8)))
assert sum(r['authorized'] for r in authorizations) == 1
print('PASS: 12 concurrent identical requests create one reservation; 8 authorizations allow exactly one sender.')

sql('UPDATE iam_handover_config SET max_reservations=2;')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    last_slot = list(pool.map(reserve, ['last-a@example.com', 'last-b@example.com']))
assert sum(r.get('acquired', False) for r in last_slot) == 1
assert sum(r.get('code') == 'HANDOVER_LIMIT_REACHED' for r in last_slot) == 1
assert sql('SELECT count(*) FROM iam_handover_requests;') == '2'
print('PASS: different recipients competing for the last global slot do not exceed the limit.')

sql("SELECT iam_handover_finish(" + request_id + ",'concurrent-owner','unknown',NULL);")
sql("SELECT iam_handover_finish(id,owner,'failed_before_send',NULL) FROM iam_handover_requests WHERE status='reserved';")
assert reserve('exhausted@example.com')['code'] == 'HANDOVER_LIMIT_REACHED'
assert reserve('same@example.com')['code'] == 'HANDOVER_UNKNOWN'
assert result(snapshot_sql) == before
print('PASS: failed and uncertain reservations count toward quota; replays stay blocked; offboarding state unchanged.')

# A result transaction failure after provider acceptance must leave the sending fence intact.
sql('UPDATE iam_handover_config SET max_reservations=3;')
h = reserve('audit-error@example.com')
assert result("SELECT iam_handover_authorize(" + h['request_id'] + ",'concurrent-owner');")['authorized']
sql("""CREATE FUNCTION reject_handover_audit() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.action='Handover Report' THEN RAISE EXCEPTION 'isolated audit failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER reject_handover_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_handover_audit();""")
try:
    sql("SELECT iam_handover_finish(" + h['request_id'] + ",'concurrent-owner','sent','mock-provider-id');")
    raise AssertionError('Expected audit transaction failure')
except subprocess.CalledProcessError:
    pass
assert reserve('audit-error@example.com')['status'] == 'sending'
assert not result("SELECT iam_handover_authorize(" + h['request_id'] + ",'concurrent-owner');")['authorized']
print('PASS: actual audit INSERT failure rolls back completion and preserves the sending fence.')
print('All checks used disposable Postgres, synthetic records and no providers.')
