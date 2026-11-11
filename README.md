# WebCraft

WebCraft is an original voxel sandbox that runs in the browser. You get an infinite, seeded world of hills, beaches, lakes, snowy peaks, and birch forests; first-person movement with real collision; mining and block placing; a nine-slot hotbar; singleplayer worlds that save in the browser; and multiplayer rooms served over WebSockets where everyone sees each other move, build, and chat.

All textures, the logo, and the UI are generated in code for this project. WebCraft is not affiliated with Mojang, Microsoft, or any other game.

## Run it

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:5173. The dev command runs the Vite client and the multiplayer server (port 8787) together; Vite proxies `/ws` to the server, so Multiplayer works with the server address left blank.

For a production build served from one process:

```sh
npm run build
npm start
```

Open http://localhost:8787. The same process serves the built client, the WebSocket endpoint at `/ws`, and a health check at `/healthz`.

| Variable   | Default   | Purpose                                          |
| ---------- | --------- | ------------------------------------------------ |
| `PORT`     | `8787`    | HTTP and WebSocket port                          |
| `HOST`     | `0.0.0.0` | Listen address                                   |
| `DATA_DIR` | `./data`  | Where multiplayer rooms are saved as JSON files  |

To build a static client that connects to a multiplayer server on another host, set `VITE_WEBCRAFT_SERVER=wss://your-server.example` at build time. Players can also type any server address on the Multiplayer screen.

## Controls

| Input                  | Action                                         |
| ---------------------- | ---------------------------------------------- |
| Mouse                  | Look (click the world to capture the pointer) |
| W A S D / arrows       | Move                                           |
| Space                  | Jump, swim up; double-tap to toggle flying     |
| Shift                  | Sprint; descend while flying                   |
| F                      | Toggle flying                                  |
| Hold left mouse        | Mine the targeted block                        |
| Right mouse            | Place the selected block (hold to repeat)      |
| Middle mouse           | Pick the targeted block into the hotbar        |
| 1–9 / mouse wheel      | Select hotbar slot                             |
| E                      | Block picker for the selected slot             |
| T or Enter             | Chat (multiplayer)                             |
| Tab (hold)             | Player list (multiplayer)                      |
| F3                     | Debug info                                     |
| Esc                    | Pause menu                                     |

## How it works

