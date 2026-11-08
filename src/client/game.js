import { BLOCK, BLOCKS, PLACEABLE_BLOCKS, tileFor } from '../shared/blocks.js';
import { EYE_HEIGHT, REACH, boxIntersectsBlock, raycast, stepPlayer } from '../shared/physics.js';
import { WORLD_HEIGHT } from '../shared/world-gen.js';
import { Avatar } from './avatars.js';
import { playSound } from './sfx.js';
import { renderBlockIcon } from './textures.js';
import { World } from './world.js';

const $ = selector => document.querySelector(selector);
const FACING = ['north (-Z)', 'west (-X)', 'south (+Z)', 'east (+X)'];

export class Game {
  constructor({ engine, settings, mode, seed, edits, player, hotbar, slot, net, selfId, players, worldName, onSave }) {
    this.engine = engine;
    this.settings = settings;
    this.mode = mode;
    this.net = net;
    this.selfId = selfId;
    this.worldName = worldName;
    this.onSave = onSave;
    this.world = new World({ seed, edits, scene: engine.scene, atlas: engine.atlas, materials: engine.materials, renderDistance: settings.renderDistance });
    this.getBlock = (x, y, z) => this.world.getBlock(x, y, z);
    const spawn = player ?? this.world.generator.spawnPoint();
    this.body = { x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, onGround: false, flying: Boolean(player?.flying), inWater: false };
    this.yaw = player?.yaw ?? 0;
    this.pitch = player?.pitch ?? 0;
    this.hotbar = [...hotbar];
    this.slot = slot;
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.mining = null;
    this.breakCooldown = 0;
    this.placeTimer = 0;
    this.target = null;
    this.ready = false;
    this.active = false;
    this.pointerFallback = false;
    this.everLocked = false;
    this.overlay = null;
    this.saveTimer = 0;
    this.netTimer = 0;
    this.lastSent = '';
    this.lastSpace = 0;
    this.stepDistance = 0;
    this.fps = 0;
    this.frames = 0;
    this.fpsTimer = 0;
    this.avatars = new Map();
    this.icons = new Map(PLACEABLE_BLOCKS.map(id => [id, renderBlockIcon(engine.atlas, id)]));
    for (const other of players ?? []) this.addAvatar(other);

    this.handlers = {
      keydown: event => this.onKeyDown(event),
      keyup: event => this.keys.delete(event.code),
      mousedown: event => this.onMouseDown(event),
      mouseup: event => this.onMouseUp(event),
      mousemove: event => this.onMouseMove(event),
      wheel: event => this.onWheel(event),
      contextmenu: event => event.preventDefault(),
      pointerlockchange: () => this.onPointerLockChange(),
      pointerlockerror: () => this.onPointerLockError(),
      blur: () => this.releaseInput(),
      beforeunload: () => this.save(),
      visibilitychange: () => document.hidden && this.save(),
    };
    for (const type of ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'contextmenu', 'pointerlockchange', 'pointerlockerror', 'visibilitychange']) document.addEventListener(type, this.handlers[type]);
    document.addEventListener('wheel', this.handlers.wheel, { passive: false });
    for (const type of ['blur', 'beforeunload']) addEventListener(type, this.handlers[type]);

