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

fs.mkdirSync(path.join(targetDir, 'dist'), { recursive: true });
for (const file of fs.readdirSync(distSrc)) {
  fs.copyFileSync(path.join(distSrc, file), path.join(targetDir, 'dist', file));
}

console.log(`\n✓ Plugin "${manifest.name}" instalado en:`);
console.log(`  ${targetDir}\n`);
console.log('  Reinicia el servidor del core para cargar el plugin:');
console.log('  cd ../vla-system && npm run dev -w @vla/api\n');
