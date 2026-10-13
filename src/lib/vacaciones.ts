import { DEFAULT_TZ, localDateString, zonedTimeToUtc } from './local-date';

/**
 * Saldo de vacaciones.
 *
 * El saldo NO se guarda: se deriva de la fecha de corte, de las vacaciones
 * aprobadas y de los ajustes de RRHH. Es la misma decisión que en la planta y
 * en el estado de los acuerdos — un número guardado y mutado a mano se
 * desincroniza en cuanto algo falla a mitad de camino, y acá el número son
 * días de descanso de una persona.
 */

/** Con lo que arranca cada quien el día que esto se enciende. */
export const SALDO_INICIAL = 15;

/** Cada mes cumplido aporta esto: 1,25 × 12 = los 15 días del año. */
export const DEVENGO_MENSUAL = 1.25;

/**
 * Pasado este acumulado se avisa a RRHH y al colaborador. Avisa, NO corta:
 * dejar de devengar en silencio le quitaría días a alguien sin que lo decida
 * nadie, que es peor que el problema de tener gente sin tomar vacaciones.
 */
export const TOPE_ALERTA = 20;

const DIA_MS = 86_400_000;

/** Un ajuste de RRHH sobre el saldo. Se guarda el delta, no el total. */
export interface AjusteSaldo {
  dias: number;          // positivo suma, negativo resta
  motivo: string;
  porUserId: string;
  creadoEn: Date;
}

export interface VacacionAprobada {
  /** Fechas locales "YYYY-MM-DD", ambas incluidas. */
  desde: string;
  hasta: string;
}

export interface Saldo {
  devengado: number;
  tomados: number;
  ajustes: number;
  saldo: number;
  /** Acumulado por encima de `TOPE_ALERTA`: hay que avisar. */
  superaTope: boolean;
  /** Meses cumplidos desde el corte; útil para explicar el número en pantalla. */
  mesesDevengados: number;
}

/** Redondeo a centésimas: 1,25 y los enteros son exactos en binario, pero una
 *  cadena larga de sumas no tiene por qué mostrar 14,999999999999998. */
