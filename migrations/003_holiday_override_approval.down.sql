-- Revierte 003. Borra las solicitudes de feriado movido junto con la tabla:
-- no hay dónde devolverlas, porque `virtual_office."HolidayOverride"` no tiene
-- las columnas de aprobación y perdería el estado y la decisión del jefe.
DROP TABLE IF EXISTS office_holiday_overrides;
