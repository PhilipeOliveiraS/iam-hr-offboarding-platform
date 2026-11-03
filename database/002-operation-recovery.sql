-- Apply once to the EXISTING iam_hr database. Additive migration; preserves employees/audit_log.
BEGIN;
CREATE TABLE IF NOT EXISTS iam_runtime (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 cycle bigint NOT NULL DEFAULT 1,
 owner text,
 operation_id bigint,
 reset_pending boolean NOT NULL DEFAULT false
);
INSERT INTO iam_runtime(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS iam_operations (
 id bigserial PRIMARY KEY,
 cycle bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN ('offboard','reset')),
 target_email text NOT NULL,
 status text NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 attempt_started_at timestamptz,
 finished_at timestamptz,
 processing_ms bigint NOT NULL DEFAULT 0,
 last_owner text,
 UNIQUE(cycle,kind,target_email)
);
CREATE TABLE IF NOT EXISTS iam_steps (
 operation_id bigint NOT NULL REFERENCES iam_operations(id),
 connector text NOT NULL CHECK(connector IN ('postgres','erp','gcp')),
 ordinal integer NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','unknown')),
 checks integer NOT NULL DEFAULT 0,
 writes integer NOT NULL DEFAULT 0,
 duration_ms bigint NOT NULL DEFAULT 0,
 started_at timestamptz,
 last_owner text,
 phase text,
 prior_status text,
 detail jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(operation_id,connector)
);
CREATE TABLE IF NOT EXISTS iam_step_events (
 id bigserial PRIMARY KEY,
 operation_id bigint NOT NULL REFERENCES iam_operations(id),
 connector text NOT NULL,
 owner text NOT NULL,
 phase text NOT NULL,
 status text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION iam_snapshot(p_id bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('id',o.id::text,'cycle',o.cycle::text,'kind',o.kind,'target_email',o.target_email,
 'status',o.status,'attempts',o.attempts,'started_at',o.started_at,'finished_at',o.finished_at,
 'processing_ms',o.processing_ms,'elapsed_ms',CASE WHEN o.finished_at IS NULL THEN NULL ELSE
 (extract(epoch FROM o.finished_at-o.started_at)*1000)::bigint END,
 'stale',o.cycle<>(SELECT cycle FROM iam_runtime WHERE singleton),
 'connectors',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',s.connector,'status',s.status,
 'checks',s.checks,'writes',s.writes,'duration_ms',s.duration_ms,'detail',s.detail) ORDER BY ordinal)
 FROM iam_steps s WHERE s.operation_id=o.id),'[]'::jsonb))
 FROM iam_operations o WHERE o.id=p_id;
$$;

