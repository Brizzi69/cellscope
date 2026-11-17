import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { projectByHand } from './experiments.js';
import { loadManifest, loadF32, loadU8, loadJSON } from './data.js';
import vertexShader from './shaders/points.vert.glsl?raw';
import fragmentShader from './shaders/points.frag.glsl?raw';
import pickVert from './shaders/pick.vert.glsl?raw';
import pickFrag from './shaders/pick.frag.glsl?raw';

// ---- renderer, scene, camera ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101114);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0, 3);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  updatePointScale();
  if (pickTarget) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    pickTarget.setSize(size.x, size.y);
  }
});

window.cs = { THREE, renderer, scene, camera, controls, projectByHand };

// ---- CONTENT START ----
const hex = (h) => new THREE.Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
const PALETTE = [0x4e79a7, 0xf28e2b, 0xe15759, 0x76b7b2, 0x59a14f, 0xedc948,
                 0xb07aa1, 0xff9da7, 0x9c755f, 0xbab0ac, 0x1b9e77, 0x7570b3].map(hex);

const uniforms = {
  uWorldSize: { value: 0.03 },
  uPxPerUnit: { value: 1.0 },
  uHighlight: { value: -1.0 },
  uPalette:   { value: PALETTE },
};

function updatePointScale() {
  const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  uniforms.uPxPerUnit.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}
window.addEventListener('resize', updatePointScale);
updatePointScale();

const sizeSlider = document.getElementById('sizeSlider');
if (sizeSlider) sizeSlider.addEventListener('input', () => {
  uniforms.uWorldSize.value = parseFloat(sizeSlider.value);
});

// C: tooltip helpers
const tooltip = document.getElementById('tooltip');

function describeCell(i) {
  const label = manifest.obs.cluster.categories[clusterCodes[i]];
  const ms = (markers.markers || markers)[label] || [];
  const top = ms.slice(0, 3).map(m => m.gene).join(', ') || '—';
  return `cell ${i}<br>cluster ${label}<br>top genes: ${top}`;
}

function showTooltip(i, x, y) {
  if (i < 0) { tooltip.style.display = 'none'; uniforms.uHighlight.value = -1; return; }
  tooltip.innerHTML = describeCell(i);
  tooltip.style.left = x + 14 + 'px';
  tooltip.style.top  = y + 14 + 'px';
  tooltip.style.display = 'block';
  uniforms.uHighlight.value = clusterCodes[i];
}

// C2: GPU colour-picking
let pickTarget = null, pickMaterial = null;
const pixel = new Uint8Array(4);
let pointerClient = null;

function setupPicking() {
  const count = points.geometry.attributes.position.count;
  const idx = new Float32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  points.geometry.setAttribute('aIndex', new THREE.BufferAttribute(idx, 1));

  pickMaterial = new THREE.ShaderMaterial({
    uniforms: { uWorldSize: uniforms.uWorldSize, uPxPerUnit: uniforms.uPxPerUnit },
    vertexShader: pickVert,
    fragmentShader: pickFrag,
  });

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (pickTarget) pickTarget.dispose();
  pickTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    samples: 0,
  });
}

function pickGPU(clientX, clientY) {
  if (!pickTarget || !points) return -1;
  const savedBg    = scene.background;
  const savedClear = renderer.getClearColor(new THREE.Color());
  const savedAlpha = renderer.getClearAlpha();

  // Temporarily show points (always pick through point cloud, even in sphere mode)
  const savedPointsVis = points.visible;
  if (sphereMesh) sphereMesh.visible = false;
  points.visible = true;

  points.material = pickMaterial;
  scene.background = null;
  renderer.setClearColor(0x000000, 1);
  renderer.setRenderTarget(pickTarget);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);

  points.material = material;
  points.visible = savedPointsVis;
  if (sphereMesh) sphereMesh.visible = (variant === 'spheres');
  scene.background = savedBg;
  renderer.setClearColor(savedClear, savedAlpha);

  const dpr = renderer.getPixelRatio();
  const x = Math.round(clientX * dpr);
  const y = pickTarget.height - Math.round(clientY * dpr) - 1;
  renderer.readRenderTargetPixels(pickTarget, x, y, 1, 1, pixel);
  const id = pixel[0] + 256 * pixel[1] + 65536 * pixel[2];
  return id - 1;
}

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!points) return;
  pointerClient = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerleave', () => {
  pointerClient = null;
  showTooltip(-1, 0, 0);
});

// D3: instanced sphere variant
let sphereMesh = null;
let variant = 'points';
const ambLight = new THREE.AmbientLight(0xffffff, 0.4);
const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
dirLight.position.set(1, 1, 1);

