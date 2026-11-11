import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/pixelify-sans/700.css';
import './style.css';
import { BLOCK, DEFAULT_HOTBAR } from './shared/blocks.js';
import { seedFromText } from './shared/noise.js';
import { sanitizeName, sanitizeRoom } from './shared/protocol.js';
import { Engine } from './client/engine.js';
import { Game } from './client/game.js';
import { NetClient, resolveServerUrl } from './client/net.js';
import { createStorage } from './client/storage.js';
import { renderBlockIcon } from './client/textures.js';
import { World } from './client/world.js';
import { configurePacks, MAX_PACK_BYTES } from './shared/mods.js';
import { createModLibrary } from './client/mod-library.js';

const $ = selector => document.querySelector(selector);
const SPLASHES = ['Blocks all the way down!', 'Runs in a tab!', 'Hand-painted pixels!', 'Bring a friend!', 'Saves as you build!', 'Now with clouds!', 'Mind the water!', 'Zero downloads!'];
const DEFAULT_SERVER = import.meta.env.VITE_WEBCRAFT_SERVER || '';

const engine = new Engine($('#view'));
const storage = createStorage();
const mods = createModLibrary();
const settings = storage.loadSettings();
const profile = storage.loadProfile();
let game = null;
let panorama = null;
let selectedWorld = null;
let optionsReturn = 'title';
let lastTime = performance.now();
const worldIcon = renderBlockIcon(engine.atlas, BLOCK.GRASS, 52);

function startPanorama() {
  panorama = new World({ seed: 20261108, scene: engine.scene, atlas: engine.atlas, materials: engine.materials, renderDistance: Math.min(settings.renderDistance, 6) });
  panorama.origin = panorama.generator.spawnPoint();
  engine.setFogDistance(Math.min(settings.renderDistance, 6) * 16);
  engine.setFov(70);
}

function stopPanorama() {
  panorama?.dispose();
  panorama = null;
}

function show(screen) {
  document.querySelectorAll('.screen').forEach(element => { element.hidden = element.id !== `screen-${screen}`; });
  if (screen === 'worlds') renderWorldList();
  if (screen === 'mods') renderMods();
  if (screen === 'create') $('#create-mods').textContent = `Yeni dünyaya eklenecek modlar: ${mods.active().map(pack => pack.name).join(', ') || 'Yok'}`;
  if (screen === 'options') syncOptions();
  if (screen === 'multiplayer') {
    $('#mp-status').textContent = '';
    $('#mp-status').classList.remove('ok');
  }
  const focusTarget = $(`#screen-${screen} input, #screen-${screen} .btn:not(:disabled)`);
  focusTarget?.focus({ preventScroll: true });
}

function renderMods() {
  const list = $('#mod-list');
  list.replaceChildren();
  for (const { pack, enabled } of mods.list()) {
    const row = document.createElement('div');
    const label = document.createElement('p');
    label.textContent = `${pack.name} · ${pack.blocks.length} blok · ${enabled ? 'Etkin' : 'Devre dışı'}`;
    row.append(label);
    for (const [text, action] of [[enabled ? 'Devre dışı bırak' : 'Etkinleştir', () => mods.toggle(pack.id)], ['Kaldır', () => mods.remove(pack.id)]]) {
      const button = document.createElement('button');
      button.className = 'btn';
      button.textContent = text;
      button.setAttribute('aria-label', `${pack.name}: ${text}`);
      button.onclick = () => {
        try { action(); renderMods(); $('#mod-status').textContent = 'Mod kitaplığı kaydedildi. Değişiklikler yeni dünyalarda geçerlidir.'; }
        catch (error) { $('#mod-status').textContent = `Kaydedilemedi: ${error.message}`; }
      };
      row.append(button);
    }
    list.append(row);
  }
  if (!mods.list().length) list.textContent = 'Henüz mod yüklenmedi.';
}
$('#mod-status').textContent = mods.error;
$('#mod-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > MAX_PACK_BYTES) throw new Error('Dosya en çok 128 KiB olabilir.');
    mods.import(await file.text());
    renderMods();
    $('#mod-status').textContent = 'Mod içe aktarıldı. Yeni dünyalarda kullanmak için Etkinleştir düğmesine basın.';
  } catch (error) { $('#mod-status').textContent = `İçe aktarılamadı: ${error.message}`; }
  event.target.value = '';
});

