import type { Cumplimiento } from '../services/compliance.service';

const NO_DISPONIBLE = 'no disponible';

/** Envuelve en comillas y duplica las internas si el valor las necesita (coma, comilla o salto de línea). */
function csvField(value: string): string {
  if (/["\n\r,]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function fila(cols: string[]): string {
  return cols.map(csvField).join(',');
}

const ENCABEZADOS = ['Sección', 'Detalle', 'Persona', 'Departamento', 'Valor'];

/**
 * Vuelca el reporte de `ComplianceService.cumplimiento` a texto CSV.
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
 */
export function cumplimientoToCsv(data: Cumplimiento): string {
  const lineas: string[] = [fila(ENCABEZADOS)];

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
