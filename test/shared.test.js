import assert from 'node:assert/strict';
import test from 'node:test';
import { BLOCK, BLOCKS, DEFAULT_HOTBAR, PLACEABLE_BLOCKS } from '../src/shared/blocks.js';
import { seedFromText } from '../src/shared/noise.js';
import { PLAYER_HEIGHT, raycast, stepPlayer } from '../src/shared/physics.js';
import { sanitizeChat, sanitizeName, sanitizeRoom } from '../src/shared/protocol.js';
import { CHUNK_SIZE, WORLD_HEIGHT, chunkIndex, createGenerator } from '../src/shared/world-gen.js';
import { createStorage } from '../src/client/storage.js';

function chunkWorld(seed) {
  const generator = createGenerator(seed);
  const chunks = new Map();
  const edits = new Map();
  const getBlock = (x, y, z) => {
    if (y < 0) return BLOCK.BEDROCK;
    if (y >= WORLD_HEIGHT) return BLOCK.AIR;
    const edited = edits.get(`${x},${y},${z}`);
    if (edited !== undefined) return edited;
    const key = `${x >> 4},${z >> 4}`;
    if (!chunks.has(key)) chunks.set(key, generator.generateChunk(x >> 4, z >> 4));
    return chunks.get(key)[chunkIndex(x & 15, y, z & 15)];
  };
  return { generator, getBlock, edits };
}

const idle = yaw => ({ forward: 0, strafe: 0, jump: false, descend: false, sprint: false, yaw });

test('terrain generation is deterministic per seed and differs across seeds', () => {
  const first = createGenerator(1234).generateChunk(3, -2);
  const again = createGenerator(1234).generateChunk(3, -2);
  const other = createGenerator(999).generateChunk(3, -2);
  assert.equal(first.length, CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  assert.deepEqual(first, again);
  assert.notDeepEqual(first, other);
  for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) assert.equal(first[chunkIndex(x, 0, z)], BLOCK.BEDROCK);
});

test('chunk contents do not depend on generation order and include trees', () => {
  const generator = createGenerator(42);
  generator.generateChunk(0, 0);
  const right = generator.generateChunk(1, 0);
  assert.deepEqual(right, createGenerator(42).generateChunk(1, 0));
  let logs = 0;
  for (let cz = -3; cz <= 3; cz++) for (let cx = -3; cx <= 3; cx++) logs += generator.generateChunk(cx, cz).filter(id => id === BLOCK.LOG).length;
  assert.ok(logs > 0);
});

test('spawn point stands on dry land with air above', () => {
  for (const seed of [1, 2, 3, 12345, -77]) {
    const { generator, getBlock } = chunkWorld(seed);
    const spawn = generator.spawnPoint();
    const x = Math.floor(spawn.x);
    const z = Math.floor(spawn.z);
    assert.ok(BLOCKS[getBlock(x, spawn.y - 1, z)].solid, `seed ${seed} spawn has ground`);
    assert.equal(getBlock(x, spawn.y, z), BLOCK.AIR);
  }
});

test('gravity lands the player on the ground and walls stop horizontal movement', () => {
  const { generator, getBlock, edits } = chunkWorld(12345);
  const spawn = generator.spawnPoint();
  const body = { x: spawn.x, y: spawn.y + 5, z: spawn.z, vx: 0, vy: 0, vz: 0, onGround: false, flying: false };
  for (let i = 0; i < 120; i++) stepPlayer(body, idle(0), 1 / 60, getBlock);
  assert.ok(body.onGround);
  assert.ok(Math.abs(body.y - spawn.y) < 0.01, `landed at ${body.y}, expected ${spawn.y}`);

  const wallZ = Math.floor(body.z) - 2;
  for (let y = spawn.y - 3; y < spawn.y + 6; y++) for (let x = Math.floor(body.x) - 2; x <= Math.floor(body.x) + 2; x++) edits.set(`${x},${y},${wallZ}`, BLOCK.STONE);
  for (let i = 0; i < 180; i++) stepPlayer(body, { ...idle(0), forward: 1 }, 1 / 60, getBlock);
  assert.ok(body.z - 0.3 >= wallZ + 1 - 1e-6, `player stopped at the wall (z=${body.z})`);
  assert.ok(body.z - 0.3 < wallZ + 1.01);
});

