import feliz from '../assets/planta/feliz.webp';
import sed from '../assets/planta/sed.webp';
import marchita from '../assets/planta/marchita.webp';
import seca from '../assets/planta/seca.webp';

export type EstadoPlanta = 'feliz' | 'sed' | 'marchita' | 'seca';

const IMG: Record<EstadoPlanta, string> = { feliz, sed, marchita, seca };

const ALT: Record<EstadoPlanta, string> = {
  feliz: 'La planta está contenta',
  sed: 'La planta tiene sed',
  marchita: 'La planta se está marchitando',
  seca: 'La planta está seca',
};

/**
 * Proporción de los cuatro archivos. Las cuatro se recortaron con la MISMA
 * caja, así que comparten tamaño y la maceta cae siempre en el mismo punto:
 * por eso la planta no salta al cambiar de estado.
 */
const PROPORCION = 243 / 320;

export function PlantaDibujo({ estado, size = 58, festeja = false, regando = false }: {
  estado: EstadoPlanta;
  /** Alto en píxeles; el ancho sale de la proporción. */
  size?: number;
  /** Brinco corto justo después de regarla. */
  festeja?: boolean;
  /** Gotas cayendo mientras se guarda el riego. */
  regando?: boolean;
}) {
  const ancho = Math.round(size * PROPORCION);

  return (
    <div
      className={`planta-caja ${festeja ? 'planta-festeja' : ''}`}
      style={{ width: ancho, height: size }}
    >
      {regando && (
        <div className="planta-lluvia" aria-hidden="true">
          <span className="planta-gota" />
          <span className="planta-gota" style={{ left: '46%', animationDelay: '0.18s' }} />
          <span className="planta-gota" style={{ left: '70%', animationDelay: '0.36s' }} />
        </div>
      )}
      <img
        src={IMG[estado]}
        alt={ALT[estado]}
        width={ancho}
        height={size}
        draggable={false}
        // La seca no se mece: una planta sin agua no se mueve, y la quietud es
        // parte de lo que avisa que hay que rescatarla.
        className={estado === 'seca' ? 'planta-cuerpo planta-quieta'
                 : estado === 'marchita' ? 'planta-cuerpo planta-lenta'
                 : 'planta-cuerpo'}
      />
    </div>
  );
}
