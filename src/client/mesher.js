import { BLOCK, BLOCKS, tileFor } from '../shared/blocks.js';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../shared/world-gen.js';

export const FACES = [
  { dir: [-1, 0, 0], face: 'side', shade: 0.72, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], face: 'side', shade: 0.72, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], face: 'bottom', shade: 0.42, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], face: 'top', shade: 1, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], face: 'side', shade: 0.58, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], face: 'side', shade: 0.58, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];

const AO_LEVELS = [0.42, 0.62, 0.8, 1];
const PADDED = CHUNK_SIZE + 2;
const LAYER = PADDED * PADDED;
export const paddedIndex = (x, y, z) => (x + 1) + (z + 1) * PADDED + (y + 1) * LAYER;
export const PADDED_VOLUME = LAYER * (WORLD_HEIGHT + 2);

function createBuffers() {
  return { positions: [], uvs: [], colors: [], indices: [] };
}

function faceVisible(id, neighbor) {
  const block = BLOCKS[id];
  const other = BLOCKS[neighbor];
  if (other.opaque) return false;
  if (block.pass === 'water') return neighbor !== BLOCK.WATER;
  if (id === BLOCK.GLASS) return neighbor !== BLOCK.GLASS;
  return true;
}

export function meshPaddedChunk(padded, tiles) {
  const passes = { opaque: createBuffers(), cutout: createBuffers(), water: createBuffers() };
  const opaqueAt = (x, y, z) => (BLOCKS[padded[paddedIndex(x, y, z)]].opaque ? 1 : 0);
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = padded[paddedIndex(x, y, z)];
        if (id === BLOCK.AIR) continue;
        const block = BLOCKS[id];
        const buffers = passes[block.pass];
        const isWater = block.pass === 'water';
        const waterTop = isWater && padded[paddedIndex(x, y + 1, z)] !== BLOCK.WATER ? 0.875 : 1;
        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const neighbor = padded[paddedIndex(x + dx, y + dy, z + dz)];
          if (!faceVisible(id, neighbor)) continue;
          const tile = tiles.get(tileFor(id, face.face));
          const base = buffers.positions.length / 3;
          const ao = [];
          for (const [px, py, pz, u, v] of face.corners) {
            let light = face.shade;
            if (!isWater) {
              const nx = x + dx;
              const ny = y + dy;
              const nz = z + dz;
              const sx = dx === 0 ? (px ? 1 : -1) : 0;
              const sy = dy === 0 ? (py ? 1 : -1) : 0;
              const sz = dz === 0 ? (pz ? 1 : -1) : 0;
              let side1;
              let side2;
              if (dx !== 0) {
                side1 = opaqueAt(nx, ny + sy, nz);
                side2 = opaqueAt(nx, ny, nz + sz);
              } else if (dy !== 0) {
                side1 = opaqueAt(nx + sx, ny, nz);
                side2 = opaqueAt(nx, ny, nz + sz);
              } else {
                side1 = opaqueAt(nx + sx, ny, nz);
                side2 = opaqueAt(nx, ny + sy, nz);
              }
              const corner = opaqueAt(nx + sx, ny + sy, nz + sz);
              const level = side1 && side2 ? 0 : 3 - (side1 + side2 + corner);
              ao.push(level);
              light *= AO_LEVELS[level];
            }
            buffers.positions.push(x + px, y + (py ? waterTop : 0), z + pz);
            buffers.uvs.push(u ? tile.u1 : tile.u0, v ? tile.v1 : tile.v0);
            buffers.colors.push(light, light, light);
          }
          if (ao.length && ao[0] + ao[3] > ao[1] + ao[2]) buffers.indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
          else buffers.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        }
      }
    }
  }
  return passes;
}

export function meshSingleBlock(id, tiles) {
  const buffers = createBuffers();
  for (const face of FACES) {
    const tile = tiles.get(tileFor(id, face.face));
    const base = buffers.positions.length / 3;
    for (const [px, py, pz, u, v] of face.corners) {
      buffers.positions.push(px - 0.5, py - 0.5, pz - 0.5);
      buffers.uvs.push(u ? tile.u1 : tile.u0, v ? tile.v1 : tile.v0);
      buffers.colors.push(face.shade, face.shade, face.shade);
    }
    buffers.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  return buffers;
}
