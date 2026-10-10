import * as THREE from 'three';

// 程序化建模的伊卡兰（山女妖）坐骑与骑手

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 坐骑配色：玩家与每位对手各不相同
export const PALETTES = {
  player: {
    wing: ['#11506a', '#1f63b0', '#5a2fa8'], stripe: '#f2b938', belly: '#86cbd9', back: ['#1d5f8a', '#0f3d5c'],
    bands: ['#f0b43a', '#0a1f33'], crest: '#f08a24', crestEm: '#ff5a1f', glow: '#5ff6ff', glowStripe: '#2a6cff', skin: '#3d6fd8',
  },
  ralu: {
    wing: ['#5a160f', '#b8361c', '#e8861f'], stripe: '#1a0d0a', belly: '#e8b48a', back: ['#8a2a14', '#4a120a'],
    bands: ['#1a0d0a', '#f5d04a'], crest: '#ffd23a', crestEm: '#ffb000', glow: '#ffb35f', glowStripe: '#ff5a1f', skin: '#3a64c8',
  },
  seyri: {
    wing: ['#2a1450', '#6a2fa8', '#e05ab8'], stripe: '#ffd6f2', belly: '#d8b8f0', back: ['#4a2280', '#24104a'],
    bands: ['#ff7ad8', '#120826'], crest: '#5ff6ff', crestEm: '#2ad8ff', glow: '#ff6ae8', glowStripe: '#b04aff', skin: '#4a72e0',
  },
  nikxa: {
    wing: ['#1b4d2a', '#3f8a3a', '#b9c43a'], stripe: '#13261a', belly: '#cfe6a8', back: ['#2f6b35', '#173d22'],
    bands: ['#e8d24a', '#0f2414'], crest: '#e05a9a', crestEm: '#ff3d8a', glow: '#9dff6a', glowStripe: '#3aff8a', skin: '#3568c0',
  },
  toka: {
    wing: ['#4a6a7a', '#a8d8e8', '#f0f8ff'], stripe: '#1a3a5a', belly: '#f0f6f8', back: ['#8ab0c0', '#4a7080'],
    bands: ['#1a3a5a', '#5ff6ff'], crest: '#3a8aff', crestEm: '#1a5aff', glow: '#a8f0ff', glowStripe: '#5aa8ff', skin: '#4470d0',
  },
};

function rgba(hex, a) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

function wingTextures(pal) {
  const stripes = (g, w, h, color, alpha) => {
    g.fillStyle = color;
    g.globalAlpha = alpha;
    for (let i = 0; i < 7; i++) {
      const x0 = 40 + i * 66;
      const wd = 15 - i * 1.2;
      g.beginPath();
      g.moveTo(x0, h);
      for (let y = h; y >= 0; y -= 8) g.lineTo(x0 + Math.sin(y * 0.04 + i) * 10 + (h - y) * 0.12, y);
      for (let y = 0; y <= h; y += 8) g.lineTo(x0 + wd + Math.sin(y * 0.04 + i) * 10 + (h - y) * 0.12, y);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;
  };
  const map = canvasTex(512, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, pal.wing[0]);
    grad.addColorStop(0.45, pal.wing[1]);
    grad.addColorStop(1, pal.wing[2]);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const lg = g.createLinearGradient(0, h, 0, 0);
    lg.addColorStop(0, 'rgba(5,15,30,0.9)');
    lg.addColorStop(0.18, 'rgba(5,15,30,0)');
    lg.addColorStop(0.85, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(230,240,255,0.3)');
    g.fillStyle = lg;
    g.fillRect(0, 0, w, h);
    stripes(g, w, h, pal.stripe, 0.85);
    g.strokeStyle = 'rgba(8,20,40,0.5)';
    g.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      g.beginPath();
      g.moveTo(i * 45, h);
      g.quadraticCurveTo(i * 45 + 30, h * 0.5, i * 45 + 50, 0);
      g.stroke();
    }
  });
  const emissive = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    stripes(g, w, h, pal.glowStripe, 0.35);
    g.fillStyle = pal.glow;
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w, y = Math.random() * h * 0.8;
      g.beginPath();
      g.arc(x, y, 1.5 + Math.random() * 2.5, 0, Math.PI * 2);
      g.fill();
    }
    const tg = g.createLinearGradient(0, 0, 0, h * 0.12);
    tg.addColorStop(0, rgba(pal.glow, 0.9));
    tg.addColorStop(1, rgba(pal.glow, 0));
    g.fillStyle = tg;
    g.fillRect(0, 0, w, h * 0.12);
  });
  return { map, emissive };
}

