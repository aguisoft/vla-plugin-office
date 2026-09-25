import { describe, it, expect } from 'vitest';
import { resolveCountry, resolveManager, resolveDepartment } from './country-source';

describe('resolveCountry — precedencia', () => {
  it('el override gana sobre Bitrix y sobre el default', () => {
    expect(resolveCountry('AR', 'CR', 'NI')).toEqual({ country: 'AR', source: 'override' });
  });

  it('sin override, gana Bitrix', () => {
    expect(resolveCountry(null, 'CR', 'NI')).toEqual({ country: 'CR', source: 'bitrix' });
  });

  it('sin override ni Bitrix, cae al default y lo dice', () => {
    expect(resolveCountry(null, null, 'CR')).toEqual({ country: 'CR', source: 'default' });
  });

  it('el estado de hoy en produccion: todos null -> default', () => {
    // 35 mapeos con country = null. El origen tiene que decir 'default' para
    // que la pantalla no muestre un CR inventado como si fuera verificado.
    expect(resolveCountry(undefined, null, 'CR').source).toBe('default');
  });
});

describe('resolveCountry — cadenas vacias', () => {
  it('trata "" de Bitrix como ausencia y cae al default', () => {
    expect(resolveCountry(null, '', 'CR')).toEqual({ country: 'CR', source: 'default' });
  });

  it('trata "" de override como ausencia y cae a Bitrix', () => {
    expect(resolveCountry('', 'AR', 'CR')).toEqual({ country: 'AR', source: 'bitrix' });
  });

  it('ignora espacios en blanco', () => {
    expect(resolveCountry('   ', '  ', 'CR')).toEqual({ country: 'CR', source: 'default' });
  });
});

describe('resolveCountry — normalizacion', () => {
  it('devuelve el ISO en mayusculas venga como venga', () => {
    expect(resolveCountry('ar', null, 'CR').country).toBe('AR');
    expect(resolveCountry(null, 'cr', 'NI').country).toBe('CR');
    expect(resolveCountry(null, null, 'ni').country).toBe('NI');
  });

  it('recorta espacios alrededor del valor', () => {
    expect(resolveCountry(' AR ', null, 'CR').country).toBe('AR');
  });
});

describe('resolveDepartment', () => {
  it('el override de RRHH gana sobre Bitrix', () => {
    expect(resolveDepartment('99', '3')).toEqual({ departmentId: '99', source: 'override' });
  });

  it('sin override, gana Bitrix', () => {
    expect(resolveDepartment(null, '3')).toEqual({ departmentId: '3', source: 'bitrix' });
  });

  it('sin ninguno de los dos, queda fuera de la jerarquia y lo dice', () => {
    // El caso de las 14 personas de produccion que hoy nadie ve en el dashboard.
    expect(resolveDepartment(null, null)).toEqual({ departmentId: null, source: 'none' });
  });

  it('el override permite ASIGNAR departamento a quien Bitrix no le da ninguno', () => {
    expect(resolveDepartment('5', null)).toEqual({ departmentId: '5', source: 'override' });
  });

  it('trata "" y espacios como ausencia en las dos fuentes', () => {
    expect(resolveDepartment('', '3')).toEqual({ departmentId: '3', source: 'bitrix' });
    expect(resolveDepartment('  ', '  ')).toEqual({ departmentId: null, source: 'none' });
  });

  it('no normaliza a mayusculas: el id de Bitrix es opaco, no un ISO', () => {
    expect(resolveDepartment(null, 'a1').departmentId).toBe('a1');
  });
});

describe('resolveDepartment + resolveManager juntos', () => {
  const heads = new Map([['3', 'jefe-dev'], ['5', 'jefe-ventas']]);

  it('corregir el departamento mueve a la persona bajo el jefe nuevo', () => {
    // Bitrix la pone en el 3, RRHH la corrige al 5: su jefe pasa a ser el del 5.
    // Si el override solo cambiara lo que se muestra, esto seguiria dando jefe-dev
    // y el override no serviria para nada.
    const { departmentId } = resolveDepartment('5', '3');
    expect(resolveManager('u1', null, departmentId, heads)).toEqual({
      managerUserId: 'jefe-ventas',
      source: 'bitrix',
    });
  });

  it('asignar departamento a alguien suelto le da jefe por primera vez', () => {
    const { departmentId } = resolveDepartment('3', null);
    expect(resolveManager('u1', null, departmentId, heads).managerUserId).toBe('jefe-dev');
  });

  it('el override de jefe sigue ganandole al departamento corregido', () => {
    const { departmentId } = resolveDepartment('5', '3');
    expect(resolveManager('u1', 'jefe-a-mano', departmentId, heads)).toEqual({
      managerUserId: 'jefe-a-mano',
      source: 'override',
    });
  });

  it('nadie se vuelve su propio jefe al caer en el departamento que dirige', () => {
    const { departmentId } = resolveDepartment('3', null);
    expect(resolveManager('jefe-dev', null, departmentId, heads)).toEqual({
      managerUserId: null,
      source: 'none',
    });
  });
});

describe('resolveManager', () => {
  const heads = new Map([['21', 'jefe-a'], ['22', 'jefe-b']]);

  it('el override gana sobre el jefe del departamento', () => {
    expect(resolveManager('u1', 'otro-jefe', '21', heads)).toEqual({
      managerUserId: 'otro-jefe',
      source: 'override',
    });
  });

  it('sin override, toma el jefe del departamento', () => {
    expect(resolveManager('u1', null, '21', heads)).toEqual({
      managerUserId: 'jefe-a',
      source: 'bitrix',
    });
  });

  it('sin departamento devuelve null sin jefe', () => {
    expect(resolveManager('u1', null, null, heads)).toEqual({
      managerUserId: null,
      source: 'none',
    });
  });

  it('departamento sin jefe registrado devuelve null', () => {
    expect(resolveManager('u1', null, '99', heads)).toEqual({
      managerUserId: null,
      source: 'none',
    });
  });

  it('nadie es su propio jefe por la via del departamento', () => {
    expect(resolveManager('jefe-a', null, '21', heads)).toEqual({
      managerUserId: null,
      source: 'none',
    });
  });

  it('nadie es su propio jefe por la via del override', () => {
    expect(resolveManager('u1', 'u1', '21', heads)).toEqual({
      managerUserId: 'jefe-a',
      source: 'bitrix',
    });
  });
});
