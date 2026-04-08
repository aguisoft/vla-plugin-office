import { useEffect, useState } from 'react';
import { api } from '../api';

interface BitrixConfig {
  configured: boolean;
  webhookUrl: string | null;
}

export function BitrixSettings({ onClose }: { onClose: () => void }) {
  const [config, setConfig]     = useState<BitrixConfig | null>(null);
  const [url, setUrl]           = useState('');
  const [saving, setSaving]     = useState(false);
  const [syncing, setSyncing]   = useState(false);
  const [testing, setTesting]   = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; user?: string; error?: string } | null>(null);
  const [syncResult, setSyncResult] = useState<{ synced: number; skipped: number } | null>(null);

  useEffect(() => {
    api.get<BitrixConfig>('/p/office/bitrix/config').then(d => {
      setConfig(d);
      setUrl(''); // don't pre-fill the secret token
    }).catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setTestResult(null);
    try {
      await api.patch('/p/office/bitrix/config', { bitrixWebhookUrl: url });
      setConfig({ configured: true, webhookUrl: '****' });
      setUrl('');
    } finally { setSaving(false); }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.get<{ ok: boolean; user?: string; error?: string }>('/p/office/bitrix/test');
      setTestResult(r);
    } finally { setTesting(false); }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await api.post<{ ok: boolean; synced: number; skipped: number }>('/p/office/bitrix/sync');
      setSyncResult({ synced: r.synced, skipped: r.skipped });
    } finally { setSyncing(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl p-6 w-96 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <h2 className="text-sm font-bold text-gray-800">Integración Bitrix24</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Status badge */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl mb-5 text-xs font-medium ${config?.configured ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${config?.configured ? 'bg-green-400' : 'bg-amber-400'}`} />
          {config?.configured ? 'Conectado a Bitrix24' : 'No configurado — falta el webhook URL'}
        </div>

        {/* Webhook URL input */}
        <div className="mb-4">
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Webhook URL
          </label>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://grupovla.bitrix24.com/rest/949/xxxxx/"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono"
          />
          <p className="text-[10px] text-gray-400 mt-1">
            Encuéntralo en Bitrix24 → Aplicaciones → Webhooks entrantes
          </p>
        </div>

        <div className="flex gap-2 mb-5">
          <button
            onClick={handleSave}
            disabled={saving || !url}
            className="flex-1 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Guardar
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !config?.configured}
            className="flex-1 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {testing && <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />}
            Probar conexión
          </button>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`px-3 py-2 rounded-xl text-xs mb-4 ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {testResult.ok ? `✓ Conectado como: ${testResult.user}` : `✗ ${testResult.error}`}
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-gray-100 my-4" />

        {/* Sync section */}
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Sincronización de fotos
          </p>
          <p className="text-[11px] text-gray-400 mb-3">
            Descarga las fotos de perfil de Bitrix24 y las muestra como avatares en la oficina virtual.
            Se sincroniza automáticamente cada 6 horas.
          </p>
          <button
            onClick={handleSync}
            disabled={syncing || !config?.configured}
            className="w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {syncing
              ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Sincronizando...</>
              : 'Sincronizar fotos ahora'
            }
          </button>
          {syncResult && (
            <p className={`text-[11px] text-center mt-2 ${syncResult.synced > 0 ? 'text-green-600' : 'text-gray-400'}`}>
              ✓ {syncResult.synced} fotos sincronizadas · {syncResult.skipped} sin foto
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