function bodyTextures(pal) {
  const map = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = pal.belly;
    g.fillRect(0, 0, w / 2, h);
    const bg = g.createLinearGradient(w / 2, 0, w, 0);
    bg.addColorStop(0, pal.back[0]);
    bg.addColorStop(0.5, pal.back[1]);
    bg.addColorStop(1, pal.back[0]);
    g.fillStyle = bg;
    g.fillRect(w / 2, 0, w / 2, h);
    const blend = g.createLinearGradient(w * 0.4, 0, w * 0.6, 0);
    blend.addColorStop(0, rgba(pal.belly, 0));
    blend.addColorStop(0.5, rgba(pal.back[0], 0.6));
    blend.addColorStop(1, rgba(pal.back[0], 0));
    g.fillStyle = blend;
    g.fillRect(w * 0.4, 0, w * 0.2, h);
    for (let k = 0; k < 16; k++) {
      const y = (k + 0.5) * (h / 16);
      g.fillStyle = pal.bands[k % 2];
      g.beginPath();
      g.ellipse(w * 0.75, y, w * 0.2, 5 + (k % 3), 0, 0, Math.PI * 2);
      g.fill();
    }
  });
  const emissive = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.fillStyle = pal.glow;
    for (let k = 0; k < 40; k++) {
      g.beginPath();
      g.arc(w * (0.55 + Math.random() * 0.4), Math.random() * h, 2 + Math.random() * 2, 0, Math.PI * 2);
      g.fill();
    }
  });
  return { map, emissive };
}

function bone(a, b, r0, r1, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, len, 6);
  geo.translate(0, len / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

const SPAN = 12.2;
function wingPanel(points, xOffset, mat) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ShapeGeometry(shape);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + xOffset) / SPAN, (pos.getY(i) + 1.4) / 4.4);
  }
  geo.rotateX(Math.PI / 2); // 形状平面 (x,y) → 机翼平面 (x,0,z)，y 正方向指向尾部
  return new THREE.Mesh(geo, mat);
}

