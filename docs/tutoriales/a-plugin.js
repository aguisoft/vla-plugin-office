// Pasa la guía publicada al plugin: documento completo, índice fijo (el CSP de
// producción no deja correr scripts en línea) y las capturas al lado.
const fs = require('fs');
const path = require('path');
const OFFICE = path.join(__dirname, '..', '..');
const destino = path.join(OFFICE, 'frontend/public/ayuda');
fs.mkdirSync(path.join(destino, 'capturas'), { recursive: true });

let h = fs.readFileSync(path.join(__dirname, 'guia-colaboradores.html'), 'utf8');

// Índice fijo, armado de los capítulos.
const caps = [...h.matchAll(/<section class="capitulo[^"]*" id="([^"]+)" data-titulo="([^"]+)"/g)].map(m => ({ id: m[1], titulo: m[2] }));
const items = (conNumero) => caps.map((c, i) => `<li><a href="#${c.id}">${conNumero ? `${i + 1}. ` : ''}${c.titulo}</a></li>`).join('\n        ');
h = h.replace('<ol id="indice-lista"></ol>', `<ol id="indice-lista">\n        ${items(false)}\n      </ol>`);
h = h.replace('<ol class="indice" id="indice-movil-lista" style="list-style:none;padding:0;margin:10px 0 0"></ol>',
  `<ol class="indice" id="indice-movil-lista" style="list-style:none;padding:0;margin:10px 0 0">\n        ${items(true)}\n      </ol>`);
// Sin el script.
h = h.replace(/\n<script>[\s\S]*?<\/script>\s*$/, '\n');
if (h.includes('<script')) throw new Error('quedó un script');

// Documento completo (el artifact agregaba el esqueleto solo).
const titulo = h.match(/<title>[^<]*<\/title>/)[0];
h = h.replace(titulo + '\n', '');
const estiloIni = h.indexOf('<link rel="preconnect"');
const estiloFin = h.indexOf('</style>') + '</style>'.length;
const cabeza = h.slice(estiloIni, estiloFin);
const cuerpo = h.slice(estiloFin).trim();
const doc = `<!doctype html>
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
`;
fs.writeFileSync(path.join(destino, 'colaboradores.html'), doc);
console.log('capítulos:', caps.length, '| capturas:', fs.readdirSync(path.join(destino, 'capturas')).length);