function renderWorldList() {
  const worlds = storage.listWorlds();
  if (!worlds.some(world => world.id === selectedWorld)) selectedWorld = worlds[0]?.id ?? null;
  $('#world-list').innerHTML = worlds.length
    ? worlds.map(world => `<button class="world-item ${world.id === selectedWorld ? 'selected' : ''}" role="option" data-world="${world.id}"><img alt="" src="${worldIcon}"><span><b>${escapeHtml(world.name)}</b><small>Last played ${new Date(world.lastPlayed).toLocaleString()} · seed ${world.seed}</small></span></button>`).join('')
    : '<div class="empty">No worlds yet. Create one to start building.</div>';
  $('#play-world').disabled = !selectedWorld;
  $('#delete-world').disabled = !selectedWorld;
}

function syncOptions() {
  $('#opt-render').value = settings.renderDistance;
  $('#opt-fov').value = settings.fov;
  $('#opt-sens').value = settings.sensitivity;
  $('#opt-render-value').textContent = `${settings.renderDistance} chunks`;
  $('#opt-fov-value').textContent = settings.fov;
  $('#opt-sens-value').textContent = `${Math.round(settings.sensitivity * 100)}%`;
}

function applySettings() {
  storage.saveSettings(settings);
  syncOptions();
  if (!game) return;
  game.world.renderDistance = settings.renderDistance;
  game.world.lastCenter = null;
  engine.setFov(settings.fov);
  engine.setFogDistance(settings.renderDistance * 16);
}

function startGame(options) {
  stopPanorama();
  document.body.classList.add('in-menu');
  show('loading');
  $('#loading-title').textContent = options.mode === 'single' ? 'Generating terrain' : `Joining ${options.worldName}`;
  game = new Game({ engine, settings, ...options });
  $('#hud').classList.toggle('multiplayer', options.mode === 'multi');
  game.onReady = () => {
    document.body.classList.remove('in-menu');
    game.requestPlay();
  };
}

function playWorld(id) {
  let saved;
  try { saved = storage.loadWorld(id); }
  catch (error) { $('#world-status').textContent = `Dünya açılamadı: ${error.message}`; show('worlds'); return; }
  if (!saved) return;
  stopPanorama();
  engine.refreshAtlas();
  startGame({
    mode: 'single',
    seed: saved.meta.seed,
    edits: saved.edits,
    player: saved.player,
    hotbar: saved.hotbar,
    slot: saved.slot,
    worldName: saved.meta.name,
    onSave: data => storage.saveWorld(id, data),
  });
}

function quitToTitle() {
  game?.dispose();
  game = null;
  configurePacks([]);
  engine.refreshAtlas();
  document.body.classList.remove('menu-over-game');
  document.body.classList.add('in-menu');
  startPanorama();
  show('title');
}

async function joinMultiplayer(event) {
  event.preventDefault();
  const status = $('#mp-status');
  status.classList.remove('ok');
  if (mods.active().length) {
    status.textContent = 'Modlar yalnızca tek oyunculuda desteklenir. Çok oyunculu için Modlar menüsündeki tüm paketleri devre dışı bırakın. Modlu dünyalar sunucuya gönderilmez.';
    return;
  }
  configurePacks([]);
  const name = sanitizeName($('#mp-name').value);
  if (!name) {
    status.textContent = 'Pick a name (letters, numbers, spaces, - _ .).';
    $('#mp-name').focus();
    return;
  }
  const room = sanitizeRoom($('#mp-room').value) || 'lobby';
  const serverInput = $('#mp-server').value.trim();
  let url;
  try {
    url = resolveServerUrl(serverInput || DEFAULT_SERVER, location);
  } catch (error) {
    status.textContent = error.message;
    return;
  }
  status.textContent = `Connecting to ${url}…`;
  status.classList.add('ok');
  $('#mp-join').disabled = true;
  const net = new NetClient();
  net.name = name;
  try {
    const welcome = await net.connect({ url, room, name });
    storage.saveProfile({ name, server: serverInput, room });
    net.name = welcome.name;
    startGame({
      mode: 'multi',
      seed: welcome.seed,
      edits: welcome.edits,
      player: welcome.spawn,
      hotbar: DEFAULT_HOTBAR,
      slot: 0,
      net,
      selfId: welcome.id,
      players: welcome.players,
      worldName: welcome.room,
    });
  } catch (error) {
    status.classList.remove('ok');
    status.textContent = error.message;
  } finally {
    $('#mp-join').disabled = false;
  }
}

