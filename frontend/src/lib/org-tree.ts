/**
 * Armado del organigrama a partir de la lista plana que devuelve
 * `GET /org/chart`.
 *
 * El backend manda pares (persona, su jefe) sin jerarquía: acá se construye.
 * Vive como módulo puro y con pruebas porque tres de sus casos no se ven
 * mirando la pantalla y cualquiera de ellos la deja inservible:
 *
 *  - **Huérfanos.** Alguien cuyo jefe no está en la lista, porque lo
 *    desactivaron. No se puede colgar de nadie, y descartarlo lo
 *    desaparecería del organigrama sin decir por qué.
 *  - **Ciclos.** `resolveManager` impide que alguien sea su propio jefe y el
 *    `PUT /org/:userId` valida los ciclos de dos personas, pero NADA valida
 *    A→B→C→A. Con un ciclo, un recorrido recursivo ingenuo cuelga la pestaña.
 *  - **Sin nombre.** El backend manda `null` cuando no lo tiene; ordenar por
 *    nombre tiene que tolerarlo sin mandarlo al azar.
 */

export interface PersonaChart {
  userId: string;
  nombre: string | null;
  managerUserId: string | null;
  departamento: string | null;
  /**
   * Estado resuelto, o `null` si el backend no pudo leerlo. `null` NO es
   * «desconectado»: decir que alguien está desconectado es una afirmación
   * sobre esa persona, y cuando la consulta falla no se sabe.
   */
  estado?: string | null;
  /** ISO de dos letras. De él se deriva la hora local. */
  pais?: string | null;
}

export interface NodoOrg {
  persona: PersonaChart;
  equipo: NodoOrg[];
  /** Cuánta gente cuelga de esta persona, directa e indirectamente. */
  totalAbajo: number;
}

export interface ArbolOrg {
  /** Quienes no dependen de nadie: la cima de la organización. */
  cima: NodoOrg[];
  /** Su jefe no está en la lista de activos. Se muestran aparte, no se pierden. */
  huerfanos: NodoOrg[];
  /**
   * Cada ciclo encontrado, como la lista de personas que lo forman. Si esto
   * no viene vacío hay un dato malo que alguien tiene que corregir, y la
   * pantalla lo dice en vez de colgarse.
   */
  ciclos: PersonaChart[][];
}

/**
 * Nombre para ordenar. Quien no tiene nombre va al final y no intercalado:
 * una fila «no disponible» en medio del alfabeto parece un error de la
 * pantalla, al final se lee como lo que es.
 */
function claveOrden(p: PersonaChart): string {
  return p.nombre ? p.nombre.toLocaleLowerCase('es') : '￿';
}

/**
 * Personas atrapadas en un ciclo de jefaturas, y los ciclos en sí.
 *
 * Recorre la cadena de jefes de cada persona llevando el camino actual. Si
 * vuelve a pisar a alguien del camino, todo lo que va de esa aparición hasta
 * el final es un ciclo. Si cae en alguien ya resuelto en una pasada anterior,
 * corta: ese tramo ya se sabe que no cicla.
 */
function detectarCiclos(
  personas: PersonaChart[], porId: Map<string, PersonaChart>,
): { enCiclo: Set<string>; ciclos: PersonaChart[][] } {
  const enCiclo = new Set<string>();
  const ciclos: PersonaChart[][] = [];
  const resuelto = new Set<string>();

  for (const inicio of personas) {
    if (resuelto.has(inicio.userId)) continue;

    const camino: string[] = [];
    const posicion = new Map<string, number>();
    let actual: PersonaChart | undefined = inicio;

    while (actual && !resuelto.has(actual.userId)) {
      const yaVisto = posicion.get(actual.userId);
      if (yaVisto !== undefined) {
        const miembros = camino.slice(yaVisto).map(id => porId.get(id)!);
        // Un ciclo se descubre una vez por cada persona que entra en él, así
        // que se registra solo la primera vez.
        if (!miembros.some(m => enCiclo.has(m.userId))) ciclos.push(miembros);
        for (const m of miembros) enCiclo.add(m.userId);
        break;
      }
      posicion.set(actual.userId, camino.length);
      camino.push(actual.userId);
      const jefeId: string | null = actual.managerUserId;
      actual = jefeId ? porId.get(jefeId) : undefined;
    }

    // Todo el camino queda resuelto: o terminó en la cima, o en un huérfano,
    // o en un ciclo ya registrado. Ninguno hace falta recorrerlo de nuevo.
    for (const id of camino) resuelto.add(id);
  }

  return { enCiclo, ciclos };
}

export function buildOrgTree(personas: PersonaChart[]): ArbolOrg {
  const porId = new Map(personas.map(p => [p.userId, p]));
  const { enCiclo, ciclos } = detectarCiclos(personas, porId);

  const nodos = new Map<string, NodoOrg>();
  for (const p of personas) {
    if (enCiclo.has(p.userId)) continue;
    nodos.set(p.userId, { persona: p, equipo: [], totalAbajo: 0 });
  }

  const cima: NodoOrg[] = [];
  const huerfanos: NodoOrg[] = [];

  for (const nodo of nodos.values()) {
    const jefeId = nodo.persona.managerUserId;
    if (!jefeId) { cima.push(nodo); continue; }

    const jefe = nodos.get(jefeId);
    if (!jefe) {
      // Dos causas distintas con el mismo remedio: el jefe está inactivo, o
      // el jefe quedó dentro de un ciclo. En ambos casos no hay de dónde
      // colgar a esta persona, y perderla sería peor que mostrarla aparte.
      huerfanos.push(nodo);
      continue;
    }
    jefe.equipo.push(nodo);
  }

  const ordenar = (lista: NodoOrg[]) => {
    lista.sort((a, b) => claveOrden(a.persona).localeCompare(claveOrden(b.persona), 'es'));
    for (const n of lista) ordenar(n.equipo);
  };
  ordenar(cima);
  ordenar(huerfanos);

  // El conteo se hace después de armar el árbol, de abajo hacia arriba. Sin
  // ciclos, esta recursión termina siempre.
  const contar = (n: NodoOrg): number => {
    n.totalAbajo = n.equipo.reduce((suma, h) => suma + 1 + contar(h), 0);
    return n.totalAbajo;
  };
  for (const n of [...cima, ...huerfanos]) contar(n);

  return { cima, huerfanos, ciclos };
}

