// Las tomas del tutorial para colaboradores. Cada escena abre su propia
// oficina de ejemplo, arma la pantalla, la marca y la fotografía.
const { abrir, anotar, foto, etiquetar, recorte, modal, estadoBtn, elegirEstado } = require('./estudio');

const ESCENAS = {
  async '01-vista-general'() {
    const { browser, page } = await abrir();
    const mapa = await etiquetar(page, 'Sales Department', 'zona-sales', { minAlto: 100, maxAncho: 600 });
    const presentes = await etiquetar(page, 'Presentes', 'presentes', { minAlto: 500 });
    await anotar(page, [
      { n: 1, blanco: page.getByRole('navigation', { name: 'Pantallas de la oficina' }) },
      { n: 2, blanco: page.locator('div.overflow-x-auto').filter({ has: page.getByRole('button', { name: /^Todos/ }) }), pad: 3 },
      { n: 3, blanco: mapa },
      { n: 4, blanco: presentes, pad: 2 },
      { n: 5, blanco: estadoBtn(page) },
      { n: 6, blanco: page.getByRole('button', { name: 'Salir' }) },
      { n: 7, blanco: page.getByTestId('campana-avisos') },
      { n: 8, blanco: page.getByTestId('menu-personal') },
      { n: 9, blanco: page.getByTestId('guia-uso') },
    ]);
    await foto(page, '01-vista-general', { x: 0, y: 0, width: 1360, height: 780 });
    await browser.close();
  },

  async '02-entrar'() {
    const { browser, page } = await abrir({ yoAdentro: false, yoEstado: 'OFFLINE' });
    await anotar(page, [{ n: 1, blanco: page.getByRole('button', { name: 'Entrar a la oficina' }), texto: 'Tocá acá al empezar el día', lado: 'abajo' }]);
    await foto(page, '02-entrar', { x: 560, y: 0, width: 800, height: 150 });
    await browser.close();
  },

  async '03-estados'() {
    const { browser, page } = await abrir();
    await estadoBtn(page).click();
    await page.waitForTimeout(300);
    const dia = await etiquetar(page, 'Estado del día', 'grupo-dia', { minAlto: 150 });
    const aus = await etiquetar(page, 'Ausencia', 'grupo-aus', { minAlto: 120 });
    await anotar(page, [
      { n: 1, blanco: dia, pad: 2 },
      { n: 2, blanco: aus, pad: 2 },
      { n: 3, blanco: page.getByRole('button', { name: 'Mis ausencias…' }), pad: 2 },
    ]);
    const caja = await recorte(page, page.locator('[data-anot="grupo-dia"]').locator('..'), 50);
    await foto(page, '03-estados', { ...caja, y: 0, height: caja.height + caja.y });
    await browser.close();
  },

  async '04-concentrado'() {
    const { browser, page } = await abrir();
    await elegirEstado(page, 'Concentrado');
    await page.locator('textarea').first().fill('Preparando la propuesta para la clínica');
    await anotar(page, [
      { n: 1, blanco: page.locator('textarea').first() },
      { n: 2, blanco: modal(page).getByRole('button').last() },
    ]);
    await foto(page, '04-concentrado', await recorte(page, modal(page)));
    await browser.close();
  },

  async '05-almuerzo'() {
    const { browser, page } = await abrir();
    await elegirEstado(page, 'Almuerzo');
    const m = modal(page);
    await anotar(page, [
      { n: 1, blanco: [m.locator('input[type="time"]').first(), m.locator('input[type="time"]').last(), m.getByText('Desde', { exact: true })], pad: 6 },
      { n: 2, blanco: m.getByRole('button').last() },
    ]);
    await foto(page, '05-almuerzo', await recorte(page, m));
    await browser.close();
  },

  async '06-volver-del-almuerzo'() {
    const { browser, page } = await abrir({ yoEstado: 'LUNCH', yoDesde: new Date(Date.parse('2026-11-25T15:05:00Z')).toISOString(), yoHasta: '2026-11-25T16:05:00Z' });
    await anotar(page, [{ n: 1, blanco: page.getByRole('button', { name: /^Almuerzo/ }).first(), texto: 'Al volver, tocá acá y elegí «Disponible»', lado: 'abajo' }]);
    await foto(page, '06-volver-del-almuerzo', { x: 560, y: 0, width: 800, height: 150 });
    await browser.close();
  },

  async '07-reunion-interna'() {
    const { browser, page } = await abrir();
    await elegirEstado(page, 'En reunión interna');
    const m = modal(page);
    await m.locator('textarea').first().fill('Repasar la propuesta para el cliente');
    await m.getByText('Bruno Méndez', { exact: true }).click();
    await m.getByText('Camila Soto', { exact: true }).click();
    await page.waitForTimeout(300);
    await anotar(page, [
      { n: 1, blanco: m.locator('textarea').first() },
      { n: 2, blanco: [m.locator('input[type="checkbox"]').first(), m.getByText('Paula Núñez', { exact: true }), m.getByText('Gina Herrera', { exact: true })], pad: 10 },
      { n: 3, blanco: m.getByRole('button').last() },
    ]);
    await foto(page, '07-reunion-interna', await recorte(page, m));
    await browser.close();
  },

  async '08-invitacion'() {
    const { browser, page } = await abrir({ invitacion: true });
    await page.waitForTimeout(800);
    const m = modal(page);
    await anotar(page, [
      { n: 1, blanco: m.getByRole('button', { name: /Aceptar|Unirme/ }) },
      { n: 2, blanco: m.getByRole('button', { name: /Rechazar|No puedo/ }) },
    ]);
    await foto(page, '08-invitacion', await recorte(page, m));
    await browser.close();
  },

  async '09-companero'() {
    const { browser, page } = await abrir();
    await page.getByText('Paula', { exact: true }).filter({ visible: true }).first().hover();
    await page.waitForTimeout(600);
    const tarjeta = await etiquetar(page, 'Visita a un cliente', 'tarjeta', { minAlto: 150, maxAncho: 300 });
    const z = await etiquetar(page, 'Sales Department', 'zona-sales', { minAlto: 100, maxAncho: 600 });
    await anotar(page, [{ n: 1, blanco: tarjeta, pad: 4 }]);
    const a = await tarjeta.boundingBox(), b = await z.boundingBox();
    const x = Math.max(0, Math.min(a.x, b.x) - 40), y = Math.max(0, Math.min(a.y, b.y) - 40);
    await foto(page, '09-companero', { x, y, width: Math.max(a.x + a.width, b.x + b.width) + 40 - x, height: Math.max(a.y + a.height, b.y + b.height) + 40 - y });
    await browser.close();
  },

  async '10-permiso'() {
    const { browser, page } = await abrir();
    await elegirEstado(page, 'Permiso');
    const m = modal(page);
    await m.locator('input[type="time"]').first().fill('14:00');
    await m.locator('input[type="time"]').last().fill('14:30');
    await m.locator('textarea').first().fill('Trámite en el banco').catch(() => {});
    await page.waitForTimeout(300);
    await anotar(page, [
      { n: 1, blanco: m.locator('input').first() },
      { n: 2, blanco: [m.locator('input[type="time"]').first(), m.locator('input[type="time"]').last(), m.getByText('Desde', { exact: true })], pad: 6 },
      { n: 3, blanco: m.getByText(/Llevás/).first() },
      { n: 4, blanco: m.locator('textarea').first() },
      { n: 5, blanco: m.getByText(/Adjuntar|comprobante/i).first() },
      { n: 6, blanco: m.getByRole('button').last() },
    ]);
    await foto(page, '10-permiso', await recorte(page, m));
    await browser.close();
  },

  async '11-vacaciones'() {
    const { browser, page } = await abrir();
    await elegirEstado(page, 'Vacaciones');
    const m = page.getByTestId('solicitud-dias');
    await m.getByLabel('Mes siguiente').click();
    await page.getByTestId('dia-2026-12-21').click();
    await page.getByTestId('dia-2026-12-23').click();
    await page.waitForTimeout(500);
    await m.locator('textarea').fill('Viaje familiar');
    await anotar(page, [
      { n: 1, blanco: m.locator('div.rounded-xl.border').first() },
      { n: 2, blanco: page.getByTestId('ficha-solicitud') },
      { n: 3, blanco: page.getByTestId('saldo-vacaciones') },
      { n: 4, blanco: m.locator('textarea') },
      { n: 5, blanco: page.getByTestId('quien-aprueba') },
      { n: 6, blanco: page.getByTestId('enviar-solicitud') },
    ]);
    await foto(page, '11-vacaciones', await recorte(page, m, 30));
    await browser.close();
  },

  async '12-mis-ausencias'() {
    const { browser, page } = await abrir();
    await page.getByTestId('menu-personal').click();
    await page.getByTestId('personal-ausencias').click();
    await page.waitForTimeout(600);
    const lista = page.getByTestId('mis-solicitudes');
    await lista.evaluate(el => { el.style.maxHeight = 'none'; });
    await page.waitForTimeout(200);
    const tarjetas = lista.locator(':scope > div');
    await anotar(page, [
      { n: 1, blanco: page.getByTestId('mi-saldo') },
      { n: 2, blanco: page.getByTestId('mover-feriado') },
      { n: 3, blanco: tarjetas.nth(0) },
      { n: 4, blanco: tarjetas.nth(1) },
      { n: 5, blanco: tarjetas.nth(2) },
    ]);
    await foto(page, '12-mis-ausencias', await recorte(page, modal(page)));
    await browser.close();
  },

  async '39-vacaciones-sin-saldo'() {
    // Ana tiene 2 días y pide 3: no la deja enviar.
    const { browser, page } = await abrir({ saldoAna: 2 });
    await elegirEstado(page, 'Vacaciones');
    const m = page.getByTestId('solicitud-dias');
    await m.getByLabel('Mes siguiente').click();
    await page.getByTestId('dia-2026-12-21').click();
    await page.getByTestId('dia-2026-12-23').click();
    await page.waitForTimeout(500);
    await anotar(page, [
      { n: 1, blanco: page.getByTestId('saldo-vacaciones'), pad: 4 },
      { n: 2, blanco: page.getByTestId('enviar-solicitud'), pad: 4 },
    ]);
    const caja = await m.boundingBox();
    const ficha = await page.getByTestId('ficha-solicitud').boundingBox();
    const boton = await page.getByTestId('enviar-solicitud').boundingBox();
    await foto(page, '39-vacaciones-sin-saldo', { x: caja.x, y: ficha.y - 30, width: caja.width, height: boton.y + boton.height + 30 - (ficha.y - 30) });
    await browser.close();
  },

  async '41-escritorio'() {
    const { browser, page } = await abrir({ escritorio: 'nueva', alto: 900 });
    await page.getByTestId('menu-personal').click();
    await page.getByTestId('personal-escritorio').click();
    await page.getByTestId('paso-descargar').waitFor();
    await page.getByLabel('Código de la app de escritorio').fill('K7P3QX');
    await page.waitForTimeout(400);
    const m = modal(page);
    await anotar(page, [
      { n: 1, blanco: page.getByRole('link', { name: /Descargar VLA Oficina/ }), pad: 4 },
      { n: 2, blanco: [page.getByLabel('Código de la app de escritorio'), page.getByRole('button', { name: 'Vincular' })], pad: 4 },
      { n: 3, blanco: page.getByRole('button', { name: 'Conectar mi Bitrix' }), pad: 4 },
    ]);
    await foto(page, '41-escritorio', await recorte(page, m, 30));
    await browser.close();
  },

  async '13-aviso-feriado'() {
    const { browser, page } = await abrir({ feriadoProximo: true });
    await page.waitForTimeout(600);
    const aviso = page.getByTestId('aviso-feriado');
    await anotar(page, [{ n: 1, blanco: aviso.getByRole('button', { name: 'Pedir tomarlo otro día' }) }]);
    await foto(page, '13-aviso-feriado', await recorte(page, aviso, 30));
    await aviso.getByRole('button', { name: 'Pedir tomarlo otro día' }).click();
    await page.waitForTimeout(800);
    const m = modal(page);
    await page.getByTestId('dia-2026-12-24').click();
    await m.locator('textarea').first().fill('Trabajo el feriado por el cierre de mes y lo tomo el 24');
    await page.waitForTimeout(300);
    await anotar(page, [
      { n: 1, blanco: page.getByTestId('calendario-feriado') },
      { n: 2, blanco: m.locator('textarea').first() },
      { n: 3, blanco: m.getByRole('button').last() },
    ]);
    await foto(page, '14-mover-feriado', await recorte(page, m));
    await browser.close();
  },

  async '15-campana'() {
    const { browser, page } = await abrir();
    await page.getByTestId('campana-avisos').click();
    await page.waitForTimeout(400);
    const panel = page.getByTestId('panel-avisos');
    await anotar(page, [
      { n: 1, blanco: panel.locator('button').filter({ hasText: 'Solicitud aprobada' }) },
      { n: 2, blanco: panel.getByRole('button', { name: 'Marcar todo como leído' }) },
    ]);
    await foto(page, '15-campana', await recorte(page, panel, 40));
    await browser.close();
  },

  async '16-tiempos'() {
    const { browser, page } = await abrir();
    await page.getByTestId('vista-tiempos').click();
    await page.waitForTimeout(1500);
    const enOficina = await etiquetar(page, 'Tiempo en oficina', 'en-oficina', { minAlto: 150 });
    const desglose = await etiquetar(page, 'Desglose por estado', 'desglose', { minAlto: 150 });
    await anotar(page, [
      { n: 1, blanco: page.getByRole('button', { name: 'Semana', exact: true }).locator('..'), pad: 4 },
      { n: 2, blanco: page.getByLabel('Período anterior').locator('..'), pad: 4 },
      { n: 3, blanco: enOficina },
      { n: 4, blanco: desglose },
    ]);
    await foto(page, '16-tiempos', { x: 160, y: 70, width: 1060, height: 600 });
    await browser.close();
  },

  async '17-organigrama'() {
    const { browser, page } = await abrir();
    await page.getByTestId('vista-organigrama').click();
    await page.waitForTimeout(1500);
    const marta = await etiquetar(page, 'Marta Quesada', 'fila-marta', { minAlto: 40, maxAncho: 1100 });
    const deptos = await etiquetar(page, 'Departamentos', 'deptos', { minAlto: 200, maxAncho: 300 });
    const estados = await etiquetar(page, 'Estados', 'estados', { minAlto: 100, maxAncho: 300 });
    await anotar(page, [
      { n: 1, blanco: page.getByPlaceholder('Buscar persona o área') },
      { n: 2, blanco: marta, pad: 4 },
      { n: 3, blanco: deptos, pad: 4 },
      { n: 4, blanco: estados, pad: 4 },
    ]);
    await foto(page, '17-organigrama', { x: 0, y: 55, width: 1360, height: 805 });
    await browser.close();
  },

  async '18-menu-personal'() {
    const { browser, page } = await abrir();
    await page.getByTestId('menu-personal').click();
    await page.waitForTimeout(300);
    const menu = page.getByRole('menu');
    await anotar(page, [
      { n: 1, blanco: page.getByTestId('personal-avatar'), pad: 0 },
      { n: 2, blanco: page.getByTestId('personal-ausencias'), pad: 0 },
      { n: 3, blanco: page.getByTestId('personal-escritorio'), pad: 0 },
    ]);
    await foto(page, '18-menu-personal', await recorte(page, menu, 40, { alto: 20 }));
    await browser.close();
  },

  async '19-salir'() {
    const { browser, page } = await abrir();
    await page.getByRole('button', { name: 'Salir' }).click();
    await page.waitForTimeout(800);
    const m = modal(page);
    await anotar(page, [
      { n: 1, blanco: m.getByText(/Hoy llevás/) },
      { n: 2, blanco: m.locator('textarea') },
      { n: 3, blanco: m.locator('input[type="time"]') },
      { n: 4, blanco: m.getByRole('button', { name: /Enviar informe/ }) },
      { n: 5, blanco: m.getByRole('button', { name: /Salir sin informe/ }) },
    ]);
    await foto(page, '19-salir', await recorte(page, m));
    await browser.close();
  },

  async '20-planta'() {
    const { browser, page } = await abrir();

    await anotar(page, [{ n: 1, blanco: page.getByRole('button', { name: /Regar/ }), texto: 'Si tiene sed, regala', lado: 'derecha' }]);
    const t = await page.getByText('Tiene sed').first().boundingBox();
    const r = await page.getByRole('button', { name: /Regar/ }).boundingBox();
    const x = t.x - 90, y = Math.min(t.y, r.y) - 35;
    await foto(page, '20-planta', { x, y, width: r.x + r.width + 230 - x, height: 120 });
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
