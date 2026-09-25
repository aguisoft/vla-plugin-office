import { describe, it, expect } from 'vitest';
import { normalizeName, matchZone, resolveZone, type ZoneRef } from './zone-match';

/** Las 13 zonas reales del layout activo en produccion. */
const ZONAS: ZoneRef[] = [
  { id: 'gerencia',      name: 'Gerencia General' },
  { id: 'development',   name: 'Development' },
  { id: 'consulting',    name: 'Consulting' },
  { id: 'rrhh',          name: 'Recursos Humanos' },
  { id: 'vfit',          name: 'V-FIT' },
  { id: 'finanzas',      name: 'Finanzas' },
  { id: 'cobros',        name: 'Cobros & Bienestar' },
  { id: 'bufete',        name: 'Bufete Jurídico' },
  { id: 'marketing',     name: 'Marketing' },
  { id: 'academy',       name: 'Academy' },
  { id: 'sales',         name: 'Sales Department' },
  { id: 'call-center',   name: 'Call Center' },
  { id: 'english-sales', name: 'English Sales' },
];

describe('normalizeName', () => {
  it('quita acentos', () => {
    expect(normalizeName('Bufete Jurídico')).toBe(normalizeName('Bufete Juridico'));
  });

  it('quita el sufijo administrativo que solo agrega ruido', () => {
    expect(normalizeName('Marketing department')).toBe(normalizeName('Marketing'));
    expect(normalizeName('Sales Department')).toBe(normalizeName('sales'));
  });

  it('ignora separadores: el slug de la zona normaliza igual que su nombre', () => {
    expect(normalizeName('english-sales')).toBe(normalizeName('English Sales'));
    expect(normalizeName('V-FIT')).toBe(normalizeName('vfit'));
  });

  it('ignora el & y los espacios', () => {
    expect(normalizeName('Cobros & Bienestar')).toBe('cobrosbienestar');
  });

  it('cadena vacia o basura da vacio', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName('   ')).toBe('');
    expect(normalizeName('- & .')).toBe('');
  });
});

describe('matchZone — los 10 departamentos de produccion que SI calzan', () => {
  const calzan: Array<[string, string]> = [
    ['Academy',          'academy'],
    ['Bufete Juridico',  'bufete'],
    ['Call Center',      'call-center'],
    ['Consulting',       'consulting'],
    ['Development',      'development'],
    ['English Sales',    'english-sales'],
    ['Finanzas',         'finanzas'],
    ['Recursos Humanos', 'rrhh'],
    ['Sales Department', 'sales'],
    ['V-FIT',            'vfit'],
  ];

  for (const [dept, zona] of calzan) {
    it(`${dept} -> ${zona}`, () => {
      expect(matchZone(dept, ZONAS)).toBe(zona);
    });
  }

  it('Marketing department calza con la zona Marketing pese al sufijo', () => {
    expect(matchZone('Marketing department', ZONAS)).toBe('marketing');
  });

  it('Cobros calza por el SLUG de la zona, aunque su nombre sea "Cobros & Bienestar"', () => {
    // Comparar tambien contra el id es lo que salva este par: el nombre visible
    // lleva "& Bienestar" y nunca calzaria, pero el slug es exactamente el
    // departamento. Son 11 de 14 los que se resuelven solos, no 10.
    expect(matchZone('Cobros', ZONAS)).toBe('cobros');
  });
});

describe('matchZone — los que NO calzan devuelven null, no una adivinanza', () => {
  it('Grupo VLA no es Gerencia General para el emparejador', () => {
    // Lo es para un humano. El punto es que el codigo no lo invente: sentar a
    // alguien en el escritorio equivocado por una equivalencia adivinada es un
    // error que despues nadie encuentra.
    expect(matchZone('Grupo VLA', ZONAS)).toBeNull();
  });

  it('Bienestar Estudiantil no se estira hasta Cobros & Bienestar', () => {
    expect(matchZone('Bienestar Estudiantil', ZONAS)).toBeNull();
  });

  it('un departamento desconocido da null', () => {
    expect(matchZone('Departamento Inventado', ZONAS)).toBeNull();
  });

  it('null, undefined y vacio dan null sin reventar', () => {
    expect(matchZone(null, ZONAS)).toBeNull();
    expect(matchZone(undefined, ZONAS)).toBeNull();
    expect(matchZone('', ZONAS)).toBeNull();
  });

  it('sin zonas cargadas da null', () => {
    expect(matchZone('Development', [])).toBeNull();
  });

  it('un empate no se resuelve por orden de carga', () => {
    const ambiguas: ZoneRef[] = [
      { id: 'a', name: 'Ventas' },
      { id: 'b', name: 'ventas' },
    ];
    expect(matchZone('Ventas', ambiguas)).toBeNull();
  });
});

describe('resolveZone', () => {
  it('la zona fijada a mano le gana a la sugerencia', () => {
    expect(resolveZone('cobros', 'Development', ZONAS)).toEqual({ zoneId: 'cobros', source: 'fijada' });
  });

  it('sin fijar, sugiere por el nombre del departamento', () => {
    expect(resolveZone(null, 'Development', ZONAS)).toEqual({ zoneId: 'development', source: 'sugerida' });
  });

  it('sin fijar y sin calce, queda sin zona y lo dice', () => {
    expect(resolveZone(null, 'Grupo VLA', ZONAS)).toEqual({ zoneId: null, source: 'none' });
  });

  it('sin departamento tampoco hay sugerencia', () => {
    expect(resolveZone(null, null, ZONAS)).toEqual({ zoneId: null, source: 'none' });
  });

  it('una zona fijada que ya no existe cae a la sugerencia, no al limbo', () => {
    // Pasa si se renombra o se borra una zona del layout: el avatar no se
    // puede dibujar en una zona inexistente.
    expect(resolveZone('zona-borrada', 'Finanzas', ZONAS)).toEqual({
      zoneId: 'finanzas',
      source: 'sugerida',
    });
  });

  it('zona inexistente y departamento sin calce: sin zona', () => {
    expect(resolveZone('zona-borrada', 'Grupo VLA', ZONAS)).toEqual({ zoneId: null, source: 'none' });
  });

  it('cadena vacia se trata como sin fijar', () => {
    expect(resolveZone('  ', 'Academy', ZONAS)).toEqual({ zoneId: 'academy', source: 'sugerida' });
  });
});
