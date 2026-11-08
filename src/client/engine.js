import * as THREE from 'three';
import { BLOCKS } from '../shared/blocks.js';
import { mulberry32 } from '../shared/noise.js';
import { meshSingleBlock } from './mesher.js';
import { createAtlas, createCrackTextures } from './textures.js';

const SKY = new THREE.Color(0x9cc9f2);
const WATER_FOG = new THREE.Color(0x1f4f8f);

function bufferGeometry(buffers) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.setIndex(buffers.indices);
  return geometry;
}

function createCloudTexture() {
  const size = 64;
  const random = mulberry32(99);
  let cells = Array.from({ length: size * size }, () => random());
  for (let pass = 0; pass < 3; pass++) {
    const next = new Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += cells[((y + dy + size) % size) * size + ((x + dx + size) % size)];
      next[y * size + x] = sum / 9;
    }
    cells = next;
  }
  const data = new Uint8Array(size * size * 4);
  cells.forEach((value, index) => {
    data.set([255, 255, 255, value > 0.53 ? 255 : 0], index * 4);
  });
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.scene.background = SKY.clone();
    this.scene.fog = new THREE.Fog(SKY.clone(), 40, 90);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.atlas = createAtlas();
    this.materials = {
      opaque: new THREE.MeshBasicMaterial({ map: this.atlas.texture, vertexColors: true }),
      cutout: new THREE.MeshBasicMaterial({ map: this.atlas.texture, vertexColors: true, alphaTest: 0.5 }),
      water: new THREE.MeshBasicMaterial({ map: this.atlas.texture, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }),
    };
    this.crackTextures = createCrackTextures();
    this.fogDistance = 90;

    const sun = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }));
    sun.userData.offset = new THREE.Vector3(-0.45, 0.62, -0.64).normalize().multiplyScalar(420);
    this.sun = sun;
    this.scene.add(sun);

    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { map: { value: createCloudTexture() }, offset: { value: new THREE.Vector2() } },
        vertexShader: 'varying vec2 vLocal; void main() { vLocal = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D map; uniform vec2 offset; varying vec2 vLocal; void main() { float a = texture2D(map, (vLocal + offset) / 768.0).a; a *= smoothstep(450.0, 220.0, length(vLocal)); if (a < 0.02) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, a * 0.82); }',
      }),
    );
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.renderOrder = 3;
    this.scene.add(this.clouds);

    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x101010, transparent: true, opacity: 0.55 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.006, 1.006, 1.006),
      new THREE.MeshBasicMaterial({ map: this.crackTextures[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    this.crack.visible = false;
    this.scene.add(this.crack);

    this.particleMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffffff }), 160);
    this.particleMesh.count = 0;
    this.particleMesh.frustumCulled = false;
    this.particles = [];
    this.scene.add(this.particleMesh);

    this.handScene = new THREE.Scene();
    this.handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.hand = new THREE.Group();
    this.handScene.add(this.hand);
    this.handMesh = null;
    this.handBlock = null;
    this.swing = 0;
    this.bob = 0;

    this.tileColors = this.computeTileColors();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  computeTileColors() {
    const context = this.atlas.canvas.getContext('2d');
    const colors = new Map();
    for (const [name, tile] of this.atlas.tiles) {
      const pixels = context.getImageData(tile.column * 16, tile.row * 16, 16, 16).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 0) {
        r += pixels[i];
        g += pixels[i + 1];
        b += pixels[i + 2];
        count++;
      }
      colors.set(name, new THREE.Color(`rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`));
    }
    return colors;
  }

  resize() {
    const width = innerWidth;
    const height = innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.handCamera.aspect = width / height;
    this.handCamera.updateProjectionMatrix();
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setFogDistance(distance) {
    this.fogDistance = distance;
  }

  setHandBlock(id) {
    if (this.handBlock === id) return;
    this.handBlock = id;
    if (this.handMesh) {
      this.hand.remove(this.handMesh);
      this.handMesh.geometry.dispose();
      this.handMesh = null;
    }
    if (!id) return;
    const material = this.materials[BLOCKS[id].pass];
    this.handMesh = new THREE.Mesh(bufferGeometry(meshSingleBlock(id, this.atlas.tiles)), material);
    this.handMesh.scale.setScalar(0.42);
    this.hand.add(this.handMesh);
  }

  swingHand() {
    this.swing = 1;
  }

  updateHand(dt, moving) {
    this.swing = Math.max(0, this.swing - dt * 4);
    if (moving) this.bob += dt * 9;
    const phase = Math.sin((1 - this.swing) * Math.PI);
    const bobX = moving ? Math.sin(this.bob) * 0.025 : 0;
    const bobY = moving ? Math.abs(Math.cos(this.bob)) * 0.025 : 0;
    this.hand.position.set(0.56 + bobX - phase * 0.12, -0.52 + bobY + phase * 0.08, -0.9 - phase * 0.1);
    this.hand.rotation.set(0.12 - phase * 0.9, 0.78 + phase * 0.3, 0);
  }

  spawnBreakParticles(x, y, z, tile) {
    const color = this.tileColors.get(tile) ?? new THREE.Color(0x888888);
    for (let i = 0; i < 14; i++) {
      if (this.particles.length >= 160) this.particles.shift();
      this.particles.push({
        position: new THREE.Vector3(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3),
        life: 0.5 + Math.random() * 0.4,
        color: color.clone().multiplyScalar(0.8 + Math.random() * 0.4),
      });
    }
  }

  updateParticles(dt) {
    const matrix = new THREE.Matrix4();
    this.particles = this.particles.filter(particle => (particle.life -= dt) > 0);
    this.particles.forEach((particle, index) => {
      particle.velocity.y -= 14 * dt;
      particle.position.addScaledVector(particle.velocity, dt);
      matrix.makeScale(particle.life * 1.6, particle.life * 1.6, particle.life * 1.6).setPosition(particle.position);
      this.particleMesh.setMatrixAt(index, matrix);
      this.particleMesh.setColorAt(index, particle.color);
    });
    this.particleMesh.count = this.particles.length;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  render(time, { underwater = false, showHand = false } = {}) {
    const fog = this.scene.fog;
    if (underwater) {
      this.scene.background.copy(WATER_FOG);
      fog.color.copy(WATER_FOG);
      fog.near = 1;
      fog.far = 18;
    } else {
      this.scene.background.copy(SKY);
      fog.color.copy(SKY);
      fog.near = this.fogDistance * 0.45;
      fog.far = this.fogDistance;
    }
    const position = this.camera.position;
    this.sun.position.copy(position).add(this.sun.userData.offset);
    this.sun.lookAt(position);
    this.clouds.position.set(position.x, 108, position.z);
    this.clouds.material.uniforms.offset.value.set(position.x + time * 1.8, -position.z);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (showHand && this.handMesh) {
      this.renderer.clearDepth();
      this.renderer.render(this.handScene, this.handCamera);
    }
  }
}
