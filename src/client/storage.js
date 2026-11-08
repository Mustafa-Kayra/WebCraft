import { DEFAULT_HOTBAR, isPlaceable } from '../shared/blocks.js';

const INDEX_KEY = 'webcraft:worlds';
const WORLD_PREFIX = 'webcraft:world:';
const SETTINGS_KEY = 'webcraft:settings';
const PROFILE_KEY = 'webcraft:profile';

export const DEFAULT_SETTINGS = Object.freeze({ renderDistance: 6, fov: 75, sensitivity: 1 });

function readJson(backend, key, fallback) {
  try {
    const raw = backend.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function createStorage(backend = globalThis.localStorage) {
  const listWorlds = () => {
    const worlds = readJson(backend, INDEX_KEY, []);
    return Array.isArray(worlds) ? worlds.sort((a, b) => b.lastPlayed - a.lastPlayed) : [];
  };
  const writeIndex = worlds => backend.setItem(INDEX_KEY, JSON.stringify(worlds));

  return {
    listWorlds,
    createWorld({ name, seed }) {
      const now = Date.now();
      const meta = { id: `w${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, name: name.trim().slice(0, 32) || 'New World', seed, createdAt: now, lastPlayed: now };
      writeIndex([...listWorlds(), meta]);
      return meta;
    },
    loadWorld(id) {
      const meta = listWorlds().find(world => world.id === id);
      if (!meta) return null;
      const data = readJson(backend, WORLD_PREFIX + id, {});
      const edits = Array.isArray(data.edits) && data.edits.length % 4 === 0 && data.edits.every(Number.isInteger) ? data.edits : [];
      const hotbar = Array.isArray(data.hotbar) && data.hotbar.length === 9 && data.hotbar.every(isPlaceable) ? data.hotbar : [...DEFAULT_HOTBAR];
      const player = data.player && ['x', 'y', 'z', 'yaw', 'pitch'].every(key => Number.isFinite(data.player[key])) ? data.player : null;
      return { meta, edits, hotbar, player, slot: Number.isInteger(data.slot) ? Math.max(0, Math.min(8, data.slot)) : 0 };
    },
    saveWorld(id, { edits, hotbar, player, slot }) {
      backend.setItem(WORLD_PREFIX + id, JSON.stringify({ version: 1, edits, hotbar, player, slot }));
      writeIndex(listWorlds().map(world => (world.id === id ? { ...world, lastPlayed: Date.now() } : world)));
    },
    deleteWorld(id) {
      backend.removeItem(WORLD_PREFIX + id);
      writeIndex(listWorlds().filter(world => world.id !== id));
    },
    loadSettings() {
      const stored = readJson(backend, SETTINGS_KEY, {});
      return {
        renderDistance: Number.isInteger(stored.renderDistance) ? Math.max(2, Math.min(12, stored.renderDistance)) : DEFAULT_SETTINGS.renderDistance,
        fov: Number.isFinite(stored.fov) ? Math.max(50, Math.min(110, stored.fov)) : DEFAULT_SETTINGS.fov,
        sensitivity: Number.isFinite(stored.sensitivity) ? Math.max(0.2, Math.min(3, stored.sensitivity)) : DEFAULT_SETTINGS.sensitivity,
      };
    },
    saveSettings(settings) {
      backend.setItem(SETTINGS_KEY, JSON.stringify(settings));
    },
    loadProfile() {
      const profile = readJson(backend, PROFILE_KEY, {});
      return { name: typeof profile.name === 'string' ? profile.name : '', server: typeof profile.server === 'string' ? profile.server : '', room: typeof profile.room === 'string' ? profile.room : '' };
    },
    saveProfile(profile) {
      backend.setItem(PROFILE_KEY, JSON.stringify(profile));
    },
  };
}
