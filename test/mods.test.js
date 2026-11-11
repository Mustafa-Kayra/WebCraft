import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { afterEach } from 'node:test';
import { Scene } from 'three';
import { BLOCKS, DEFAULT_HOTBAR, PLACEABLE_BLOCKS, isPlaceable, isSolid } from '../src/shared/blocks.js';
import { configurePacks, parsePack, validatePack } from '../src/shared/mods.js';
import { createModLibrary } from '../src/client/mod-library.js';
import { createStorage } from '../src/client/storage.js';
import { World } from '../src/client/world.js';

const block = (overrides = {}) => ({ id: 'ruby', name: 'Yakut', color: '#ff0066', texture: 'noise', solid: true, hardness: 1.5, ...overrides });
const pack = (overrides = {}) => ({ format: 1, id: 'demo', name: 'Demo', blocks: [block()], ...overrides });
const manyBlocks = count => Array.from({ length: count }, (_, i) => block({ id: `block_${i}` }));

afterEach(() => configurePacks([]));

test('valid packs and the documented sample parse into detached definitions', async () => {
  const input = pack();
  const result = validatePack(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.notEqual(result.blocks, input.blocks);
  assert.notEqual(result.blocks[0], input.blocks[0]);
  assert.deepEqual(parsePack(JSON.stringify(input)), input);
  const sample = parsePack(await readFile(new URL('../public/mods/ornek.json', import.meta.url), 'utf8'));
  assert.equal(sample.id, 'ornek');
  assert.equal(sample.blocks.length, 2);
  for (const texture of ['noise', 'solid', 'brick']) {
    assert.equal(validatePack(pack({ blocks: [block({ texture, solid: false, hardness: 0.1 })] })).blocks[0].texture, texture);
  }
  assert.equal(validatePack(pack({ blocks: [block({ hardness: 10 })] })).blocks[0].hardness, 10);
});

test('pack validation rejects invalid shapes, missing fields and unknown properties', () => {
  for (const input of [null, [], 'demo', 1, true, {}, pack({ format: 2 }), pack({ blocks: null }), pack({ blocks: {} }), pack({ extra: true }), pack({ blocks: [block({ script: 'alert(1)' })] })]) {
    assert.throws(() => validatePack(input));
  }
  for (const key of ['format', 'id', 'name', 'blocks']) {
    const input = pack();
    delete input[key];
    assert.throws(() => validatePack(input), key);
  }
  for (const key of Object.keys(block())) {
    const input = pack();
    delete input.blocks[0][key];
    assert.throws(() => validatePack(input), key);
  }
});

test('identifiers and display names cannot carry paths, HTML or control characters', () => {
  for (const id of ['', 'Demo', '1demo', '../demo', 'demo/file', 'a'.repeat(33), 'demo space', 'demo\u0000', '<img>']) {
    assert.throws(() => validatePack(pack({ id })), `pack id ${JSON.stringify(id)}`);
    assert.throws(() => validatePack(pack({ blocks: [block({ id })] })), `block id ${JSON.stringify(id)}`);
  }
  for (const name of ['', 'a'.repeat(49), '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'line\nbreak', 'null\u0000byte', 'delete\u007f']) {
    assert.throws(() => validatePack(pack({ name })), `pack name ${JSON.stringify(name)}`);
    assert.throws(() => validatePack(pack({ blocks: [block({ name })] })), `block name ${JSON.stringify(name)}`);
  }
  assert.equal(validatePack(pack({ id: `a${'b'.repeat(31)}`, name: 'Örnek Türkçe Blok' })).name, 'Örnek Türkçe Blok');
  assert.throws(() => parsePack('{"format":1,"id":"demo","name":"Demo","blocks":[],"__proto__":{"polluted":true}}'));
  assert.equal({}.polluted, undefined);
});

test('block properties reject executable content, invalid types and non-finite hardness', () => {
  const invalid = {
    color: ['red', '#fff', '#gg0066', '#ff006600', 'url(https://example.com/image)', 'javascript:alert(1)', null],
    texture: ['script', 'https://example.com/image.png', '<svg onload=alert(1)>', null],
    solid: ['true', 1, null],
    hardness: [0, 0.099, 10.001, Infinity, -Infinity, NaN, '1', null],
  };
  for (const [key, values] of Object.entries(invalid)) {
    for (const value of values) assert.throws(() => validatePack(pack({ blocks: [block({ [key]: value })] })), `${key}: ${value}`);
  }
  assert.throws(() => validatePack(pack({ blocks: [block(), block()] })));
  assert.throws(() => validatePack(pack({ blocks: [null] })));
});

test('parsing enforces JSON syntax and the UTF-8 byte limit', () => {
  for (const text of ['', '{', 'null', '[]', '{"format":1,}', '<script>alert(1)</script>']) assert.throws(() => parsePack(text));
  const json = JSON.stringify(pack());
  assert.deepEqual(parsePack(json + ' '.repeat(128 * 1024 - Buffer.byteLength(json))), pack());
  assert.throws(() => parsePack(json + ' '.repeat(128 * 1024 - Buffer.byteLength(json) + 1)));
  assert.throws(() => parsePack(`${'é'.repeat(64 * 1024)}${json}`));
});

test('catalog assigns sequential IDs in pack order and resets arrays in place', () => {
  const catalog = BLOCKS;
  const placeable = PLACEABLE_BLOCKS;
  const builtins = BLOCKS.slice(0, 14);
  const basePlaceable = [...PLACEABLE_BLOCKS];
  assert.equal(configurePacks([pack({ blocks: [block(), block({ id: 'mist', name: 'Sis', solid: false })] }), pack({ id: 'other', blocks: [block({ name: 'Other Ruby' })] })]), catalog);
  assert.equal(BLOCKS, catalog);
  assert.equal(PLACEABLE_BLOCKS, placeable);
  assert.deepEqual(BLOCKS.slice(0, 14), builtins);
  assert.deepEqual(BLOCKS.slice(14).map(entry => entry.name), ['Yakut', 'Sis', 'Other Ruby']);
  assert.deepEqual(PLACEABLE_BLOCKS.slice(basePlaceable.length), [14, 15, 16]);
  assert.equal(isSolid(14), true);
  assert.equal(isSolid(15), false);
  assert.equal(isPlaceable(15), true);
  configurePacks([pack({ blocks: [block({ name: 'Replacement' })] })]);
  assert.equal(BLOCKS.length, 15);
  assert.equal(BLOCKS[14].name, 'Replacement');
  assert.equal(BLOCKS[15], undefined);
  configurePacks([]);
  assert.deepEqual(BLOCKS, builtins);
  assert.deepEqual(PLACEABLE_BLOCKS, basePlaceable);
});

test('pack, block and total limits are enforced before replacing the catalog', () => {
  assert.throws(() => validatePack(pack({ blocks: manyBlocks(33) })));
  const sixteen = Array.from({ length: 16 }, (_, i) => pack({ id: `pack_${i}` }));
  configurePacks(sixteen);
  assert.equal(BLOCKS.length, 30);
  assert.throws(() => configurePacks([...sixteen, pack({ id: 'extra' })]));
  assert.throws(() => configurePacks([pack(), pack()]));
  const maximum = Array.from({ length: 4 }, (_, i) => pack({ id: `pack_${i}`, blocks: manyBlocks(32) }));
  configurePacks(maximum);
  assert.equal(BLOCKS.length, 142);
  const before = BLOCKS.map(entry => ({ ...entry }));
  assert.throws(() => configurePacks([...maximum, pack({ id: 'overflow' })]));
  assert.deepEqual(BLOCKS, before);
  assert.throws(() => configurePacks([pack({ blocks: [block({ texture: 'script' })] })]));
  assert.deepEqual(BLOCKS, before);
});

test('texture keys distinguish pack and block IDs containing underscores', () => {
  configurePacks([
    pack({ id: 'a_b', blocks: [block({ id: 'c' })] }),
    pack({ id: 'a', blocks: [block({ id: 'b_c' })] }),
  ]);
  assert.equal(BLOCKS[14].tiles.all, 'mod:a_b:c');
  assert.equal(BLOCKS[15].tiles.all, 'mod:a:b_c');
  assert.notEqual(BLOCKS[14].tiles.all, BLOCKS[15].tiles.all);
});

test('mod library imports disabled packs and persists toggles and removal', () => {
  const memory = new Map();
  const backend = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const library = createModLibrary(backend);
  library.import(JSON.stringify(pack()));
  assert.deepEqual(library.list(), [{ pack: pack(), enabled: false }]);
  assert.deepEqual(library.active(), []);
  assert.deepEqual(createModLibrary(backend).list(), library.list());
  library.toggle('demo');
  const reconstructed = createModLibrary(backend);
  assert.deepEqual(reconstructed.active(), [pack()]);
  reconstructed.toggle('demo');
  assert.deepEqual(createModLibrary(backend).active(), []);
  reconstructed.import(JSON.stringify(pack({ id: 'other' })));
  reconstructed.remove('demo');
  assert.deepEqual(reconstructed.list().map(entry => entry.pack.id), ['other']);
  assert.deepEqual(createModLibrary(backend).list(), reconstructed.list());
});

test('duplicate mod imports are rejected without changing entries or persisted data', () => {
  const memory = new Map();
  let writes = 0;
  const backend = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { writes++; memory.set(key, value); } };
  const library = createModLibrary(backend);
  library.import(JSON.stringify(pack()));
  library.toggle('demo');
  const before = structuredClone(library.list());
  const stored = [...memory];
  const previousWrites = writes;
  assert.throws(() => library.import(JSON.stringify(pack({ name: 'Replacement' }))));
  assert.deepEqual(library.list(), before);
  assert.deepEqual([...memory], stored);
  assert.equal(writes, previousWrites);
});

test('storage write failures leave mod library imports, toggles and removal unchanged', () => {
  const memory = new Map();
  let failWrites = false;
  const backend = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error('Storage quota exceeded');
      memory.set(key, value);
    },
  };
  const library = createModLibrary(backend);
  library.import(JSON.stringify(pack()));
  library.toggle('demo');
  const before = structuredClone(library.list());
  const stored = [...memory];
  failWrites = true;
  for (const change of [
    () => library.import(JSON.stringify(pack({ id: 'other' }))),
    () => library.toggle('demo'),
    () => library.remove('demo'),
  ]) {
    assert.throws(change, /Storage quota exceeded/);
    assert.deepEqual(library.list(), before);
    assert.deepEqual(library.active(), [pack()]);
    assert.deepEqual([...memory], stored);
    assert.deepEqual(createModLibrary(backend).list(), before);
  }
});

