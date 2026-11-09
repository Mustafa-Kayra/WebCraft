const play = document.querySelector('#play');
const version = document.querySelector('#version');
const archiveInput = document.querySelector('#archive-input');
const folderInput = document.querySelector('#folder-input');
const modList = document.querySelector('#mod-list');
const modCount = document.querySelector('#mod-count');
const dbRequest = indexedDB.open('webcraft-mods', 1);
dbRequest.onupgradeneeded = () => dbRequest.result.createObjectStore('packs', { keyPath: 'id' });
const modsReady = new Promise((resolve, reject) => { dbRequest.onsuccess = () => resolve(dbRequest.result); dbRequest.onerror = () => reject(dbRequest.error); });
const readMods = async () => {
  const db = await modsReady;
  return new Promise((resolve, reject) => { const request = db.transaction('packs').objectStore('packs').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
};
const saveMod = async (pack) => { const db = await modsReady; db.transaction('packs', 'readwrite').objectStore('packs').put(pack); };
const deleteMod = async (id) => { const db = await modsReady; db.transaction('packs', 'readwrite').objectStore('packs').delete(id); renderMods(); };
const renderMods = async () => {
  const packs = await readMods();
  modCount.textContent = `${packs.length} paket`;
  modList.replaceChildren(...(packs.length ? packs.map((pack) => { const row = document.createElement('div'); row.className = 'mod-row'; row.innerHTML = `<span class="mod-icon">${pack.kind === 'jar' ? 'J' : '◆'}</span><span class="mod-name">${pack.name}<small>${pack.kind === 'jar' ? 'JVM modu · uyumsuz' : `${pack.size} · ${pack.version}`}</small></span><button type="button" aria-label="${pack.name} paketini sil">×</button>`; row.querySelector('button').onclick = () => deleteMod(pack.id); return row; }) : [Object.assign(document.createElement('span'), { className: 'empty-mods', textContent: 'Henüz paket eklenmedi.' })]));
};
const addPack = async (file, folder = false) => {
  const lower = file.name.toLowerCase();
  const kind = lower.endsWith('.jar') ? 'jar' : lower.endsWith('.epk') ? 'epk' : folder ? 'folder' : 'zip';
  await saveMod({ id: `${version.value}:${file.name}:${file.size}:${file.lastModified}`, name: folder ? file.webkitRelativePath.split('/')[0] : file.name, kind, size: `${Math.max(1, Math.round(file.size / 1024))} KB`, version: version.value, blob: kind === 'jar' ? null : file });
  renderMods();
};
document.querySelector('#add-archive').onclick = () => archiveInput.click();
document.querySelector('#add-folder').onclick = () => folderInput.click();
archiveInput.onchange = () => archiveInput.files[0] && addPack(archiveInput.files[0]);
folderInput.onchange = () => folderInput.files[0] && addPack(folderInput.files[0], true);
const savedVersion = localStorage.getItem('webcraft-version');
if (savedVersion === '26.2' || savedVersion === '1.12.2') version.value = savedVersion;
renderMods();
play.addEventListener('click', async () => {
  play.disabled = true;
  const status = document.querySelector('#status');
  status.textContent = 'Tarayıcı ve oyun dosyaları kontrol ediliyor…';
  try {
    const canvas = document.createElement('canvas');
    if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) throw new Error('WebGL etkin değil. Donanım hızlandırmasını açıp tekrar dene.');
    if (!window.indexedDB) throw new Error('Dünya kaydı için IndexedDB destekleyen bir tarayıcı gerekiyor.');
    const response = await fetch('runtime/version.txt');
    if (!response.ok) throw new Error('Oyun dosyaları eksik. Sunucuda npm run build çalıştırılmalı.');
    await navigator.storage?.persist?.().catch(() => false);
    localStorage.setItem('webcraft-version', version.value);
    window.location.assign(`game.html?version=${encodeURIComponent(version.value)}`);
  } catch (error) {
    status.textContent = error.message;
    play.disabled = false;
  }
});
