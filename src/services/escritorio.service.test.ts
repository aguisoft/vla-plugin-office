import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PluginContext } from '@vla/plugin-sdk';
import { EscritorioService } from './escritorio.service';

const ctx = { logger: { log: vi.fn(), warn: vi.fn() } } as unknown as PluginContext;
let dir: string;

function publicar(version: string, conInstalador = true) {
  const archivo = `VLA-Oficina-Setup-${version}.exe`;
  if (conInstalador) fs.writeFileSync(path.join(dir, archivo), 'exe');
  const manifiesto = JSON.stringify({ version, archivo, sha512: 'x', tamano: 3, fecha: 'f' });
  fs.writeFileSync(path.join(dir, 'publicacion.json'), JSON.stringify({ manifiesto, firma: 'f' }));
}

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esc-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('EscritorioService', () => {
  it('sin publicación, leer da null', () => {
    expect(new EscritorioService(ctx, dir).leer()).toBeNull();
  });

  it('lee la publicación y encuentra su instalador', () => {
    publicar('0.2.0');
    const svc = new EscritorioService(ctx, dir);
    const p = svc.leer()!;
    expect(p.meta.version).toBe('0.2.0');
    expect(svc.rutaInstalador(p)).toBe(path.join(dir, 'VLA-Oficina-Setup-0.2.0.exe'));
  });

  it('la primera revisión tras arrancar no avisa; una versión nueva sí, una vez', () => {
    publicar('0.2.0');
    const svc = new EscritorioService(ctx, dir);
    const aviso = vi.fn();
    svc.revisar(aviso);
    expect(aviso).not.toHaveBeenCalled();

    publicar('0.2.1');
    svc.revisar(aviso);
    svc.revisar(aviso);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith('0.2.1');
  });

  /** Si el aviso saliera antes de que esté el .exe, 23 apps pedirían un archivo inexistente. */
  it('no avisa mientras el instalador no esté copiado', () => {
    publicar('0.2.0');
    const svc = new EscritorioService(ctx, dir);
    const aviso = vi.fn();
    svc.revisar(aviso);
    publicar('0.2.1', false);
    svc.revisar(aviso);
    expect(aviso).not.toHaveBeenCalled();
    fs.writeFileSync(path.join(dir, 'VLA-Oficina-Setup-0.2.1.exe'), 'exe');
    svc.revisar(aviso);
    expect(aviso).toHaveBeenCalledWith('0.2.1');
  });

  it('la primera publicación de todas avisa', () => {
    const svc = new EscritorioService(ctx, dir);
    const aviso = vi.fn();
    svc.revisar(aviso);
    publicar('0.2.0');
    svc.revisar(aviso);
    expect(aviso).toHaveBeenCalledWith('0.2.0');
  });
});
