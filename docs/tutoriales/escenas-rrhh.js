// Las tomas de la guía para RRHH. Quien mira es Irene Salas, de RRHH, con el
// permiso de administrar la oficina (ver rutasRrhh en estudio.js).
const { abrir, anotar, foto, etiquetar, recorte } = require('./estudio');

const RRHH = { rol: 'rrhh' };

/** Recorte que une varias cajas, con margen. */
async function union(page, locs, margen = 30) {
  const bs = [];
  for (const l of locs) { const b = await l.first().boundingBox(); if (b) bs.push(b); }
  const v = page.viewportSize();
  const x = Math.max(0, Math.min(...bs.map(b => b.x)) - margen), y = Math.max(0, Math.min(...bs.map(b => b.y)) - margen);
  const x2 = Math.min(v.width, Math.max(...bs.map(b => b.x + b.width)) + margen), y2 = Math.min(v.height, Math.max(...bs.map(b => b.y + b.height)) + margen);
  return { x, y, width: x2 - x, height: y2 - y };
}

async function abrirPersonas(alto = 1000) {
  const { browser, page } = await abrir({ ...RRHH, alto });
  await page.getByTestId('menu-administrar').click();
  await page.getByTestId('admin-personas').click();
  const m = page.getByTestId('personas-admin');
  await m.getByText('ana@ejemplo.com').waitFor();
  await page.waitForTimeout(400);
  return { browser, page, m };
}

async function abrirFeriados() {
  const { browser, page } = await abrir({ ...RRHH, alto: 900 });
  await page.getByTestId('menu-administrar').click();
  await page.getByTestId('admin-feriados').click();
  await page.getByText('Navidad').first().waitFor();
  await page.waitForTimeout(400);
  return { browser, page };
}

