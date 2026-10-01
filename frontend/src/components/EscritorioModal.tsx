import { useEffect, useRef, useState } from 'react';
import { Shell } from './modalParts';
import {
  ApiError, conectarBitrixUrl, confirmarDispositivo, desconectarBitrix, getEstadoBitrix, type EstadoBitrix,
} from '../api';
import {
  mensajeDeVinculacion, normalizarCodigo, problemaDelCodigo, textoEstadoBitrix, type ResultadoBitrix,
} from '../lib/escritorio';

/**
 * La puesta en marcha de la app de escritorio, en el orden en que se hace:
 * 1) vincular la app con el código que muestra, 2) conectar el Bitrix propio
 * para los mensajes. El widget abre esta pantalla con el código ya escrito
 * (`?escritorio=CODIGO`) o directo al paso 2 (`?escritorio=bitrix`).
 */
export function EscritorioModal({ onClose, resultado, codigoInicial, autoConectar }: {
  onClose: () => void;
  /** Viene de la vuelta de Bitrix (`?bitrix=listo|error`), si la hubo. */
  resultado: ResultadoBitrix | null;
  /** Código que mandó el widget: se precarga, pero vincular sigue pidiendo un clic. */
  codigoInicial?: string | null;
  /** El widget pidió conectar Bitrix: se va directo a Bitrix si falta. */
  autoConectar?: boolean;
}) {
  const [estado, setEstado] = useState<EstadoBitrix | null>(null);
  const [errorEstado, setErrorEstado] = useState(false);
  const [codigo, setCodigo] = useState(codigoInicial ?? '');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [vinculado, setVinculado] = useState(false);
  const [errorVinculo, setErrorVinculo] = useState<string | null>(null);
  const yaRedirigio = useRef(false);

  const cargarEstado = () => {
    setErrorEstado(false);
    getEstadoBitrix().then(setEstado).catch(() => setErrorEstado(true));
  };
  useEffect(cargarEstado, []);

  function conectar() {
    // La oficina corre en un iframe y Bitrix no se deja enmarcar.
    try {
      (window.top ?? window).location.href = conectarBitrixUrl;
    } catch {
      window.location.href = conectarBitrixUrl;
    }
  }

  // Desde el widget («Conectar mi Bitrix»): si todavía no está, directo a Bitrix.
  useEffect(() => {
    if (autoConectar && estado && !estado.conectado && !yaRedirigio.current) {
      yaRedirigio.current = true;
      conectar();
    }
  }, [autoConectar, estado]);

  async function desconectar() {
    await desconectarBitrix().catch(() => undefined);
    cargarEstado();
  }

  const problema = problemaDelCodigo(codigo);

  async function vincular() {
    setTocado(true);
    if (problema) return;
    setEnviando(true);
    setErrorVinculo(null);
    try {
      await confirmarDispositivo(normalizarCodigo(codigo));
      setVinculado(true);
      setCodigo('');
    } catch (e) {
      setErrorVinculo(e instanceof ApiError ? mensajeDeVinculacion(e.status, e.detail) : mensajeDeVinculacion(0));
    } finally {
      setEnviando(false);
    }
  }

  const bitrixListo = !!estado?.conectado;
  const Paso = ({ n, hecho, titulo }: { n: number; hecho: boolean; titulo: string }) => (
    <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold text-gray-700">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${hecho ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
        {hecho ? '✓' : n}
      </span>
      {titulo}
    </h3>
  );

  return (
    <Shell title="App de escritorio" onClose={onClose}>
      {resultado === 'listo' && bitrixListo && (
        <p className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700">Bitrix conectado. Ya podés ver y mandar tus mensajes desde la app.</p>
      )}
      {resultado === 'error' && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">Bitrix no completó la conexión. Volvé a intentarlo.</p>
      )}

      <section className="mb-4">
        <Paso n={1} hecho={vinculado} titulo="Vincular la app" />
        {vinculado ? (
          <p className="rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700" data-testid="vinculado">
            Listo: la app de escritorio ya entró con tu cuenta.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-gray-500">
              {codigoInicial
                ? 'Revisá que sea el mismo código que muestra la app en tu computadora y tocá Vincular.'
                : 'Abrí la app en tu computadora: te muestra un código de 6 caracteres.'}
            </p>
            <div className="flex gap-2">
              <input
                value={codigo}
                onChange={e => { setCodigo(e.target.value); setErrorVinculo(null); }}
                onKeyDown={e => { if (e.key === 'Enter') void vincular(); }}
                placeholder="K7P-3QX"
                maxLength={9}
                autoComplete="off"
                spellCheck={false}
                aria-label="Código de la app de escritorio"
                className="cifras-tabulares min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-center font-mono text-sm uppercase tracking-[0.3em] focus:border-gray-400 focus:outline-none"
              />
              <button onClick={() => void vincular()} disabled={enviando}
                className="rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50">
                {enviando ? 'Vinculando…' : 'Vincular'}
              </button>
            </div>
            {(errorVinculo || (tocado && problema)) && (
              <p className="mt-2 text-xs text-red-600" role="alert">{errorVinculo ?? problema}</p>
            )}
          </>
        )}
      </section>

      <section>
        <Paso n={2} hecho={bitrixListo} titulo="Conectar tu Bitrix" />
        <p className="mb-2 text-xs text-gray-500" data-testid="estado-bitrix">
          {errorEstado ? 'No se pudo consultar el estado.' : textoEstadoBitrix(estado)}
        </p>
        {estado && !estado.conectado && (
          <button onClick={conectar}
            className={`w-full rounded-xl px-3 py-2 text-xs font-semibold text-white ${vinculado ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-900 hover:bg-gray-700'}`}>
            {vinculado ? 'Siguiente: conectar mi Bitrix' : 'Conectar mi Bitrix'}
          </button>
        )}
        {bitrixListo && (
          <button onClick={desconectar} className="text-[11px] text-gray-500 underline hover:text-gray-700">
            Desconectar
          </button>
        )}
      </section>

      {bitrixListo && vinculado && (
        <p className="mt-4 rounded-xl bg-green-50 px-3 py-2 text-center text-xs font-semibold text-green-700">
          Todo listo. Ya podés cerrar esto: la app muestra tus mensajes sola.
        </p>
      )}
    </Shell>
  );
}
