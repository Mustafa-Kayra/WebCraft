import * as THREE from 'three';

function nameHash(name) {
  let h = 2166136261;
  for (const char of name) h = Math.imul(h ^ char.codePointAt(0), 16777619);
  return h >>> 0;
}

function faceTexture(skin, eyes) {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext('2d');
  context.fillStyle = skin;
  context.fillRect(0, 0, 8, 8);
  context.fillStyle = '#3b2a20';
  context.fillRect(0, 0, 8, 2);
  context.fillStyle = '#ffffff';
  context.fillRect(1, 3, 2, 1);
  context.fillRect(5, 3, 2, 1);
  context.fillStyle = eyes;
  context.fillRect(2, 3, 1, 1);
  context.fillRect(5, 3, 1, 1);
  context.fillStyle = 'rgba(0,0,0,0.35)';
  context.fillRect(3, 6, 2, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function nameTag(name) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = '28px "Pixelify Sans", monospace';
  const width = Math.ceil(context.measureText(name).width) + 24;
  canvas.width = width;
  canvas.height = 44;
  context.font = '28px "Pixelify Sans", monospace';
  context.fillStyle = 'rgba(0, 0, 0, 0.45)';
  context.fillRect(0, 0, width, 44);
  context.fillStyle = '#ffffff';
  context.textBaseline = 'middle';
  context.fillText(name, 12, 23);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
  sprite.scale.set((width / 44) * 0.26, 0.26, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function box(width, height, depth, material, offsetY) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.y = offsetY;
  return mesh;
}

export class Avatar {
  constructor(id, name, state) {
    this.id = id;
    this.name = name;
    const hash = nameHash(name);
    const shirt = new THREE.Color().setHSL((hash % 360) / 360, 0.55, 0.5);
    const skinTone = ['#f1c7a5', '#d9a47c', '#a8714d', '#6f4a33'][hash % 4];
    const skin = new THREE.MeshBasicMaterial({ color: skinTone });
    const shirtMaterial = new THREE.MeshBasicMaterial({ color: shirt });
    const pants = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(((hash >> 9) % 360) / 360, 0.35, 0.28) });
    const face = new THREE.MeshBasicMaterial({ map: faceTexture(skinTone, ['#2e5fa8', '#3c7a3a', '#5a3b22'][hash % 3]) });
    const hair = new THREE.MeshBasicMaterial({ color: 0x3b2a20 });

    this.group = new THREE.Group();
    this.legs = [-0.125, 0.125].map(x => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.75, 0);
      pivot.add(box(0.25, 0.75, 0.25, pants, -0.375));
      this.group.add(pivot);
      return pivot;
    });
    this.group.add(box(0.5, 0.75, 0.25, shirtMaterial, 1.125));
    this.arms = [-0.375, 0.375].map(x => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.45, 0);
      pivot.add(box(0.24, 0.75, 0.24, shirtMaterial, -0.3));
      this.group.add(pivot);
      return pivot;
    });
    this.head = new THREE.Group();
    this.head.position.y = 1.5;
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), [skin, skin, hair, skin, hair, face]);
    headMesh.position.y = 0.25;
    this.head.add(headMesh);
    this.group.add(this.head);
    this.group.scale.setScalar(0.9);
    this.tag = nameTag(name);
    this.tag.position.y = 2.25;
    this.group.add(this.tag);

    this.target = new THREE.Vector3(state.x, state.y, state.z);
    this.group.position.copy(this.target);
    this.yaw = state.yaw ?? 0;
    this.pitch = state.pitch ?? 0;
    this.walk = 0;
  }

  setState(state) {
    this.target.set(state.x, state.y, state.z);
    this.yaw = state.yaw;
    this.pitch = state.pitch;
  }

  update(dt) {
    const before = this.group.position.clone();
    this.group.position.lerp(this.target, 1 - Math.exp(-dt * 14));
    const speed = Math.hypot(this.group.position.x - before.x, this.group.position.z - before.z) / Math.max(dt, 1e-3);
    let delta = this.yaw - this.group.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.group.rotation.y += delta * (1 - Math.exp(-dt * 14));
    this.head.rotation.x = this.pitch * 0.8;
    this.walk += dt * Math.min(speed, 6) * 2.2;
    const swing = Math.sin(this.walk) * Math.min(1, speed / 3) * 0.8;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing;
    this.arms[1].rotation.x = swing;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(object => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of materials) {
        material.map?.dispose();
        material.dispose();
      }
    });
  }
}