const ESCENAS = {
  async '29-rrhh-encabezado'() {
    const { browser, page } = await abrir(RRHH);
    await page.getByTestId('menu-administrar').click();
    await page.waitForTimeout(300);
    const menu = page.locator('[role=menu]');
    await anotar(page, [
      { n: 1, blanco: page.getByTestId('boton-solicitudes'), pad: 2 },
      { n: 2, blanco: menu, pad: 3 },
      { n: 3, blanco: page.getByTestId('guia-uso'), pad: 2 },
    ]);
    await foto(page, '29-rrhh-encabezado', await union(page, [page.getByTestId('boton-solicitudes'), menu, page.getByTestId('menu-administrar')], 30));
    await browser.close();
  },

  async '30-rrhh-personas'() {
    const { browser, page, m } = await abrirPersonas();
    await anotar(page, [
      { n: 1, blanco: [m.locator('input[type=search]'), m.getByLabel('Filtrar por estado del dato')], pad: 4 },
      { n: 2, blanco: m.getByText(/^por defecto/).first(), pad: 3 },
      { n: 3, blanco: [m.getByLabel('Jefe de Felipe Mora'), m.getByTestId('aprueba-felipe')], pad: 4 },
      { n: 4, blanco: [m.getByRole('columnheader', { name: 'Sábados' }), m.getByLabel('Sábados de Ana Rojas')], pad: 4 },
      { n: 5, blanco: m.getByText('sugerida por el depto.').first(), pad: 3 },
    ]);
    const caja = await m.boundingBox();
    const fin = await m.getByTestId('aprueba-felipe').boundingBox();
    await foto(page, '30-rrhh-personas', { x: caja.x, y: caja.y, width: caja.width, height: fin.y + fin.height + 24 - caja.y });
    await browser.close();
  },

  async '31-rrhh-sin-jefe'() {
    const { browser, page, m } = await abrirPersonas();
    await m.getByLabel('Filtrar por estado del dato').selectOption('jefe');
    await page.waitForTimeout(400);
    // Renglones de todo el ancho: angostos, para que la marca abrace solo el texto.
    for (const l of [m.getByText(/^2 de 15/), m.getByTestId('aprueba-luis')]) await l.evaluate(el => { el.style.width = 'fit-content'; });
    await anotar(page, [
      { n: 1, blanco: m.getByLabel('Filtrar por estado del dato'), pad: 3 },
      { n: 2, blanco: m.getByText(/^2 de 15/), pad: 10 },
      { n: 3, blanco: m.getByTestId('aprueba-luis'), pad: 10 },
    ]);
    const caja = await m.boundingBox();
    const fin = await m.getByTestId('aprueba-nicolas').boundingBox();
    await foto(page, '31-rrhh-sin-jefe', { x: caja.x, y: caja.y, width: caja.width, height: fin.y + fin.height + 24 - caja.y });
    await browser.close();
  },

  async '32-rrhh-feriados'() {
    const { browser, page } = await abrirFeriados();
    const lista = [page.getByText('12 en 2026'), page.getByText('Navidad').first()];
    await anotar(page, [
      { n: 1, blanco: [page.getByLabel('Año anterior'), page.getByLabel('Año siguiente')], pad: 4 },
      { n: 2, blanco: [page.getByRole('button', { name: /Costa Rica/ }), page.getByRole('button', { name: /Colombia/ })], pad: 3 },
      { n: 3, blanco: [page.getByText(/personas tienen Costa Rica/), page.getByTestId('ver-personas-pais')], pad: 12 },
      { n: 4, blanco: page.locator('p', { hasText: 'solo porque es el país por defecto' }), pad: 6 },
      { n: 5, blanco: lista, pad: 6 },
    ]);
    const modal = await page.locator('div.max-w-5xl').boundingBox();
    const nav = await page.getByText('Navidad').first().boundingBox();
    await foto(page, '32-rrhh-feriados', { x: modal.x, y: modal.y, width: modal.width, height: nav.y + nav.height + 40 - modal.y });
    await browser.close();
  },

  async '33-rrhh-feriado-nuevo'() {
    const { browser, page } = await abrirFeriados();
    // Fin de año: RRHH carga el calendario del año que viene.
    await page.getByLabel('Año siguiente').click();
    await page.getByText(/Sin feriados cargados/).waitFor();
    await page.getByRole('button', { name: /^1 de enero$/i }).first().click();
    await page.getByPlaceholder('Día de la Independencia').fill('Año Nuevo');
    await page.waitForTimeout(300);
    const agregar = page.getByRole('button', { name: /^Agregar en Costa Rica/ });
    await anotar(page, [
      { n: 1, blanco: page.getByText('2027', { exact: true }), pad: 6 },
      { n: 2, blanco: page.getByRole('button', { name: /^1 de enero$/i }).first(), pad: 3 },
      { n: 3, blanco: [page.getByPlaceholder('Día de la Independencia'), agregar], pad: 4 },
    ]);
    const modal = await page.locator('div.max-w-5xl').boundingBox();
    const ag = await agregar.boundingBox();
    await foto(page, '33-rrhh-feriado-nuevo', { x: modal.x, y: modal.y, width: modal.width, height: ag.y + ag.height + 60 - modal.y });
    await browser.close();
  },

  async '34-rrhh-bandeja'() {
    const { browser, page } = await abrir(RRHH);
    await page.getByTestId('boton-solicitudes').click();
    const b = page.getByTestId('bandeja-solicitudes');
    await b.getByText('Nicolás Brenes').waitFor();
    await b.getByText(/Como RRHH ves/).evaluate(el => { el.style.width = 'fit-content'; el.style.margin = '12px 0 0 14px'; });
    await b.evaluate(el => { el.style.maxHeight = 'none'; el.querySelectorAll('.overflow-y-auto').forEach(x => { x.style.overflow = 'visible'; }); });
    await page.setViewportSize({ width: 1360, height: 1200 });
    await page.waitForTimeout(300);
    await anotar(page, [
      { n: 1, blanco: b.getByText(/Como RRHH ves las de todo el equipo/), pad: 6 },
      { n: 2, blanco: b.getByText('Nicolás Brenes', { exact: true }), pad: 6 },
    ]);
    await foto(page, '34-rrhh-bandeja', await recorte(page, b, 40));
    await browser.close();
  },

  async '35-rrhh-mapa'() {
    const { browser, page } = await abrir(RRHH);
    await page.getByText('Karla', { exact: true }).filter({ visible: true }).first().hover();
    await page.waitForTimeout(700);
    const tarjeta = await etiquetar(page, 'karla@ejemplo.com', 'tarjeta-karla', { minAlto: 180, maxAncho: 360 });
    const ventas = await etiquetar(page, 'Sales Department', 'zona-sales', { minAlto: 100, maxAncho: 600 });
    await anotar(page, [
      { n: 1, blanco: tarjeta.getByText('Trámite en el banco'), pad: 3 },
      { n: 2, blanco: [page.getByText('1:15:00').filter({ visible: true }).first(), page.getByText('25:00').filter({ visible: true }).first()], pad: 4 },
    ]);
    await foto(page, '35-rrhh-mapa', await union(page, [tarjeta, ventas], 30));
    await browser.close();
  },

  async '36-rrhh-cumplimiento'() {
    const { browser, page } = await abrir({ ...RRHH, alto: 1350 });
    await page.getByTestId('vista-tiempos').click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Cumplimiento' }).click();
    await page.getByText('Exportar CSV').waitFor();
    // Abiertas, para que se vea a quién señala cada una.
    for (const t of ['Ver a la persona', 'Ver a las personas']) {
      const s = page.locator('summary', { hasText: t });
      for (let i = 0; i < await s.count(); i++) await s.nth(i).click();
    }
    await page.waitForTimeout(300);
    const tarjeta = async (titulo, nombre) => etiquetar(page, titulo, nombre, { minAlto: 90, maxAncho: 700 });
    const sinMarcar = await tarjeta('Sin marcar en 30 días', 'c-sinmarcar');
    const sesiones = await tarjeta('Sesiones abiertas', 'c-sesiones');
    const sinJefe = await tarjeta('Sin jefe directo', 'c-sinjefe');
    const porDepto = await etiquetar(page, 'Por departamento', 'c-depto', { minAlto: 120 });
    await anotar(page, [
      { n: 1, blanco: page.getByRole('button', { name: 'Cumplimiento' }), pad: 3 },
      { n: 2, blanco: page.getByText('Exportar CSV'), pad: 3 },
      { n: 3, blanco: sinMarcar, pad: 3 },
      { n: 4, blanco: sesiones, pad: 3 },
      { n: 5, blanco: sinJefe, pad: 3 },
      { n: 6, blanco: porDepto, pad: 3 },
    ]);
    const panel = await union(page, [page.getByText('Tiempo en oficina por período.'), page.getByRole('button', { name: 'Cumplimiento' }), page.getByText('Exportar CSV'), porDepto], 30);
    await foto(page, '36-rrhh-cumplimiento', panel);
    await browser.close();
  },

  async '37-rrhh-ausencias'() {
    const { browser, page } = await abrir({ ...RRHH, alto: 1000 });
    await page.getByTestId('menu-administrar').click();
    await page.getByTestId('admin-ausencias').click();
    const m = page.getByTestId('ausencias-admin');
    await m.getByLabel('Persona').selectOption('bruno');
    await m.getByTestId('solicitud-sb2').waitFor();
    await m.getByTestId('anular-sb2').click();
    await m.getByLabel('Motivo').fill('Se aprobó por error: esa semana cubre el inventario');
    await page.waitForTimeout(300);
    await anotar(page, [
      { n: 1, blanco: m.getByLabel('Persona'), pad: 4 },
      { n: 2, blanco: m.getByTestId('registrar-ausencia'), pad: 3 },
      { n: 3, blanco: m.getByTestId('anular-sb1'), pad: 4 },
      { n: 4, blanco: [m.getByLabel('Motivo'), m.getByTestId('confirmar-anular-sb2')], pad: 4 },
    ]);
    await foto(page, '37-rrhh-ausencias', await union(page, [m], 0));
    await browser.close();
  },

  async '38-rrhh-registrar'() {
    const { browser, page } = await abrir({ ...RRHH, alto: 1000 });
    await page.getByTestId('menu-administrar').click();
    await page.getByTestId('admin-ausencias').click();
    const m = page.getByTestId('ausencias-admin');
    await m.getByLabel('Persona').selectOption('bruno');
    await m.getByTestId('solicitud-sb1').waitFor();
    await m.getByTestId('registrar-INCAPACIDAD').click();
    const d = page.getByTestId('solicitud-dias');
    await d.getByTestId('dia-2026-11-23').click();
    await d.getByTestId('dia-2026-11-25').click();
    await d.locator('textarea').fill('Reposo por gripe, adjunto la boleta de la CCSS');
    await page.waitForTimeout(500);
    await anotar(page, [
      { n: 1, blanco: d.locator('h2'), pad: 4 },
      { n: 2, blanco: d.getByTestId('ficha-solicitud'), pad: 3 },
      { n: 3, blanco: d.getByTestId('quien-aprueba'), pad: 3 },
    ]);
    await foto(page, '38-rrhh-registrar', await union(page, [d], 0));
    await browser.close();
  },
};

(async () => {
  const pedidas = process.argv.slice(2);
  for (const [nombre, f] of Object.entries(ESCENAS)) {
    if (pedidas.length && !pedidas.some(p => nombre.startsWith(p))) continue;
    try { await f(); } catch (e) { console.log('FALLÓ', nombre, '→', e.message.split('\n')[0]); }
  }
  // Una escena que falla deja su navegador abierto: sin esto el proceso no termina.
  process.exit(0);
})();
