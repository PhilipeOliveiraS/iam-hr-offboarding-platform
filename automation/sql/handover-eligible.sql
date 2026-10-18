-- Local handover eligibility contract; public delivery remains disabled.
-- $1 is the exact synthetic employee email, never a display name.
WITH allowed(email) AS (VALUES
 ('john.carter@demo-corp.com'), ('sarah.connor@demo-corp.com'),
 ('tchalla.udaku@demo-corp.com'), ('ellen.ripley@demo-corp.com'),
 ('arthur.dent@demo-corp.com'), ('marty.mcfly@demo-corp.com'),
 ('dana.scully@demo-corp.com')
)
SELECT e.full_name, e.email, e.access_groups, e.status
FROM employees e JOIN allowed a ON a.email = e.email
WHERE e.email = $1 AND e.status = 'OFFBOARDED';
