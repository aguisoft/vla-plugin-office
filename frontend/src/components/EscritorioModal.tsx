import { useEffect, useState } from 'react';
import { Shell } from './modalParts';
import {
  ApiError, conectarBitrixUrl, confirmarDispositivo, desconectarBitrix, getEstadoBitrix, type EstadoBitrix,
} from '../api';
import {
  mensajeDeVinculacion, normalizarCodigo, problemaDelCodigo, textoEstadoBitrix, type ResultadoBitrix,
} from '../lib/escritorio';

/**
 * Lo que la app de escritorio necesita de esta pantalla, en el orden en que
 * se hace la primera vez: conectar el Bitrix propio (para los mensajes) y
 * vincular la app con el código que muestra.
 */
export function EscritorioModal({ onClose, resultado }: {
  onClose: () => void;
  /** Viene de la vuelta de Bitrix (`?bitrix=listo|error`), si la hubo. */
  resultado: ResultadoBitrix | null;
}) {
  const [estado, setEstado] = useState<EstadoBitrix | null>(null);
  const [errorEstado, setErrorEstado] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [vinculado, setVinculado] = useState(false);
  const [errorVinculo, setErrorVinculo] = useState<string | null>(null);

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

  return (
    <Shell title="App de escritorio" onClose={onClose}>
      {resultado === 'listo' && estado?.conectado && (
        <p className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700">Bitrix conectado. Ya podés usar la mensajería.</p>
      )}
      {resultado === 'error' && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">Bitrix no completó la conexión. Volvé a intentarlo.</p>
      )}

      <section className="mb-4">
        <h3 className="mb-1 text-xs font-semibold text-gray-700">1. Tu Bitrix</h3>
        <p className="mb-2 text-xs text-gray-500" data-testid="estado-bitrix">
          {errorEstado ? 'No se pudo consultar el estado.' : textoEstadoBitrix(estado)}
        </p>
        {estado && !estado.conectado && (
          <button onClick={conectar}
            className="w-full rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-700">
            Conectar mi Bitrix
          </button>
        )}
        {estado?.conectado && (
          <button onClick={desconectar} className="text-[11px] text-gray-500 underline hover:text-gray-700">
            Desconectar
          </button>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold text-gray-700">2. Vincular la app</h3>
        {vinculado ? (
          <p className="rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700" data-testid="vinculado">
            Listo: la app de escritorio ya entró con tu cuenta.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-gray-500">Abrí la app en tu computadora: te muestra un código de 6 caracteres.</p>
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
    </Shell>
  );
}
