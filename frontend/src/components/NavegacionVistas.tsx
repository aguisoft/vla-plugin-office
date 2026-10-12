/**
 * Las tres pantallas de la oficina como pestañas, al lado del título: dónde
 * estoy y adónde puedo ir. Antes «Tiempos» y «Organigrama» eran botones
 * sueltos entre las acciones, sin marcar cuál estaba abierta, y a la oficina
 * solo se volvía con la ✕ de cada pantalla.
 *
 * Debajo de 1024 px quedan solo los íconos (en el celular la barra de abajo
 * no las tiene, así que acá son la única forma de llegar).
 */
export type Vista = 'oficina' | 'tiempos' | 'organigrama';

const PESTANAS: Array<{ id: Vista; titulo: string; d: string }> = [
  { id: 'oficina', titulo: 'Oficina', d: 'M3 10.5L12 4l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9.5z' },
  { id: 'tiempos', titulo: 'Tiempos', d: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'organigrama', titulo: 'Organigrama', d: 'M12 4v4m0 0H8a2 2 0 00-2 2v2m6-4h4a2 2 0 012 2v2M6 16h2a2 2 0 002-2v-2m8 4h-2a2 2 0 01-2-2v-2M10 2h4v4h-4zM4 16h4v4H4zM16 16h4v4h-4z' },
];

export function NavegacionVistas({ vista, onCambiar }: { vista: Vista; onCambiar: (v: Vista) => void }) {
  return (
    <nav className="flex items-center gap-0.5 rounded-xl bg-gray-100 p-0.5" aria-label="Pantallas de la oficina">
      {PESTANAS.map(p => {
        const activa = p.id === vista;
        return (
          <button key={p.id} onClick={() => onCambiar(p.id)} data-testid={`vista-${p.id}`}
            aria-current={activa ? 'page' : undefined} title={p.titulo}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] transition-colors ${
              activa ? 'bg-white font-semibold text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={p.d} />
            </svg>
            <span className="hidden lg:inline">{p.titulo}</span>
          </button>
        );
      })}
    </nav>
  );
}