- `src/shared/` holds code used by both the browser and the server: block definitions, seeded simplex terrain generation, AABB player physics, voxel raycasting, and input sanitising. Both sides generate the same terrain from a seed, so the server only stores and sends edits.
- `src/client/` renders 16×16×80 chunks with face-culled meshes, per-vertex ambient occlusion, a generated 16-pixel texture atlas, and separate opaque, cutout (leaves and glass), and translucent water passes. Chunks load around the player within a time budget per frame.
- Singleplayer worlds are stored in `localStorage` (seed, block edits, position, and hotbar), saved every 10 seconds, on pause, on quit, and when the tab is hidden or closed.
- `server/app.js` is the multiplayer server. A room is created on first join with a random seed. The server validates edits (block type, world bounds, an 8-block reach from the player's last reported position, no bedrock, and no placing into occupied cells), rate-limits each socket, broadcasts accepted changes, and sends a correction to the sender when it rejects one. Rooms, including each player's last position by name, are written to `DATA_DIR/rooms/<room>.json` a second after a change and on shutdown, so they survive restarts.

## Tests

```sh
npm test
```

The suite covers deterministic terrain, spawn selection, collision and jumping, raycasting, save-data validation, and the multiplayer server with real WebSocket clients: presence, movement relay, edit broadcast and rejection, chat, and room persistence across a restart.

## Bildirimsel mod paketleri

Ana menüde **Modlar → JSON mod dosyası içe aktar → Etkinleştir** yolunu izleyin; **Örnek modu indir** düğmesi içe aktarılabilir iki bloklu paketi verir. Ardından **Singleplayer → Create New World** ile başlayın. Oyun içinde **E** ile blok seçiciyi açın, Yakut veya Dekoratif Tuğla seçin; sağ tıkla yerleştirin, sol tuşu basılı tutarak kazın. Paketler ve etkinlik durumu bu tarayıcının yerel depolamasında kalır. Çok oyunculuya katılmadan önce tüm paketleri Modlar menüsünde devre dışı bırakın; etkin paket varken katılma isteği açık bir hata ile engellenir.

Modlar JavaScript çalıştırmaz; yalnızca JSON ile yeni bloklar tanımlar. Renk ve doku oyun tarafından üretilir. Paketler betik, HTML, harici resim adresi veya özel oyun mantığı içeremez. Başlangıç için [`public/mods/ornek.json`](public/mods/ornek.json) dosyasını kullanabilirsiniz.

Bir paket şu biçimdedir:

```json
{
  "format": 1,
  "id": "demo",
  "name": "Demo",
  "blocks": [
    {
      "id": "ruby",
      "name": "Yakut",
      "color": "#ff0066",
      "texture": "noise",
      "solid": true,
      "hardness": 1.5
    }
  ]
}
```

- `format` tam olarak `1` olmalıdır. Paket ve blok nesnelerinde bilinmeyen alanlar reddedilir.
- Paket ve blok `id` değerleri küçük harfle başlamalı; yalnızca `a-z`, `0-9`, `_` ve `-` içermeli ve en fazla 32 karakter olmalıdır. Paket kimlikleri etkin paketler arasında, blok kimlikleri kendi paketi içinde benzersiz olmalıdır.
- `name`, HTML veya kontrol karakteri içermeyen, en fazla 48 karakterlik görüntülenen addır.
- `color`, `#ff0066` gibi altı basamaklı onaltılık bir renktir. `texture` yalnızca `noise`, `solid` veya `brick` olabilir.
- `solid` bir boolean değeridir: `true` oyuncuyu engeller, `false` bloktan geçilmesine izin verir. `hardness`, `0.1` ile `10` arasında sonlu bir sayıdır; kazma süresini belirler.
- Bir JSON dosyası en fazla 128 KiB olabilir. En fazla 16 paket etkinleştirilebilir; her pakette 1–32, tüm etkin paketlerde toplam en fazla 128 blok bulunabilir.

Paketleri mod yöneticisinden içe aktarın ve yeni dünya için kullanmak istediklerinizi etkinleştirin. Yönetici değişiklikleri **yalnızca yeni dünyaları** etkiler. Yeni dünya oluşturulurken doğrulanmış paketlerin bir kopyası dünya kaydına eklenir. Daha sonra paketi kitaplıktan silmek, devre dışı bırakmak veya değiştirmek mevcut dünyanın bloklarını değiştirmez; dünya her açıldığında kendi kayıtlı paketleri kullanılır. Modların yeni özellikleri mevcut dünyalara otomatik olarak uygulanmaz.

Yerleşik blokların sayısal kimlikleri `0–13` aralığındadır. Mod blokları etkin paket ve blok sırasına göre `14` değerinden başlayarak atanır. Bu yüzden kayıtlı paketlerin sırası ve içeriği dünya ile birlikte korunur; kayıt dosyasındaki paketleri veya blok kimliklerini elle değiştirmeyin. Mod paketleri tek oyunculu dünyalar içindir; çok oyunculu odalar yerleşik blok kataloğunu kullanır.

Geliştiriciler için `src/shared/mods.js`, nesneleri doğrulamak için `validatePack(input)`, boyut denetimli JSON okumak için `parsePack(text)` ve kataloğu kurmak için `configurePacks(packs)` dışa aktarır. Geçersiz girdiler hata üretir. `configurePacks`, önceki mod bloklarını temizler, `BLOCKS` ve `PLACEABLE_BLOCKS` dizilerini yerinde günceller ve `BLOCKS` kataloğunu döndürür. Doğrulama, sınır ve güvenlik kontrolleri ile kayıt uyumluluğu `test/mods.test.js` içinde sınanır; çalıştırmak için `node --test test/mods.test.js` kullanın.

## Deploying multiplayer

The client is static and can be hosted anywhere, but multiplayer needs the Node server running somewhere that accepts long-lived WebSocket connections. Static-only hosts (GitHub Pages, plain Netlify or Vercel static sites) can serve singleplayer but not rooms. A single Node process on a VM, Fly.io, Railway, Render, or similar works; give it a persistent volume for `DATA_DIR`, terminate TLS in front of it so browsers on HTTPS connect with `wss://`, and forward WebSocket upgrades on `/ws`.

Known limits of the current server:

- Names are not authenticated. Anyone who types a name in a room takes over that name's saved position, and anyone who knows a room name can join and edit it.
- Movement is trusted from the client (edits are reach-checked against it), so a modified client could teleport.
- Rooms live in one process. Running several instances behind a load balancer needs sticky routing by room or a shared store.
- There are no survival mechanics: no health, item drops, crafting, or mobs. Block supply is unlimited.
