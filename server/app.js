import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { BLOCK, isPlaceable } from '../src/shared/blocks.js';
import { EYE_HEIGHT } from '../src/shared/physics.js';
import { PROTOCOL_VERSION, sanitizeChat, sanitizeName, sanitizeRoom } from '../src/shared/protocol.js';
import { CHUNK_SIZE, WORLD_HEIGHT, chunkIndex, createGenerator } from '../src/shared/world-gen.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};
const MAX_COORD = 10_000_000;
const SERVER_REACH = 8;
const TOKEN_RATE = 60;
const TOKEN_CAPACITY = 120;

export function createWebCraftServer({
  staticDir = null,
  dataDir,
  maxPlayersPerRoom = 16,
  maxEditsPerRoom = 250_000,
  saveDelayMs = 1000,
  idleEvictMs = 60_000,
  log = console.log,
} = {}) {
  const rooms = new Map();
  const loadingRooms = new Map();
  const staticRoot = staticDir ? resolve(staticDir) : null;
  const roomPath = id => join(dataDir, 'rooms', `${id}.json`);

  async function serveStatic(pathname, response) {
    if (!staticRoot) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('This process only hosts the multiplayer endpoint at /ws.');
      return;
    }
    let filePath = resolve(staticRoot, `.${decodeURIComponent(pathname)}`);
    if (filePath !== staticRoot && !filePath.startsWith(staticRoot + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if (filePath === staticRoot) filePath = join(staticRoot, 'index.html');
    try {
      const body = await readFile(filePath);
      const immutable = filePath.includes(`${sep}assets${sep}`);
      response.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
      response.end(body);
    } catch {
      if (extname(filePath)) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      try {
        const body = await readFile(join(staticRoot, 'index.html'));
        response.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' }).end(body);
      } catch {
        response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('Client not built. Run npm run build first.');
      }
    }
  }

  const http = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/healthz') {
      let players = 0;
      for (const room of rooms.values()) players += room.players.size;
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, rooms: rooms.size, players }));
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    serveStatic(url.pathname, response);
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 4096, perMessageDeflate: false });

  const send = (socket, message) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const broadcast = (room, message, except = null) => {
    const payload = JSON.stringify(message);
    for (const client of room.players.values()) if (client !== except && client.socket.readyState === WebSocket.OPEN) client.socket.send(payload);
  };

  async function loadRoom(id) {
    let stored = null;
    try {
      stored = JSON.parse(await readFile(roomPath(id), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') log(`Could not read room ${id}: ${error.message}`);
    }
    const seed = Number.isInteger(stored?.seed) ? stored.seed : randomInt(2 ** 31);
    const generator = createGenerator(seed);
    const room = {
      id,
      seed,
      generator,
      spawn: generator.spawnPoint(),
      createdAt: stored?.createdAt ?? Date.now(),
      edits: new Map(),
      chunkCache: new Map(),
      positions: new Map(Object.entries(stored?.positions ?? {})),
      players: new Map(),
      dirty: !stored,
      saveTimer: null,
      evictTimer: null,
      writing: Promise.resolve(),
    };
    const flat = Array.isArray(stored?.edits) ? stored.edits : [];
    for (let i = 0; i + 3 < flat.length; i += 4) room.edits.set(`${flat[i]},${flat[i + 1]},${flat[i + 2]}`, flat[i + 3]);
    rooms.set(id, room);
    return room;
  }

  async function getRoom(id) {
    if (rooms.has(id)) return rooms.get(id);
    if (!loadingRooms.has(id)) loadingRooms.set(id, loadRoom(id).finally(() => loadingRooms.delete(id)));
    return loadingRooms.get(id);
  }

  function saveRoom(room) {
    clearTimeout(room.saveTimer);
    room.saveTimer = null;
    if (!room.dirty) return room.writing;
    room.dirty = false;
    const edits = [];
    for (const [key, id] of room.edits) edits.push(...key.split(',').map(Number), id);
    const body = JSON.stringify({ version: 1, id: room.id, seed: room.seed, createdAt: room.createdAt, edits, positions: Object.fromEntries(room.positions) });
    room.writing = room.writing.then(async () => {
      await mkdir(join(dataDir, 'rooms'), { recursive: true });
      const temp = `${roomPath(room.id)}.${process.pid}.tmp`;
      await writeFile(temp, body);
      await rename(temp, roomPath(room.id));
    }).catch(error => {
      room.dirty = true;
      log(`Could not save room ${room.id}: ${error.message}`);
    });
    return room.writing;
  }

  function scheduleSave(room) {
    room.dirty = true;
    if (!room.saveTimer) room.saveTimer = setTimeout(() => saveRoom(room), saveDelayMs);
  }

  function blockAt(room, x, y, z) {
    const edited = room.edits.get(`${x},${y},${z}`);
    if (edited !== undefined) return edited;
    const chunkKey = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
    let data = room.chunkCache.get(chunkKey);
    if (data) room.chunkCache.delete(chunkKey);
    else data = room.generator.generateChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    room.chunkCache.set(chunkKey, data);
    if (room.chunkCache.size > 64) room.chunkCache.delete(room.chunkCache.keys().next().value);
    return data[chunkIndex(((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, y, ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE)];
  }

  const publicPlayer = client => ({ id: client.id, name: client.name, x: client.x, y: client.y, z: client.z, yaw: client.yaw, pitch: client.pitch });

  async function handleHello(client, message) {
    const { socket } = client;
    if (message.v !== PROTOCOL_VERSION) {
      send(socket, { type: 'error', message: `This server speaks protocol ${PROTOCOL_VERSION}; reload the page to update your client.` });
      socket.close(1008, 'Protocol mismatch');
      return;
    }
    const name = sanitizeName(message.name);
    if (!name) {
      send(socket, { type: 'error', message: 'Choose a name made of letters, numbers, spaces, or - _ .' });
      return;
    }
    client.joining = true;
    const roomId = sanitizeRoom(message.room) || 'lobby';
    const room = await getRoom(roomId);
    client.joining = false;
    if (socket.readyState !== WebSocket.OPEN) return;
    if (room.players.size >= maxPlayersPerRoom) {
      send(socket, { type: 'error', message: `Room "${roomId}" is full (${maxPlayersPerRoom} players).` });
      return;
    }
    const nameKey = name.toLowerCase();
    if ([...room.players.values()].some(other => other.name.toLowerCase() === nameKey)) {
      send(socket, { type: 'error', message: `Someone named "${name}" is already in room "${roomId}".` });
      return;
    }
    const remembered = room.positions.get(nameKey);
    const [x, y, z, yaw, pitch] = Array.isArray(remembered) && remembered.every(Number.isFinite) ? remembered : [room.spawn.x, room.spawn.y, room.spawn.z, 0, 0];
    Object.assign(client, { name, nameKey, room, x, y, z, yaw, pitch });
    clearTimeout(room.evictTimer);
    room.evictTimer = null;
    const edits = [];
    for (const [key, id] of room.edits) edits.push(...key.split(',').map(Number), id);
    send(socket, { type: 'welcome', id: client.id, name, room: roomId, seed: room.seed, edits, spawn: { x, y, z, yaw, pitch }, players: [...room.players.values()].map(publicPlayer) });
    broadcast(room, { type: 'join', player: publicPlayer(client) });
    room.players.set(client.id, client);
    log(`${name} joined ${roomId} (${room.players.size} online)`);
  }

  function handleSet(client, message) {
    const { room } = client;
    const { x, y, z, id } = message;
    if (![x, y, z].every(Number.isInteger) || Math.abs(x) > MAX_COORD || Math.abs(z) > MAX_COORD) return;
    if (y < 1 || y >= WORLD_HEIGHT) return;
    const reject = reason => {
      send(client.socket, { type: 'set', x, y, z, id: blockAt(room, x, y, z) });
      if (reason) send(client.socket, { type: 'error', message: reason });
    };
    if (id !== BLOCK.AIR && !isPlaceable(id)) return reject();
    const distance = Math.hypot(x + 0.5 - client.x, y + 0.5 - (client.y + EYE_HEIGHT), z + 0.5 - client.z);
    if (distance > SERVER_REACH) return reject();
    const key = `${x},${y},${z}`;
    if (!room.edits.has(key) && room.edits.size >= maxEditsPerRoom) return reject('This room has reached its edit limit.');
    const current = blockAt(room, x, y, z);
    if (current === BLOCK.BEDROCK) return reject();
    if (id !== BLOCK.AIR && current !== BLOCK.AIR && current !== BLOCK.WATER) return reject();
    room.edits.set(key, id);
    broadcast(room, { type: 'set', x, y, z, id }, client);
    scheduleSave(room);
  }

  function leave(client) {
    const { room } = client;
    if (!room || !room.players.has(client.id)) return;
    room.players.delete(client.id);
    room.positions.set(client.nameKey, [client.x, client.y, client.z, client.yaw, client.pitch]);
    scheduleSave(room);
    broadcast(room, { type: 'leave', id: client.id });
    log(`${client.name} left ${room.id} (${room.players.size} online)`);
    if (room.players.size === 0) {
      room.evictTimer = setTimeout(async () => {
        await saveRoom(room);
        if (room.players.size === 0 && rooms.get(room.id) === room) rooms.delete(room.id);
      }, idleEvictMs);
    }
  }

  wss.on('connection', socket => {
    const client = { socket, id: randomUUID(), room: null, joining: false, tokens: TOKEN_CAPACITY, refilledAt: Date.now() };
    socket.on('message', async raw => {
      const now = Date.now();
      client.tokens = Math.min(TOKEN_CAPACITY, client.tokens + ((now - client.refilledAt) / 1000) * TOKEN_RATE);
      client.refilledAt = now;
      if (--client.tokens < 0) {
        if (client.tokens < -TOKEN_CAPACITY) socket.close(1008, 'Too many messages');
        return;
      }
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;
      if (!client.room) {
        if (message.type === 'hello' && !client.joining) await handleHello(client, message);
        return;
      }
      if (message.type === 'move') {
        const values = [message.x, message.y, message.z, message.yaw, message.pitch];
        if (!values.every(Number.isFinite) || Math.abs(message.x) > MAX_COORD || Math.abs(message.z) > MAX_COORD || message.y < -100 || message.y > 500) return;
        [client.x, client.y, client.z, client.yaw, client.pitch] = values;
        broadcast(client.room, { type: 'move', ...publicPlayer(client) }, client);
      } else if (message.type === 'set') handleSet(client, message);
      else if (message.type === 'chat') {
        const text = sanitizeChat(message.text);
        if (text) broadcast(client.room, { type: 'chat', name: client.name, text });
      }
    });
    socket.on('close', () => leave(client));
    socket.on('error', () => socket.terminate());
  });

  return {
    http,
    rooms,
    listen(port, host) {
      return new Promise(resolveListen => http.listen(port, host, () => resolveListen(http.address())));
    },
    async close() {
      for (const client of wss.clients) client.close(1001, 'Server shutting down');
      await Promise.all([...rooms.values()].map(room => {
        clearTimeout(room.evictTimer);
        for (const client of room.players.values()) room.positions.set(client.nameKey, [client.x, client.y, client.z, client.yaw, client.pitch]);
        if (room.players.size) room.dirty = true;
        return saveRoom(room);
      }));
      await new Promise(resolveClose => wss.close(() => resolveClose()));
      await new Promise(resolveClose => http.close(() => resolveClose()));
    },
  };
}
