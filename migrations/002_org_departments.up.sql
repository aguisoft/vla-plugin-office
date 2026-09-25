-- Plugin: office | Migration 002 — Departamentos y su override
-- Schema: plugin_office (aislado; el core fija el search_path, por eso no hay prefijo)
--
-- Dos tablas por dos problemas distintos.
--
-- office_departments existe porque el organigrama guarda el departamento como
-- un ID desnudo ("3", "1819", "2115") y tira el nombre. `syncOrgStructure` ya
-- le pide `department.get` a Bitrix y usa el NAME solo para resolver jefes; acá
-- se persiste para que la pantalla pueda ofrecer "DEVELOPMENT" en vez de "3".
-- Un desplegable de IDs numéricos no es usable por nadie.
--
-- office_org_overrides existe porque el departamento que trae Bitrix puede
-- estar mal o faltar —hoy 14 de 35 personas no tienen ninguno, y por eso nadie
-- las ve en el dashboard de tiempos—. La corrección de RRHH tiene que ganarle
-- al dato automático, igual que ya pasa con el país y con el jefe.

CREATE TABLE IF NOT EXISTS office_departments (
  id        text PRIMARY KEY,
  name      text        NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS office_org_overrides (
  user_id       text PRIMARY KEY,
  department_id text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Buscar por departamento es la consulta que hace la pantalla al filtrar, y la
-- que usa managedUserIds para saber a quién ve un jefe.
CREATE INDEX IF NOT EXISTS office_org_overrides_dept_idx
  ON office_org_overrides (department_id) WHERE department_id IS NOT NULL;

-- Siembra del catálogo con los departamentos que YA están en uso, para que la
-- pantalla sea usable antes del primer sync de Bitrix (que corre cada 6 horas).
-- El nombre provisional es el propio ID: honesto —dice que todavía no se sabe—
-- y el sync lo reemplaza por el real. Inventar un nombre sería peor que no
-- tenerlo, porque nadie volvería a mirarlo.
INSERT INTO office_departments (id, name)
SELECT DISTINCT m."departmentId", m."departmentId"
  FROM virtual_office."BitrixUserMapping" m
 WHERE m."departmentId" IS NOT NULL
ON CONFLICT (id) DO NOTHING;
