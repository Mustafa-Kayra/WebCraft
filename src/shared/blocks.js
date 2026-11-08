export const BLOCK = Object.freeze({
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  LOG: 5,
  LEAVES: 6,
  PLANKS: 7,
  COBBLE: 8,
  GLASS: 9,
  BRICK: 10,
  WATER: 11,
  SNOW: 12,
  BEDROCK: 13,
});

const solidBlock = (name, tiles, hardness, extra = {}) => ({
  name, tiles, hardness, solid: true, opaque: true, pass: 'opaque', placeable: true, targetable: true, ...extra,
});

export const BLOCKS = [];
BLOCKS[BLOCK.AIR] = { name: 'Air', solid: false, opaque: false, pass: null, placeable: false, targetable: false, hardness: 0 };
BLOCKS[BLOCK.GRASS] = solidBlock('Meadow Turf', { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, 0.45);
BLOCKS[BLOCK.DIRT] = solidBlock('Loam', { all: 'dirt' }, 0.45);
BLOCKS[BLOCK.STONE] = solidBlock('Slate', { all: 'stone' }, 1.0);
BLOCKS[BLOCK.SAND] = solidBlock('Dune Sand', { all: 'sand' }, 0.4);
BLOCKS[BLOCK.LOG] = solidBlock('Birchwood Log', { top: 'log_top', side: 'log_side', bottom: 'log_top' }, 0.9);
BLOCKS[BLOCK.LEAVES] = solidBlock('Canopy Leaves', { all: 'leaves' }, 0.2, { opaque: false, pass: 'cutout' });
BLOCKS[BLOCK.PLANKS] = solidBlock('Timber Planks', { all: 'planks' }, 0.8);
BLOCKS[BLOCK.COBBLE] = solidBlock('Fieldstone', { all: 'cobble' }, 1.1);
BLOCKS[BLOCK.GLASS] = solidBlock('Clear Pane', { all: 'glass' }, 0.3, { opaque: false, pass: 'cutout' });
BLOCKS[BLOCK.BRICK] = solidBlock('Kiln Brick', { all: 'brick' }, 1.2);
BLOCKS[BLOCK.WATER] = { name: 'Water', tiles: { all: 'water' }, solid: false, opaque: false, pass: 'water', placeable: false, targetable: false, liquid: true, hardness: 0 };
BLOCKS[BLOCK.SNOW] = solidBlock('Packed Snow', { top: 'snow', side: 'snow_side', bottom: 'dirt' }, 0.3);
BLOCKS[BLOCK.BEDROCK] = solidBlock('Deepstone', { all: 'bedrock' }, Infinity, { placeable: false });

export const PLACEABLE_BLOCKS = BLOCKS.flatMap((block, id) => (block.placeable ? [id] : []));
export const DEFAULT_HOTBAR = [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.PLANKS, BLOCK.LOG, BLOCK.GLASS, BLOCK.BRICK, BLOCK.SAND];

export const isPlaceable = id => Boolean(BLOCKS[id]?.placeable);
export const isSolid = id => Boolean(BLOCKS[id]?.solid);
export const isOpaque = id => Boolean(BLOCKS[id]?.opaque);

export function tileFor(id, face) {
  const tiles = BLOCKS[id].tiles;
  if (tiles.all) return tiles.all;
  if (face === 'top') return tiles.top;
  if (face === 'bottom') return tiles.bottom;
  return tiles.side;
}
