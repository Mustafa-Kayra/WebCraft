import { BLOCK } from './blocks.js';
import { createNoise2D, fbm, hash2 } from './noise.js';

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 80;
export const SEA_LEVEL = 24;
export const chunkIndex = (x, y, z) => x + (z << 4) + (y << 8);

const TREE_CELL = 5;

export function createGenerator(seed) {
  const continental = createNoise2D(seed ^ 0x9e3779b9);
  const hills = createNoise2D(seed ^ 0x85ebca6b);
  const ridges = createNoise2D(seed ^ 0xc2b2ae35);
  const forest = createNoise2D(seed ^ 0x27d4eb2f);

  function heightAt(x, z) {
    const c = fbm(continental, x / 240, z / 240, 3);
    const h = fbm(hills, x / 64, z / 64, 4);
    const ridge = 1 - Math.abs(ridges(x / 130, z / 130));
    const mountain = Math.max(0, c - 0.12) / 0.88;
    const height = SEA_LEVEL + 3 + c * 11 + h * 6 + mountain * mountain * ridge * ridge * 34;
    return Math.max(4, Math.min(WORLD_HEIGHT - 12, Math.floor(height)));
  }

  function surfaceAt(height) {
    if (height <= SEA_LEVEL + 1) return BLOCK.SAND;
    if (height >= 54) return BLOCK.SNOW;
    if (height >= 47) return BLOCK.STONE;
    return BLOCK.GRASS;
  }

  function treeInCell(cellX, cellZ) {
    const x = cellX * TREE_CELL + Math.floor(hash2(seed, cellX, cellZ) * TREE_CELL);
    const z = cellZ * TREE_CELL + Math.floor(hash2(seed + 1, cellX, cellZ) * TREE_CELL);
    const density = 0.06 + Math.max(0, forest(x / 110, z / 110)) * 0.9;
    if (hash2(seed + 2, cellX, cellZ) >= density) return null;
    const ground = heightAt(x, z);
    if (surfaceAt(ground) !== BLOCK.GRASS) return null;
    return { x, z, ground, trunk: 4 + Math.floor(hash2(seed + 3, x, z) * 3) };
  }

  function generateChunk(cx, cz) {
    const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        const height = heightAt(wx, wz);
        const surface = surfaceAt(height);
        data[chunkIndex(lx, 0, lz)] = BLOCK.BEDROCK;
        if (hash2(seed + 9, wx, wz) < 0.5) data[chunkIndex(lx, 1, lz)] = BLOCK.BEDROCK;
        for (let y = 1; y <= height; y++) {
          const index = chunkIndex(lx, y, lz);
          if (data[index]) continue;
          const depth = height - y;
          let block = BLOCK.STONE;
          if (surface === BLOCK.SAND && depth < 4) block = BLOCK.SAND;
          else if (surface === BLOCK.GRASS) block = depth === 0 ? BLOCK.GRASS : depth < 4 ? BLOCK.DIRT : BLOCK.STONE;
          else if (surface === BLOCK.SNOW && depth === 0) block = BLOCK.SNOW;
          data[index] = block;
        }
        for (let y = height + 1; y <= SEA_LEVEL; y++) data[chunkIndex(lx, y, lz)] = BLOCK.WATER;
      }
    }

    const put = (x, y, z, block, onlyAir) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
      const index = chunkIndex(lx, y, lz);
      if (onlyAir && data[index] !== BLOCK.AIR) return;
      data[index] = block;
    };
    const firstCellX = Math.floor((x0 - 2) / TREE_CELL);
    const lastCellX = Math.floor((x0 + CHUNK_SIZE + 2) / TREE_CELL);
    const firstCellZ = Math.floor((z0 - 2) / TREE_CELL);
    const lastCellZ = Math.floor((z0 + CHUNK_SIZE + 2) / TREE_CELL);
    for (let cellZ = firstCellZ; cellZ <= lastCellZ; cellZ++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const tree = treeInCell(cellX, cellZ);
        if (!tree) continue;
        const top = tree.ground + tree.trunk;
        for (let y = top - 2; y <= top + 1; y++) {
          const radius = y < top ? 2 : 1;
          for (let dz = -radius; dz <= radius; dz++) {
            for (let dx = -radius; dx <= radius; dx++) {
              const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
              if (corner && (y === top + 1 || hash2(seed + y, tree.x + dx, tree.z + dz) < 0.55)) continue;
              put(tree.x + dx, y, tree.z + dz, BLOCK.LEAVES, true);
            }
          }
        }
        for (let y = tree.ground + 1; y <= top; y++) put(tree.x, y, tree.z, BLOCK.LOG, false);
      }
    }
    return data;
  }

  function spawnPoint() {
    for (let radius = 0; radius < 400; radius += 4) {
      for (let step = 0; step < Math.max(1, radius * 2); step++) {
        const angle = (step / Math.max(1, radius * 2)) * Math.PI * 2;
        const x = Math.round(Math.cos(angle) * radius);
        const z = Math.round(Math.sin(angle) * radius);
        const height = heightAt(x, z);
        if (surfaceAt(height) !== BLOCK.GRASS) continue;
        const data = generateChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
        const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        if (data[chunkIndex(lx, height + 1, lz)] !== BLOCK.AIR) continue;
        return { x: x + 0.5, y: height + 1, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: heightAt(0, 0) + 2, z: 0.5 };
  }

  return { seed, heightAt, generateChunk, spawnPoint };
}