document.addEventListener('click', event => {
  const go = event.target.closest('[data-go]');
  if (!go) return;
  if (go.dataset.go === 'options') optionsReturn = 'title';
  show(go.dataset.go);
});

$('#world-list').addEventListener('click', event => {
  const item = event.target.closest('[data-world]');
  if (!item) return;
  selectedWorld = item.dataset.world;
  renderWorldList();
});
$('#world-list').addEventListener('dblclick', event => {
  const item = event.target.closest('[data-world]');
  if (item) playWorld(item.dataset.world);
});
$('#play-world').addEventListener('click', () => selectedWorld && playWorld(selectedWorld));
$('#delete-world').addEventListener('click', () => {
  const world = storage.listWorlds().find(entry => entry.id === selectedWorld);
  if (!world || !confirm(`Delete "${world.name}" forever?`)) return;
  storage.deleteWorld(world.id);
  selectedWorld = null;
  renderWorldList();
});
$('#create-form').addEventListener('submit', event => {
  event.preventDefault();
  let meta;
  try { meta = storage.createWorld({ name: $('#world-name').value, seed: seedFromText($('#world-seed').value), packs: mods.active() }); }
  catch (error) { $('#create-mods').textContent = `Dünya oluşturulamadı: ${error.message}`; return; }
  $('#world-seed').value = '';
  selectedWorld = meta.id;
  playWorld(meta.id);
});
$('#join-form').addEventListener('submit', joinMultiplayer);

for (const [id, key, parse] of [['#opt-render', 'renderDistance', Number], ['#opt-fov', 'fov', Number], ['#opt-sens', 'sensitivity', Number]]) {
  $(id).addEventListener('input', event => {
    settings[key] = parse(event.target.value);
    applySettings();
  });
}
$('#options-done').addEventListener('click', () => {
  if (optionsReturn === 'pause') {
    document.body.classList.remove('in-menu', 'menu-over-game');
    $('#pause').hidden = false;
  } else show('title');
});

$('#resume').addEventListener('click', () => game?.requestPlay());
$('#pause-options').addEventListener('click', () => {
  optionsReturn = 'pause';
  $('#pause').hidden = true;
  document.body.classList.add('in-menu', 'menu-over-game');
  show('options');
});
$('#quit').addEventListener('click', quitToTitle);
$('#disconnect-back').addEventListener('click', quitToTitle);
$('#click-to-play').addEventListener('click', () => game?.requestPlay());

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const time = now / 1000;
  if (game) {
    const view = game.frame(dt, time);
    if (view.loading) {
      const total = (settings.renderDistance * 2 + 3) ** 2;
      $('#loading-bar').style.width = `${Math.min(100, (game.world.chunks.size / Math.min(total, 25)) * 100)}%`;
    }
    $('#player-list').classList.toggle('show', Boolean(game.net && game.active && game.keys.has('Tab')));
    engine.render(time, view);
    return;
  }
  if (panorama) {
    const origin = panorama.origin;
    panorama.update(origin.x, origin.z, 6);
    engine.camera.position.set(origin.x, origin.y + 14, origin.z);
    engine.camera.rotation.set(-0.18, time * 0.035, 0);
  }
  engine.render(time, {});
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

$('#splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
$('#mp-name').value = profile.name;
$('#mp-server').value = profile.server || DEFAULT_SERVER;
$('#mp-room').value = new URLSearchParams(location.search).get('room') || profile.room;
globalThis.webcraft = { get game() { return game; }, engine, storage };
document.body.classList.add('in-menu');
startPanorama();
show(new URLSearchParams(location.search).has('room') ? 'multiplayer' : 'title');
requestAnimationFrame(frame);
