window.eaglercraftXOpts = {
  container: 'game', assetsURI: 'runtime/assets.epk', localesURI: 'runtime/lang/',
  worldsDB: 'webcraft-worlds-v1', resourcePacksDB: 'webcraft-resources-v1',
  localStorageNamespace: 'webcraft-1.12', lang: 'tr_tr', demoMode: false,
  servers: [], relays: [], allowVoiceClient: false, allowServerRedirects: false,
  enableServerCookies: false, enableDownloadOfflineButton: false, allowBootMenu: false,
  enableMinceraft: false
};
const script = document.createElement('script');
script.src = 'runtime/classes.js';
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
