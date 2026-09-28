import type { Cumplimiento } from '../services/compliance.service';
import type { FilaEquipo } from '../services/team.service';

const NO_DISPONIBLE = 'no disponible';
/** Ninguna de las columnas del período aplica a esta fila (I7). */
const NO_APLICA = 'no aplica';

/**
 * Caracteres con los que Excel, LibreOffice y Google Sheets interpretan una
 * celda como fórmula en vez de como texto.
 */
const ARRANQUE_DE_FORMULA = /^[=+\-@\t\r]/;

/**
 * Prepara un valor para una celda: neutraliza fórmulas y después escapa.
 *
 * Lo de la fórmula no es teórico. Los nombres salen de Bitrix, donde cualquiera
 * puede escribir lo que quiera en su perfil; un nombre que empiece con `=` hace
 * que Excel EJECUTE el contenido al abrir el archivo, y esto se exporta para
 * evaluaciones y planillas, o sea que lo abre gente de RRHH en su máquina. La
 * comilla simple al frente es la neutralización estándar: Excel la consume y
 * muestra el texto tal cual.
 *
 * El orden importa. Primero se antepone la comilla y después se decide si hay
 * que entrecomillar: al revés, un valor como `=1,2` quedaría entrecomillado por
 * la coma y la comilla simple entraría adentro, donde ya no protege de nada.
 */
