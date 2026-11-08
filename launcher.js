const play = document.querySelector('#play');
const version = document.querySelector('#version');
const savedVersion = localStorage.getItem('webcraft-version');
if (savedVersion === '26.2' || savedVersion === '1.12.2') version.value = savedVersion;
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
