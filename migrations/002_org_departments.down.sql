DROP TABLE IF EXISTS office_org_overrides;
DROP TABLE IF EXISTS office_departments;
-- Plugin: office | Rollback 002
-- OJO: office_org_overrides son correcciones hechas a mano por RRHH y no se
-- pueden reconstruir desde Bitrix — justamente existen porque Bitrix no las
-- tiene. El catálogo de nombres sí se repuebla solo en el siguiente sync.
--
-- Los DROP van primero: el parser de migraciones del core parte por ';' y
-- descarta lo que quede sin sentencia, así que un comentario de encabezado
-- arriba se come la primera instrucción.