function csvField(value: string): string {
  const seguro = ARRANQUE_DE_FORMULA.test(value) ? `'${value}` : value;
  if (/["\n\r,]/.test(seguro)) return `"${seguro.replace(/"/g, '""')}"`;
  return seguro;
}

function fila(cols: string[]): string {
  return cols.map(csvField).join(',');
}

const ENCABEZADOS = ['Sección', 'Detalle', 'Persona', 'Departamento', 'Valor'];

/**
 * Columnas de la tabla del equipo (I7): las mismas seis que muestra
 * `TeamTable`, más el email (join útil en una planilla) y el desglose de
 * "Días" en sus tres partes -- la tabla lo muestra como una sola celda, pero
 * un CSV que se va a sumar en Excel necesita las columnas separadas, no un
 * "4/5" como texto.
 */
const ENCABEZADOS_EQUIPO = [
  'Persona', 'Email', 'Estado', 'Minutos del período', 'vs. su promedio',
  'Días con registro', 'Días hábiles', 'Días fin de semana', 'Entrada habitual', 'Último registro',
];

/**
 * Fila de la tabla del equipo para el CSV. Los TRES estados de
 * `FilaEquipo.estado` se distinguen también acá (I7): `sin-registrar` y
 * `no-disponible` nunca escriben `0` en las columnas del período -- son el
 * mismo "cero inventado" que el resto de este archivo evita, trasladado a
 * la exportación -- y se distinguen ENTRE SÍ ("sin registrar" es un hecho
 * sobre la persona; "no disponible" sobre el sistema), igual que en
 * `TeamTable.CeldaEstado`.
 */
function filaEquipoCsv(f: FilaEquipo): string[] {
  const persona = `${f.firstName} ${f.lastName}`.trim();
  // `ultimoRegistro` sale de una consulta APARTE de `estado` (ver
  // `TeamService.ultimoRegistroPorUsuario`, C1): puede seguir siendo
  // confiable aunque `estado` sea `no-disponible` por el fallo de OTRA
  // consulta, así que se calcula fuera de la rama de abajo.
  const ultimo = !f.ultimoDisponible ? NO_DISPONIBLE : (f.ultimoRegistro ?? 'nunca');

  if (f.estado !== 'con-registro') {
    return [
      persona, f.email, f.estado === 'sin-registrar' ? 'sin registrar' : NO_DISPONIBLE,
      NO_APLICA, NO_APLICA, NO_APLICA, NO_APLICA, NO_APLICA, NO_APLICA, ultimo,
    ];
  }

  const vsPromedio = f.variacion.tipo === 'sin-base' ? 'sin base' : `${f.variacion.pct >= 0 ? '+' : ''}${f.variacion.pct}%`;
  return [
    persona, f.email, 'con registro',
    String(f.totalMinutes), vsPromedio,
    String(f.diasConRegistro), String(f.diasHabiles), String(f.diasFinDeSemana),
    f.entradaHabitual ?? NO_DISPONIBLE, ultimo,
  ];
}

/**
 * Vuelca el reporte de `ComplianceService.cumplimiento` -- y, desde I7, la
 * tabla del equipo del mismo período -- a texto CSV.
 *
 * Lleva BOM UTF-8 al inicio (Requisito 3, Task 10): sin él Excel abre el
 * archivo asumiendo Latin-1 y cualquier tilde o ñ en un nombre sale rota.
 * Los saltos de línea van en `\r\n`, que es lo que Excel espera de un CSV
 * -- con solo `\n` algunas versiones lo abren como una sola celda por hoja.
 *
 * Cada contador en `null` se escribe literalmente como «no disponible», y
 * un arreglo vacío (de verdad vacío, no degradado) se escribe como
 * «Ninguna». Las dos palabras tienen que poder distinguirse en la hoja:
 * confundirlas es el mismo error de "cero inventado" que el resto del
 * reporte existe para impedir, ahora en la exportación.
 *
 * `filas` va ANTES que el reporte de cumplimiento (I7, el spec de
 * `GET /timesheet/export` la pide primero): son dos tablas de forma
 * distinta en el mismo archivo -- RRHH abre una sola hoja y encuentra
 * primero la de evaluación/planilla, después la de cumplimiento. Por
 * omisión es `[]` para no romper a quien ya llamaba `cumplimientoToCsv`
 * con un solo argumento.
 */
export function cumplimientoToCsv(data: Cumplimiento, filas: FilaEquipo[] = []): string {
  const lineas: string[] = [fila(ENCABEZADOS_EQUIPO)];
  if (filas.length === 0) {
    lineas.push(fila(['Ninguna', '', '', '', '', '', '', '', '', '']));
  } else {
    for (const f of filas) lineas.push(fila(filaEquipoCsv(f)));
  }

  lineas.push(fila(ENCABEZADOS));

  lineas.push(fila([
    'Resumen', 'Feriados cargados', '', '',
    data.feriadosCargados === null ? NO_DISPONIBLE : String(data.feriadosCargados),
  ]));
  lineas.push(fila([
    'Resumen', 'Ausencias del período', '', '',
    data.ausenciasDelPeriodo === null ? NO_DISPONIBLE : String(data.ausenciasDelPeriodo),
  ]));
  lineas.push(fila([
    'Resumen', 'Historial de estados desde', '', '',
    data.historialEstadosDesde ?? NO_DISPONIBLE,
  ]));

  if (data.sinMarcar30Dias === null) {
    lineas.push(fila(['Sin marcar en 30 días', NO_DISPONIBLE, '', '', '']));
  } else if (data.sinMarcar30Dias.length === 0) {
    lineas.push(fila(['Sin marcar en 30 días', 'Ninguna', '', '', '']));
  } else {
    for (const p of data.sinMarcar30Dias) {
      lineas.push(fila(['Sin marcar en 30 días', '', p.nombre, p.departamento ?? '', '']));
    }
  }

  if (data.sesionesAbiertas === null) {
    lineas.push(fila(['Sesiones abiertas', NO_DISPONIBLE, '', '', '']));
  } else if (data.sesionesAbiertas.length === 0) {
    lineas.push(fila(['Sesiones abiertas', 'Ninguna', '', '', '']));
  } else {
    for (const s of data.sesionesAbiertas) {
      lineas.push(fila(['Sesiones abiertas', '', s.nombre, '', s.desde]));
    }
  }

  if (data.sinJefe === null) {
    lineas.push(fila(['Sin jefe', NO_DISPONIBLE, '', '', '']));
  } else if (data.sinJefe.length === 0) {
    lineas.push(fila(['Sin jefe', 'Ninguna', '', '', '']));
  } else {
    for (const p of data.sinJefe) lineas.push(fila(['Sin jefe', '', p.nombre, '', '']));
  }

  if (data.sinDepartamento === null) {
    lineas.push(fila(['Sin departamento', NO_DISPONIBLE, '', '', '']));
  } else if (data.sinDepartamento.length === 0) {
    lineas.push(fila(['Sin departamento', 'Ninguna', '', '', '']));
  } else {
    for (const p of data.sinDepartamento) lineas.push(fila(['Sin departamento', '', p.nombre, '', '']));
  }

  if (data.porDepartamento === null) {
    lineas.push(fila(['Por departamento', NO_DISPONIBLE, '', '', '']));
  } else if (data.porDepartamento.length === 0) {
    lineas.push(fila(['Por departamento', 'Ninguno', '', '', '']));
  } else {
    for (const d of data.porDepartamento) {
      lineas.push(fila(['Por departamento', '', '', d.departamento, `${d.sinMarcar}/${d.total}`]));
    }
  }

  // BOM UTF-8 explícito con \uFEFF (y no el carácter pegado directo en
  // el código): sin él, Excel abre el archivo asumiendo Latin-1 y
  // cualquier tilde o ñ en un nombre sale rota.
  return '\uFEFF' + lineas.join('\r\n') + '\r\n';
}
