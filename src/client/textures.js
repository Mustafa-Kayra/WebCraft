import * as THREE from 'three';
import { BLOCKS, tileFor } from '../shared/blocks.js';
import { mulberry32 } from '../shared/noise.js';

const TILE = 16;
const COLUMNS = 8;

const rgb = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const scale = (color, amount) => color.map(channel => Math.max(0, Math.min(255, Math.round(channel * amount))));

function painter(seed) {
  const pixels = new Uint8ClampedArray(TILE * TILE * 4);
  const random = mulberry32(seed);
  const set = (x, y, color, alpha = 255) => {
    const index = (((y + TILE) % TILE) * TILE + ((x + TILE) % TILE)) * 4;
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
    pixels[index + 3] = alpha;
  };
  const fill = (base, spread) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) set(x, y, scale(base, 1 + (random() - 0.5) * spread));
  };
  return { pixels, random, set, fill };
}

function speckle(p, base, count, amount) {
  for (let i = 0; i < count; i++) p.set(Math.floor(p.random() * TILE), Math.floor(p.random() * TILE), scale(base, amount));
}

const PAINTERS = {
  dirt(p) {
    const base = rgb(0x8a5d3b);
    p.fill(base, 0.22);
    speckle(p, base, 26, 0.7);
    speckle(p, base, 10, 1.25);
  },
  grass_top(p) {
    const base = rgb(0x67a845);
    p.fill(base, 0.26);
    speckle(p, base, 30, 0.82);
    speckle(p, base, 18, 1.18);
  },
  grass_side(p) {
    PAINTERS.dirt(p);
    const green = rgb(0x67a845);
    for (let x = 0; x < TILE; x++) {
      const depth = 3 + Math.floor(p.random() * 3) + (x % 3 === 0 ? 1 : 0);
      for (let y = 0; y < depth; y++) p.set(x, y, scale(green, 0.85 + p.random() * 0.3 - (y === depth - 1 ? 0.18 : 0)));
    }
  },
  stone(p) {
    const base = rgb(0x8b9096);
    p.fill(base, 0.12);
    for (let i = 0; i < 9; i++) {
      let x = Math.floor(p.random() * TILE);
      let y = Math.floor(p.random() * TILE);
      const shade = p.random() < 0.5 ? 0.82 : 1.12;
      for (let step = 0; step < 4; step++) {
        p.set(x, y, scale(base, shade));
        x += Math.floor(p.random() * 3) - 1;
        y += p.random() < 0.6 ? 0 : 1;
      }
    }
  },
  cobble(p) {
    const base = rgb(0x7f8389);
    const seeds = Array.from({ length: 8 }, () => [p.random() * TILE, p.random() * TILE, 0.85 + p.random() * 0.35]);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        let best = Infinity;
        let second = Infinity;
        let tone = 1;
        for (const [sx, sy, shade] of seeds) {
          const ddx = Math.min(Math.abs(x - sx), TILE - Math.abs(x - sx));
          const ddy = Math.min(Math.abs(y - sy), TILE - Math.abs(y - sy));
          const distance = Math.hypot(ddx, ddy);
          if (distance < best) {
            second = best;
            best = distance;
            tone = shade;
          } else if (distance < second) second = distance;
        }
        const edge = second - best < 1.1;
        p.set(x, y, scale(base, edge ? 0.55 : tone + (p.random() - 0.5) * 0.12 - best * 0.025));
      }
    }
  },
  sand(p) {
    const base = rgb(0xdccf98);
    p.fill(base, 0.1);
    speckle(p, base, 22, 0.88);
    speckle(p, base, 10, 1.08);
  },
  log_side(p) {
    const base = rgb(0xd8d2c0);
    p.fill(base, 0.08);
    for (let x = 0; x < TILE; x++) {
      if (p.random() < 0.3) for (let y = 0; y < TILE; y++) if (p.random() < 0.7) p.set(x, y, scale(base, 0.9));
    }
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(p.random() * (TILE - 3));
      const y = Math.floor(p.random() * TILE);
      const width = 2 + Math.floor(p.random() * 3);
      for (let dx = 0; dx < width; dx++) p.set(x + dx, y, scale(rgb(0x3a3430), 0.9 + p.random() * 0.3));
    }
  },
  log_top(p) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const distance = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (distance > 6.6) p.set(x, y, scale(rgb(0xd8d2c0), 0.9 + p.random() * 0.15));
        else p.set(x, y, scale(rgb(0xc4a173), Math.floor(distance) % 2 ? 0.86 : 1.02 + p.random() * 0.05));
      }
    }
  },
  leaves(p) {
    const base = rgb(0x3f7f34);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (p.random() < 0.2) p.set(x, y, [0, 0, 0], 0);
        else p.set(x, y, scale(base, 0.75 + p.random() * 0.5));
      }
    }
  },
  planks(p) {
    const base = rgb(0xb88a52);
    for (let board = 0; board < 4; board++) {
      const tone = 0.92 + p.random() * 0.14;
      const seam = Math.floor(p.random() * TILE);
      for (let row = 0; row < 4; row++) {
        const y = board * 4 + row;
        for (let x = 0; x < TILE; x++) {
          let shade = tone + (p.random() - 0.5) * 0.08;
          if (row === 3) shade *= 0.62;
          else if (x === seam) shade *= 0.7;
          else if (p.random() < 0.08) shade *= 0.88;
          p.set(x, y, scale(base, shade));
        }
      }
    }
  },
  glass(p) {
    const frame = rgb(0xd7eef5);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) p.set(x, y, [0, 0, 0], 0);
    for (let i = 0; i < TILE; i++) {
      p.set(i, 0, frame);
      p.set(i, TILE - 1, scale(frame, 0.82));
      p.set(0, i, frame);
      p.set(TILE - 1, i, scale(frame, 0.82));
    }
    for (let i = 0; i < 4; i++) p.set(3 + i, 6 - i, [255, 255, 255]);
    p.set(10, 11, [255, 255, 255]);
    p.set(11, 10, [255, 255, 255]);
  },
  brick(p) {
    const mortar = rgb(0xc9c1b4);
    const brick = rgb(0xa4503b);
    for (let y = 0; y < TILE; y++) {
      const row = Math.floor(y / 4);
      const offset = row % 2 ? 4 : 0;
      for (let x = 0; x < TILE; x++) {
        const isMortar = y % 4 === 3 || (x + offset) % 8 === 7;
        p.set(x, y, isMortar ? scale(mortar, 0.9 + p.random() * 0.15) : scale(brick, 0.85 + p.random() * 0.25));
      }
    }
  },
  water(p) {
    const base = rgb(0x2f6fd0);
    p.fill(base, 0.08);
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(p.random() * TILE);
      const y = Math.floor(p.random() * TILE);
      for (let dx = 0; dx < 3; dx++) p.set(x + dx, y, scale(base, 1.25));
    }
  },
  snow(p) {
    const base = rgb(0xf1f6fb);
    p.fill(base, 0.04);
    speckle(p, base, 14, 0.94);
  },
  snow_side(p) {
    PAINTERS.dirt(p);
    const white = rgb(0xf1f6fb);
    for (let x = 0; x < TILE; x++) {
      const depth = 3 + Math.floor(p.random() * 2) + (x % 4 === 1 ? 1 : 0);
      for (let y = 0; y < depth; y++) p.set(x, y, scale(white, 0.95 + p.random() * 0.05));
    }
  },
  bedrock(p) {
    const base = rgb(0x4b4d52);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) p.set(x, y, scale(base, [0.45, 0.8, 1.15, 1.45][Math.floor(p.random() * 4)]));
  },
};

