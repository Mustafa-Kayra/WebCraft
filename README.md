# WebCraft

Turkish browser launcher for the **Eaglercraft 1.12.2** JavaScript port, configured for local singleplayer. This is not a new voxel simulation, an official Mojang release, or current Minecraft Java Edition.

## Run

Requires Node.js 22+ and Git:

```sh
npm run build
npm start
```

Open http://localhost:3000. Deploy `dist/` to any static HTTPS host. Keep the same origin to retain access to saved worlds. Desktop Chrome/Edge/Firefox with WebGL, keyboard, and mouse are recommended; touch gameplay is not promised.

The first build downloads the upstream runtime (~88 MB). Subsequent builds reuse it. `scripts/runtime.mjs` pins revision `d9e759ec21fdb807742201b11de8835e34ccd48a` from https://github.com/JessePinkman27/eaglercraft-1.12.2 and applies narrowly scoped menu patches hiding and disabling Multiplayer and Open to LAN. Runtime binaries are generated, not committed. No external game iframe, game server, account, or CDN is needed at play time. The optional launcher font uses Google Fonts with a system fallback.

## Versions

The launcher offers the pinned Eaglercraft 1.12.2 client and the real Eaglercraft 26.2 Zeus distribution. The 26.2 bundle is fetched from the official Eaglercraft CDN during build into `public/runtime-26.2`; it is not renamed 1.12.2 code. Each version uses separate IndexedDB namespaces.

## Saves and networking

The integrated game server runs in a browser worker. IndexedDB `webcraft-worlds-v1` holds worlds; settings use a separate `webcraft-1.12` namespace. The launcher requests persistent storage, but browsers may decline. Export worlds in the game before clearing browser data or changing devices/origins. Private browsing is not suitable for long-term saves.

Configured server and relay lists are empty; voice, redirects, server cookies, and alternate-client boot menus are disabled. The game page's connection policy permits only same-origin/data/blob fetches, blocking remote websocket servers. Do not weaken it when deploying.

## Third-party provenance

Eaglercraft and Minecraft names, runtime, artwork, and assets belong to their respective authors/rightsholders. The upstream build repository does not include a redistribution license. This project does not grant rights to those materials. Check the upstream terms and obtain any necessary permissions before publicly redistributing a built site. This launcher is not affiliated with Mojang or Microsoft. Upstream credits and first-run notices remain intact.
