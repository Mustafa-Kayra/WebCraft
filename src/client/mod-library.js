import { validatePacks, parsePack } from '../shared/mods.js';

const KEY = 'webcraft:mods';
export function createModLibrary(backend = globalThis.localStorage) {
  let entries = [];
  let error = '';
  try {
    const stored = JSON.parse(backend.getItem(KEY) || '[]');
    if (!Array.isArray(stored) || stored.some(entry => typeof entry.enabled !== 'boolean')) throw new Error('Geçersiz mod kitaplığı.');
    const packs = validatePacks(stored.map(entry => entry.pack));
    entries = packs.map((pack, index) => ({ pack, enabled: stored[index].enabled }));
  } catch { error = 'Kayıtlı mod kitaplığı okunamadı. Yeni bir paket içe aktarabilirsiniz; dünya kayıtlarındaki modlar korunur.'; }
  function save(next) {
    validatePacks(next.map(entry => entry.pack));
    backend.setItem(KEY, JSON.stringify(next));
    entries = next;
  }
  return {
    error,
    list: () => entries,
    active: () => entries.filter(entry => entry.enabled).map(entry => entry.pack),
    import(text) {
      const pack = parsePack(text);
      if (entries.some(entry => entry.pack.id === pack.id)) throw new Error('Bu paket kimliği zaten yüklü. Önce eski paketi kaldırın.');
      save([...entries, { pack, enabled: false }]);
    },
    toggle(id) { save(entries.map(entry => entry.pack.id === id ? { ...entry, enabled: !entry.enabled } : entry)); },
    remove(id) { save(entries.filter(entry => entry.pack.id !== id)); },
  };
}
