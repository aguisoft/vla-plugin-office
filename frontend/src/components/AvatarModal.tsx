import { useState } from 'react';
import { AvatarSVG } from './AvatarSVG';
import type { AvatarCfg } from '../types';

const SKIN_COLORS  = ['#FDDBB4','#F5CBA7','#F1C27D','#D4A574','#C68642','#8D5524'];
const HAIR_COLORS  = ['#1A1A1A','#2C2C2C','#4A3728','#8B4513','#C4A35A','#D2691E'];
const SHIRT_COLORS = ['#3498DB','#E91E63','#2ECC71','#9B59B6','#E74C3C','#F39C12','#1ABC9C','#34495E','#FF7043','#00BCD4'];
const HAIR_STYLES  = ['short','long','curly','bald','ponytail','mohawk','afro','buzz'] as const;
const ACCESSORIES  = ['none','glasses','headphones','hat','earbuds'] as const;
const EMOJIS       = ['','😊','💪','🚀','⚡','🎯','💡','📚','🎨','☕','🏆','🌟','❤️','🎧','👑'];

export function AvatarModal({ current, onSave, onClose }: {
  current: AvatarCfg | null;
  onSave: (cfg: Partial<AvatarCfg>) => Promise<void>;
  onClose: () => void;
}) {
  const [cfg, setCfg] = useState<AvatarCfg>({
    skinColor:  current?.skinColor  ?? '#F5CBA7',
    hairStyle:  current?.hairStyle  ?? 'short',
    hairColor:  current?.hairColor  ?? '#2C2C2C',
    shirtColor: current?.shirtColor ?? '#3498DB',
    accessory:  current?.accessory  ?? 'none',
    emoji:      current?.emoji      ?? '',
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try { await onSave(cfg); onClose(); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl p-6 w-80 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-bold text-gray-800">Personalizar avatar</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Preview */}
        <div className="flex justify-center mb-5 bg-gray-50 rounded-2xl py-4">
          <AvatarSVG cfg={cfg} size={72} status="AVAILABLE" />
        </div>

        {/* Skin */}
        <Section label="Tono de piel">
          <div className="flex gap-2 flex-wrap">
            {SKIN_COLORS.map(c => (
              <Swatch key={c} color={c} selected={cfg.skinColor === c}
                onClick={() => setCfg(p => ({ ...p, skinColor: c }))} />
            ))}
          </div>
        </Section>

        {/* Hair style */}
        <Section label="Cabello">
          <div className="flex flex-wrap gap-1.5">
            {HAIR_STYLES.map(s => (
              <Chip key={s} label={s} selected={cfg.hairStyle === s}
                onClick={() => setCfg(p => ({ ...p, hairStyle: s }))} />
            ))}
          </div>
        </Section>

        {/* Hair color */}
        <Section label="Color de cabello">
          <div className="flex gap-2 flex-wrap">
            {HAIR_COLORS.map(c => (
              <Swatch key={c} color={c} selected={cfg.hairColor === c}
                onClick={() => setCfg(p => ({ ...p, hairColor: c }))} />
            ))}
          </div>
        </Section>

        {/* Shirt */}
        <Section label="Color de camisa">
          <div className="flex gap-2 flex-wrap">
            {SHIRT_COLORS.map(c => (
              <Swatch key={c} color={c} selected={cfg.shirtColor === c}
                onClick={() => setCfg(p => ({ ...p, shirtColor: c }))} />
            ))}
          </div>
        </Section>

        {/* Accessory */}
        <Section label="Accesorio">
          <div className="flex flex-wrap gap-1.5">
            {ACCESSORIES.map(a => (
              <Chip key={a} label={a === 'none' ? 'Ninguno' : a} selected={cfg.accessory === a}
                onClick={() => setCfg(p => ({ ...p, accessory: a }))} />
            ))}
          </div>
        </Section>

        {/* Emoji */}
        <Section label="Emoji">
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((e, i) => (
              <button key={i} onClick={() => setCfg(p => ({ ...p, emoji: e }))}
                className={`w-8 h-8 rounded-lg text-base flex items-center justify-center transition-colors ${cfg.emoji === e ? 'bg-gray-800 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>
                {e || '✕'}
              </button>
            ))}
          </div>
        </Section>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2.5 rounded-xl bg-green-500 hover:bg-green-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Guardar cambios
        </button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">{label}</p>
      {children}
    </div>
  );
}

function Swatch({ color, selected, onClick }: { color: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${selected ? 'border-gray-800 scale-110' : 'border-transparent'}`}
      style={{ backgroundColor: color }}
    />
  );
}

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors capitalize ${selected ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
    >
      {label}
    </button>
  );
}