export const TILE_NAMES = Object.keys(PAINTERS);

export function createAtlas() {
  const rows = Math.ceil(TILE_NAMES.length / COLUMNS);
  const canvas = document.createElement('canvas');
  canvas.width = COLUMNS * TILE;
  canvas.height = rows * TILE;
  const context = canvas.getContext('2d');
  const tiles = new Map();
  TILE_NAMES.forEach((name, index) => {
    const p = painter(index * 7919 + 17);
    PAINTERS[name](p);
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    context.putImageData(new ImageData(p.pixels, TILE, TILE), column * TILE, row * TILE);
    const inset = 0.01 / COLUMNS;
    tiles.set(name, {
      column,
      row,
      u0: column / COLUMNS + inset,
      u1: (column + 1) / COLUMNS - inset,
      v0: 1 - (row + 1) / rows + inset,
      v1: 1 - row / rows - inset,
    });
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture, tiles };
}

export function createCrackTextures() {
  const random = mulberry32(4242);
  const strokes = [];
  for (let i = 0; i < 70; i++) {
    let x = 8 + Math.floor((random() - 0.5) * 4);
    let y = 8 + Math.floor((random() - 0.5) * 4);
    const path = [];
    const angle = random() * Math.PI * 2;
    for (let step = 0; step < 6; step++) {
      path.push([x, y]);
      x += Math.round(Math.cos(angle) + (random() - 0.5));
      y += Math.round(Math.sin(angle) + (random() - 0.5));
    }
    strokes.push(path);
  }
  return Array.from({ length: 8 }, (_, stage) => {
    const canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(20, 16, 14, 0.72)';
    for (const path of strokes.slice(0, Math.round(((stage + 1) / 8) * strokes.length * 0.5))) {
      for (const [x, y] of path) context.fillRect(((x % TILE) + TILE) % TILE, ((y % TILE) + TILE) % TILE, 1, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    return texture;
  });
}

export function renderBlockIcon(atlas, id, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  const edge = size * 0.52;
  const w = edge * Math.cos(Math.PI / 6);
  const q = edge / 2;
  const cx = size / 2;
  const y0 = (size - (2 * q + edge)) / 2;
  const faceImage = (face, darkness) => {
    const tile = atlas.tiles.get(tileFor(id, face));
    const temp = document.createElement('canvas');
    temp.width = TILE;
    temp.height = TILE;
    const tempContext = temp.getContext('2d');
    tempContext.drawImage(atlas.canvas, tile.column * TILE, tile.row * TILE, TILE, TILE, 0, 0, TILE, TILE);
    if (darkness) {
      tempContext.globalCompositeOperation = 'source-atop';
      tempContext.fillStyle = `rgba(0, 0, 0, ${darkness})`;
      tempContext.fillRect(0, 0, TILE, TILE);
    }
    return temp;
  };
  const draw = (image, a, b, c, d, e, f) => {
    context.setTransform(a, b, c, d, e, f);
    context.drawImage(image, 0, 0);
  };
  draw(faceImage('side', 0.25), w / TILE, q / TILE, 0, edge / TILE, cx - w, y0 + q);
  draw(faceImage('side', 0.45), w / TILE, -q / TILE, 0, edge / TILE, cx, y0 + 2 * q);
  draw(faceImage('top', 0), w / TILE, -q / TILE, w / TILE, q / TILE, cx - w, y0 + q);
  context.setTransform(1, 0, 0, 1, 0, 0);
  return canvas.toDataURL();
}

export function blockName(id) {
  return BLOCKS[id]?.name ?? 'Unknown';
}
