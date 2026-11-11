import { BLOCKS, PLACEABLE_BLOCKS } from './blocks.js';

export const MAX_PACK_BYTES = 128 * 1024;
const builtins = BLOCKS.slice();
const identifier = /^[a-z][a-z0-9_-]{0,31}$/;
const fail = message => { throw new Error(message); };
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(`${label}: desteklenmeyen alan veya geçersiz nesne.`);
}
function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 48 || /[<>&"'`\u0000-\u001f\u007f]/.test(value)) fail('Ad 1–48 güvenli karakter içermeli.');
  return value.trim();
}
export function validatePack(input) {
  object(input, ['format', 'id', 'name', 'blocks'], 'Paket');
  if (input.format !== 1 || !identifier.test(input.id) || typeof input.id !== 'string') fail('Paket biçimi 1 olmalı; kimlik küçük harfle başlamalı (en çok 32 karakter).');
  if (!Array.isArray(input.blocks) || input.blocks.length < 1 || input.blocks.length > 32) fail('Paket 1–32 blok içermeli.');
  const ids = new Set();
  const blocks = input.blocks.map(block => {
    object(block, ['id', 'name', 'color', 'texture', 'solid', 'hardness'], 'Blok');
    if (typeof block.id !== 'string' || !identifier.test(block.id) || ids.has(block.id)) fail('Blok kimliği geçersiz veya yineleniyor.');
    ids.add(block.id);
    if (typeof block.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(block.color)) fail('Renk #RRGGBB biçiminde olmalı.');
    if (!['solid', 'noise', 'brick'].includes(block.texture)) fail('Doku solid, noise veya brick olmalı.');
    if (typeof block.solid !== 'boolean' || !Number.isFinite(block.hardness) || block.hardness < 0.1 || block.hardness > 10) fail('solid doğru/yanlış, hardness 0.1–10 olmalı.');
    return { id: block.id, name: name(block.name), color: block.color, texture: block.texture, solid: block.solid, hardness: block.hardness };
  });
  return { format: 1, id: input.id, name: name(input.name), blocks };
}
export function parsePack(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_PACK_BYTES) fail('Mod dosyası en çok 128 KiB olabilir.');
  let input;
  try { input = JSON.parse(text); } catch { fail('Geçerli bir JSON dosyası seçin. JavaScript ve Forge/Fabric JAR desteklenmez.'); }
  return validatePack(input);
}
export function validatePacks(input) {
  if (!Array.isArray(input) || input.length > 16) fail('En çok 16 mod paketi kullanılabilir.');
  const packs = input.map(validatePack);
  if (new Set(packs.map(pack => pack.id)).size !== packs.length || packs.reduce((sum, pack) => sum + pack.blocks.length, 0) > 128) fail('Paket kimlikleri benzersiz olmalı; toplam en çok 128 blok olabilir.');
  return packs;
}
export function configurePacks(input) {
  const packs = validatePacks(input);
  BLOCKS.splice(0, BLOCKS.length, ...builtins);
  for (const pack of packs) for (const block of pack.blocks) {
    BLOCKS.push({ ...block, tiles: { all: `mod:${pack.id}:${block.id}` }, opaque: true, pass: 'opaque', targetable: true, placeable: true, mod: true });
  }
  PLACEABLE_BLOCKS.splice(0, PLACEABLE_BLOCKS.length, ...BLOCKS.flatMap((block, id) => block.placeable ? [id] : []));
  return BLOCKS;
}