export function buildIkran(pal = PALETTES.player) {
  const root = new THREE.Group();
  const bt = bodyTextures(pal);
  const wt = wingTextures(pal);
  const bodyMat = new THREE.MeshStandardMaterial({
    map: bt.map, emissiveMap: bt.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.3,
    roughness: 0.5, metalness: 0.1,
  });
  const wingMat = new THREE.MeshStandardMaterial({
    map: wt.map, emissiveMap: wt.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.4,
    roughness: 0.6, side: THREE.DoubleSide,
  });
  const boneMat = new THREE.MeshStandardMaterial({ color: '#16344a', roughness: 0.5 });
  const crestMat = new THREE.MeshStandardMaterial({
    color: pal.crest, emissive: new THREE.Color(pal.crestEm), emissiveIntensity: 0.4, side: THREE.DoubleSide, roughness: 0.4,
  });

  // 身体
  const bodyGeo = new THREE.SphereGeometry(1, 24, 16);
  bodyGeo.rotateX(Math.PI / 2);
  bodyGeo.scale(0.95, 0.75, 3.0);
  root.add(new THREE.Mesh(bodyGeo, bodyMat));
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), bodyMat);
  chest.scale.set(0.9, 0.85, 1.3);
  chest.position.set(0, -0.15, -1.6);
  root.add(chest);

  // 颈与头
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.65, 2.4, 10), bodyMat);
  neck.rotation.x = -Math.PI / 2 + 0.25;
  neck.position.set(0, 0.3, -3.4);
  root.add(neck);

  const head = new THREE.Group();
  head.position.set(0, 0.65, -4.7);
  root.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), bodyMat);
  skull.scale.set(0.8, 0.65, 1.4);
  head.add(skull);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.3, 10), crestMat);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.02, -1.7);
  head.add(beak);
  const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.8, 8), boneMat);
  jaw.rotation.x = -Math.PI / 2 - 0.12;
  jaw.position.set(0, -0.28, -1.4);
  head.add(jaw);
  const crestShape = new THREE.Shape([
    new THREE.Vector2(-0.6, 0), new THREE.Vector2(1.7, 1.2), new THREE.Vector2(1.25, 0.35), new THREE.Vector2(0.4, 0),
  ]);
  const crestGeo = new THREE.ShapeGeometry(crestShape);
  crestGeo.rotateY(-Math.PI / 2);
  const crest = new THREE.Mesh(crestGeo, crestMat);
  crest.position.set(0, 0.3, -0.2);
  head.add(crest);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 0.4) });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), eyeMat);
    eye.position.set(s * 0.38, 0.16, -0.55);
    head.add(eye);
  }

  // 尾巴
  const tail = [];
  let parent = root;
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.1 : 0, i === 0 ? 2.6 : 1.0);
    parent.add(seg);
    const r = 0.45 * (1 - i / 8);
    const g = new THREE.CylinderGeometry(r * 0.75, r, 1.1, 8);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.55);
    seg.add(new THREE.Mesh(g, bodyMat));
    tail.push(seg);
    parent = seg;
  }
  const finShape = new THREE.Shape([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.75, 0.55), new THREE.Vector2(0, 1.5), new THREE.Vector2(-0.75, 0.55),
  ]);
  const finGeo = new THREE.ShapeGeometry(finShape);
  finGeo.rotateX(Math.PI / 2);
  const fin = new THREE.Mesh(finGeo, wingMat);
  fin.position.z = 0.9;
  parent.add(fin);

  // 收起的爪子
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.6, 6), boneMat);
    leg.rotation.x = Math.PI / 2;
    leg.position.set(s * 0.5, -0.65, 1.1);
    root.add(leg);
  }

  // 翅膀（内翼 + 外翼，各自有关节）
  const wings = [];
  const tips = [];
  const INNER = [[0, -1.1], [2.5, -1.3], [5.2, -0.9], [5.2, 1.1], [3.5, 2.3], [1.5, 2.8], [0, 2.6]];
  const OUTER = [[0, -0.9], [3.0, -0.7], [6.8, 0.6], [5.2, 1.3], [4.0, 1.0], [2.6, 1.9], [1.2, 1.6], [0, 1.1]];
  for (const side of [1, -1]) {
    const inner = new THREE.Group();
    inner.position.set(side * 0.75, 0.35, -0.6);
    inner.scale.x = side;
    root.add(inner);
    inner.add(wingPanel(INNER, 0, wingMat));
    inner.add(bone(new THREE.Vector3(0, 0, -1.1), new THREE.Vector3(5.2, 0, -0.9), 0.2, 0.13, boneMat));

    const outer = new THREE.Group();
    outer.position.set(5.2, 0, 0);
    inner.add(outer);
    outer.add(wingPanel(OUTER, 5.2, wingMat));
    const knuckle = new THREE.Vector3(0, 0, -0.9);
    outer.add(bone(knuckle, new THREE.Vector3(6.8, 0, 0.6), 0.13, 0.04, boneMat));
    outer.add(bone(knuckle, new THREE.Vector3(4.0, 0, 1.0), 0.08, 0.03, boneMat));
    outer.add(bone(knuckle, new THREE.Vector3(2.6, 0, 1.9), 0.08, 0.03, boneMat));
    const tip = new THREE.Object3D();
    tip.position.set(6.8, 0, 0.6);
    outer.add(tip);
    tips.push(tip);
    wings.push({ inner, outer, side });
  }

  // 纳美骑手
  const skin = new THREE.MeshStandardMaterial({ color: pal.skin, roughness: 0.6, emissive: '#0b2a66', emissiveIntensity: 0.3 });
  const rider = new THREE.Group();
  rider.position.set(0, 0.85, -1.5);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.7, 4, 10), skin);
  torso.rotation.x = -0.55;
  torso.position.y = 0.45;
  rider.add(torso);
  const rHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skin);
  rHead.position.set(0, 1.0, -0.35);
  rider.add(rHead);
  const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 1.1, 5), boneMat);
  hair.rotation.x = 1.0;
  hair.position.set(0, 0.85, 0.15);
  rider.add(hair);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.7, 3, 6), skin);
    leg.rotation.set(-1.2, 0, s * 0.5);
    leg.position.set(s * 0.32, 0.0, -0.1);
    rider.add(leg);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.6, 3, 6), skin);
    arm.rotation.set(-1.1, 0, s * 0.25);
    arm.position.set(s * 0.3, 0.55, -0.5);
    rider.add(arm);
  }
  root.add(rider);

  root.scale.setScalar(0.6);
  return { root, wings, tips, tail, head, bodyMat, wingMat, skin };
}
