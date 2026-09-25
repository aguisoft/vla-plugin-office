#!/usr/bin/env node
/**
 * Instala el plugin compilado directamente en el core local para desarrollo.
 * Evita el ciclo zip → upload → restart del flujo de producción.
 *
 * Uso:
 *   node scripts/dev-install.js              # busca ../vla-system automáticamente
 *   node scripts/dev-install.js /ruta/core   # ruta explícita al core
 *
 * Después de correr: reiniciar el servidor del core (npm run dev -w @vla/api)
 */

const fs = require('fs');
const path = require('path');

const pluginDir = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf-8'));

// Buscar el core: argumento explícito o ../vla-system
const corePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(pluginDir, '..', 'vla-system');

const pluginsDir = path.join(corePath, 'apps', 'api', 'storage', 'plugins');
const targetDir = path.join(pluginsDir, manifest.name);
const distSrc = path.join(pluginDir, 'dist');

// Validaciones
if (!fs.existsSync(corePath)) {
  console.error(`ERROR: Core no encontrado en ${corePath}`);
  console.error('Pasa la ruta como argumento: node scripts/dev-install.js /ruta/al/core');
  process.exit(1);
}

if (!fs.existsSync(distSrc)) {
  console.error('ERROR: dist/ no encontrado. Ejecuta "npm run build" primero.');
  process.exit(1);
}

// Copiar plugin.json + dist/ al core
if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true });
fs.mkdirSync(targetDir, { recursive: true });

fs.copyFileSync(path.join(pluginDir, 'plugin.json'), path.join(targetDir, 'plugin.json'));

// Copia recursiva: dist/ ya trae subcarpetas (lib/, services/), no solo
// archivos sueltos como cuando el plugin era solo index.ts.
fs.cpSync(distSrc, path.join(targetDir, 'dist'), { recursive: true });

// migrations/: sin esto el core local nunca las veía y había que aplicarlas a
// mano con psql — que es justo lo que enmascaró durante siete tareas que el
// empaquetado tampoco las llevaba. Se cuenta lo copiado para que el hueco se
// note en la salida en vez de quedar en silencio.
const migrationsSrc = path.join(pluginDir, 'migrations');
const sqlFiles = fs.existsSync(migrationsSrc)
  ? fs.readdirSync(migrationsSrc).filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  : [];

if (sqlFiles.length > 0) {
  fs.cpSync(migrationsSrc, path.join(targetDir, 'migrations'), { recursive: true });
  console.log(`\n✓ ${sqlFiles.length} migraciones incluidas (migrations/*.sql)`);
} else {
  console.log('\nℹ  Sin migraciones (migrations/ vacío o inexistente), no se copia el directorio.');
}

console.log(`\n✓ Plugin "${manifest.name}" instalado en:`);
console.log(`  ${targetDir}\n`);
console.log('  Reinicia el servidor del core para cargar el plugin:');
console.log('  cd ../vla-system && npm run dev -w @vla/api\n');
