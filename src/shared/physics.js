import { BLOCK, BLOCKS } from './blocks.js';

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
export const REACH = 6;

const EPSILON = 1e-3;
const GRAVITY = 30;
const JUMP_SPEED = 8.6;

export function raycast(getBlock, origin, direction, maxDistance = REACH) {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = direction;
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const stepZ = Math.sign(dz);
  const deltaX = dx ? Math.abs(1 / dx) : Infinity;
  const deltaY = dy ? Math.abs(1 / dy) : Infinity;
  const deltaZ = dz ? Math.abs(1 / dz) : Infinity;
  let maxX = dx > 0 ? (x + 1 - ox) * deltaX : dx < 0 ? (ox - x) * deltaX : Infinity;
  let maxY = dy > 0 ? (y + 1 - oy) * deltaY : dy < 0 ? (oy - y) * deltaY : Infinity;
  let maxZ = dz > 0 ? (z + 1 - oz) * deltaZ : dz < 0 ? (oz - z) * deltaZ : Infinity;
  let normal = [0, 0, 0];
  let distance = 0;
  while (distance <= maxDistance) {
    const id = getBlock(x, y, z);
    if (id && BLOCKS[id]?.targetable) return { x, y, z, id, normal, distance };
    if (maxX < maxY && maxX < maxZ) {
      x += stepX;
      distance = maxX;
      maxX += deltaX;
      normal = [-stepX, 0, 0];
    } else if (maxY < maxZ) {
      y += stepY;
      distance = maxY;
      maxY += deltaY;
      normal = [0, -stepY, 0];
    } else {
      z += stepZ;
      distance = maxZ;
      maxZ += deltaZ;
      normal = [0, 0, -stepZ];
    }
  }
  return null;
}

export function boxIntersectsBlock(body, x, y, z) {
  const half = PLAYER_WIDTH / 2;
  return body.x + half > x && body.x - half < x + 1
    && body.y + PLAYER_HEIGHT > y && body.y < y + 1
    && body.z + half > z && body.z - half < z + 1;
}

function sweepAxis(body, axis, delta, isSolidAt) {
  if (!delta) return false;
  const half = PLAYER_WIDTH / 2;
  const min = [body.x - half, body.y, body.z - half];
  const max = [body.x + half, body.y + PLAYER_HEIGHT, body.z + half];
  min[axis] += delta;
  max[axis] += delta;
  let limit = delta > 0 ? Infinity : -Infinity;
  for (let x = Math.floor(min[0] + EPSILON); x <= Math.floor(max[0] - EPSILON); x++) {
    for (let y = Math.floor(min[1] + EPSILON); y <= Math.floor(max[1] - EPSILON); y++) {
      for (let z = Math.floor(min[2] + EPSILON); z <= Math.floor(max[2] - EPSILON); z++) {
        if (!isSolidAt(x, y, z)) continue;
        const edge = [x, y, z][axis];
        limit = delta > 0 ? Math.min(limit, edge) : Math.max(limit, edge + 1);
      }
    }
  }
  const key = ['x', 'y', 'z'][axis];
  if (!Number.isFinite(limit)) {
    body[key] += delta;
    return false;
  }
  const extentBelow = axis === 1 ? 0 : half;
  const extentAbove = axis === 1 ? PLAYER_HEIGHT : half;
  const target = delta > 0 ? limit - extentAbove - EPSILON : limit + extentBelow + EPSILON;
  if ((delta > 0 && target > body[key]) || (delta < 0 && target < body[key])) body[key] = target;
  return true;
}

export function moveBody(body, dt, isSolidAt) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(body.vx), Math.abs(body.vy), Math.abs(body.vz)) * dt / 0.35));
  const stepDt = dt / steps;
  body.onGround = false;
  for (let i = 0; i < steps; i++) {
    if (sweepAxis(body, 1, body.vy * stepDt, isSolidAt)) {
      if (body.vy < 0) body.onGround = true;
      body.vy = 0;
    }
    if (sweepAxis(body, 0, body.vx * stepDt, isSolidAt)) body.vx = 0;
    if (sweepAxis(body, 2, body.vz * stepDt, isSolidAt)) body.vz = 0;
  }
}

export function stepPlayer(body, input, dt, getBlock) {
  const isSolidAt = (x, y, z) => {
    const id = getBlock(x, y, z);
    return id === null || id === undefined || Boolean(BLOCKS[id]?.solid);
  };
  const feet = getBlock(Math.floor(body.x), Math.floor(body.y + 0.1), Math.floor(body.z));
  const chest = getBlock(Math.floor(body.x), Math.floor(body.y + 1.1), Math.floor(body.z));
  body.inWater = feet === BLOCK.WATER || chest === BLOCK.WATER;

  const speed = body.flying ? (input.sprint ? 22 : 11) : body.inWater ? 2.6 : input.sprint ? 5.8 : 4.3;
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  let wishX = -sin * input.forward + cos * input.strafe;
  let wishZ = -cos * input.forward - sin * input.strafe;
  const length = Math.hypot(wishX, wishZ);
  if (length > 1) {
    wishX /= length;
    wishZ /= length;
  }
  const control = body.flying || body.onGround ? 14 : body.inWater ? 6 : 3.5;
  const blend = 1 - Math.exp(-control * dt);
  body.vx += (wishX * speed - body.vx) * blend;
  body.vz += (wishZ * speed - body.vz) * blend;

  if (body.flying) {
    const vertical = (Number(input.jump) - Number(input.descend)) * speed * 0.8;
    body.vy += (vertical - body.vy) * (1 - Math.exp(-10 * dt));
  } else if (body.inWater) {
    body.vy -= 9 * dt;
    if (input.jump) body.vy += 22 * dt;
    body.vy *= Math.exp(-2.2 * dt);
    body.vy = Math.max(-3.5, Math.min(3.8, body.vy));
  } else {
    body.vy = Math.max(-55, body.vy - GRAVITY * dt);
    if (input.jump && body.onGround) body.vy = JUMP_SPEED;
  }
  moveBody(body, dt, isSolidAt);
  if (body.flying && body.onGround) body.flying = false;
  return body;
}
