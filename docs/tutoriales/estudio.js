// «Estudio de fotos» de la Oficina Virtual: la UI real (frontend/dist) contra
// una API simulada con el plano real de la oficina y un equipo FICTICIO.
// Nada de esto toca producción.
const { chromium } = require('C:/Users/Carlos/Documents/Projects/vlaSystem/vla-system/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const UI = 'C:/Users/Carlos/Documents/Projects/vlaSystem/vla-plugin-office/frontend/dist';
const ORIGEN = 'http://oficina.vla';
// Las capturas van directo a la guía que viaja con el plugin.
const OUT = path.join(__dirname, '..', '..', 'frontend', 'public', 'ayuda', 'capturas');
fs.mkdirSync(OUT, { recursive: true });

// Miércoles 25 de noviembre de 2026, 10:15 en Costa Rica.
const AHORA = new Date('2026-11-25T16:15:00Z');
const hace = (min) => new Date(AHORA.getTime() - min * 60000).toISOString();
const en = (min) => new Date(AHORA.getTime() + min * 60000).toISOString();

// El plano real de la oficina (solo zonas, sin datos de personas).
const layoutReal = JSON.parse(fs.readFileSync(path.join(__dirname, 'layout-ejemplo.json'), 'utf8'));
const zonas = typeof layoutReal.zones === 'string' ? JSON.parse(layoutReal.zones) : layoutReal.zones;
const zona = (prefijo) => zonas.find(z => z.id.startsWith(prefijo))?.id ?? zonas[0].id;

const av = (skin, hair, hairColor, shirt, acc = 'none') => ({ skinColor: skin, hairStyle: hair, hairColor, shirtColor: shirt, accessory: acc });

/** El equipo de ejemplo. Todos los nombres son inventados. */
function equipo(o) {
  const yo = {
    userId: 'ana', firstName: 'Ana', lastName: 'Rojas', email: 'ana.rojas@ejemplo.com', role: 'STAFF',
    isCheckedIn: o.yoAdentro, status: o.yoEstado, rawStatus: o.yoEstado, isAbsent: false,
    statusStartsAt: o.yoDesde ?? hace(95), statusEndsAt: o.yoHasta, justification: o.yoMotivo,
    currentZoneId: zona('sales'), defaultZoneId: zona('sales'), lastActivityAt: hace(1), checkedInAt: hace(95),
    avatar: av('#F1C27D', 'long', '#4A3728', '#E91E63'), canSeeTimeAlerts: true, tieneEscritorio: true,
  };
  const p = (id, nombre, apellido, z, status, extra = {}) => ({
    userId: id, firstName: nombre, lastName: apellido, email: `${id}@ejemplo.com`, role: 'STAFF',
    isCheckedIn: !['VACACIONES', 'PERMISO', 'OFFLINE', 'INCAPACIDAD'].includes(status) || extra.isCheckedIn === true,
    status, rawStatus: status, isAbsent: ['VACACIONES', 'PERMISO', 'INCAPACIDAD', 'CITA_MEDICA'].includes(status),
    statusStartsAt: hace(40), currentZoneId: zona(z), defaultZoneId: zona(z), lastActivityAt: hace(3), checkedInAt: hace(120),
    avatar: extra.avatar ?? av('#FDDBB4', 'short', '#1A1A1A', '#3498DB'), ...extra,
  });
  // Quien mira: Ana (colaboradora), Paula (jefa de Ventas) o Irene (RRHH).
  const jefe = o.rol === 'jefe';
  const rrhh = o.rol === 'rrhh';
  const otraVista = jefe || rrhh;
  const aCargo = otraVista ? { canSeeTimeAlerts: true } : {};
  const paula = jefe
    ? p('paula', 'Paula', 'Núñez', 'sales', o.yoEstado, { isCheckedIn: o.yoAdentro, statusStartsAt: hace(95), canSeeTimeAlerts: true, avatar: av('#D4A574', 'ponytail', '#2C2C2C', '#9B59B6', 'glasses') })
    : p('paula', 'Paula', 'Núñez', 'sales', 'IN_MEETING_EXTERNAL', { justification: 'Visita a un cliente', avatar: av('#D4A574', 'ponytail', '#2C2C2C', '#9B59B6', 'glasses') });
  const ana = otraVista ? { ...yo, status: 'AVAILABLE', rawStatus: 'AVAILABLE', isCheckedIn: true, statusEndsAt: undefined, justification: undefined, ...aCargo } : yo;
  const irene = rrhh
    ? p('irene', 'Irene', 'Salas', 'rrhh', o.yoEstado, { isCheckedIn: o.yoAdentro, statusStartsAt: hace(95), canSeeTimeAlerts: true, avatar: av('#D4A574', 'curly', '#4A3728', '#9B59B6') })
    : p('irene', 'Irene', 'Salas', 'rrhh', 'AVAILABLE', { avatar: av('#D4A574', 'curly', '#4A3728', '#9B59B6') });
  const todos = [
    jefe ? paula : ana,
    jefe ? ana : paula,
    otraVista
      ? p('bruno', 'Bruno', 'Méndez', 'sales', 'LUNCH', { statusStartsAt: hace(75), statusEndsAt: hace(15), ...aCargo, avatar: av('#F5CBA7', 'buzz', '#8B4513', '#2ECC71', 'headphones') })
      : p('bruno', 'Bruno', 'Méndez', 'sales', 'AVAILABLE', { avatar: av('#F5CBA7', 'buzz', '#8B4513', '#2ECC71', 'headphones') }),
    p('camila', 'Camila', 'Soto', 'sales', 'BRB', { justification: 'Voy por un café', statusStartsAt: hace(otraVista ? 25 : 6), ...aCargo, avatar: av('#FDDBB4', 'curly', '#C4A35A', '#FF7043') }),
    p('diego', 'Diego', 'Vargas', 'marketin', 'FOCUS', { justification: 'Diseñando la campaña de diciembre', avatar: av('#C68642', 'short', '#1A1A1A', '#34495E') }),
    p('elena', 'Elena', 'Castro', 'finanzas', 'AVAILABLE', { avatar: av('#F1C27D', 'long', '#1A1A1A', '#1ABC9C', 'earbuds') }),
    p('felipe', 'Felipe', 'Mora', 'call-cen', 'IN_MEETING_INTERNAL', { justification: 'Revisión de llamadas', meetingWith: [{ userId: 'gina', firstName: 'Gina', lastName: 'Herrera' }], avatar: av('#8D5524', 'afro', '#1A1A1A', '#E74C3C') }),
    p('gina', 'Gina', 'Herrera', 'call-cen', 'IN_MEETING_INTERNAL', { justification: 'Revisión de llamadas', meetingWith: [{ userId: 'felipe', firstName: 'Felipe', lastName: 'Mora' }], avatar: av('#F5CBA7', 'ponytail', '#D2691E', '#F39C12') }),
    p('hugo', 'Hugo', 'Jiménez', 'developm', 'AVAILABLE', { avatar: av('#FDDBB4', 'mohawk', '#2C2C2C', '#00BCD4', 'glasses') }),
    irene,
    p('julian', 'Julián', 'Ortiz', 'academy', 'VACACIONES', { absenceStartsAt: '2026-11-23T06:00:00Z', absenceEndsAt: '2026-11-28T05:59:59Z', avatar: av('#F1C27D', 'short', '#8B4513', '#3498DB', 'hat') }),
    p('karla', 'Karla', 'Fonseca', 'cobros', 'PERMISO', { justification: 'Trámite en el banco', absenceStartsAt: hace(20), absenceEndsAt: en(40), isCheckedIn: true, avatar: av('#C68642', 'long', '#1A1A1A', '#E91E63') }),
    p('luis', 'Luis', 'Campos', 'consulti', 'OFFLINE', { avatar: av('#FDDBB4', 'bald', '#1A1A1A', '#34495E') }),
    p('marta', 'Marta', 'Quesada', 'english-', 'AVAILABLE', { avatar: av('#F5CBA7', 'long', '#C4A35A', '#2ECC71') }),
    p('nicolas', 'Nicolás', 'Brenes', 'gerencia', 'AVAILABLE', { avatar: av('#D4A574', 'short', '#2C2C2C', '#34495E', 'glasses') }),
  ];
  // RRHH ve el cronómetro en color y los motivos de todos.
  return rrhh ? todos.map(x => ({ ...x, canSeeTimeAlerts: true })) : todos;
}

/** El saldo de Ana. `disponible` sale del escenario (`saldoAna`), o 11. */
function saldoAna(e) {
  if (e.saldoAna === 'ninguno') return { cargado: false };
  const disponible = e.saldoAna ?? 11;
  return { cargado: true, inicial: 12.75, corte: '2026-10-14', mesesDevengados: 1, devengado: 14, tomados: 3, apartados: 0,
    saldo: disponible, disponible, cargadoPor: 'Irene Salas', cargadoEn: '2026-10-14T15:00:00Z', motivo: 'Planilla de RRHH' };
}

const ESCENARIO_BASE = {
  yoAdentro: true, yoEstado: 'AVAILABLE', yoHasta: undefined, yoMotivo: undefined, yoDesde: undefined,
  invitacion: false, feriadoProximo: false, avisos: true, jornadaAbierta: true,
};

/** Lo que ve la jefa (Paula) que no ve un colaborador. */
const respondidas = new Set();
function rutasJefe(q, u, req, json, e) {
  const sol = (o) => ({ estado: 'pendiente', absenceId: null, resueltaPor: null, resueltaEn: null, motivoResolucion: null, creadaEn: hace(40), adjuntos: [], ...o });
  if (q === '/solicitudes/bandeja') return json({
    ausencias: [
      sol({ id: 'v1', userId: 'ana', nombre: 'Ana Rojas', creadaPor: 'ana', tipo: 'VACACIONES', startAt: '2026-12-21T06:00:00Z', endAt: '2026-12-24T05:59:59Z', justificacion: 'Viaje familiar' }),
      sol({ id: 'p1', userId: 'bruno', nombre: 'Bruno Méndez', creadaPor: 'bruno', tipo: 'PERMISO', startAt: '2026-11-25T20:00:00Z', endAt: '2026-11-25T20:30:00Z', absenceId: 'a9', justificacion: 'Trámite en el banco', usoMes: { permisoMin: 30, permisoTopeMin: 60, permisoRestanteMin: 30 } }),
      sol({ id: 'c1', userId: 'camila', nombre: 'Camila Soto', creadaPor: 'camila', tipo: 'CITA_MEDICA', startAt: '2026-11-27T20:00:00Z', endAt: '2026-11-27T21:30:00Z', absenceId: 'a8', justificacion: 'Control en la clínica', adjuntos: [{ id: 'd1', nombre: 'cita-clinica.pdf', tipo: 'application/pdf', bytes: 84000 }], usoMes: { permisoMin: 0, permisoTopeMin: 60, permisoRestanteMin: 60 } }),
    ].filter(x => !respondidas.has(x.id)),
    feriados: respondidas.has('f1') ? [] : [{ id: 'f1', userId: 'ana', nombre: 'Ana Rojas', holidayId: 'h-dic1', newDate: '2026-12-24', justification: 'Trabajo el feriado por el cierre de mes', status: 'PENDING', holidayName: 'Abolición del Ejército', holidayDate: '2026-12-01' }],
    esJefe: true, esRrhh: false,
  });
  const m = q.match(/^\/solicitudes\/(\w+)\/(aprobar|rechazar)$/) || q.match(/^\/holidays\/overrides\/(\w+)\/(approve|reject)$/);
  if (m && req.method() === 'POST') { respondidas.add(m[1]); return json({ ok: true }); }
  if (q === '/avisos') return json({ sinLeer: 2, avisos: [
    { id: '9', tipo: 'solicitud.nueva', titulo: 'Solicitud de tu equipo', cuerpo: 'Ana Rojas pidió vacaciones del 21 al 23 dic (3 días hábiles)', url: '/dashboard/office?solicitudes=1', creadoEn: hace(40), leidoEn: null },
    { id: '8', tipo: 'feriado.nuevo', titulo: 'Solicitud de tu equipo', cuerpo: 'Ana Rojas pidió trabajar el feriado «Abolición del Ejército» (1 dic) y tomarlo el 24 dic', url: '/dashboard/office?solicitudes=1', creadoEn: hace(55), leidoEn: null },
  ] });
  if (q.startsWith('/absences/usage')) return json({ anio: 2026, mes: 11, permisoMin: 30, permisoTopeMin: 60, permisoRestanteMin: 30, permisoExcedido: false, citas: [], citasMin: 0, citasExcesoMin: 0 });
  // El detalle de Bruno: sus propias horas (15h 5m, con más almuerzo).
  if (q.startsWith('/timesheet/office') && u.searchParams.get('userId') === 'bruno') return json({
    period: 'week', from: '2026-11-23T06:00:00.000Z', to: '2026-11-30T05:59:59.999Z',
    office: { userId: 'bruno', totalMinutes: 905, byDay: [{ date: '2026-11-23', minutes: 380 }, { date: '2026-11-24', minutes: 425 }, { date: '2026-11-25', minutes: 100 }] },
    breakdown: [{ status: 'AVAILABLE', minutes: 560 }, { status: 'LUNCH', minutes: 205 }, { status: 'BRB', minutes: 80 }, { status: 'IN_MEETING_INTERNAL', minutes: 60 }],
    unaccountedMinutes: 0, coverageStart: '2026-09-24', absences: [{ type: 'PERMISO', days: 0, minutes: 30 }],
  });
  const yo = (id, n, a) => ({ id, firstName: n, lastName: a, email: id + '@ejemplo.com' });
  if (q === '/timesheet/scope') return json({ viewerId: 'paula', isAdmin: false, users: [yo('paula', 'Paula', 'Núñez'), yo('ana', 'Ana', 'Rojas'), yo('bruno', 'Bruno', 'Méndez'), yo('camila', 'Camila', 'Soto')] });
  if (q.startsWith('/timesheet/team')) {
    const fila = (id, n, a, min, pct, dias, entrada, extra = {}) => ({ userId: id, firstName: n, lastName: a, email: id + '@ejemplo.com', estado: 'con-registro', totalMinutes: min, openSessionCapped: false, variacion: pct === null ? { tipo: 'sin-base' } : { tipo: 'calculada', pct, destacar: Math.abs(pct) > 15 }, diasConRegistro: dias, diasHabiles: 6, diasFueraDeHabiles: 0, entradaHabitual: entrada, ultimoRegistro: '2026-11-25', ultimoDisponible: true, ...extra });
    const celdas = [];
    for (const [fecha, desde, hasta, gente] of [['2026-11-23', 7, 17, [2, 4, 4, 4, 3, 2, 4, 4, 4, 3, 1]], ['2026-11-24', 7, 17, [1, 3, 4, 4, 4, 1, 3, 4, 4, 4, 2]], ['2026-11-25', 7, 10, [2, 4, 4, 3]]]) {
      for (let h = desde; h <= hasta; h++) celdas.push({ fecha, hora: h, personas: gente[h - desde] ?? 0 });
    }
    return json({
      period: 'week', from: '2026-11-23T06:00:00.000Z', to: '2026-11-30T05:59:59.999Z', viewerId: 'paula', isAdmin: false,
      filas: [
        fila('paula', 'Paula', 'Núñez', 1210, 3, 3, '07:52'),
        fila('ana', 'Ana', 'Rojas', 1185, -2, 3, '08:01'),
        fila('bruno', 'Bruno', 'Méndez', 905, -24, 3, '08:47'),
        fila('camila', 'Camila', 'Soto', 1260, 6, 3, '07:58'),
      ],
      excepciones: { sinMarcar30Dias: [], sesionesAbiertas: [] },
      cobertura: { horaMin: 7, horaMax: 17, fechas: ['2026-11-23', '2026-11-24', '2026-11-25'], celdas },
    });
  }
  return null;
}

/**
 * Lo que ve RRHH (Irene Salas, con office.manage) que no ve un jefe: Personas,
 * Feriados, Cumplimiento y las solicitudes de toda la empresa. No tiene gente a
 * cargo, así que en Tiempos se ve solo a sí misma.
 */
const DEPTOS = {
  ventas: 'Ventas', mercadeo: 'Mercadeo', finanzas: 'Finanzas', callcenter: 'Call Center', desarrollo: 'Desarrollo',
  rrhh: 'Recursos Humanos', academy: 'Academy', cobros: 'Cobros', english: 'English Sales', gerencia: 'Gerencia General',
};
// [id, nombre, apellido, país (origen), depto (origen), jefe (origen), zona (origen), sábado]
const PLANILLA = [
  ['ana', 'Ana', 'Rojas', 'CR bitrix', 'ventas bitrix', 'paula bitrix', 'sales fijada', 0.5],
  ['bruno', 'Bruno', 'Méndez', 'CR bitrix', 'ventas bitrix', 'paula bitrix', 'sales sugerida', 0.5],
  ['camila', 'Camila', 'Soto', 'CR bitrix', 'ventas bitrix', 'paula bitrix', 'sales sugerida', 0.5],
  ['diego', 'Diego', 'Vargas', 'CR bitrix', 'mercadeo bitrix', 'nicolas bitrix', 'marketing sugerida', 0],
  ['elena', 'Elena', 'Castro', 'CR default', 'finanzas bitrix', 'nicolas bitrix', 'finanzas fijada', 0],
  ['felipe', 'Felipe', 'Mora', 'CR bitrix', 'callcenter bitrix', 'marta override', 'call-center fijada', 1],
  ['gina', 'Gina', 'Herrera', 'CR bitrix', 'callcenter bitrix', 'marta override', 'call-center fijada', 1],
  ['hugo', 'Hugo', 'Jiménez', 'CR default', 'desarrollo bitrix', 'nicolas bitrix', 'development fijada', 0],
  ['irene', 'Irene', 'Salas', 'CR bitrix', 'rrhh bitrix', 'nicolas bitrix', 'rrhh fijada', 0],
  ['julian', 'Julián', 'Ortiz', 'CR bitrix', 'academy bitrix', 'nicolas bitrix', 'academy sugerida', 0],
  ['karla', 'Karla', 'Fonseca', 'CR bitrix', 'cobros override', 'nicolas bitrix', 'cobros fijada', 0.5],
  ['luis', 'Luis', 'Campos', 'CR default', '- none', '- none', '- none', 0],
  ['marta', 'Marta', 'Quesada', 'CO override', 'english bitrix', 'nicolas bitrix', 'english-sales fijada', 0],
  ['nicolas', 'Nicolás', 'Brenes', 'CR bitrix', 'gerencia bitrix', '- none', 'gerencia fijada', 0],
  ['paula', 'Paula', 'Núñez', 'CR bitrix', 'ventas bitrix', 'nicolas bitrix', 'sales fijada', 0.5],
];
function planilla() {
  return PLANILLA.map(([id, n, a, pais, depto, jefe, zonaEnt, sabado]) => {
    const [c, cs] = pais.split(' '), [d, ds] = depto.split(' '), [j, js] = jefe.split(' '), [z, zs] = zonaEnt.split(' ');
    const zonaObj = zonas.find(x => x.id === z);
    return {
      userId: id, firstName: n, lastName: a, email: id + '@ejemplo.com',
      country: c, countrySource: cs,
      departmentId: d === '-' ? null : 'd-' + d, departmentName: d === '-' ? null : DEPTOS[d], departmentSource: ds,
      managerUserId: j === '-' ? null : j, managerSource: js,
      zoneId: zonaObj?.id ?? null, zoneName: zonaObj?.name ?? null, zoneSource: zs, sabado,
    };
  });
}
const FERIADOS_2026 = [
  ['CR', '01-01', 'Año Nuevo'], ['CR', '04-02', 'Jueves Santo'], ['CR', '04-03', 'Viernes Santo'], ['CR', '04-11', 'Día de Juan Santamaría'],
  ['CR', '05-01', 'Día del Trabajo'], ['CR', '07-25', 'Anexión del Partido de Nicoya'], ['CR', '08-02', 'Virgen de los Ángeles'],
  ['CR', '08-15', 'Día de la Madre'], ['CR', '08-31', 'Día de la Persona Negra'], ['CR', '09-15', 'Día de la Independencia'],
  ['CR', '12-01', 'Abolición del Ejército'], ['CR', '12-25', 'Navidad'],
  ['CO', '01-01', 'Año Nuevo'], ['CO', '01-12', 'Día de los Reyes Magos'], ['CO', '05-01', 'Día del Trabajo'], ['CO', '07-20', 'Día de la Independencia'],
  ['CO', '08-07', 'Batalla de Boyacá'], ['CO', '12-08', 'Inmaculada Concepción'], ['CO', '12-25', 'Navidad'],
];
const anuladasRrhh = new Map();
let cargaBruno = null;
function saldoBruno() {
  if (!cargaBruno) return { cargado: false };
  const tomados = anuladasRrhh.has('sb2') ? 0 : 4;   // 28–31 dic, lun a jue
  return { cargado: true, inicial: cargaBruno.dias, corte: '2026-11-25', mesesDevengados: 0, devengado: cargaBruno.dias, tomados, apartados: 0,
    saldo: cargaBruno.dias - tomados, disponible: cargaBruno.dias - tomados, cargadoPor: 'Irene Salas', cargadoEn: hace(0), motivo: cargaBruno.motivo || null };
}
const registradasRrhh = [];
function solicitudesBruno() {
  const s = (o) => ({ userId: 'bruno', adjuntos: [], motivoResolucion: null, creadaPor: 'bruno', ...o });
  return [
    s({ id: 'sb1', tipo: 'PERMISO', startAt: '2026-11-25T20:00:00Z', endAt: '2026-11-25T20:30:00Z', justificacion: 'Trámite en el banco', estado: 'pendiente', absenceId: 'a9', resueltaPor: null, resueltaEn: null, creadaEn: hace(40) }),
    s({ id: 'sb2', tipo: 'VACACIONES', startAt: '2026-12-28T06:00:00Z', endAt: '2027-01-01T05:59:59Z', justificacion: 'Fin de año en Guanacaste', estado: 'aprobada', absenceId: 'a5', resueltaPor: 'paula', resueltaEn: hace(60 * 30), creadaEn: hace(60 * 50), nombreResolvio: 'Paula Núñez' }),
    s({ id: 'sb3', tipo: 'CITA_MEDICA', startAt: '2026-11-12T15:00:00Z', endAt: '2026-11-12T16:30:00Z', justificacion: 'Control en la clínica', estado: 'aprobada', absenceId: 'a4', resueltaPor: 'paula', resueltaEn: hace(60 * 24 * 14), creadaEn: hace(60 * 24 * 15), nombreResolvio: 'Paula Núñez' }),
    ...registradasRrhh.filter(x => x.userId === 'bruno'),
  ].map(x => anuladasRrhh.has(x.id) ? { ...x, estado: 'cancelada', motivoResolucion: anuladasRrhh.get(x.id), nombreResolvio: 'Irene Salas' } : x);
}
function rutasRrhh(q, u, req, json, e) {
  const sol = (o) => ({ estado: 'pendiente', absenceId: null, resueltaPor: null, resueltaEn: null, motivoResolucion: null, creadaEn: hace(40), adjuntos: [], ...o });
  if (q === '/solicitudes/bandeja') return json({
    ausencias: [
      sol({ id: 'v2', userId: 'nicolas', nombre: 'Nicolás Brenes', creadaPor: 'nicolas', tipo: 'VACACIONES', startAt: '2026-12-28T06:00:00Z', endAt: '2027-01-01T05:59:59Z', justificacion: 'Fin de año con la familia', creadaEn: hace(60 * 26) }),
      sol({ id: 'v1', userId: 'ana', nombre: 'Ana Rojas', creadaPor: 'ana', tipo: 'VACACIONES', startAt: '2026-12-21T06:00:00Z', endAt: '2026-12-24T05:59:59Z', justificacion: 'Viaje familiar' }),
      sol({ id: 'c2', userId: 'felipe', nombre: 'Felipe Mora', creadaPor: 'felipe', tipo: 'CITA_MEDICA', startAt: '2026-11-26T20:00:00Z', endAt: '2026-11-26T21:30:00Z', absenceId: 'a7', justificacion: 'Control odontológico', usoMes: { permisoMin: 0, permisoTopeMin: 60, permisoRestanteMin: 60 } }),
    ],
    // RRHH ve y decide los feriados movidos de todos (desde 1.46.0).
    feriados: [{ id: 'f1', userId: 'ana', nombre: 'Ana Rojas', holidayId: 'h-dic1', newDate: '2026-12-24', justification: 'Trabajo el feriado por el cierre de mes', status: 'PENDING', holidayName: 'Abolición del Ejército', holidayDate: '2026-12-01' }],
    esJefe: false, esRrhh: true,
  });
  if (q === '/avisos') return json({ sinLeer: 0, avisos: [] });
  if (q === '/vacaciones/saldo' && u.searchParams.get('userId') === 'bruno') return json(saldoBruno());
  if (q === '/vacaciones/saldo/bruno' && req.method() === 'PUT') { cargaBruno = req.postDataJSON(); return json(saldoBruno()); }
  // Administrar → Ausencias: las solicitudes de Bruno, anularlas y registrar por él.
  const de = q.match(/^\/solicitudes\/de\/(\w+)$/);
  if (de) return json(de[1] === 'bruno' ? solicitudesBruno() : []);
  const anul = q.match(/^\/solicitudes\/(\w+)\/cancelar$/);
  if (anul && req.method() === 'POST') { anuladasRrhh.set(anul[1], req.postDataJSON()?.motivo ?? ''); return json({ ok: true }); }
  if (q === '/absences' && req.method() === 'POST') {
    const b = req.postDataJSON();
    registradasRrhh.push({ id: 'r' + registradasRrhh.length, userId: b.userId, tipo: b.type, startAt: b.startAt.length === 10 ? b.startAt + 'T06:00:00Z' : b.startAt, endAt: b.endAt.length === 10 ? new Date(Date.parse(b.endAt + 'T05:59:59Z') + 86400000).toISOString() : b.endAt, justificacion: b.justification ?? null, estado: 'aprobada', absenceId: 'ra', resueltaPor: 'irene', resueltaEn: hace(0), motivoResolucion: null, creadaPor: 'irene', creadaEn: hace(0), nombreResolvio: 'Irene Salas', adjuntos: [] });
    return json({ id: 'ra', solicitudId: 'r', estado: 'aprobada', aprobadorId: 'paula' }, 201);
  }
  if (q === '/org/roster') return json({ defaultCountry: 'CR', zones: zonas.map(z => ({ id: z.id, name: z.name })), users: planilla() });
  if (q === '/org/departments') {
    const p = planilla();
    return json({ departments: Object.entries(DEPTOS).map(([k, name]) => ({ id: 'd-' + k, name, headcount: p.filter(x => x.departmentId === 'd-' + k).length })) });
  }
  if (q === '/holidays' && req.method() === 'GET') {
    const anio = u.searchParams.get('year') ?? '2026';
    return json(anio !== '2026' ? [] : FERIADOS_2026.map(([country, md, name], i) => ({ id: `h${i}`, date: `2026-${md}T00:00:00.000Z`, name, country })));
  }
  if (q === '/timesheet/scope') return json({ viewerId: 'irene', isAdmin: false, users: [{ id: 'irene', firstName: 'Irene', lastName: 'Salas', email: 'irene@ejemplo.com' }] });
  if (q.startsWith('/timesheet/office')) return json({
    period: 'week', from: '2026-11-23T06:00:00.000Z', to: '2026-11-30T05:59:59.999Z',
    office: { userId: 'irene', totalMinutes: 1240, byDay: [{ date: '2026-11-23', minutes: 505 }, { date: '2026-11-24', minutes: 520 }, { date: '2026-11-25', minutes: 215 }] },
    breakdown: [{ status: 'AVAILABLE', minutes: 880 }, { status: 'IN_MEETING_INTERNAL', minutes: 180 }, { status: 'LUNCH', minutes: 150 }, { status: 'BRB', minutes: 30 }],
    unaccountedMinutes: 0, coverageStart: '2026-09-24', absences: [],
  });
  if (q.startsWith('/timesheet/compliance')) return json({
    sinMarcar30Dias: [{ userId: 'luis', nombre: 'Luis Campos', departamento: null }],
    sesionesAbiertas: [{ userId: 'hugo', nombre: 'Hugo Jiménez', desde: '2026-11-20T23:10:00.000Z' }],
    sinJefe: [{ userId: 'nicolas', nombre: 'Nicolás Brenes' }, { userId: 'luis', nombre: 'Luis Campos' }],
    sinDepartamento: [{ userId: 'luis', nombre: 'Luis Campos' }],
    feriadosCargados: 12, ausenciasDelPeriodo: 5, historialEstadosDesde: '2026-09-24',
    porDepartamento: [
      ...Object.entries(DEPTOS).map(([k, departamento]) => ({ departamentoId: 'd-' + k, departamento, total: planilla().filter(x => x.departmentId === 'd-' + k).length, sinMarcar: 0 })),
      { departamentoId: null, departamento: '(sin departamento)', total: 1, sinMarcar: 1 },
    ],
  });
  return null;
}

async function abrir({ ancho = 1360, alto = 860, ruta = '/', ...esc } = {}) {
  const e = { ...ESCENARIO_BASE, ...esc };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, locale: 'es-CR', timezoneId: 'America/Costa_Rica', deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(AHORA);
  // La conexión en vivo: un EventSource que se abre y queda abierto («En vivo»).
  await page.addInitScript(() => {
    class FakeES {
      constructor() { this.readyState = 1; setTimeout(() => this.onopen && this.onopen({}), 50); }
      close() {} addEventListener() {} removeEventListener() {}
    }
    window.EventSource = FakeES;
    try { localStorage.setItem('vla-escritorio-posponer', String(Date.now())); } catch {}
  });
  page.on('pageerror', err => console.log('PAGEERROR', err.message));

  await page.route('**/*', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname;
    if (p.startsWith('/api/v1/p/office/ui')) {
      const rel = p.replace('/api/v1/p/office/ui', '').replace(/^\//, '') || 'index.html';
      const f = path.join(UI, rel);
      const file = fs.existsSync(f) && fs.statSync(f).isFile() ? f : path.join(UI, 'index.html');
      const tipo = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html';
      return route.fulfill({ path: file, contentType: tipo });
    }
    if (!p.startsWith('/api/v1')) return route.fulfill({ status: 404, body: '' });
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    const q = p.replace('/api/v1/p/office', '');
    const jefe = e.rol === 'jefe', rrhh = e.rol === 'rrhh';
    if (p === '/api/v1/auth/me') return json({
      id: jefe ? 'paula' : rrhh ? 'irene' : 'ana', role: 'STAFF',
      permissions: ['office.view', 'office.checkin', ...(rrhh ? ['office.manage'] : [])],
    });
    if (jefe || rrhh) {
      const r = (jefe ? rutasJefe : rutasRrhh)(q, u, req, json, e);
      if (r) return r;
    }
    if (q === '/layout') return json({ layout: { id: layoutReal.id, name: layoutReal.name, zones: zonas } });
    if (q === '/snapshot') return json(equipo(e));
    if (q === '/presence/me/aviso') return json(null);
    // Google Calendar: `google: 'conectado'` en el escenario; Bruno ocupado en Google hasta las 10:30.
    if (q === '/google/estado') return json(e.google === 'conectado' ? { configurado: true, conectado: true, email: 'ana.rojas@grupovla.com', desde: hace(60 * 24) } : { configurado: true, conectado: false });
    if (q === '/google/ocupados') return json({ bruno: '2026-11-25T16:30:00.000Z' });
    if (q === '/vacaciones/saldo') return json(u.searchParams.get('userId') ? { cargado: false } : saldoAna(e));
    // `escritorio: 'nueva'`: todavía no instaló la app ni conectó Bitrix.
    if (q === '/escritorio/mio' && e.escritorio === 'nueva') return json({ instalada: false, version: null, ultimaVez: null, alDia: false, companeros: 14, publicada: { version: '0.9.6', tamano: 117000000, tamanoTexto: '112 MB', fecha: '2026-10-13' } });
    if (q === '/bitrix/oauth/estado' && e.escritorio === 'nueva') return json({ conectado: false });
    if (q === '/escritorio/mio') return json({ instalada: true, version: '0.9.6', ultimaVez: hace(2), alDia: true, companeros: 14, publicada: { version: '0.9.6', tamano: 117000000, tamanoTexto: '112 MB', fecha: '2026-10-13' } });
    if (q === '/solicitudes/bandeja') return json({ ausencias: [], feriados: [], esJefe: false, esRrhh: false });
    if (q === '/avisos') return json(e.avisos ? { sinLeer: 1, avisos: [
      { id: '3', tipo: 'solicitud.resuelta', titulo: 'Solicitud aprobada', cuerpo: 'Tus vacaciones del 21 al 23 dic fueron aprobadas por Paula Núñez', url: '/dashboard/office?ausencias=1', creadoEn: hace(35), leidoEn: null },
      { id: '2', tipo: 'feriado.resuelto', titulo: 'Feriado aprobado', cuerpo: 'Tu pedido de tomar el feriado el 9 nov fue aprobado por Paula Núñez', url: '/dashboard/office', creadoEn: hace(60 * 24 * 12), leidoEn: hace(60 * 24 * 11) },
    ] } : { sinLeer: 0, avisos: [] });
    if (q === '/avisos/clave-navegador') return json({ clave: null });
    if (q === '/holidays/movable') return json(e.feriadoProximo ? [{ id: 'h-dic1', date: '2026-12-01T00:00:00.000Z', name: 'Abolición del Ejército', country: 'CR' }] : []);
    if (q === '/holidays/overrides/mine') return json([]);
    if (q === '/meetings/invites') return json(e.invitacion ? [{ id: 'inv1', meetingId: 'm1', hostId: 'bruno', hostName: 'Bruno Méndez', justification: 'Repasar la propuesta para el cliente', expiresAt: en(5), meet: e.meet ? 'https://meet.google.com/abc-defg-hij' : null }] : []);
    if (q === '/solicitudes/mias') return json([
      { id: 's1', userId: 'ana', tipo: 'VACACIONES', startAt: '2026-12-21T06:00:00Z', endAt: '2026-12-24T05:59:59Z', justificacion: 'Viaje familiar', estado: 'aprobada', absenceId: 'a1', resueltaPor: 'paula', resueltaEn: hace(35), motivoResolucion: null, creadaPor: 'ana', creadaEn: hace(300), nombreResolvio: 'Paula Núñez' },
      { id: 's2', userId: 'ana', tipo: 'CITA_MEDICA', startAt: '2026-11-27T20:00:00Z', endAt: '2026-11-27T21:30:00Z', justificacion: 'Control en la clínica', estado: 'pendiente', absenceId: 'a2', resueltaPor: null, resueltaEn: null, motivoResolucion: null, creadaPor: 'ana', creadaEn: hace(20), adjuntos: [{ id: 'd1', nombre: 'cita-clinica.pdf', tipo: 'application/pdf', bytes: 84000 }] },
      { id: 's3', userId: 'ana', tipo: 'PERMISO', startAt: '2026-11-13T15:00:00Z', endAt: '2026-11-13T16:00:00Z', justificacion: 'Trámite en la municipalidad', estado: 'rechazada', absenceId: null, resueltaPor: 'paula', resueltaEn: hace(60 * 24 * 13), motivoResolucion: 'Ese día tenemos la capacitación; movámoslo al lunes', creadaPor: 'ana', creadaEn: hace(60 * 24 * 14), nombreResolvio: 'Paula Núñez' },
    ]);
    if (q.startsWith('/absences/usage')) return json({ anio: 2026, mes: 11, permisoMin: 30, permisoTopeMin: 60, permisoRestanteMin: 30, permisoExcedido: false, citas: [], citasMin: 0, citasExcesoMin: 0 });
    if (q.startsWith('/absences/resumen')) {
      const d = u.searchParams.get('desde'), h = u.searchParams.get('hasta');
      const FER = [{ fecha: '2026-12-01', nombre: 'Abolición del Ejército' }, { fecha: '2026-12-25', nombre: 'Navidad' }];
      let hab = 0, corr = 0; const c = new Date(d + 'T12:00:00Z');
      while (c.toISOString().slice(0, 10) <= h) { const f = c.toISOString().slice(0, 10), w = c.getUTCDay(); corr++; if (!FER.some(x => x.fecha === f)) hab += w === 0 ? 0 : w === 6 ? 0.5 : 1; c.setUTCDate(c.getUTCDate() + 1); }
      const r = new Date(h + 'T12:00:00Z'); do { r.setUTCDate(r.getUTCDate() + 1); } while (r.getUTCDay() === 0 || FER.some(x => x.fecha === r.toISOString().slice(0, 10)));
      return json({ diasHabiles: hab, diasCorridos: corr, reintegro: r.toISOString().slice(0, 10), sabado: 0.5, feriados: FER, aprobador: { id: 'paula', nombre: 'Paula Núñez' } });
    }
    if (q === '/org/chart') return json({ personas: equipo(e).map(x => ({
      userId: x.userId, nombre: `${x.firstName} ${x.lastName}`,
      managerUserId: x.userId === 'nicolas' ? null : ['paula', 'diego', 'elena', 'hugo', 'irene', 'luis', 'marta', 'julian', 'karla'].includes(x.userId) ? 'nicolas' : ['felipe', 'gina'].includes(x.userId) ? 'marta' : 'paula',
      departamento: ({ ana: 'Ventas', paula: 'Ventas', bruno: 'Ventas', camila: 'Ventas', diego: 'Mercadeo', elena: 'Finanzas', felipe: 'Call Center', gina: 'Call Center', hugo: 'Desarrollo', irene: 'Recursos Humanos', julian: 'Academy', karla: 'Cobros', luis: 'Consultoría', marta: 'English Sales', nicolas: 'Gerencia General' })[x.userId],
      estado: x.status, pais: x.userId === 'marta' ? 'CO' : 'CR',
    })) });
    if (q === '/timesheet/scope') return json({ viewerId: 'ana', isAdmin: false, users: [{ id: 'ana', firstName: 'Ana', lastName: 'Rojas', email: 'ana.rojas@ejemplo.com' }] });
    if (q.startsWith('/timesheet/office')) return json({
      period: 'week', from: '2026-11-23T06:00:00.000Z', to: '2026-11-30T05:59:59.999Z',
      office: { userId: 'ana', totalMinutes: 1185, byDay: [{ date: '2026-11-23', minutes: 492 }, { date: '2026-11-24', minutes: 515 }, { date: '2026-11-25', minutes: 178 }] },
      breakdown: [{ status: 'AVAILABLE', minutes: 760 }, { status: 'IN_MEETING_INTERNAL', minutes: 150 }, { status: 'FOCUS', minutes: 120 }, { status: 'LUNCH', minutes: 120 }, { status: 'BRB', minutes: 35 }],
      unaccountedMinutes: 0, coverageStart: '2026-09-24', absences: [],
    });
    if (q.startsWith('/timesheet/')) return json({ message: 'Solo para jefes' }, 403);
    if (q === '/planta') return json({ estado: 'sed', horasSinAgua: 27, puedeRegar: true, seriaRescate: false, ultimoRiegoPor: 'Bruno Méndez', ultimoRiegoEn: hace(27 * 60), misRiegos: 4 });
    // `sinBitrix: true`: no conectó su Bitrix (el servidor responde 409 con `conectar`).
    if (q === '/jornada/borrador' && e.sinBitrix) return json({ message: 'Conectá tu Bitrix para usar la jornada', conectar: '/api/v1/p/office/bitrix/oauth/start' }, 409);
    if (q === '/jornada/borrador') return json({ jornada: { estado: e.jornadaAbierta ? 'trabajando' : 'sin_iniciar', trabajadoSeg: 7.6 * 3600 }, reporte: '• Seguimiento a 12 prospectos\n• Propuesta para Clínica Santa Ana\n• Capacitación de producto', pideHora: false, horaSugerida: '17:02' });
    if (q === '/bitrix/oauth/estado') return json({ conectado: true });
    if (req.method() === 'GET') return json([]);
    return json({ ok: true });
  });

  await page.goto(ORIGEN + '/api/v1/p/office/ui' + ruta);
  await page.getByTestId('vista-oficina').waitFor({ timeout: 20000 });
  await page.waitForTimeout(900);
  return { browser, page };
}

/**
 * Marca partes de la pantalla: un recuadro con un número (y un texto corto si
 * hace falta). `blanco` es un Locator de Playwright.
 */
async function anotar(page, marcas, { oscurecer = false } = {}) {
  const cajas = [];
  for (const m of marcas) {
    const blancos = Array.isArray(m.blanco) ? m.blanco : [m.blanco];
    const bs = [];
    for (const bl of blancos) { const x = await bl.first().boundingBox(); if (x) bs.push(x); }
    if (!bs.length) { console.log('SIN CAJA para la marca', m.n); continue; }
    const x0 = Math.min(...bs.map(c => c.x)), y0 = Math.min(...bs.map(c => c.y));
    const b = { x: x0, y: y0, width: Math.max(...bs.map(c => c.x + c.width)) - x0, height: Math.max(...bs.map(c => c.y + c.height)) - y0 };
    cajas.push({ ...b, n: m.n, texto: m.texto ?? null, lado: m.lado ?? 'auto', pad: m.pad ?? 5 });
  }
  await page.evaluate(({ cajas, oscurecer }) => {
    document.getElementById('__anot')?.remove();
    const capa = document.createElement('div');
    capa.id = '__anot';
    Object.assign(capa.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none' });
    const W = window.innerWidth, H = window.innerHeight;
    if (oscurecer && cajas.length) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      Object.assign(svg.style, { position: 'absolute', inset: '0' });
      const huecos = cajas.map(c => `M${c.x - c.pad},${c.y - c.pad} h${c.width + 2 * c.pad} v${c.height + 2 * c.pad} h${-(c.width + 2 * c.pad)} Z`).join(' ');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M0,0 H${W} V${H} H0 Z ${huecos}`);
      path.setAttribute('fill-rule', 'evenodd');
      path.setAttribute('fill', 'rgba(15,23,42,0.38)');
      svg.appendChild(path);
      capa.appendChild(svg);
    }
    for (const c of cajas) {
      const r = document.createElement('div');
      Object.assign(r.style, {
        position: 'absolute', left: `${c.x - c.pad}px`, top: `${c.y - c.pad}px`, width: `${c.width + 2 * c.pad}px`, height: `${c.height + 2 * c.pad}px`,
        border: '3px solid #f97316', borderRadius: '12px', boxShadow: '0 0 0 4px rgba(249,115,22,0.18)',
      });
      capa.appendChild(r);
      // El número: arriba a la izquierda, afuera del recuadro, sin taparlo.
      const b = document.createElement('div');
      b.textContent = String(c.n);
      const izq = Math.max(4, c.x - c.pad - 14), arr = Math.max(4, c.y - c.pad - 14);
      Object.assign(b.style, {
        position: 'absolute', left: `${izq}px`, top: `${arr}px`, width: '28px', height: '28px', borderRadius: '50%',
        background: '#f97316', color: '#fff', font: '700 15px/28px system-ui, sans-serif', textAlign: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)', border: '2px solid #fff',
      });
      capa.appendChild(b);
      if (c.texto) {
        const t = document.createElement('div');
        t.textContent = c.texto;
        Object.assign(t.style, {
          position: 'absolute', background: '#0f172a', color: '#fff', font: '600 13px/1.35 system-ui, sans-serif', padding: '6px 10px',
          borderRadius: '8px', maxWidth: '240px', boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        });
        capa.appendChild(t);
        const tw = Math.min(240, t.getBoundingClientRect().width), th = t.getBoundingClientRect().height;
        let lado = c.lado;
        if (lado === 'auto') lado = c.y + c.height + th + 20 < H ? 'abajo' : 'arriba';
        let x = c.x - c.pad, y = lado === 'abajo' ? c.y + c.height + c.pad + 10 : lado === 'arriba' ? c.y - c.pad - th - 10 : c.y;
        if (lado === 'izquierda') x = c.x - c.pad - tw - 12;
        if (lado === 'derecha') x = c.x + c.width + c.pad + 12;
        x = Math.min(Math.max(8, x), W - tw - 8);
        y = Math.min(Math.max(8, y), H - th - 8);
        Object.assign(t.style, { left: `${x}px`, top: `${y}px` });
      }
    }
    document.body.appendChild(capa);
  }, { cajas, oscurecer });
}

async function foto(page, nombre, clip) {
  const archivo = path.join(OUT, `${nombre}.png`);
  await page.screenshot({ path: archivo, ...(clip ? { clip } : {}) });
  console.log('foto', nombre);
  return archivo;
}

async function limpiar(page) {
  await page.evaluate(() => document.getElementById('__anot')?.remove());
}

/** Marca con data-anot el primer ancestro (o el mismo) del texto que mida al menos esto. */
async function etiquetar(page, texto, nombre, { minAlto = 0, minAncho = 0, maxAncho = 99999 } = {}) {
  const ok = await page.evaluate(({ texto, nombre, minAlto, minAncho, maxAncho }) => {
    const todos = [...document.querySelectorAll('body *')].filter(el => el.childElementCount === 0 && el.textContent.trim() === texto);
    for (const inicio of todos) {
      if (!inicio.getClientRects().length) continue; // oculto
      let el = inicio;
      while (el && el !== document.body) {
        const r = el.getBoundingClientRect();
        if (r.width > maxAncho) break;
        if (r.height >= minAlto && r.width >= minAncho) { el.setAttribute('data-anot', nombre); return true; }
        el = el.parentElement;
      }
    }
    return false;
  }, { texto, nombre, minAlto, minAncho, maxAncho });
  if (!ok) console.log('etiquetar: no encontré', texto);
  return page.locator(`[data-anot="${nombre}"]`);
}

/** Recorte alrededor de un elemento, con margen, dentro de la ventana. */
async function recorte(page, loc, margen = 40, extra = {}) {
  const b = await loc.first().boundingBox();
  const v = page.viewportSize();
  const x = Math.max(0, b.x - margen), y = Math.max(0, b.y - margen);
  const w = Math.min(v.width - x, b.width + 2 * margen + (extra.ancho ?? 0));
  const h = Math.min(v.height - y, b.height + 2 * margen + (extra.alto ?? 0));
  return { x, y, width: w, height: h };
}

const modal = (page) => page.locator('div.fixed.inset-0 > div').last();
const estadoBtn = (page, nombre = 'Disponible') => page.getByRole('button', { name: nombre, exact: true });
async function elegirEstado(page, etiqueta) {
  await estadoBtn(page).click();
  await page.locator('div.w-52').getByRole('button', { name: new RegExp(`^${etiqueta}`) }).first().click();
  await page.waitForTimeout(500);
}

module.exports = { abrir, anotar, foto, limpiar, AHORA, etiquetar, recorte, modal, estadoBtn, elegirEstado };