    if (net) this.bindNetwork();
    this.buildHud();
    engine.setFov(settings.fov);
    engine.setFogDistance(settings.renderDistance * 16);
    $('#hud').hidden = false;
    $('#players-online').hidden = !net;
    this.updatePlayerCount();
  }

  buildHud() {
    $('#hotbar').innerHTML = this.hotbar.map((id, index) => `<div class="slot" data-slot="${index}"><img alt="" src="${this.icons.get(id)}"><span>${index + 1}</span></div>`).join('');
    this.selectSlot(this.slot, false);
    $('#inventory-grid').innerHTML = PLACEABLE_BLOCKS.map(id => `<button class="inventory-item" data-block="${id}" title="${BLOCKS[id].name}"><img alt="" src="${this.icons.get(id)}"><span>${BLOCKS[id].name}</span></button>`).join('');
    $('#inventory-grid').onclick = event => {
      const button = event.target.closest('[data-block]');
      if (!button) return;
      this.hotbar[this.slot] = Number(button.dataset.block);
      this.buildHud();
    };
    $('#hotbar').onclick = event => {
      const slot = event.target.closest('[data-slot]');
      if (slot) this.selectSlot(Number(slot.dataset.slot));
    };
  }

  selectSlot(index, announce = true) {
    this.slot = (index + 9) % 9;
    document.querySelectorAll('#hotbar .slot').forEach((element, slot) => element.classList.toggle('selected', slot === this.slot));
    this.engine.setHandBlock(this.hotbar[this.slot]);
    if (!announce) return;
    const label = $('#block-name');
    label.textContent = BLOCKS[this.hotbar[this.slot]].name;
    label.classList.remove('show');
    void label.offsetWidth;
    label.classList.add('show');
  }

  bindNetwork() {
    this.net.on('join', ({ player }) => {
      this.addAvatar(player);
      this.chat(`${player.name} joined the room`, 'system');
      this.updatePlayerCount();
    });
    this.net.on('leave', ({ id }) => {
      const avatar = this.avatars.get(id);
      if (!avatar) return;
      this.chat(`${avatar.name} left the room`, 'system');
      avatar.dispose();
      this.avatars.delete(id);
      this.updatePlayerCount();
    });
    this.net.on('move', message => this.avatars.get(message.id)?.setState(message));
    this.net.on('set', ({ x, y, z, id }) => this.world.setBlock(x, y, z, id));
    this.net.on('chat', ({ name, text }) => this.chat(text, name));
    this.net.on('error', ({ message }) => this.chat(message, 'system'));
    this.net.on('disconnect', reason => {
      this.releaseInput();
      if (document.pointerLockElement) document.exitPointerLock();
      this.setOverlay('disconnected');
      $('#disconnect-reason').textContent = reason;
    });
  }

  addAvatar(state) {
    if (state.id === this.selfId || this.avatars.has(state.id)) return;
    const avatar = new Avatar(state.id, state.name, state);
    this.engine.scene.add(avatar.group);
    this.avatars.set(state.id, avatar);
  }

  updatePlayerCount() {
    if (!this.net) return;
    $('#players-online').textContent = `${this.avatars.size + 1} online · room ${this.worldName}`;
    $('#player-list').innerHTML = [`<li>${escapeHtml(this.net.name)} (you)</li>`, ...[...this.avatars.values()].map(avatar => `<li>${escapeHtml(avatar.name)}</li>`)].join('');
  }

  chat(text, from) {
    const line = document.createElement('div');
    line.className = from === 'system' ? 'line system' : 'line';
    line.textContent = from === 'system' ? text : `<${from}> ${text}`;
    const log = $('#chat-log');
    log.append(line);
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    setTimeout(() => line.classList.add('faded'), 9000);
  }

  setOverlay(name) {
    this.overlay = name;
    $('#pause').hidden = name !== 'pause';
    $('#inventory').hidden = name !== 'inventory';
    $('#disconnected').hidden = name !== 'disconnected';
    $('#chat').classList.toggle('open', name === 'chat');
    $('#chat-input').hidden = name !== 'chat';
    $('#click-to-play').hidden = Boolean(name) || this.active || !this.ready;
    if (name === 'chat') {
      $('#chat-input').value = '';
      $('#chat-input').focus();
    }
  }

  requestPlay() {
    if (!this.ready || this.overlay === 'disconnected') return;
    this.setOverlay(null);
    if (this.pointerFallback) {
      this.active = true;
      $('#click-to-play').hidden = true;
      return;
    }
    try {
      const request = this.engine.canvas.requestPointerLock();
      request?.catch?.(() => this.onPointerLockError());
    } catch {
      this.onPointerLockError();
    }
  }

  onPointerLockChange() {
    const locked = document.pointerLockElement === this.engine.canvas;
    this.active = locked;
    if (locked) {
      this.everLocked = true;
      this.setOverlay(null);
      return;
    }
    this.releaseInput();
    if (!this.overlay) {
      this.setOverlay('pause');
      this.save();
    }
  }

  onPointerLockError() {
    if (this.everLocked) {
      this.active = false;
      this.setOverlay(null);
      return;
    }
    this.pointerFallback = true;
    this.active = true;
    this.setOverlay(null);
  }

  pauseFromFallback() {
    this.active = false;
    this.releaseInput();
    this.setOverlay('pause');
    this.save();
  }

  releaseInput() {
    this.keys.clear();
    this.mouse.left = false;
    this.mouse.right = false;
    this.mining = null;
  }

  onKeyDown(event) {
    if (this.overlay === 'chat') {
      if (event.code === 'Enter') {
        const text = $('#chat-input').value.trim();
        if (text) this.net?.send({ type: 'chat', text });
        this.setOverlay(null);
        this.requestPlay();
      } else if (event.code === 'Escape') {
        this.setOverlay(null);
        this.requestPlay();
      }
      return;
    }
    if (this.overlay === 'inventory') {
      if (event.code === 'KeyE' || event.code === 'Escape') {
        event.preventDefault();
        this.setOverlay(null);
        this.requestPlay();
      }
      return;
    }
    if (event.code === 'F3') {
      event.preventDefault();
      $('#debug').hidden = !$('#debug').hidden;
      return;
    }
    if (!this.active) return;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(event.code)) event.preventDefault();
    if (event.repeat) return;
    this.keys.add(event.code);
    if (event.code.startsWith('Digit') && event.code !== 'Digit0') this.selectSlot(Number(event.code.slice(5)) - 1);
    else if (event.code === 'KeyF') this.toggleFlight();
    else if (event.code === 'Space') {
      const now = performance.now();
      if (now - this.lastSpace < 280) this.toggleFlight();
      this.lastSpace = now;
    } else if (event.code === 'KeyE') this.openPanel('inventory');
    else if (this.net && (event.code === 'KeyT' || event.code === 'Enter')) {
      event.preventDefault();
      this.openPanel('chat');
    } else if (event.code === 'Escape') {
      if (this.pointerFallback) this.pauseFromFallback();
      else document.exitPointerLock();
    }
  }

  openPanel(name) {
    this.releaseInput();
    this.overlay = name;
    this.active = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.setOverlay(name);
  }

  toggleFlight() {
    this.body.flying = !this.body.flying;
    this.body.vy = 0;
  }

  onMouseDown(event) {
    if (!this.active) {
      if (event.target === this.engine.canvas) this.requestPlay();
      return;
    }
    if (event.button === 0) {
      this.mouse.left = true;
      this.engine.swingHand();
    } else if (event.button === 2) {
      this.mouse.right = true;
      this.placeTimer = 0.3;
      if (this.target) this.placeBlock(this.target);
    } else if (event.button === 1) {
      event.preventDefault();
      if (this.target && BLOCKS[this.target.id].placeable) {
        const existing = this.hotbar.indexOf(this.target.id);
        if (existing >= 0) this.selectSlot(existing);
        else {
          this.hotbar[this.slot] = this.target.id;
          this.buildHud();
          this.selectSlot(this.slot);
        }
      }
    }
  }

  onMouseUp(event) {
    if (event.button === 0) this.mouse.left = false;
    if (event.button === 2) this.mouse.right = false;
  }

  onMouseMove(event) {
    if (!this.active) return;
    const sensitivity = 0.0022 * this.settings.sensitivity;
    this.yaw -= event.movementX * sensitivity;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch - event.movementY * sensitivity));
  }

  onWheel(event) {
    if (!this.active) return;
    event.preventDefault();
    this.selectSlot(this.slot + Math.sign(event.deltaY));
  }

  eye() {
    return [this.body.x, this.body.y + EYE_HEIGHT, this.body.z];
  }

  lookDirection() {
    const cos = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cos, Math.sin(this.pitch), -Math.cos(this.yaw) * cos];
  }

  breakBlock(hit) {
    this.world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
    this.engine.spawnBreakParticles(hit.x, hit.y, hit.z, tileFor(hit.id, 'side'));
    this.net?.send({ type: 'set', x: hit.x, y: hit.y, z: hit.z, id: BLOCK.AIR });
    playSound('break');
  }

  placeBlock(hit) {
    const x = hit.x + hit.normal[0];
    const y = hit.y + hit.normal[1];
    const z = hit.z + hit.normal[2];
    const existing = this.world.getBlock(x, y, z);
    if (y < 1 || y >= WORLD_HEIGHT || (existing !== BLOCK.AIR && existing !== BLOCK.WATER)) return false;
    if (boxIntersectsBlock(this.body, x, y, z)) return false;
    const id = this.hotbar[this.slot];
    this.world.setBlock(x, y, z, id);
    this.net?.send({ type: 'set', x, y, z, id });
    this.engine.swingHand();
    playSound('place');
    return true;
  }

  updateInteraction(dt) {
    const hit = this.active ? raycast(this.getBlock, this.eye(), this.lookDirection(), REACH) : null;
    this.target = hit;
    const { highlight, crack } = this.engine;
    highlight.visible = Boolean(hit);
    if (hit) highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.breakCooldown = Math.max(0, this.breakCooldown - dt);

    if (this.mouse.left && hit && this.breakCooldown === 0) {
      if (!this.mining || this.mining.x !== hit.x || this.mining.y !== hit.y || this.mining.z !== hit.z) this.mining = { x: hit.x, y: hit.y, z: hit.z, progress: 0 };
      const hardness = BLOCKS[hit.id].hardness;
      if (Number.isFinite(hardness)) this.mining.progress += dt / hardness;
      if (Math.random() < dt * 6) this.engine.swingHand();
      if (this.mining.progress >= 1) {
        this.breakBlock(hit);
        this.mining = null;
        this.breakCooldown = 0.15;
      }
    } else if (!this.mouse.left) this.mining = null;

    crack.visible = Boolean(this.mining && this.mining.progress > 0);
    if (crack.visible) {
      crack.position.set(this.mining.x + 0.5, this.mining.y + 0.5, this.mining.z + 0.5);
      crack.material.map = this.engine.crackTextures[Math.min(7, Math.floor(this.mining.progress * 8))];
    }

    if (this.mouse.right) {
      this.placeTimer -= dt;
      if (this.placeTimer <= 0) {
        if (hit) this.placeBlock(hit);
        this.placeTimer = 0.22;
      }
    }
  }

  frame(dt, time) {
    this.world.update(this.body.x, this.body.z);
    if (!this.ready) {
      if (this.world.isChunkReady(this.body.x, this.body.z)) this.becomeReady();
      else {
        this.updateCamera();
        return { loading: true };
      }
    }
    const input = this.active ? {
      forward: Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')),
      strafe: Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')),
      jump: this.keys.has('Space'),
      descend: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      sprint: this.keys.has('ControlLeft') || (!this.body.flying && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'))),
      yaw: this.yaw,
    } : { forward: 0, strafe: 0, jump: false, descend: false, sprint: false, yaw: this.yaw };
    const beforeX = this.body.x;
    const beforeZ = this.body.z;
    stepPlayer(this.body, input, dt, this.getBlock);
    if (this.body.y < -20) Object.assign(this.body, this.world.generator.spawnPoint(), { vx: 0, vy: 0, vz: 0 });
    const moved = Math.hypot(this.body.x - beforeX, this.body.z - beforeZ);
    if (this.body.onGround && moved > 0) {
      this.stepDistance += moved;
      if (this.stepDistance > 1.9) {
        this.stepDistance = 0;
        playSound('step', 0.35);
      }
    }
    this.updateCamera();
    this.updateInteraction(dt);
    this.engine.updateHand(dt, this.body.onGround && moved > dt * 0.5);
    this.engine.updateParticles(dt);
    for (const avatar of this.avatars.values()) avatar.update(dt);
    this.updateNetwork(dt);
    this.updateDebug(dt);
    if (this.mode === 'single') {
      this.saveTimer += dt;
      if (this.saveTimer > 10) this.save();
    }
    const eye = this.eye();
    return { underwater: this.world.getBlock(Math.floor(eye[0]), Math.floor(eye[1]), Math.floor(eye[2])) === BLOCK.WATER, showHand: true, time };
  }

  becomeReady() {
    this.ready = true;
    for (let i = 0; i < WORLD_HEIGHT && boxBlocked(this); i++) this.body.y += 1;
    $('#click-to-play').hidden = Boolean(this.overlay);
    this.onReady?.();
  }

  updateCamera() {
    const camera = this.engine.camera;
    camera.position.set(this.body.x, this.body.y + EYE_HEIGHT, this.body.z);
    camera.rotation.set(this.pitch, this.yaw, 0);
  }

  updateNetwork(dt) {
    if (!this.net) return;
    this.netTimer += dt;
    if (this.netTimer < 1 / 12) return;
    this.netTimer = 0;
    const state = [this.body.x, this.body.y, this.body.z, this.yaw, this.pitch].map(value => Math.round(value * 100) / 100);
    const signature = state.join(',');
    if (signature === this.lastSent) return;
    this.lastSent = signature;
    this.net.send({ type: 'move', x: state[0], y: state[1], z: state[2], yaw: state[3], pitch: state[4] });
  }

  updateDebug(dt) {
    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }
    if ($('#debug').hidden) return;
    const facing = FACING[((Math.round(this.yaw / (Math.PI / 2)) % 4) + 4) % 4];
    const target = this.target ? `${this.target.x}, ${this.target.y}, ${this.target.z} (${BLOCKS[this.target.id].name})` : 'none';
    $('#debug').textContent = [
      `WebCraft · ${this.fps} fps`,
      `XYZ ${this.body.x.toFixed(2)} / ${this.body.y.toFixed(2)} / ${this.body.z.toFixed(2)}`,
      `Chunk ${Math.floor(this.body.x) >> 4}, ${Math.floor(this.body.z) >> 4} · loaded ${this.world.chunks.size}`,
      `Facing ${facing}`,
      `Target ${target}`,
      `${this.body.flying ? 'Flying' : this.body.inWater ? 'Swimming' : this.body.onGround ? 'On ground' : 'Airborne'}`,
      `Seed ${this.world.seed} · ${this.mode === 'single' ? 'singleplayer' : `room ${this.worldName}`}`,
    ].join('\n');
  }

  save() {
    if (this.mode !== 'single' || !this.ready) return;
    this.saveTimer = 0;
    try {
      this.onSave({
        edits: this.world.serializeEdits(),
        hotbar: this.hotbar,
        slot: this.slot,
        player: { x: this.body.x, y: this.body.y, z: this.body.z, yaw: this.yaw, pitch: this.pitch, flying: this.body.flying },
      });
    } catch (error) {
      this.chat(`Could not save: ${error.message}`, 'system');
    }
  }

  dispose() {
    this.save();
    for (const type of ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'contextmenu', 'pointerlockchange', 'pointerlockerror', 'visibilitychange', 'wheel']) document.removeEventListener(type, this.handlers[type]);
    for (const type of ['blur', 'beforeunload']) removeEventListener(type, this.handlers[type]);
    if (document.pointerLockElement) document.exitPointerLock();
    this.net?.close();
    for (const avatar of this.avatars.values()) avatar.dispose();
    this.avatars.clear();
    this.world.dispose();
    this.engine.highlight.visible = false;
    this.engine.crack.visible = false;
    this.engine.setHandBlock(null);
    this.engine.particles = [];
    this.engine.updateParticles(0);
    $('#hud').hidden = true;
    $('#chat-log').innerHTML = '';
    for (const id of ['#pause', '#inventory', '#disconnected']) $(id).hidden = true;
  }
}

function boxBlocked(game) {
  const { body } = game;
  for (let y = Math.floor(body.y); y <= Math.floor(body.y + 1.79); y++) {
    for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
      if (BLOCKS[game.world.getBlock(Math.floor(body.x + dx), y, Math.floor(body.z + dz))]?.solid) return true;
    }
  }
  return false;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}
