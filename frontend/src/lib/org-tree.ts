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