test('jumping clears one block but not two', () => {
  const { generator, getBlock, edits } = chunkWorld(12345);
  const spawn = generator.spawnPoint();
  const floorY = spawn.y - 1;
  const cx = Math.floor(spawn.x);
  const cz = Math.floor(spawn.z);
  for (let x = cx - 3; x <= cx + 3; x++) for (let z = cz - 6; z <= cz + 3; z++) {
    edits.set(`${x},${floorY},${z}`, BLOCK.STONE);
    for (let y = spawn.y; y < spawn.y + 6; y++) edits.set(`${x},${y},${z}`, BLOCK.AIR);
  }
  const body = { x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, onGround: true };
  let peak = body.y;
  stepPlayer(body, { ...idle(0), jump: true }, 1 / 60, getBlock);
  for (let i = 0; i < 60; i++) {
    stepPlayer(body, idle(0), 1 / 60, getBlock);
    peak = Math.max(peak, body.y);
  }
  assert.ok(peak - spawn.y > 1.1 && peak - spawn.y < 2, `jump height ${peak - spawn.y}`);
  assert.ok(PLAYER_HEIGHT < 2);
});

test('raycast hits the first targetable block and reports the face normal', () => {
  const blocks = new Map([['2,5,0', BLOCK.STONE], ['4,5,0', BLOCK.DIRT], ['1,5,0', BLOCK.WATER]]);
  const getBlock = (x, y, z) => blocks.get(`${x},${y},${z}`) ?? BLOCK.AIR;
  const hit = raycast(getBlock, [0.5, 5.5, 0.5], [1, 0, 0], 6);
  assert.deepEqual([hit.x, hit.y, hit.z, hit.id], [2, 5, 0, BLOCK.STONE]);
  assert.deepEqual(hit.normal, [-1, 0, 0]);
  assert.equal(raycast(getBlock, [0.5, 5.5, 0.5], [-1, 0, 0], 6), null);
  assert.equal(raycast(getBlock, [0.5, 5.5, 0.5], [1, 0, 0], 1), null);
});

test('hotbar only offers placeable blocks', () => {
  assert.equal(DEFAULT_HOTBAR.length, 9);
  for (const id of DEFAULT_HOTBAR) assert.ok(PLACEABLE_BLOCKS.includes(id));
  assert.ok(!PLACEABLE_BLOCKS.includes(BLOCK.BEDROCK));
  assert.ok(!PLACEABLE_BLOCKS.includes(BLOCK.WATER));
  assert.ok(!PLACEABLE_BLOCKS.includes(BLOCK.AIR));
});

test('seed text and user input are normalised', () => {
  assert.equal(seedFromText('12345'), 12345);
  assert.equal(seedFromText('meadow'), seedFromText('meadow'));
  assert.notEqual(seedFromText('meadow'), seedFromText('valley'));
  assert.equal(sanitizeRoom('  My Room!! 2 '), 'my-room-2');
  assert.equal(sanitizeName('<b>Ada</b>'), 'bAdab');
  assert.equal(sanitizeChat('hi\u0000 there'), 'hi there');
});

test('singleplayer storage round-trips worlds and rejects corrupt saves', () => {
  const memory = new Map();
  const backend = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const storage = createStorage(backend);
  const world = storage.createWorld({ name: '  Test World ', seed: 77 });
  assert.equal(world.name, 'Test World');
  storage.saveWorld(world.id, { edits: [1, 30, 2, BLOCK.BRICK], hotbar: [...DEFAULT_HOTBAR], slot: 3, player: { x: 1, y: 30, z: 2, yaw: 0.5, pitch: -0.2 } });
  const loaded = storage.loadWorld(world.id);
  assert.deepEqual(loaded.edits, [1, 30, 2, BLOCK.BRICK]);
  assert.equal(loaded.slot, 3);
  assert.equal(loaded.player.yaw, 0.5);

  memory.set(`webcraft:world:${world.id}`, '{"edits":[1,2],"hotbar":[99],"player":{"x":"nope"}}');
  const repaired = storage.loadWorld(world.id);
  assert.deepEqual(repaired.edits, []);
  assert.deepEqual(repaired.hotbar, DEFAULT_HOTBAR);
  assert.equal(repaired.player, null);

  storage.deleteWorld(world.id);
  assert.equal(storage.listWorlds().length, 0);
});
