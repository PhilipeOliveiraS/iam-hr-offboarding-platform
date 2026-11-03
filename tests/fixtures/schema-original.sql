-- TEST FIXTURE ONLY: used by PGlite in memory. Never apply to the demo database.
-- schema.sql
-- Roda automaticamente na primeira subida do container Postgres
-- (montado em /docker-entrypoint-initdb.d/ no docker-compose.yml).

BEGIN;

-- "Make Illegal States Unrepresentable": o próprio banco não aceita
-- um status que não seja um desses dois valores.
CREATE TYPE employee_status AS ENUM ('ACTIVE', 'OFFBOARDED');

CREATE TABLE employees (
  id            SERIAL PRIMARY KEY,
  full_name     TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  status        employee_status NOT NULL DEFAULT 'ACTIVE',
  access_groups TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Substitui as duas planilhas "Log" e "Analytics" por uma única fonte
-- de verdade. A separação público/privado deixa de ser duas escritas
-- redundantes e passa a ser uma VIEW (evita duplicação e drift entre
-- os dois logs, que era um risco real no desenho anterior).
CREATE TABLE audit_log (
  id            SERIAL PRIMARY KEY,
  target_email  TEXT NOT NULL,
  action        TEXT NOT NULL,
  status        TEXT NOT NULL,
  requester     TEXT NOT NULL DEFAULT 'anonymous-demo',
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- View exposta ao dashboard público: sem "requester" nem "detail"
-- (onde qualquer dado mais sensível poderia entrar no futuro).
CREATE VIEW audit_log_public AS
  SELECT id, target_email, action, status, created_at
  FROM audit_log
  ORDER BY created_at DESC;

-- Seed com os dados reais que você já usa (extraídos do seu .xlsx)
INSERT INTO employees (full_name, email, access_groups) VALUES
  ('John Carter',    'john.carter@demo-corp.com',   'Sales, IT, General'),
  ('Sarah Connor',   'sarah.connor@demo-corp.com',  'Engineering, Security, General'),
  ('T''Challa Udaku','tchalla.udaku@demo-corp.com', 'Leadership, Finance, General'),
  ('Ellen Ripley',   'ellen.ripley@demo-corp.com',  'Operations, Logistics, General'),
  ('Arthur Dent',    'arthur.dent@demo-corp.com',   'Marketing, Content, General'),
  ('Marty McFly',    'marty.mcfly@demo-corp.com',   'R&D, General'),
  ('Dana Scully',    'dana.scully@demo-corp.com',   'Compliance, Research, General');

COMMIT;