CREATE OR REPLACE FUNCTION iam_begin(p_kind text,p_email text,p_id bigint,p_owner text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r iam_runtime%ROWTYPE; o iam_operations%ROWTYPE; em text := lower(trim(p_email));
BEGIN
 SELECT * INTO r FROM iam_runtime WHERE singleton FOR UPDATE;
 IF p_kind NOT IN ('offboard','reset') OR COALESCE(p_owner,'')='' THEN
 RETURN jsonb_build_object('accepted',false,'code','INVALID_REQUEST','http_status',400); END IF;
 IF r.owner IS NOT NULL THEN RETURN jsonb_build_object('accepted',false,'code','OPERATION_BUSY',
 'http_status',409,'operation',iam_snapshot(r.operation_id)); END IF;
 IF p_kind='offboard' AND r.reset_pending THEN RETURN jsonb_build_object('accepted',false,'code','RESET_PENDING','http_status',409); END IF;
 IF p_kind='reset' THEN
  em := '*';
  IF EXISTS(SELECT 1 FROM iam_steps s JOIN iam_operations x ON x.id=s.operation_id
    WHERE x.cycle=r.cycle AND x.kind='offboard' AND s.status IN ('running','unknown')) THEN
   RETURN jsonb_build_object('accepted',false,'code','RECONCILIATION_REQUIRED','http_status',409);
  END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM employees WHERE email=em) THEN
   RETURN jsonb_build_object('accepted',false,'code','EMPLOYEE_NOT_FOUND','http_status',404); END IF;
 END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO o FROM iam_operations WHERE id=p_id;
  IF NOT FOUND OR o.kind<>p_kind OR o.target_email<>em THEN RETURN jsonb_build_object('accepted',false,'code','OPERATION_MISMATCH','http_status',409); END IF;
  IF o.cycle<>r.cycle THEN RETURN jsonb_build_object('accepted',false,'code','OPERATION_EXPIRED','http_status',409,'operation',iam_snapshot(o.id)); END IF;
 ELSE
  SELECT * INTO o FROM iam_operations WHERE cycle=r.cycle AND kind=p_kind AND target_email=em;
  IF NOT FOUND THEN
   INSERT INTO iam_operations(cycle,kind,target_email) VALUES(r.cycle,p_kind,em) RETURNING * INTO o;
   INSERT INTO iam_steps(operation_id,connector,ordinal) VALUES
    (o.id,'postgres',CASE WHEN p_kind='reset' THEN 3 ELSE 1 END),
    (o.id,'erp',CASE WHEN p_kind='reset' THEN 1 ELSE 2 END),
    (o.id,'gcp',CASE WHEN p_kind='reset' THEN 2 ELSE 3 END);
  END IF;
 END IF;
 IF p_kind='offboard' AND EXISTS(SELECT 1 FROM iam_steps s JOIN iam_operations x ON x.id=s.operation_id WHERE x.cycle=r.cycle AND x.id<>o.id AND s.status='unknown') THEN
 RETURN jsonb_build_object('accepted',false,'code','RECONCILIATION_REQUIRED','http_status',409); END IF;
 IF o.status='succeeded' THEN RETURN jsonb_build_object('accepted',false,'replayed',true,'http_status',200,'operation',iam_snapshot(o.id)); END IF;
 -- A duplicated delivery with the same execution identity must not replay a completed attempt.
 IF o.last_owner=p_owner THEN RETURN jsonb_build_object('accepted',false,'code','ATTEMPT_ALREADY_FINISHED','http_status',409,'operation',iam_snapshot(o.id)); END IF;
 UPDATE iam_runtime SET owner=p_owner,operation_id=o.id,reset_pending=(reset_pending OR p_kind='reset') WHERE singleton;
 UPDATE iam_operations SET status='running',attempts=attempts+1,last_owner=p_owner,attempt_started_at=clock_timestamp(),finished_at=NULL WHERE id=o.id;
 RETURN jsonb_build_object('accepted',true,'operation_id',o.id::text,'owner',p_owner,'kind',p_kind);
END $$;

