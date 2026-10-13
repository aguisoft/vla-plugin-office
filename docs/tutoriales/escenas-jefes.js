// Las tomas de la guía para jefes. Quien mira es Paula Núñez, jefa de Ventas,
// con Ana, Bruno y Camila a cargo (ver rutasJefe en estudio.js).
const path = require('path');
const { abrir, anotar, foto, etiquetar, recorte, modal } = require('./estudio');

const JEFE = { rol: 'jefe' };

const ESCENAS = {
  async '21-jefe-encabezado'() {
    const { browser, page } = await abrir(JEFE);
    await anotar(page, [
      { n: 1, blanco: page.getByTestId('boton-solicitudes'), pad: 2 },
      { n: 2, blanco: page.getByTestId('campana-avisos'), pad: 2 },
      { n: 3, blanco: page.getByTestId('guia-uso'), pad: 2 },
    ]);
    await foto(page, '21-jefe-encabezado', { x: 760, y: 0, width: 600, height: 80 });
    await browser.close();
  },

  async '22-jefe-bandeja'() {
    const { browser, page } = await abrir(JEFE);
    await page.getByTestId('boton-solicitudes').click();
    const b = page.getByTestId('bandeja-solicitudes');
    await b.waitFor();
    await page.waitForTimeout(500);
    // La lista tiene scroll propio: para la foto, que entre entera.
    await b.evaluate(el => { el.style.maxHeight = 'none'; el.querySelectorAll('.overflow-y-auto').forEach(x => { x.style.overflow = 'visible'; }); });
    await page.setViewportSize({ width: 1360, height: 1300 });
    await page.waitForTimeout(300);
    const tarjetas = b.locator('div.space-y-2 > div');
    await anotar(page, [
      { n: 1, blanco: tarjetas.nth(0) },
      { n: 2, blanco: tarjetas.nth(1) },
      { n: 3, blanco: b.getByText('cita-clinica.pdf') },
      { n: 4, blanco: tarjetas.nth(3) },
      { n: 5, blanco: b.getByTestId('aprobar-v1') },
      { n: 6, blanco: tarjetas.nth(0).getByRole('button', { name: 'No aprobar' }) },
    ]);
    await foto(page, '22-jefe-bandeja', await recorte(page, b, 40));
    await browser.close();
  },

  async '23-jefe-no-aprobar'() {
    const { browser, page } = await abrir(JEFE);
    await page.getByTestId('boton-solicitudes').click();
    const b = page.getByTestId('bandeja-solicitudes');
    await b.waitFor();
    const primera = b.locator('div.space-y-2 > div').first();
    await primera.getByRole('button', { name: 'No aprobar' }).click();
    await primera.getByLabel('Motivo').fill('Esa semana cerramos el año con el equipo; pasémoslas a enero');
    await page.waitForTimeout(300);
    await anotar(page, [
      { n: 1, blanco: primera.getByLabel('Motivo') },
      { n: 2, blanco: primera.getByRole('button', { name: 'No aprobar' }) },
      { n: 3, blanco: primera.getByRole('button', { name: 'Volver' }) },
    ]);
    await foto(page, '23-jefe-no-aprobar', await recorte(page, primera, 40));
    await browser.close();
  },

  async '24-jefe-avisos'() {
    const { browser, page } = await abrir(JEFE);
    await page.getByTestId('campana-avisos').click();
    await page.waitForTimeout(400);
    const panel = page.getByTestId('panel-avisos');
    await anotar(page, [{ n: 1, blanco: panel.locator('button').filter({ hasText: 'pidió vacaciones' }) }]);
    await foto(page, '24-jefe-avisos', await recorte(page, panel, 40));
    await browser.close();
  },

  async '25-jefe-correo'() {
    // El correo que le llega a la jefa: la misma plantilla y la misma ficha que manda el plugin.
    const D = path.join(__dirname, '..', '..', 'dist', 'lib');
    const { armarCorreo } = require(path.join(D, 'correo-aviso.js'));
    const { fichaSolicitud } = require(path.join(D, 'solicitudes.js'));
    const ficha = fichaSolicitud({
      nombre: 'Ana Rojas', tipo: 'VACACIONES', startIso: '2026-12-21T06:00:00Z', endIso: '2026-12-24T05:59:59Z', tz: 'America/Costa_Rica',
      diasHabiles: 3, reintegro: '2026-12-24', comentarios: 'Viaje familiar',
    });
    const c = armarCorreo({ titulo: 'Solicitud de tu equipo', cuerpo: 'Ana Rojas pidió vacaciones del 21 al 23 dic (3 días hábiles)', url: '/dashboard/office?solicitudes=1', ficha }, 'https://system.somosvla.com');
    const { browser, page } = await abrir(JEFE);
    await page.setContent(c.html);
    await page.waitForTimeout(300);
    await anotar(page, [{ n: 1, blanco: page.getByText('Abrir en la oficina') }]);
    await foto(page, '25-jefe-correo', await recorte(page, page.locator('table[role="presentation"] table').first(), 30));
    await browser.close();
  },

  async '26-jefe-cronometro'() {
    const { browser, page } = await abrir(JEFE);
    await page.getByText('Bruno', { exact: true }).filter({ visible: true }).first().hover();
    await page.waitForTimeout(700);
    const tarjeta = await etiquetar(page, 'bruno@ejemplo.com', 'tarjeta-bruno', { minAlto: 180, maxAncho: 320 });
    const z = await etiquetar(page, 'Sales Department', 'zona-sales', { minAlto: 100, maxAncho: 600 });
    await anotar(page, [
      { n: 1, blanco: page.getByText('1:15:00').filter({ visible: true }).first() },
      { n: 2, blanco: tarjeta, pad: 4 },
    ]);
    const a = await tarjeta.boundingBox(), b = await z.boundingBox();
    const x = Math.max(0, Math.min(a.x, b.x) - 40), y = Math.max(0, Math.min(a.y, b.y) - 40);
    await foto(page, '26-jefe-cronometro', { x, y, width: Math.max(a.x + a.width, b.x + b.width) + 40 - x, height: Math.max(a.y + a.height, b.y + b.height) + 40 - y });
    await browser.close();
  },

  async '27-jefe-tiempos'() {
    const { browser, page } = await abrir(JEFE);
    await page.getByTestId('vista-tiempos').click();
    await page.waitForTimeout(1500);
    const cobertura = await etiquetar(page, 'Cobertura horaria', 'cobertura', { minAlto: 150 });
    const filaBruno = page.locator('tr').filter({ hasText: 'Bruno Méndez' });
    await anotar(page, [
      { n: 1, blanco: filaBruno },
      { n: 2, blanco: page.getByText('Vs. su promedio', { exact: false }).first() },
      { n: 3, blanco: page.getByText('Días', { exact: true }).first() },
      { n: 4, blanco: page.getByText('Entrada habitual', { exact: false }).first() },
      { n: 5, blanco: cobertura },
    ]);
    await foto(page, '27-jefe-tiempos', { x: 160, y: 70, width: 1060, height: 600 });
    await browser.close();
  },

  async '28-jefe-detalle'() {
    const { browser, page } = await abrir(JEFE);
    await page.getByTestId('vista-tiempos').click();
    await page.waitForTimeout(1500);
    await page.locator('tr').filter({ hasText: 'Bruno Méndez' }).click();
    await page.waitForTimeout(1200);
    await anotar(page, [{ n: 1, blanco: page.getByText(/Volver al equipo/).first() }]);
    await foto(page, '28-jefe-detalle', { x: 160, y: 70, width: 1060, height: 520 });
    await browser.close();
  },
};

(async () => {
  const pedidas = process.argv.slice(2);
  for (const [nombre, f] of Object.entries(ESCENAS)) {
    if (pedidas.length && !pedidas.some(p => nombre.startsWith(p))) continue;
    try { await f(); } catch (e) { console.log('FALLÓ', nombre, '→', e.message.split('\n')[0]); }
  }
})();