test('world saves preserve pack snapshots and mod edits after library changes', () => {
  const memory = new Map();
  const backend = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const storage = createStorage(backend);
  const original = pack({ blocks: [block(), block({ id: 'mist', name: 'Sis', solid: false })] });
  const meta = storage.createWorld({ name: 'Mod World', seed: 77, packs: [original] });
  original.blocks[0].name = 'Changed library';
  configurePacks([]);
  const initial = storage.loadWorld(meta.id);
  assert.equal(initial.packs[0].blocks[0].name, 'Yakut');
  assert.equal(BLOCKS[14].name, 'Yakut');
  const world = new World({ seed: meta.seed, scene: new Scene(), edits: initial.edits });
  world.setBlock(-1, 30, 2, 14);
  world.setBlock(17, 31, -2, 15);
  const edits = world.serializeEdits();
  const hotbar = [14, 15, ...DEFAULT_HOTBAR.slice(2)];
  storage.saveWorld(meta.id, { edits, hotbar, player: null, slot: 1 });
  configurePacks([pack({ id: 'replacement', blocks: [block({ name: 'Wrong Block' })] })]);
  const loaded = storage.loadWorld(meta.id);
  assert.deepEqual(loaded.packs, initial.packs);
  assert.deepEqual(loaded.edits, edits);
  assert.deepEqual(loaded.hotbar, hotbar);
  assert.equal(loaded.slot, 1);
  assert.equal(BLOCKS[14].name, 'Yakut');
  assert.equal(isSolid(15), false);
  const restored = new World({ seed: meta.seed, scene: new Scene(), edits: loaded.edits });
  restored.generate(-1, 0);
  restored.generate(1, -1);
  assert.equal(restored.getBlock(-1, 30, 2), 14);
  assert.equal(restored.getBlock(17, 31, -2), 15);
  assert.deepEqual(restored.serializeEdits(), edits);
  world.dispose();
  restored.dispose();
});

test('invalid saved pack snapshots or unknown block IDs fail without rewriting the save', () => {
  const memory = new Map();
  const storage = createStorage({ getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) });
  const meta = storage.createWorld({ name: 'Protected World', seed: 77, packs: [pack()] });
  const key = `webcraft:world:${meta.id}`;
  const valid = JSON.parse(memory.get(key));
  for (const data of [
    { ...valid, packs: [pack({ blocks: [block({ texture: 'script' })] })] },
    { ...valid, edits: [1, 30, 2, 15] },
    { ...valid, edits: [1, 30, 2, -1] },
  ]) {
    const raw = JSON.stringify(data);
    memory.set(key, raw);
    assert.throws(() => storage.loadWorld(meta.id));
    assert.equal(memory.get(key), raw);
  }
});