function setupSpheres() {
  if (sphereMesh) { sphereMesh.geometry.dispose(); scene.remove(sphereMesh); sphereMesh = null; }
  const N = clusterCodes.length;
  const pos = points.geometry.attributes.position.array;
  const radius = uniforms.uWorldSize.value / 2;
  const geo = new THREE.IcosahedronGeometry(1, 1);  // ~80 triangles per sphere
  const mat = new THREE.MeshPhongMaterial({ shininess: 40 });
  sphereMesh = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(radius, radius, radius);
  for (let i = 0; i < N; i++) {
    m.compose(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), q, s);
    sphereMesh.setMatrixAt(i, m);
    const p = PALETTE[Math.min(clusterCodes[i], 11)];
    c.setRGB(p.x, p.y, p.z, THREE.SRGBColorSpace);
    sphereMesh.setColorAt(i, c);
  }
  sphereMesh.instanceMatrix.needsUpdate = true;
  if (sphereMesh.instanceColor) sphereMesh.instanceColor.needsUpdate = true;
  scene.add(sphereMesh);
}

function setVariant(v) {
  variant = v;
  const btn = document.getElementById('variantBtn');
  if (v === 'spheres') {
    if (points) points.visible = false;
    setupSpheres();
    scene.add(ambLight, dirLight);
    if (btn) btn.textContent = 'show points';
  } else {
    if (points) points.visible = true;
    if (sphereMesh) { scene.remove(sphereMesh); sphereMesh.geometry.dispose(); sphereMesh = null; }
    scene.remove(ambLight, dirLight);
    if (btn) btn.textContent = 'show spheres';
  }
}

const variantBtn = document.getElementById('variantBtn');
if (variantBtn) variantBtn.addEventListener('click', () => {
  if (!points) return;
  setVariant(variant === 'points' ? 'spheres' : 'points');
});

let points = null, material = null, manifest = null, clusterCodes = null, markers = null;

// D2: generalised loader — takes an embedding name (pca / synth_100k / synth_500k)
async function loadCells(embName = 'pca') {
  // Dispose old geometry to free GPU memory
  if (points) {
    scene.remove(points);
    points.geometry.dispose();
    points = null;
  }
  if (sphereMesh) {
    scene.remove(sphereMesh);
    sphereMesh.geometry.dispose();
    sphereMesh = null;
  }

  if (!manifest) manifest = await loadManifest();
  if (!markers)  markers  = await loadJSON('/data/' + manifest.markers);

  const emb = manifest.embeddings[embName];
  const isSynth = !!emb.synthetic;
  const nCells = emb.n_cells ?? manifest.n_cells;
  const clusterPath = isSynth ? emb.cluster_file : manifest.obs.cluster.file;

  const positions = await loadF32('/data/' + emb.file);
  clusterCodes = await loadU8('/data/' + clusterPath);

  if (positions.length !== nCells * 3) throw new Error('positions: size mismatch');
  if (clusterCodes.length !== nCells)  throw new Error('cluster codes: size mismatch');

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aCluster', new THREE.BufferAttribute(clusterCodes, 1));

  material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true });
  points = new THREE.Points(geometry, material);
  scene.add(points);  // always in scene; hidden via .visible in sphere mode

  window.cs.points = points;
  window.cs.clusterCodes = clusterCodes;
  window.cs.manifest = manifest;

  geometry.computeBoundingSphere();
  const r = geometry.boundingSphere.radius;
  const fovRad = camera.fov * Math.PI / 180;
  camera.position.set(0, 0, (r / Math.sin(fovRad / 2)) * 1.2);
  controls.update();

  const synthLabel = isSynth ? ' · SYNTHETIC' : '';
  hudInfo = `${nCells.toLocaleString()} cells · ${embName}${synthLabel} · ${manifest.obs.cluster.categories.length} clusters`;

  setupPicking();

  // Rebuild sphere mesh if currently in sphere mode
  if (variant === 'spheres') setVariant('spheres');
}

// D2: dataset selector dropdown
const embSelect = document.getElementById('embSelect');
if (embSelect) embSelect.addEventListener('change', () => {
  loadCells(embSelect.value).catch(err => { console.error(err); hud.textContent = String(err); });
});

loadCells('pca').catch((err) => { console.error(err); hud.textContent = String(err); });

function update(dt) {
  if (pickTarget && pointerClient) {
    const i = pickGPU(pointerClient.x, pointerClient.y);
    showTooltip(i, pointerClient.x, pointerClient.y);
  }
}
// ---- CONTENT END ----

// ---- HUD and render loop ----
const hud = document.getElementById('hud');
let hudInfo = '';
let frames = 0, last = performance.now(), prev = last;

function animate(now) {
  requestAnimationFrame(animate);
  update((now - prev) / 1000);
  prev = now;
  controls.update();
  renderer.render(scene, camera);

  frames++;
  if (now - last > 500) {
    const fps = Math.round(frames * 1000 / (now - last));
    // D1: renderer.info.render gives draw-call stats reset each frame
    const ri = renderer.info.render;
    hud.textContent = `${hudInfo} · ${ri.calls} calls · ${ri.points} pts · ${ri.triangles} tris · ${fps} FPS`;
    frames = 0; last = now;
  }
}
requestAnimationFrame(animate);
