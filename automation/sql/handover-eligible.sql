-- Read-only contract. $1: exact synthetic email; $2: completed offboarding ID.
-- Delivery admission must use iam_handover_reserve, not this read alone.
SELECT employee FROM (SELECT iam_handover_eligible($2::bigint,$1) AS employee) e
WHERE employee IS NOT NULL;