/**
 * La cadena de mando de una persona, desde la raíz hasta ella.
 *
 * Responde «si necesito autorización, ¿a quién subo?». Devuelve la lista
 * ordenada de arriba hacia abajo, con la propia persona al final.
 *
 * Corta si vuelve a pisar a alguien ya visitado: un ciclo en los datos
 * dejaría este recorrido dando vueltas para siempre, y colgar la pestaña es
 * peor que mostrar una cadena incompleta. Lo mismo si el jefe no está en la
 * lista: la cadena termina donde se corta el dato, sin inventar el resto.
 */
export function cadenaDeMando(personas: PersonaChart[], userId: string): PersonaChart[] {
  const porId = new Map(personas.map(p => [p.userId, p]));
  const cadena: PersonaChart[] = [];
  const visto = new Set<string>();
  let actual = porId.get(userId);
  while (actual && !visto.has(actual.userId)) {
    visto.add(actual.userId);
    cadena.unshift(actual);
    actual = actual.managerUserId ? porId.get(actual.managerUserId) : undefined;
  }
  return cadena;
}

export interface SaludOrg {
  /** Sin jefe Y sin gente a cargo: ni raíz ni rama, flotando. */
  sueltos: PersonaChart[];
  /** Su jefe no está entre los activos: hay que reubicarlos. */
  huerfanos: PersonaChart[];
  /** Ciclos de jefatura. Cada uno es la lista de personas que lo forman. */
  ciclos: PersonaChart[][];
  /** Sin departamento asignado. */
  sinDepartamento: PersonaChart[];
  /** Verdadero cuando no hay nada que corregir. */
  sana: boolean;
}

/**
 * Lo que un organigrama puede decir de sí mismo: qué datos hay que corregir.
 *
 * No incluye a quien no tiene jefe PERO sí tiene gente a cargo: esa es la
 * cima de la organización y es correcta. Josué y Verónica son gerentes
 * generales; marcarlos como problema entrenaría a ignorar este panel, que es
 * justo lo que no debe pasar con un aviso que casi siempre está vacío.
 *
 * Verónica además no tiene gente a cargo, así que caería en `sueltos` por la
 * regla mecánica. Por eso `raicesLegitimas` se recibe de afuera: quién está
 * legítimamente en la cima es un dato que solo sabe una persona, no algo que
 * se pueda deducir de la forma del árbol.
 */
export function saludOrg(
  personas: PersonaChart[],
  arbol: ArbolOrg,
  raicesLegitimas: ReadonlySet<string> = new Set(),
): SaludOrg {
  const enCiclo = new Set(arbol.ciclos.flat().map(p => p.userId));
  const huerfanos = arbol.huerfanos.map(n => n.persona);
  const idsHuerfanos = new Set(huerfanos.map(p => p.userId));

  const sueltos = personas.filter(p =>
    !p.managerUserId &&
    !raicesLegitimas.has(p.userId) &&
    !enCiclo.has(p.userId) &&
    !idsHuerfanos.has(p.userId) &&
    !personas.some(o => o.managerUserId === p.userId));

  const sinDepartamento = personas.filter(p => !p.departamento);

  return {
    sueltos,
    huerfanos,
    ciclos: arbol.ciclos,
    sinDepartamento,
    sana: sueltos.length === 0 && huerfanos.length === 0
      && arbol.ciclos.length === 0 && sinDepartamento.length === 0,
  };
}

/**
 * Hora local de una persona según su país. `null` si no se sabe el país:
 * inventar una zona pondría una hora falsa al lado de un nombre real.
 */
const ZONA: Record<string, string> = {
  CR: 'America/Costa_Rica', NI: 'America/Managua', PA: 'America/Panama',
  GT: 'America/Guatemala', SV: 'America/El_Salvador', HN: 'America/Tegucigalpa',
  BZ: 'America/Belize', MX: 'America/Mexico_City', US: 'America/New_York',
  CO: 'America/Bogota', VE: 'America/Caracas', EC: 'America/Guayaquil',
  PE: 'America/Lima', CL: 'America/Santiago', AR: 'America/Argentina/Buenos_Aires',
  ES: 'Europe/Madrid',
};

export function horaLocalDe(pais: string | null | undefined, ahora: Date = new Date()): string | null {
  if (!pais) return null;
  const zona = ZONA[pais.toUpperCase()];
  if (!zona) return null;
  try {
    return new Intl.DateTimeFormat('es-CR', {
      timeZone: zona, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(ahora);
  } catch {
    // Una zona que este navegador no conozca no debe tumbar la pantalla.
    return null;
  }
}
