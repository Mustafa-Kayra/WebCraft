const selectedVersion = new URLSearchParams(location.search).get('version') || localStorage.getItem('webcraft-version') || '1.12.2';
const runtime = selectedVersion === '26.2' ? 'runtime-26.2' : 'runtime';
document.title = `WebCraft — ${selectedVersion}`;
if (selectedVersion === '26.2') {
  location.replace('runtime-26.2/eaglercraft26-2.html');
} else {
  window.eaglercraftXOpts = {
    container: 'game', assetsURI: 'runtime/assets.epk', localesURI: 'runtime/lang/',
    worldsDB: `webcraft-worlds-${selectedVersion}`, resourcePacksDB: `webcraft-resources-${selectedVersion}`,
    localStorageNamespace: 'webcraft-1.12', lang: 'tr_tr', demoMode: false,
    servers: [], relays: [], allowVoiceClient: false, allowServerRedirects: false,
    enableServerCookies: false, enableDownloadOfflineButton: false, allowBootMenu: false,
    enableMinceraft: false
  };
  const script = document.createElement('script');
  script.src = `${runtime}/classes.js`;
  script.onerror = () => { document.querySelector('#progress').textContent = 'Oyun motoru yüklenemedi. Bağlantını kontrol edip sayfayı yenile.'; };
  script.onload = () => {
    document.querySelector('#loading').remove();
    try { window.main(); }
    catch (error) {
      const message = document.createElement('p');
      message.textContent = `Oyun başlatılamadı: ${error.message}. Sayfayı yenileyerek tekrar dene.`;
      document.querySelector('#game').append(message);
    }
  };
  document.head.append(script);
}
