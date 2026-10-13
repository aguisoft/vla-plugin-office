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
  return [
    yo,
    p('paula', 'Paula', 'Núñez', 'sales', 'IN_MEETING_EXTERNAL', { justification: 'Visita a un cliente', avatar: av('#D4A574', 'ponytail', '#2C2C2C', '#9B59B6', 'glasses') }),
    p('bruno', 'Bruno', 'Méndez', 'sales', 'AVAILABLE', { avatar: av('#F5CBA7', 'buzz', '#8B4513', '#2ECC71', 'headphones') }),
    p('camila', 'Camila', 'Soto', 'sales', 'BRB', { justification: 'Voy por un café', statusStartsAt: hace(6), avatar: av('#FDDBB4', 'curly', '#C4A35A', '#FF7043') }),
    p('diego', 'Diego', 'Vargas', 'marketin', 'FOCUS', { justification: 'Diseñando la campaña de diciembre', avatar: av('#C68642', 'short', '#1A1A1A', '#34495E') }),
    p('elena', 'Elena', 'Castro', 'finanzas', 'AVAILABLE', { avatar: av('#F1C27D', 'long', '#1A1A1A', '#1ABC9C', 'earbuds') }),
    p('felipe', 'Felipe', 'Mora', 'call-cen', 'IN_MEETING_INTERNAL', { justification: 'Revisión de llamadas', meetingWith: [{ userId: 'gina', firstName: 'Gina', lastName: 'Herrera' }], avatar: av('#8D5524', 'afro', '#1A1A1A', '#E74C3C') }),
    p('gina', 'Gina', 'Herrera', 'call-cen', 'IN_MEETING_INTERNAL', { justification: 'Revisión de llamadas', meetingWith: [{ userId: 'felipe', firstName: 'Felipe', lastName: 'Mora' }], avatar: av('#F5CBA7', 'ponytail', '#D2691E', '#F39C12') }),
    p('hugo', 'Hugo', 'Jiménez', 'developm', 'AVAILABLE', { avatar: av('#FDDBB4', 'mohawk', '#2C2C2C', '#00BCD4', 'glasses') }),
    p('irene', 'Irene', 'Salas', 'rrhh', 'AVAILABLE', { avatar: av('#D4A574', 'curly', '#4A3728', '#9B59B6') }),
    p('julian', 'Julián', 'Ortiz', 'academy', 'VACACIONES', { absenceStartsAt: '2026-11-23T06:00:00Z', absenceEndsAt: '2026-11-28T05:59:59Z', avatar: av('#F1C27D', 'short', '#8B4513', '#3498DB', 'hat') }),
    p('karla', 'Karla', 'Fonseca', 'cobros', 'PERMISO', { justification: 'Trámite en el banco', absenceStartsAt: hace(20), absenceEndsAt: en(40), isCheckedIn: true, avatar: av('#C68642', 'long', '#1A1A1A', '#E91E63') }),
    p('luis', 'Luis', 'Campos', 'consulti', 'OFFLINE', { avatar: av('#FDDBB4', 'bald', '#1A1A1A', '#34495E') }),
    p('marta', 'Marta', 'Quesada', 'english-', 'AVAILABLE', { avatar: av('#F5CBA7', 'long', '#C4A35A', '#2ECC71') }),
    p('nicolas', 'Nicolás', 'Brenes', 'gerencia', 'AVAILABLE', { avatar: av('#D4A574', 'short', '#2C2C2C', '#34495E', 'glasses') }),
  ];
}

const ESCENARIO_BASE = {
  yoAdentro: true, yoEstado: 'AVAILABLE', yoHasta: undefined, yoMotivo: undefined, yoDesde: undefined,
  invitacion: false, feriadoProximo: false, avisos: true, jornadaAbierta: true,
};

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
    if (p === '/api/v1/auth/me') return json({ id: 'ana', role: 'STAFF', permissions: ['office.view', 'office.checkin'] });
    if (q === '/layout') return json({ layout: { id: layoutReal.id, name: layoutReal.name, zones: zonas } });
    if (q === '/snapshot') return json(equipo(e));
    if (q === '/presence/me/aviso') return json(null);
    if (q === '/escritorio/mio') return json({ instalada: true, version: '0.9.6', ultimaVez: hace(2), alDia: true, companeros: 14, publicada: { version: '0.9.6', tamano: 117000000, tamanoTexto: '112 MB', fecha: '2026-10-13' } });
    if (q === '/solicitudes/bandeja') return json({ ausencias: [], feriados: [], esJefe: false, esRrhh: false });
    if (q === '/avisos') return json(e.avisos ? { sinLeer: 1, avisos: [
      { id: '3', tipo: 'solicitud.resuelta', titulo: 'Solicitud aprobada', cuerpo: 'Tus vacaciones del 21 al 23 dic fueron aprobadas por Paula Núñez', url: '/dashboard/office?ausencias=1', creadoEn: hace(35), leidoEn: null },
      { id: '2', tipo: 'feriado.resuelto', titulo: 'Feriado aprobado', cuerpo: 'Tu pedido de tomar el feriado el 9 nov fue aprobado por Paula Núñez', url: '/dashboard/office', creadoEn: hace(60 * 24 * 12), leidoEn: hace(60 * 24 * 11) },
    ] } : { sinLeer: 0, avisos: [] });
    if (q === '/avisos/clave-navegador') return json({ clave: null });
    if (q === '/holidays/movable') return json(e.feriadoProximo ? [{ id: 'h-dic1', date: '2026-12-01T00:00:00.000Z', name: 'Abolición del Ejército', country: 'CR' }] : []);
    if (q === '/holidays/overrides/mine') return json([]);
    if (q === '/meetings/invites') return json(e.invitacion ? [{ id: 'inv1', meetingId: 'm1', hostId: 'bruno', hostName: 'Bruno Méndez', justification: 'Repasar la propuesta para el cliente', expiresAt: en(5) }] : []);
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

module.exports = { abrir, anotar, foto, limpiar, AHORA };
