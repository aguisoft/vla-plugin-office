import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DEFAULT_TZ } from './local-date';

/**
 * El manifiesto es el contrato: `settings.sections` dibuja el formulario del
 * panel admin y sus valores llegan como `ctx.plugin.config`. Nada en el
 * compilador ata ese JSON al código que lo lee, así que estas pruebas son el
 * único lugar donde las dos mitades se comparan.
 *
 * Existen por dos desvíos concretos que pueden pasar sin que nada falle:
 *
 *  - Que el manifiesto declare un `default` distinto del respaldo en duro del
 *    código. Entonces el plugin se comporta de una forma cuando el valor está
 *    sin configurar y de otra apenas alguien abre el panel y guarda, sin haber
 *    cambiado nada a propósito.
 *  - Que la lista de países del desplegable se separe de `countries.ts`. El
 *    manifiesto es JSON y no puede importar del catálogo; la copia se hace a
 *    mano y se desvía sola.
 */

const RAIZ = path.resolve(__dirname, '..', '..');
const manifiesto = JSON.parse(fs.readFileSync(path.join(RAIZ, 'plugin.json'), 'utf8'));
const campos: any[] = (manifiesto.settings?.sections ?? []).flatMap((s: any) => s.fields ?? []);
const campo = (key: string) => campos.find(f => f.key === key);

/** Los ISO del catálogo del frontend, leídos del fuente para no importar TSX. */
function isosDelCatalogo(): string[] {
  const src = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'countries.ts'), 'utf8');
  return [...src.matchAll(/\{\s*iso:\s*'([A-Z]{2})'/g)].map(m => m[1]);
}

describe('el manifiesto declara lo que el código lee', () => {
  // Si alguien agrega un `ctx.plugin.config.LO_QUE_SEA` y no lo declara acá,
  // el valor queda invisible: nadie puede configurarlo sin editar la base.
  const LEIDOS_POR_EL_CODIGO = [
    'TIMEZONE', 'DEFAULT_COUNTRY', 'WORKDAY_HOURS', 'MAX_OPEN_SESSION_HOURS', 'bitrixWebhookSecret',
  ];

  it.each(LEIDOS_POR_EL_CODIGO)('declara %s', clave => {
    expect(campo(clave), `${clave} lo lee el código pero no está en settings.sections`).toBeDefined();
  });

  it('no declara campos que nadie lee', () => {
    const sobrantes = campos.map(f => f.key).filter(k => !LEIDOS_POR_EL_CODIGO.includes(k));
    expect(sobrantes, 'un campo en el panel que no hace nada invita a llenarlo esperando un efecto').toEqual([]);
  });
});

describe('los defaults del panel coinciden con los respaldos del código', () => {
  it('TIMEZONE cae en la misma zona que DEFAULT_TZ', () => {
    expect(campo('TIMEZONE').default).toBe(DEFAULT_TZ);
  });

  it('DEFAULT_COUNTRY coincide con el respaldo en duro', () => {
    // index.ts: (ctx.plugin.config.DEFAULT_COUNTRY as string) || 'CR'
    expect(campo('DEFAULT_COUNTRY').default).toBe('CR');
  });

  it('WORKDAY_HOURS coincide con horasConfig', () => {
    expect(campo('WORKDAY_HOURS').default).toBe(8);
  });

  it('MAX_OPEN_SESSION_HOURS coincide con horasConfig', () => {
    expect(campo('MAX_OPEN_SESSION_HOURS').default).toBe(12);
  });

  it('los dos campos de horas acotan al mismo rango que valida el código', () => {
    // horasConfig acepta `crudo >= 1 && crudo <= 24`.
    for (const clave of ['WORKDAY_HOURS', 'MAX_OPEN_SESSION_HOURS']) {
      expect(campo(clave).min, `${clave}.min`).toBe(1);
      expect(campo(clave).max, `${clave}.max`).toBe(24);
    }
  });
});

describe('el desplegable de países no se separa del catálogo', () => {
  it('ofrece exactamente los mismos ISO que countries.ts', () => {
    const delManifiesto = campo('DEFAULT_COUNTRY').options.map((o: any) => o.value);
    expect(delManifiesto.sort()).toEqual(isosDelCatalogo().sort());
  });

  it('el default está entre las opciones ofrecidas', () => {
    const valores = campo('DEFAULT_COUNTRY').options.map((o: any) => o.value);
    expect(valores).toContain(campo('DEFAULT_COUNTRY').default);
  });

  it('cada opción tiene etiqueta legible, no solo el ISO', () => {
    for (const o of campo('DEFAULT_COUNTRY').options) {
      expect(o.label.length, `la opción ${o.value} no tiene nombre`).toBeGreaterThan(3);
    }
  });
});

describe('zona horaria', () => {
  it('el default está entre las opciones', () => {
    const valores = campo('TIMEZONE').options.map((o: any) => o.value);
    expect(valores).toContain(campo('TIMEZONE').default);
  });

  it('toda opción es una zona IANA que el motor de fechas reconoce', () => {
    // Una zona inventada no falla al guardarla: falla después, dentro de
    // Intl.DateTimeFormat, en cada cálculo de día local.
    for (const o of campo('TIMEZONE').options) {
      expect(
        () => new Intl.DateTimeFormat('es', { timeZone: o.value }).format(new Date()),
        `zona inválida: ${o.value}`,
      ).not.toThrow();
    }
  });
});

describe('forma del esquema', () => {
  it('todo campo tiene key, type y label', () => {
    for (const f of campos) {
      expect(f.key, 'campo sin key').toBeTruthy();
      expect(f.type, `${f.key} sin type`).toBeTruthy();
      expect(f.label, `${f.key} sin label`).toBeTruthy();
    }
  });

  it('el secreto va como `secret` y no como texto plano', () => {
    expect(campo('bitrixWebhookSecret').type).toBe('secret');
  });

  it('toda sección tiene título', () => {
    for (const s of manifiesto.settings.sections) expect(s.title).toBeTruthy();
  });
});
