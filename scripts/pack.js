#!/usr/bin/env node
/**
 * Empaqueta el plugin (backend + frontend) en un archivo .vla.zip.
 *
 * Estructura del zip:
 *   plugin.json          — manifest
 *   dist/                — backend compilado (tsc)
 *   ui/                  — frontend compilado (vite build), opcional
 *
 * Uso:  node scripts/pack.js
 *       npm run release   (compila backend + frontend + empaqueta)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');

// ── 1. Leer manifest ──────────────────────────────────────────────────────────
const manifestPath = path.join(root, 'plugin.json');
if (!fs.existsSync(manifestPath)) {
  console.error('ERROR: plugin.json no encontrado');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

// ── 2. Verificar dist/index.js ─────────────────────────────────────────────────
const entryPoint = path.join(root, 'dist', 'index.js');
if (!fs.existsSync(entryPoint)) {
  console.error('ERROR: dist/index.js no encontrado. Ejecuta "npm run build" primero.');
  process.exit(1);
}

// ── 3. Copiar frontend/dist → ui/ si existe ────────────────────────────────────
const frontendDist = path.join(root, 'frontend', 'dist');
const uiDir        = path.join(root, 'ui');
const hasFrontend  = fs.existsSync(frontendDist);

if (hasFrontend) {
  // Limpiar ui/ anterior y copiar nuevo build
  if (fs.existsSync(uiDir)) fs.rmSync(uiDir, { recursive: true });
  fs.cpSync(frontendDist, uiDir, { recursive: true });
  console.log('✓ Frontend copiado → ui/');
} else {
  console.log('ℹ  Sin frontend (frontend/dist/ no encontrado), se empaqueta solo el backend.');
}

// ── 4. Crear el zip ───────────────────────────────────────────────────────────
const zipName = `${manifest.name}-${manifest.version}.vla.zip`;
const zipPath = path.join(root, zipName);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const filesToZip = hasFrontend ? 'plugin.json dist/ ui/' : 'plugin.json dist/';

try {
  execSync(`cd "${root}" && zip -r "${zipName}" ${filesToZip}`, { stdio: 'pipe' });
} catch {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addLocalFile(manifestPath);
    zip.addLocalFolder(path.join(root, 'dist'), 'dist');
    if (hasFrontend) zip.addLocalFolder(uiDir, 'ui');
    zip.writeZip(zipPath);
  } catch {
    console.error('ERROR: No se pudo crear el zip. Instala "zip" o "adm-zip".');
    process.exit(1);
  }
}

// ── 5. Limpiar ui/ temporal ───────────────────────────────────────────────────
if (hasFrontend && fs.existsSync(uiDir)) {
  fs.rmSync(uiDir, { recursive: true });
}

// ── 6. Resumen ────────────────────────────────────────────────────────────────
const stats = fs.statSync(zipPath);
const kb = (stats.size / 1024).toFixed(1);

console.log('');
console.log(`✓ Plugin empaquetado: ${zipName}  (${kb} KB)${hasFrontend ? '  [backend + frontend]' : '  [solo backend]'}`);
console.log('');
console.log('  Próximos pasos:');
console.log('  1. Abre el panel admin de VLA → Módulos');
console.log('  2. Haz clic en "Seleccionar .vla.zip"');
console.log(`  3. Selecciona  ${zipName}`);
console.log('  4. El servidor reiniciará y cargará el plugin automáticamente');
console.log('');