function c(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Meses CUMPLIDOS entre dos instantes, en la zona de la operación. El devengo
 * cae el mismo día del mes que el corte: alguien que entró al sistema un 20 de
 * enero devenga el 20 de febrero, no el 1.
 */
export function mesesCumplidos(corte: Date, ahora: Date, tz: string = DEFAULT_TZ): number {
  const a = localDateString(corte, tz).split('-').map(Number);
  const b = localDateString(ahora, tz).split('-').map(Number);
  let meses = (b[0] - a[0]) * 12 + (b[1] - a[1]);
  // Si aún no llegó el día del mes, el mes no está cumplido.
  if (b[2] < a[2]) meses -= 1;
  return Math.max(0, meses);
}

/** 0 = domingo … 6 = sábado, en la zona de la operación. */
function diaDeLaSemana(fecha: string, tz: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return zonedTimeToUtc(y, m, d, 12, 0, 0, tz).getUTCDay();
}

/**
 * Cuánto vale un día de trabajo: 1 de lunes a viernes, lo que trabaje la
 * persona el sábado (0, ½ o 1 — hay gente que trabaja medio día), 0 el
 * domingo y en los feriados.
 */
function valorDelDia(fecha: string, noLaborables: ReadonlySet<string>, tz: string, sabado: number): number {
  if (noLaborables.has(fecha)) return 0;
  const dia = diaDeLaSemana(fecha, tz);
  return dia === 0 ? 0 : dia === 6 ? sabado : 1;
}

/**
 * Días hábiles de un rango: lunes a viernes, descontando los feriados.
 *
 * `feriados` son fechas locales "YYYY-MM-DD" ya resueltas — los traslados de
 * feriado se deciden en `holiday-resolver.ts`, no acá. Ambos extremos entran:
 * unas vacaciones de un solo día llegan con la misma fecha en los dos campos.
 */
export function diasHabiles(
  desde: string,
  hasta: string,
  feriados: Iterable<string> = [],
  tz: string = DEFAULT_TZ,
  /** Lo que trabaja la persona el sábado: 0 (nada, lo de casi todos), 0.5 o 1. */
  sabado = 0,
): number {
  if (hasta < desde) return 0;
  const noLaborables = feriados instanceof Set ? feriados : new Set(feriados);

  const [y, m, d] = desde.split('-').map(Number);
  let cursor = zonedTimeToUtc(y, m, d, 12, 0, 0, tz);   // mediodía: inmune al horario de verano
  let dias = 0;

  // Cota dura: un rango disparatado no puede colgar el servidor.
  for (let i = 0; i < 1000; i++) {
    const fecha = localDateString(cursor, tz);
    if (fecha > hasta) break;
    dias += valorDelDia(fecha, noLaborables, tz, sabado);
    cursor = new Date(cursor.getTime() + DIA_MS);
  }
  return c(dias);
}

/**
 * El saldo a día de hoy.
 *
 * `corte` es desde cuándo devenga esta persona; antes de esa fecha no se
 * cuenta nada. Las vacaciones que entran acá son solo las APROBADAS: una
 * solicitud pendiente no gasta saldo todavía, para que el jefe pueda
 * rechazarla sin dejar un agujero.
 */
export function calcularSaldo(args: {
  corte: Date;
  ahora?: Date;
  aprobadas?: VacacionAprobada[];
  ajustes?: AjusteSaldo[];
  feriados?: Iterable<string>;
  inicial?: number;
  tz?: string;
}): Saldo {
  const {
    corte, ahora = new Date(), aprobadas = [], ajustes = [],
    feriados = [], inicial = SALDO_INICIAL, tz = DEFAULT_TZ,
  } = args;

  const noLaborables = feriados instanceof Set ? feriados : new Set(feriados);
  const meses = mesesCumplidos(corte, ahora, tz);
  const devengado = c(inicial + meses * DEVENGO_MENSUAL);
  const tomados = c(aprobadas.reduce(
    (s, v) => s + diasHabiles(v.desde, v.hasta, noLaborables, tz), 0));
  const sumaAjustes = c(ajustes.reduce((s, a) => s + a.dias, 0));
  const saldo = c(devengado - tomados + sumaAjustes);

  return {
    devengado,
    tomados,
    ajustes: sumaAjustes,
    saldo,
    superaTope: saldo > TOPE_ALERTA,
    mesesDevengados: meses,
  };
}

export type MotivoRechazo = 'sin_saldo' | 'rango_invalido' | 'sin_dias_habiles';

/**
 * ¿Alcanza el saldo para esta solicitud? Devuelve null si está todo bien.
 *
 * Cuenta contra el saldo actual y no contra el que habrá cuando lleguen las
 * vacaciones: alguien que pide en enero para diciembre todavía no devengó esos
 * días, y aprobarlo ahora es prometer algo que no existe.
 */
export function validarSolicitud(args: {
  desde: string;
  hasta: string;
  saldo: Saldo;
  pendientes?: VacacionAprobada[];
  feriados?: Iterable<string>;
  tz?: string;
}): { ok: true; dias: number } | { ok: false; motivo: MotivoRechazo; dias: number; disponible: number } {
  const { desde, hasta, saldo, pendientes = [], feriados = [], tz = DEFAULT_TZ } = args;
  const noLaborables = feriados instanceof Set ? feriados : new Set(feriados);

  if (hasta < desde) return { ok: false, motivo: 'rango_invalido', dias: 0, disponible: saldo.saldo };

  const dias = diasHabiles(desde, hasta, noLaborables, tz);
  if (dias === 0) {
    // Un rango que cae entero en fin de semana o feriado no es una solicitud.
    return { ok: false, motivo: 'sin_dias_habiles', dias: 0, disponible: saldo.saldo };
  }

  // Lo ya pedido y sin resolver también aparta saldo: si no, alguien manda
  // tres solicitudes de 10 días y el jefe aprueba las tres sin enterarse.
  const apartados = c(pendientes.reduce(
    (s, v) => s + diasHabiles(v.desde, v.hasta, noLaborables, tz), 0));
  const disponible = c(saldo.saldo - apartados);

  if (dias > disponible) return { ok: false, motivo: 'sin_saldo', dias, disponible };
  return { ok: true, dias };
}

/** Lo que cargó RRHH: los días que la persona tenía ese día (el corte, `YYYY-MM-DD` local). */
export interface CargaSaldo {
  inicial: number;
  corte: string;
}

export interface SaldoVacaciones {
  inicial: number;
  corte: string;
  mesesDevengados: number;
  /** Lo cargado más 1,25 por mes cumplido desde el corte. */
  devengado: number;
  /** Vacaciones aprobadas, de la parte que cae desde el corte. */
  tomados: number;
  /** Pedidas y sin responder: apartan saldo hasta que se resuelvan. */
  apartados: number;
  saldo: number;
  /** Lo que se puede pedir hoy: el saldo menos lo apartado. */
  disponible: number;
}

/**
 * El saldo a partir de lo que cargó RRHH (13-oct-2026: «RRHH carga el saldo
 * de cada persona»). RRHH carga los días que la persona tiene ESE día sin
 * contar las vacaciones ya aprobadas en la oficina de ahí en adelante: esas, y
 * las que se aprueben después, se descuentan acá. Solo la parte desde el corte,
 * para no descontar dos veces lo que ya había tomado. Cuenta con SU sábado y SUS
 * feriados, igual que el formulario.
 */
export function saldoDesdeCarga(args: {
  carga: CargaSaldo;
  ahora?: Date;
  aprobadas?: VacacionAprobada[];
  pendientes?: VacacionAprobada[];
  feriados?: Iterable<string>;
  tz?: string;
  sabado?: number;
}): SaldoVacaciones {
  const { carga, ahora = new Date(), aprobadas = [], pendientes = [], feriados = [], tz = DEFAULT_TZ, sabado = 0 } = args;
  const noLaborables = feriados instanceof Set ? feriados : new Set(feriados);
  const [y, m, d] = carga.corte.split('-').map(Number);
  const meses = mesesCumplidos(zonedTimeToUtc(y, m, d, 12, 0, 0, tz), ahora, tz);
  const desdeCorte = (v: VacacionAprobada) =>
    diasHabiles(v.desde > carga.corte ? v.desde : carga.corte, v.hasta, noLaborables, tz, sabado);
  const devengado = c(carga.inicial + meses * DEVENGO_MENSUAL);
  const tomados = c(aprobadas.reduce((s, v) => s + desdeCorte(v), 0));
  const apartados = c(pendientes.reduce((s, v) => s + desdeCorte(v), 0));
  const saldo = c(devengado - tomados);
  return { inicial: carga.inicial, corte: carga.corte, mesesDevengados: meses, devengado, tomados, apartados, saldo, disponible: c(saldo - apartados) };
}

/** ¿Alcanza para pedir `dias` hábiles? Sin saldo cargado no se bloquea. */
export function alcanzaSaldo(saldo: SaldoVacaciones | null, dias: number): boolean {
  return !saldo || c(dias) <= saldo.disponible;
}

/** El delta que hay que guardar para que el saldo quede en `deseado`. */
export function ajustePara(saldoActual: number, deseado: number): number {
  return c(deseado - saldoActual);
}

/**
 * El día que la persona vuelve: el primer día hábil después de `hasta`
 * (salta fines de semana y feriados). Es el «Me reintegro el día» del
 * formulario de papel de RRHH.
 */
export function diaDeReintegro(hasta: string, feriados: Iterable<string> = [], tz: string = DEFAULT_TZ, sabado = 0): string {
  const noLaborables = feriados instanceof Set ? feriados : new Set(feriados);
  const [y, m, d] = hasta.split('-').map(Number);
  let cursor = zonedTimeToUtc(y, m, d, 12, 0, 0, tz);
  for (let i = 0; i < 60; i++) {
    cursor = new Date(cursor.getTime() + DIA_MS);
    const fecha = localDateString(cursor, tz);
    if (valorDelDia(fecha, noLaborables, tz, sabado) > 0) return fecha;
  }
  return localDateString(cursor, tz);
}

/** Lo que muestra el formulario y lleva el correo: días hábiles, días corridos y reintegro. */
export function resumenRango(
  desde: string, hasta: string, feriados: Iterable<string> = [], tz: string = DEFAULT_TZ, sabado = 0,
): { diasHabiles: number; diasCorridos: number; reintegro: string } {
  const noLaborables = feriados instanceof Set ? feriados : new Set(feriados);
  const corridos = hasta < desde ? 0
    : Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / DIA_MS) + 1;
  return {
    diasHabiles: diasHabiles(desde, hasta, noLaborables, tz, sabado),
    diasCorridos: corridos,
    reintegro: diaDeReintegro(hasta, noLaborables, tz, sabado),
  };
}
