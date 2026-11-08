import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { createWebCraftServer } from '../server/app.js';
import { BLOCK } from '../src/shared/blocks.js';
import { PROTOCOL_VERSION } from '../src/shared/protocol.js';

class Client {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.inbox = [];
    this.waiters = [];
    this.socket.on('message', data => {
      const message = JSON.parse(data.toString());
      const waiter = this.waiters.find(entry => entry.predicate(message));
      if (waiter) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      } else this.inbox.push(message);
    });
  }

  next(predicate, timeout = 2000) {
    const queued = this.inbox.findIndex(predicate);
    if (queued >= 0) return Promise.resolve(this.inbox.splice(queued, 1)[0]);
    return new Promise((resolve, reject) => {
      const entry = { predicate };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(entry), 1);
        reject(new Error('Timed out waiting for a server message'));
      }, timeout);
      entry.resolve = message => {
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.push(entry);
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  async join(room, name) {
    if (this.socket.readyState !== WebSocket.OPEN) await once(this.socket, 'open');
    this.send({ type: 'hello', v: PROTOCOL_VERSION, room, name });
    return this.next(message => message.type === 'welcome' || message.type === 'error');
  }

  close() {
    this.socket.close();
  }
}

async function startServer(dataDir) {
  const server = createWebCraftServer({ dataDir, saveDelayMs: 10, idleEvictMs: 10, log: () => {} });
  const { port } = await server.listen(0, '127.0.0.1');
  return { server, url: `ws://127.0.0.1:${port}/ws`, http: `http://127.0.0.1:${port}` };
}

test('two clients share a room: presence, movement, block edits, and chat', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webcraft-'));
  const { server, url, http } = await startServer(dataDir);
  t.after(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const alder = new Client(url);
  const welcomeA = await alder.join('Oak Room', 'Alder');
  assert.equal(welcomeA.type, 'welcome');
  assert.equal(welcomeA.room, 'oak-room');
  assert.deepEqual(welcomeA.players, []);

  const birch = new Client(url);
  const welcomeB = await birch.join('oak-room', 'Birch');
  assert.equal(welcomeB.seed, welcomeA.seed);
  assert.deepEqual(welcomeB.players.map(player => player.name), ['Alder']);
  assert.equal((await alder.next(message => message.type === 'join')).player.name, 'Birch');

  const duplicate = new Client(url);
  const rejected = await duplicate.join('oak-room', 'alder');
  assert.equal(rejected.type, 'error');
  duplicate.close();

  const { spawn } = welcomeA;
  alder.send({ type: 'move', x: spawn.x + 1, y: spawn.y, z: spawn.z, yaw: 1, pitch: 0 });
  const moved = await birch.next(message => message.type === 'move');
  assert.equal(moved.id, welcomeA.id);
  assert.equal(moved.x, spawn.x + 1);

  const target = { x: Math.floor(spawn.x) + 2, y: spawn.y, z: Math.floor(spawn.z) };
  alder.send({ type: 'set', ...target, id: BLOCK.AIR });
  assert.deepEqual(await birch.next(message => message.type === 'set'), { type: 'set', ...target, id: BLOCK.AIR });
  alder.send({ type: 'set', ...target, id: BLOCK.BRICK });
  assert.deepEqual(await birch.next(message => message.type === 'set'), { type: 'set', ...target, id: BLOCK.BRICK });

  alder.send({ type: 'set', x: target.x, y: 0, z: target.z, id: BLOCK.AIR });
  alder.send({ type: 'set', x: target.x + 500, y: target.y, z: target.z, id: BLOCK.STONE });
  alder.send({ type: 'set', ...target, id: BLOCK.BEDROCK });
  const corrections = [];
  for (let i = 0; i < 2; i++) corrections.push(await alder.next(message => message.type === 'set'));
  assert.deepEqual(corrections.map(message => message.x), [target.x + 500, target.x]);
  assert.equal(corrections[1].id, BLOCK.BRICK);

  birch.send({ type: 'chat', text: '  hello\u0007 alder ' });
  const chat = await alder.next(message => message.type === 'chat');
  assert.deepEqual([chat.name, chat.text], ['Birch', 'hello alder']);

  const health = await (await fetch(`${http}/healthz`)).json();
  assert.equal(health.players, 2);

  birch.close();
  assert.equal((await alder.next(message => message.type === 'leave')).id, welcomeB.id);

  const late = new Client(url);
  const welcomeLate = await late.join('oak-room', 'Cedar');
  const edits = welcomeLate.edits;
  assert.deepEqual(edits.slice(-4), [target.x, target.y, target.z, BLOCK.BRICK]);
  late.close();
  alder.close();
});

test('room edits and player positions persist across a server restart', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webcraft-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const first = await startServer(dataDir);
  const builder = new Client(first.url);
  const welcome = await builder.join('keep', 'Builder');
  const target = { x: Math.floor(welcome.spawn.x) + 1, y: welcome.spawn.y + 1, z: Math.floor(welcome.spawn.z) };
  builder.send({ type: 'set', ...target, id: BLOCK.AIR });
  builder.send({ type: 'set', ...target, id: BLOCK.GLASS });
  builder.send({ type: 'move', x: welcome.spawn.x + 1.5, y: welcome.spawn.y, z: welcome.spawn.z, yaw: 2, pitch: 0 });
  await new Promise(resolve => setTimeout(resolve, 50));
  await first.server.close();

  const saved = JSON.parse(await readFile(join(dataDir, 'rooms', 'keep.json'), 'utf8'));
  assert.equal(saved.seed, welcome.seed);

  const second = await startServer(dataDir);
  t.after(() => second.server.close());
  const returning = new Client(second.url);
  const again = await returning.join('keep', 'builder');
  assert.equal(again.seed, welcome.seed);
  assert.deepEqual(again.edits, [target.x, target.y, target.z, BLOCK.GLASS]);
  assert.equal(again.spawn.x, welcome.spawn.x + 1.5);
  returning.close();
});

test('protocol mismatches are rejected', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webcraft-'));
  const { server, url } = await startServer(dataDir);
  t.after(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const client = new Client(url);
  await once(client.socket, 'open');
  client.send({ type: 'hello', v: PROTOCOL_VERSION + 1, room: 'x', name: 'Old' });
  assert.equal((await client.next(message => message.type === 'error')).type, 'error');
  client.close();
});