CREATE OR REPLACE FUNCTION iam_next(p_id bigint,p_owner text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r iam_runtime%ROWTYPE; o iam_operations%ROWTYPE; s iam_steps%ROWTYPE; outcome text; elapsed bigint; t timestamptz;
BEGIN
 SELECT * INTO r FROM iam_runtime WHERE singleton FOR UPDATE;
 IF r.owner IS DISTINCT FROM p_owner OR r.operation_id IS DISTINCT FROM p_id THEN RAISE EXCEPTION 'Execution does not own operation'; END IF;
 SELECT * INTO o FROM iam_operations WHERE id=p_id;
 IF EXISTS(SELECT 1 FROM iam_steps WHERE operation_id=p_id AND status='running') THEN RAISE EXCEPTION 'A connector is still running'; END IF;
 SELECT * INTO s FROM iam_steps WHERE operation_id=p_id AND status<>'succeeded'
  AND last_owner IS DISTINCT FROM p_owner ORDER BY ordinal LIMIT 1;
 IF FOUND AND s.connector='postgres' THEN
  t:=clock_timestamp();
  IF o.kind='offboard' THEN
   UPDATE employees SET status='OFFBOARDED',updated_at=clock_timestamp() WHERE email=o.target_email;
   UPDATE iam_steps SET status='succeeded',writes=writes+1,last_owner=p_owner,
     duration_ms=duration_ms+greatest(0,(extract(epoch FROM clock_timestamp()-t)*1000)::bigint),
     detail='{"record_updated":true}' WHERE operation_id=p_id AND connector='postgres';
  ELSIF NOT EXISTS(SELECT 1 FROM iam_steps WHERE operation_id=p_id AND connector<>'postgres' AND status<>'succeeded') THEN
   UPDATE employees SET status='ACTIVE',updated_at=clock_timestamp();
   UPDATE iam_steps SET status='succeeded',writes=writes+1,last_owner=p_owner,
     duration_ms=duration_ms+greatest(0,(extract(epoch FROM clock_timestamp()-t)*1000)::bigint),
     detail='{"baseline_restored":true}' WHERE operation_id=p_id AND connector='postgres';
  ELSE
   UPDATE iam_steps SET status='pending',last_owner=p_owner,detail='{"code":"WAITING_FOR_CONNECTORS"}' WHERE operation_id=p_id AND connector='postgres';
  END IF;
  INSERT INTO iam_step_events(operation_id,connector,owner,phase,status,detail)
   SELECT p_id,connector,p_owner,'database',status,detail FROM iam_steps WHERE operation_id=p_id AND connector='postgres';
  RETURN iam_next(p_id,p_owner);
 END IF;
 IF FOUND THEN
  UPDATE iam_steps SET prior_status=status,status='running',phase='probe',checks=checks+1,
   started_at=clock_timestamp(),last_owner=p_owner WHERE operation_id=p_id AND connector=s.connector;
  RETURN jsonb_build_object('done',false,'operation_id',p_id::text,'owner',p_owner,'kind',o.kind,
   'target_email',o.target_email,'connector',s.connector,'prior_status',s.status);
 END IF;
 IF EXISTS(SELECT 1 FROM iam_steps WHERE operation_id=p_id AND status='unknown') THEN outcome:='unknown';
 ELSIF EXISTS(SELECT 1 FROM iam_steps WHERE operation_id=p_id AND status<>'succeeded') THEN outcome:='partial';
 ELSE outcome:='succeeded'; END IF;
 elapsed:=greatest(0,(extract(epoch FROM clock_timestamp()-o.attempt_started_at)*1000)::bigint);
 -- Completion and audit commit atomically. processing_ms ends immediately before this final audit transaction commits.
 UPDATE iam_operations SET status=outcome,processing_ms=processing_ms+elapsed,finished_at=clock_timestamp() WHERE id=p_id;
 INSERT INTO audit_log(target_email,action,status,detail) VALUES(o.target_email,
  CASE WHEN o.kind='reset' THEN 'Demo Reset' ELSE 'Offboarding Executed' END,
  CASE WHEN outcome='succeeded' THEN 'Success' WHEN outcome='unknown' THEN 'Needs Review' ELSE 'Partial Success' END,
  jsonb_build_object('operation',iam_snapshot(p_id),'execution_id',p_owner));
 UPDATE iam_runtime SET owner=NULL,operation_id=NULL,
  cycle=CASE WHEN o.kind='reset' AND outcome='succeeded' THEN cycle+1 ELSE cycle END,
  reset_pending=CASE WHEN o.kind='reset' AND outcome='succeeded' THEN false ELSE reset_pending END WHERE singleton;
 RETURN jsonb_build_object('done',true,'operation',iam_snapshot(p_id));
END $$;

CREATE OR REPLACE FUNCTION iam_mark_write(p_id bigint,p_owner text,p_connector text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r iam_runtime%ROWTYPE; s iam_steps%ROWTYPE;
BEGIN
 SELECT * INTO r FROM iam_runtime WHERE singleton FOR UPDATE;
 IF r.owner IS DISTINCT FROM p_owner OR r.operation_id IS DISTINCT FROM p_id THEN RAISE EXCEPTION 'Execution does not own operation'; END IF;
 SELECT * INTO s FROM iam_steps WHERE operation_id=p_id AND connector=p_connector FOR UPDATE;
 IF s.status<>'running' OR s.phase<>'probe' OR s.prior_status='unknown' THEN RAISE EXCEPTION 'Write not allowed'; END IF;
 UPDATE iam_steps SET writes=writes+1,phase='write' WHERE operation_id=p_id AND connector=p_connector;
 INSERT INTO iam_step_events(operation_id,connector,owner,phase,status) VALUES(p_id,p_connector,p_owner,'write','started');
 RETURN jsonb_build_object('authorized',true);
END $$;

CREATE OR REPLACE FUNCTION iam_record(p_id bigint,p_owner text,p_connector text,p_status text,p_detail jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r iam_runtime%ROWTYPE; s iam_steps%ROWTYPE;
BEGIN
 SELECT * INTO r FROM iam_runtime WHERE singleton FOR UPDATE;
 IF r.owner IS DISTINCT FROM p_owner OR r.operation_id IS DISTINCT FROM p_id THEN RAISE EXCEPTION 'Execution does not own operation'; END IF;
 SELECT * INTO s FROM iam_steps WHERE operation_id=p_id AND connector=p_connector FOR UPDATE;
 IF s.status<>'running' OR p_status NOT IN ('succeeded','failed','unknown') THEN RAISE EXCEPTION 'Invalid connector result'; END IF;
 UPDATE iam_steps SET status=p_status,detail=COALESCE(p_detail,'{}'),
 duration_ms=duration_ms+greatest(0,(extract(epoch FROM clock_timestamp()-started_at)*1000)::bigint)
 WHERE operation_id=p_id AND connector=p_connector;
 INSERT INTO iam_step_events(operation_id,connector,owner,phase,status,detail) VALUES(p_id,p_connector,p_owner,s.phase,p_status,p_detail);
 RETURN jsonb_build_object('recorded',true);
END $$;

-- Administrative recovery ONLY AFTER confirming the owning n8n execution is stopped.
-- No automatic lock expiry: a remote request can outlive a local timeout.
CREATE OR REPLACE FUNCTION iam_release_stopped(p_owner text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r iam_runtime%ROWTYPE;
BEGIN
 SELECT * INTO r FROM iam_runtime WHERE singleton FOR UPDATE;
 IF r.owner IS DISTINCT FROM p_owner THEN RAISE EXCEPTION 'Owner mismatch'; END IF;
 UPDATE iam_steps SET status=CASE WHEN phase='write' THEN 'unknown' ELSE COALESCE(prior_status,'pending') END,
 detail=jsonb_build_object('code','EXECUTION_STOPPED_REQUIRES_RECONCILIATION') WHERE operation_id=r.operation_id AND status='running';
 UPDATE iam_operations SET status='unknown',processing_ms=processing_ms+greatest(0,(extract(epoch FROM clock_timestamp()-attempt_started_at)*1000)::bigint),finished_at=clock_timestamp() WHERE id=r.operation_id;
 INSERT INTO audit_log(target_email,action,status,detail) SELECT target_email,'Stopped Execution Released','Needs Review',
 jsonb_build_object('operation_id',id,'execution_id',p_owner) FROM iam_operations WHERE id=r.operation_id;
 UPDATE iam_runtime SET owner=NULL,operation_id=NULL WHERE singleton;
 RETURN iam_snapshot(r.operation_id);
END $$;

-- Operator-only decision after confirming no remote request remains in flight and inspecting the target.
CREATE OR REPLACE FUNCTION iam_resolve_unknown(p_id bigint,p_connector text,p_note text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r iam_runtime%ROWTYPE;
BEGIN
 SELECT * INTO r FROM iam_runtime WHERE singleton FOR UPDATE;
 IF r.owner IS NOT NULL OR length(trim(COALESCE(p_note,'')))<12 THEN RAISE EXCEPTION 'Idle runtime and evidence note required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM iam_operations WHERE id=p_id AND cycle=r.cycle) THEN RAISE EXCEPTION 'Expired operation'; END IF;
 UPDATE iam_steps SET status='failed',detail=jsonb_build_object('code','OPERATOR_AUTHORIZED_RETRY','note',p_note)
 WHERE operation_id=p_id AND connector=p_connector AND status='unknown';
 IF NOT FOUND THEN RAISE EXCEPTION 'Connector is not unknown'; END IF;
 INSERT INTO audit_log(target_email,action,status,detail) SELECT target_email,'Connector Retry Authorized','Needs Review',
 jsonb_build_object('operation_id',p_id,'connector',p_connector,'note',p_note) FROM iam_operations WHERE id=p_id;
 RETURN iam_snapshot(p_id);
END $$;

CREATE OR REPLACE FUNCTION iam_dashboard() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('cycle',r.cycle::text,'maintenance',r.reset_pending,'busy',r.owner IS NOT NULL,
 'employees',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'full_name',e.full_name,'email',e.email,
 'status',CASE WHEN o.status IN ('running','partial','unknown') THEN upper(o.status) ELSE e.status::text END,
 'record_status',e.status,'access_groups',e.access_groups,
 'operation',CASE WHEN o.id IS NULL THEN NULL ELSE iam_snapshot(o.id) END) ORDER BY e.id)
 FROM employees e LEFT JOIN iam_operations o ON o.target_email=e.email AND o.cycle=r.cycle AND o.kind='offboard'),'[]'::jsonb),
 'metrics',(SELECT jsonb_build_object('avg_processing_ms',round(avg(processing_ms) FILTER(WHERE status='succeeded')),
 'successful_count',count(*) FILTER(WHERE status='succeeded'),'partial_count',count(*) FILTER(WHERE status='partial'),
 'unknown_count',count(*) FILTER(WHERE status='unknown'),'window_hours',24)
 FROM iam_operations WHERE kind='offboard' AND finished_at>=now()-interval '24 hours')) FROM iam_runtime r WHERE singleton;
$$;
COMMIT;
