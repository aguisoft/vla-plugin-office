// Pasa las guías publicadas al plugin: documento completo, índice fijo (el CSP
// de producción no deja correr scripts en línea) y las capturas al lado.
const fs = require('fs');
const path = require('path');
const OFFICE = path.join(__dirname, '..', '..');
const destino = path.join(OFFICE, 'frontend/public/ayuda');
fs.mkdirSync(path.join(destino, 'capturas'), { recursive: true });

// Fuente → página del plugin. `artifact` es el enlace público de esa guía: las
// otras guías lo usan y dentro del plugin se cambia por la página de al lado.
const GUIAS = [
  { fuente: 'guia-colaboradores.html', pagina: 'colaboradores.html', artifact: 'https://claude.ai/artifact/Uy5fqgTt7gMCCDBpdiG5PT' },
  { fuente: 'guia-jefes.html', pagina: 'jefes.html', artifact: 'https://claude.ai/artifact/9WvA2uksnW3sKKbppxqdCJ' },
  { fuente: 'guia-rrhh.html', pagina: 'rrhh.html', artifact: 'https://claude.ai/artifact/XRMgDDMvtV5ox6h4iNa8gq' },
];

function aPlugin(fuente) {
  let h = fs.readFileSync(path.join(__dirname, fuente), 'utf8');

  // Índice fijo, armado de los capítulos.
  const caps = [...h.matchAll(/<section class="capitulo[^"]*" id="([^"]+)" data-titulo="([^"]+)"/g)].map(m => ({ id: m[1], titulo: m[2] }));
  const items = (conNumero) => caps.map((c, i) => `<li><a href="#${c.id}">${conNumero ? `${i + 1}. ` : ''}${c.titulo}</a></li>`).join('\n        ');
  h = h.replace('<ol id="indice-lista"></ol>', `<ol id="indice-lista">\n        ${items(false)}\n      </ol>`);
  h = h.replace('<ol class="indice" id="indice-movil-lista" style="list-style:none;padding:0;margin:10px 0 0"></ol>',
    `<ol class="indice" id="indice-movil-lista" style="list-style:none;padding:0;margin:10px 0 0">\n        ${items(true)}\n      </ol>`);
  // Sin el script.
  h = h.replace(/\n<script>[\s\S]*?<\/script>\s*$/, '\n');
  if (h.includes('<script')) throw new Error(`${fuente}: quedó un script`);
  // Los enlaces entre guías apuntan a la página de al lado.
  for (const g of GUIAS) if (g.artifact) h = h.split(`href="${g.artifact}"`).join(`href="${g.pagina}"`);
  if (h.includes('claude.ai/artifact')) throw new Error(`${fuente}: quedó un enlace a un artifact`);

  // Documento completo (el artifact agregaba el esqueleto solo).
  const titulo = h.match(/<title>[^<]*<\/title>/)[0];
  h = h.replace(titulo + '\n', '');
  const estiloIni = h.indexOf('<link rel="preconnect"');
  const estiloFin = h.indexOf('</style>') + '</style>'.length;
  const cabeza = h.slice(estiloIni, estiloFin);
  const cuerpo = h.slice(estiloFin).trim();
  return { caps: caps.length, doc: `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${titulo}
${cabeza.replace('<style>', '<style>\nimg { max-width: 100%; }\n[hidden] { display: none !important; }')}
</head>
<body>
${cuerpo}
</body>
</html>
` };
}

for (const g of GUIAS) {
  const { caps, doc } = aPlugin(g.fuente);
  fs.writeFileSync(path.join(destino, g.pagina), doc);
  console.log(`${g.pagina}: ${caps} capítulos`);
}
console.log('capturas:', fs.readdirSync(path.join(destino, 'capturas')).length);
