import * as THREE from 'three';
import { BLOCK } from '../shared/blocks.js';
import { CHUNK_SIZE, WORLD_HEIGHT, chunkIndex, createGenerator } from '../shared/world-gen.js';
import { PADDED_VOLUME, meshPaddedChunk, paddedIndex } from './mesher.js';

const chunkKey = (cx, cz) => `${cx},${cz}`;

export class World {
  constructor({ seed, edits = [], scene, atlas, materials, renderDistance = 6 }) {
    this.seed = seed;
    this.generator = createGenerator(seed);
    this.atlas = atlas;
    this.materials = materials;
    this.renderDistance = renderDistance;
    this.chunks = new Map();
    this.edits = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);
    this.padded = new Uint8Array(PADDED_VOLUME);
    for (let i = 0; i + 3 < edits.length; i += 4) this.recordEdit(edits[i], edits[i + 1], edits[i + 2], edits[i + 3]);
    this.lastCenter = null;
    this.pending = true;
  }

  getBlock(x, y, z) {
    if (y < 0) return BLOCK.BEDROCK;
    if (y >= WORLD_HEIGHT) return BLOCK.AIR;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return chunk ? chunk.data[chunkIndex(x & 15, y, z & 15)] : null;
  }

  isChunkReady(x, z) {
    return Boolean(this.chunks.get(chunkKey(Math.floor(x) >> 4, Math.floor(z) >> 4))?.meshed);
  }

  recordEdit(x, y, z, id) {
    const key = chunkKey(x >> 4, z >> 4);
    let chunkEdits = this.edits.get(key);
    if (!chunkEdits) {
      chunkEdits = new Map();
      this.edits.set(key, chunkEdits);
    }
    chunkEdits.set(chunkIndex(x & 15, y, z & 15), id);
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    this.recordEdit(x, y, z, id);
    const cx = x >> 4;
    const cz = z >> 4;
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (chunk) chunk.data[chunkIndex(x & 15, y, z & 15)] = id;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const neighbor = this.chunks.get(chunkKey(cx + dx, cz + dz));
        if (!neighbor) continue;
        const lx = x - neighbor.cx * CHUNK_SIZE;
        const lz = z - neighbor.cz * CHUNK_SIZE;
        if (lx >= -1 && lx <= CHUNK_SIZE && lz >= -1 && lz <= CHUNK_SIZE) {
          neighbor.dirty = true;
          neighbor.urgent = true;
        }
      }
    }
    this.pending = true;
    return true;
  }

  serializeEdits() {
    const flat = [];
    for (const [key, chunkEdits] of this.edits) {
      const [cx, cz] = key.split(',').map(Number);
      for (const [index, id] of chunkEdits) flat.push(cx * CHUNK_SIZE + (index & 15), index >> 8, cz * CHUNK_SIZE + ((index >> 4) & 15), id);
    }
    return flat;
  }

  generate(cx, cz) {
    const data = this.generator.generateChunk(cx, cz);
    const chunkEdits = this.edits.get(chunkKey(cx, cz));
    if (chunkEdits) for (const [index, id] of chunkEdits) data[index] = id;
    const chunk = { cx, cz, data, dirty: true, urgent: false, meshed: false, meshes: [] };
    this.chunks.set(chunkKey(cx, cz), chunk);
    return chunk;
  }

  neighborsLoaded(chunk) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(chunkKey(chunk.cx + dx, chunk.cz + dz))) return false;
    return true;
  }

  fillPadded(chunk) {
    const padded = this.padded;
    for (let z = -1; z <= CHUNK_SIZE; z++) {
      for (let x = -1; x <= CHUNK_SIZE; x++) {
        const wx = chunk.cx * CHUNK_SIZE + x;
        const wz = chunk.cz * CHUNK_SIZE + z;
        const source = this.chunks.get(chunkKey(wx >> 4, wz >> 4)).data;
        const column = (wx & 15) + ((wz & 15) << 4);
        padded[paddedIndex(x, -1, z)] = BLOCK.BEDROCK;
        padded[paddedIndex(x, WORLD_HEIGHT, z)] = BLOCK.AIR;
        for (let y = 0; y < WORLD_HEIGHT; y++) padded[paddedIndex(x, y, z)] = source[column + (y << 8)];
      }
    }
  }

  disposeMeshes(chunk) {
    for (const mesh of chunk.meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    chunk.meshes = [];
  }

  buildMesh(chunk) {
    this.fillPadded(chunk);
    const passes = meshPaddedChunk(this.padded, this.atlas.tiles);
    this.disposeMeshes(chunk);
    for (const [pass, buffers] of Object.entries(passes)) {
      if (!buffers.indices.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
      geometry.setIndex(buffers.indices);
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.materials[pass]);
      mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (pass === 'water') mesh.renderOrder = 2;
      this.group.add(mesh);
      chunk.meshes.push(mesh);
    }
    chunk.dirty = false;
    chunk.urgent = false;
    chunk.meshed = true;
  }

  update(x, z, budgetMs = 8) {
    const centerX = Math.floor(x) >> 4;
    const centerZ = Math.floor(z) >> 4;
    const centerKey = chunkKey(centerX, centerZ);
    if (centerKey !== this.lastCenter) {
      this.lastCenter = centerKey;
      this.pending = true;
      for (const [key, chunk] of this.chunks) {
        if (Math.max(Math.abs(chunk.cx - centerX), Math.abs(chunk.cz - centerZ)) > this.renderDistance + 2) {
          this.disposeMeshes(chunk);
          this.chunks.delete(key);
        }
      }
    }
    for (const chunk of this.chunks.values()) if (chunk.urgent && this.neighborsLoaded(chunk)) this.buildMesh(chunk);
    if (!this.pending) return;

    const start = performance.now();
    const radius = this.renderDistance;
    const wanted = [];
    for (let dz = -radius - 1; dz <= radius + 1; dz++) {
      for (let dx = -radius - 1; dx <= radius + 1; dx++) wanted.push([dx * dx + dz * dz, centerX + dx, centerZ + dz]);
    }
    wanted.sort((a, b) => a[0] - b[0]);
    let remaining = false;
    for (const [distanceSq, cx, cz] of wanted) {
      if (performance.now() - start > budgetMs) {
        remaining = true;
        break;
      }
      const inMeshRange = distanceSq <= (radius + 0.5) ** 2;
      if (!inMeshRange && distanceSq > (radius + 1.5) ** 2) continue;
      let chunk = this.chunks.get(chunkKey(cx, cz));
      if (!chunk) {
        chunk = this.generate(cx, cz);
        remaining = true;
      }
      if (!inMeshRange || !chunk.dirty) continue;
      if (!this.neighborsLoaded(chunk)) {
        remaining = true;
        continue;
      }
      this.buildMesh(chunk);
    }
    this.pending = remaining;
  }

  dispose() {
    for (const chunk of this.chunks.values()) this.disposeMeshes(chunk);
    this.chunks.clear();
    this.group.removeFromParent();
  }
}
