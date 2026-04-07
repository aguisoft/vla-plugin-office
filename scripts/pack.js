#!/usr/bin/env node
/**
 * Empaqueta el plugin compilado en un archivo .vla.zip listo para subir.
 *
 * Uso:  node scripts/pack.js
 *       npm run pack          (después de compilar)
 *       npm run release       (compila + empaqueta en un solo paso)
 *
 * Genera:  <name>-<version>.vla.zip  en la raíz del proyecto.
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

// ── 2. Verificar que dist/index.js existe ─────────────────────────────────────
const entryPoint = path.join(root, 'dist', 'index.js');
if (!fs.existsSync(entryPoint)) {
  console.error('ERROR: dist/index.js no encontrado. Ejecuta "npm run build" primero.');
  process.exit(1);
}

// ── 3. Crear el zip ───────────────────────────────────────────────────────────
const zipName = `${manifest.name}-${manifest.version}.vla.zip`;
const zipPath = path.join(root, zipName);

// Eliminar zip anterior si existe
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

// Usar el módulo nativo 'zip' si está disponible, sino intentar con Node
try {
  execSync(`cd "${root}" && zip -r "${zipName}" plugin.json dist/`, { stdio: 'pipe' });
} catch {
  // Fallback: usar el módulo adm-zip si zip no está disponible (Windows)
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addLocalFile(manifestPath);
    zip.addLocalFolder(path.join(root, 'dist'), 'dist');
    zip.writeZip(zipPath);
  } catch {
    console.error('ERROR: No se pudo crear el zip. Instala "zip" (Linux/Mac) o "adm-zip" (npm install adm-zip).');
    process.exit(1);
  }
}

// ── 4. Resumen ────────────────────────────────────────────────────────────────
const stats = fs.statSync(zipPath);
const kb = (stats.size / 1024).toFixed(1);

console.log('');
console.log(`✓ Plugin empaquetado: ${zipName}  (${kb} KB)`);
console.log('');
console.log('  Próximos pasos:');
console.log('  1. Abre el panel admin de VLA → Módulos');
console.log('  2. Haz clic en "Seleccionar .vla.zip"');
console.log(`  3. Selecciona  ${zipName}`);
console.log('  4. El servidor reiniciará y cargará el plugin automáticamente');
console.log('');
