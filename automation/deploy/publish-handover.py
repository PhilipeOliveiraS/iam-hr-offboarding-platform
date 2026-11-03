#!/usr/bin/env python3
"""Publish the reviewed handover graph with existing provider configuration.

Uses the installation's validated PUT ?publishIfActive=false + POST /publish API.
No workflow/webhook/provider executions. Credentials are never decrypted or printed.
"""
import copy
import datetime
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

ID = 'bXvV6huhS8fSluZy'
BASELINE = 'a410bcaa-5512-4e33-8226-6fb4628ae299'
PROVIDERS = ('Generate Report (Gemini)', 'Parse Gemini Response', 'Send Email')
REVISION = {'updatedAt', 'versionId', 'versionCounter', 'activeVersionId', 'activeVersion'}
GRAPH = ('nodes', 'connections', 'nodeGroups')


class Stop(Exception):
    pass


def require(condition, message):
    if not condition:
        raise Stop(message)


def nodes(workflow):
    value = workflow.get('nodes')
    require(isinstance(value, list), 'Invalid nodes.')
    result = {n['name']: n for n in value}
    require(len(result) == len(value), 'Duplicate node names.')
    return result


def secure_write(path, value):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    os.umask(0o077)
    key = os.environ.get('N8N_API_KEY')
    base = os.environ.get('N8N_API_BASE_URL', '').rstrip('/')
    require(bool(key) and bool(base), 'Load N8N_API_KEY and N8N_API_BASE_URL securely in this terminal.')
    parsed = urllib.parse.urlsplit(base)
    require(parsed.scheme == 'https' or (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '::1')),
            'Use HTTPS or an existing loopback SSH tunnel.')
    require(parsed.hostname and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment
            and parsed.path == '/api/v1', 'Invalid API base URL.')
    host = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                           'philipe@192.168.7.29', 'hostname'], capture_output=True, text=True, check=True).stdout.strip()
    require(host == 'cortex-01', 'Unexpected hostname.')
    # Read-only preflight: schema must already exist and have the approved setting.
    preflight = """docker exec factory-postgres-1 sh -c 'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT max_reservations FROM iam_handover_config WHERE singleton;"'"""
    checked = subprocess.run(['ssh', 'philipe@192.168.7.29', preflight], capture_output=True, text=True, check=True)
    require(checked.stdout.strip() == '20', 'Expected migrated schema and approved initial quota 20.')
    opener = urllib.request.build_opener(NoRedirect)

    def api(method, workflow_id=ID, suffix='', body=None):
        request = urllib.request.Request(base + '/workflows/' + workflow_id + suffix,
            data=None if body is None else json.dumps(body).encode(), method=method,
            headers={'X-N8N-API-KEY': key, 'Content-Type': 'application/json'})
        try:
            with opener.open(request, timeout=60) as response:
                result = json.load(response)
            require(isinstance(result, dict), 'Invalid API response.')
            return result
        except urllib.error.HTTPError as error:
            raise Stop(f'API {method}: HTTP {error.code}; body omitted.') from None
        except (urllib.error.URLError, OSError, ValueError):
            raise Stop(f'API {method}: transport/response failure; details omitted. Inspect state before retrying.') from None

    before = api('GET')
    require(before.get('id') == ID and before.get('name') == 'IAM-HR - Lead Capture and Handover Report', 'Unexpected workflow.')
    require(before.get('active') is False and before.get('activeVersionId') is None and before.get('versionId') == BASELINE,
            'Workflow changed or was activated concurrently; stop for review.')
    history = api('GET', suffix='/versions/' + BASELINE)
    require(history.get('versionId') == BASELINE and history.get('workflowId') == ID, 'Unexpected last publication.')
    for field in GRAPH:
        require(before.get(field) == history.get(field), 'Draft differs from last functional publication.')
    root = Path(__file__).resolve().parents[2]
    template = json.loads((root / 'automation/n8n/n8n-04-handover-report.json').read_text())
    original = nodes(before)
    target = nodes(template)
    for name in PROVIDERS:
        a = copy.deepcopy(original[name]['parameters'])
        b = copy.deepcopy(target[name]['parameters'])
        if name == 'Generate Report (Gemini)':
            a['url'] = '__PRESERVE_PUBLISHED_PROVIDER_URL__'
            a['headerParameters'] = {'parameters': []}
        require(a == b, 'Provider prompt/parser/content changed unexpectedly; stop for review.')
    require(not original['Send Email'].get('retryOnFail', False), 'Automatic Gmail retry must stay disabled.')
    pg = copy.deepcopy(original['Get Employee'].get('credentials'))
    require(pg and 'postgres' in pg, 'Existing Postgres credential binding unavailable.')
    offboard = api('GET', workflow_id='vIHvzH7Y8J1nKyoD')
    require(offboard.get('active') is True, 'Offboarding reference is not active.')
    auth_nodes = [n for n in offboard['activeVersion']['nodes'] if n['type'] == 'n8n-nodes-base.webhook']
    require(len(auth_nodes) == 1 and auth_nodes[0]['parameters'].get('authentication') == 'headerAuth', 'Reference Header Auth unavailable.')
    auth = copy.deepcopy(auth_nodes[0].get('credentials'))
    require(auth and auth.get('httpHeaderAuth', {}).get('id'), 'Existing Header Auth binding missing.')
    built = []
    for planned in template['nodes']:
        name = planned['name']
        if name in PROVIDERS:
            result = copy.deepcopy(original[name])
        elif name in original:
            result = copy.deepcopy(original[name])
            if name == 'Receive Request':
                result['parameters']['authentication'] = 'headerAuth'
                result['credentials'] = auth
            else:
                result['parameters'] = copy.deepcopy(planned['parameters'])
                # Existing error-routing flags remain; planned new graph handles them.
        else:
            result = copy.deepcopy(planned)
        if result['type'] == 'n8n-nodes-base.postgres':
            result['credentials'] = pg
        built.append(result)
    expected = copy.deepcopy(before)
    expected['nodes'] = built
    expected['connections'] = template['connections']
    for name in PROVIDERS:
        require(nodes(expected)[name] == original[name], 'Original provider node was modified.')
    require(expected['settings'] == before['settings'], 'Settings changed.')
    # All surviving original nodes keep their credential binding, except the newly protected webhook.
    for n in built:
        if n['name'] in original and n['name'] != 'Receive Request':
            require(n.get('credentials') == original[n['name']].get('credentials'), 'Existing credential binding changed.')
    backup_root = Path.home() / '.local/state/iam-hr-rollback'
    require(not any(p.is_symlink() for p in (backup_root, *backup_root.parents)), 'Unsafe backup directory.')
    backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(stat.S_IMODE(backup_root.stat().st_mode) == 0o700, 'Backup root must be 0700.')
    backup = Path(tempfile.mkdtemp(prefix='HANDOVER-', dir=backup_root))
    secure_write(backup / 'workflow-before.json', before)
    secure_write(backup / 'published-before.json', history)
    print('Restricted backup:', backup, flush=True)
    print('Original Gemini/parser/Gmail nodes unchanged; existing bindings reused. No providers will be executed.', flush=True)
    payload = {k: expected[k] for k in ('name', 'nodes', 'connections', 'settings')}
    require(api('GET') == before and api('GET', suffix='/versions/' + BASELINE) == history,
            'Concurrent edit before save; no write performed.')
    saved = api('PUT', suffix='?publishIfActive=false', body=payload)
    new = saved.get('versionId')
    require(isinstance(new, str) and new != BASELINE and saved.get('active') is False and saved.get('activeVersionId') is None,
            'Unexpected save state; publication stopped.')
    draft = api('GET')

    def verify(actual, expected_state, active):
        for field in (set(actual) | set(expected_state)) - REVISION - {'active', 'triggerCount'}:
            require((field in actual) == (field in expected_state) and actual.get(field) == expected_state.get(field),
                    'Unrelated workflow field changed; stopped.')
        require(actual.get('active') is active, 'Unexpected activation state.')
        # Publishing a previously inactive webhook changes only the server-managed trigger count.
        require(actual.get('triggerCount') in (before.get('triggerCount'), 1), 'Unexpected trigger count.')

    verify(draft, expected, False)
    require(draft.get('versionId') == new and draft.get('activeVersionId') is None, 'Unexpected draft revision.')
    secure_write(backup / 'saved-revision.json', {'oldVersionId': BASELINE, 'newVersionId': new})
    require(api('GET') == draft and api('GET', suffix='/versions/' + BASELINE) == history,
            'Concurrent edit before publish; stopped.')
    published_result = api('POST', suffix='/publish', body={'versionId': new})
    require(published_result.get('active') is True and published_result.get('activeVersionId') == new, 'Publish response unconfirmed.')
    after = api('GET')
    published = api('GET', suffix='/versions/' + new)
    verify(after, expected, True)
    require(after.get('versionId') == new and after.get('activeVersionId') == new, 'Active revision mismatch.')
    require(published.get('versionId') == new and published.get('workflowId') == ID, 'Publication identity mismatch.')
    for field in GRAPH:
        require(published.get(field) == expected.get(field)
                and after['activeVersion'].get(field) == published.get(field), 'Published graph differs from reviewed graph.')
    for name in PROVIDERS:
        require(nodes(published)[name] == original[name], 'Published provider node differs from original.')
    require(api('GET', workflow_id='vIHvzH7Y8J1nKyoD') == offboard, 'Offboarding reference changed during publication.')
    secure_write(backup / 'verification.json', {'workflowId': ID, 'previousVersionId': BASELINE,
        'newVersionId': new, 'active': True, 'providerNodesPreserved': True,
        'workflowExecuted': False, 'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    print('Publication verified:', BASELINE, '->', new)
    print('No workflow, Gemini, Gmail, offboarding or reset was executed.')


if __name__ == '__main__':
    try:
        main()
    except Stop as error:
        print('STOP:', str(error), file=sys.stderr)
        print('No automatic rollback/retry. Script and backups remain. Inspect draft/publication if a write began.', file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print('STOP:', type(error).__name__, '; sensitive details omitted. Script and backups remain; inspect state before retry.', file=sys.stderr)
        sys.exit(1)
