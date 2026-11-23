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
  uWorldSize:         { value: 0.03 },
  uPxPerUnit:         { value: 1.0 },
  uHighlight:         { value: -1.0 },
  uPalette:           { value: PALETTE },
  uMode:              { value: 0 },        // 0=cluster colour, 1=gene expression
  uLUT:               { value: null },     // cividis DataTexture (loaded async)
  uUncertaintyAmount: { value: 0.0 },
  uCVD:               { value: 0 },        // 0=normal, 1=deuteranopia sim
};

// ---- State ----
let points = null, material = null, manifest = null, clusterCodes = null, markers = null;
let genesIndex = null, annotationData = null, uncertaintyBuf = null;
let currentGene = null, geneHi = 0;
let variant = 'points', sphereMesh = null, hudInfo = '';

function updatePointScale() {
  const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  uniforms.uPxPerUnit.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}
window.addEventListener('resize', updatePointScale);
updatePointScale();

// ---- Size slider ----
const sizeSlider = document.getElementById('sizeSlider');
if (sizeSlider) sizeSlider.addEventListener('input', () => {
  uniforms.uWorldSize.value = parseFloat(sizeSlider.value);
});

// ---- Tooltip ----
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

// ---- GPU colour-picking ----
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

// ---- Sphere variant ----
const ambLight = new THREE.AmbientLight(0xffffff, 0.4);
const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
dirLight.position.set(1, 1, 1);

function setupSpheres() {
  if (sphereMesh) { sphereMesh.geometry.dispose(); scene.remove(sphereMesh); sphereMesh = null; }
  const N = clusterCodes.length;
  const pos = points.geometry.attributes.position.array;
  const radius = uniforms.uWorldSize.value / 2;
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshPhongMaterial({ shininess: 40 });
  sphereMesh = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const q = new THREE.Quaternion(), s = new THREE.Vector3(radius, radius, radius);
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

// ---- Gene expression (R2) ----
async function selectGene(gene) {
  if (!points || !genesIndex) return;
  const meta = genesIndex[gene];
  if (!meta) return;
  currentGene = gene;
  geneHi = meta.hi;
  const raw = await loadU8('/data/' + meta.file);
  const aVal = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) aVal[i] = raw[i] / 255;
  points.geometry.attributes.aValue.array.set(aVal);
  points.geometry.attributes.aValue.needsUpdate = true;
  uniforms.uMode.value = 1;
  updateGeneLegend();
}

function clearGene() {
  currentGene = null;
  uniforms.uMode.value = 0;
  updateGeneLegend();
}

function updateGeneLegend() {
  const el = document.getElementById('gene-legend');
  if (!el) return;
  if (!currentGene) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  const nameEl = el.querySelector('#gene-name');
  const scaleEl = el.querySelector('#gene-scale');
  if (nameEl) nameEl.textContent = currentGene;
  if (scaleEl) scaleEl.textContent = `0 — ${geneHi.toFixed(2)} log-norm`;
  // Draw cividis gradient on canvas
  const cbar = el.querySelector('#gene-cbar');
  if (cbar && uniforms.uLUT.value) {
    const ctx = cbar.getContext('2d');
    const lut = uniforms.uLUT.value.image.data;
    const W = cbar.width;
    for (let i = 0; i < W; i++) {
      const p = Math.floor(i / W * 256) * 4;
      ctx.fillStyle = `rgb(${lut[p]},${lut[p+1]},${lut[p+2]})`;
      ctx.fillRect(i, 0, 1, cbar.height);
    }
  }
}

function setupGeneInput() {
  const input = document.getElementById('gene-input');
  const dl = document.getElementById('gene-list');
  if (!input || !dl || !genesIndex) return;
  Object.keys(genesIndex).forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    dl.appendChild(opt);
  });
  const applyGene = () => {
    const raw = input.value.trim();
    const match = Object.keys(genesIndex).find(k => k.toLowerCase() === raw.toLowerCase());
    if (match) selectGene(match).catch(console.error);
    else if (raw === '') clearGene();
  };
  input.addEventListener('change', applyGene);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); applyGene(); }
    if (e.key === 'Escape') { clearGene(); input.value = ''; }
  });
}

// ---- Uncertainty slider (R4) ----
const uncSlider = document.getElementById('uncSlider');
if (uncSlider) uncSlider.addEventListener('input', () => {
  uniforms.uUncertaintyAmount.value = parseFloat(uncSlider.value);
});

// ---- CVD toggle (R6) ----
const cvdToggle = document.getElementById('cvdToggle');
if (cvdToggle) cvdToggle.addEventListener('change', () => {
  uniforms.uCVD.value = cvdToggle.checked ? 1 : 0;
});

// ---- Cluster legend panel (R3) ----
function updateLegendPanel() {
  const panel = document.getElementById('legend');
  if (!panel || !manifest) return;
  const cats = manifest.obs.cluster.categories;
  const ann = annotationData || {};
  const sizes = manifest.cluster_sizes || {};

  panel.innerHTML = cats.map((cat, i) => {
    const p = PALETTE[i % 12];
    const r = Math.round(p.x * 255), g = Math.round(p.y * 255), b = Math.round(p.z * 255);
    const name = ann[cat] || `Cluster ${cat}`;
    const count = sizes[cat] ? Number(sizes[cat]).toLocaleString() : '';
    return `<div class="legend-row" data-cluster="${i}" tabindex="0" role="button" aria-label="${name}: ${count} cells">
      <span class="legend-swatch" style="background:rgb(${r},${g},${b})"></span>
      <span class="legend-name">${name}</span>
      <span class="legend-count">${count}</span>
    </div>`;
  }).join('');

  panel.querySelectorAll('.legend-row').forEach(row => {
    const handler = () => {
      const ci = parseInt(row.dataset.cluster);
      uniforms.uHighlight.value = uniforms.uHighlight.value === ci ? -1 : ci;
    };
    row.addEventListener('click', handler);
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });
}

// ---- 2D bar chart (R5) ----
function updateBarChart() {
  const svg = document.getElementById('chart-svg');
  if (!svg || !manifest) return;
  const cats = manifest.obs.cluster.categories;
  const ann = annotationData || {};
  const sizes = manifest.cluster_sizes || {};
  const total = cats.reduce((s, c) => s + (sizes[c] || 0), 0);
  if (!total) return;

  const W = 210, BAR_H = 13, GAP = 3, LABEL_W = 94, PAD_TOP = 18;
  const H = PAD_TOP + cats.length * (BAR_H + GAP) + 4;
  const maxBar = W - LABEL_W - 20;

  let content = `<text x="${W / 2}" y="12" text-anchor="middle" fill="#888" font-size="9" font-family="system-ui">cells per cluster</text>`;

  cats.forEach((cat, i) => {
    const p = PALETTE[i % 12];
    const r = Math.round(p.x * 255), g = Math.round(p.y * 255), b = Math.round(p.z * 255);
    const count = sizes[cat] || 0;
    const barW = Math.max(2, Math.round((count / total) * maxBar));
    const y = PAD_TOP + i * (BAR_H + GAP);
    const name = (ann[cat] || `C${cat}`).slice(0, 14);
    content += `<g class="bar-row" data-cluster="${i}" tabindex="0" role="button" aria-label="${ann[cat] || cat}: ${count} cells">
      <rect x="0" y="${y}" width="${W}" height="${BAR_H + 1}" fill="transparent"/>
      <text x="${LABEL_W - 4}" y="${y + BAR_H - 2}" text-anchor="end" fill="#aaa" font-size="9" font-family="system-ui">${name}</text>
      <rect x="${LABEL_W}" y="${y + 1}" width="${barW}" height="${BAR_H - 2}" fill="rgb(${r},${g},${b})" rx="2"/>
      <text x="${LABEL_W + barW + 3}" y="${y + BAR_H - 2}" fill="#888" font-size="8" font-family="system-ui">${count}</text>
    </g>`;
  });

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.innerHTML = content;

  svg.querySelectorAll('.bar-row').forEach(row => {
    const handler = () => {
      const ci = parseInt(row.dataset.cluster);
      uniforms.uHighlight.value = uniforms.uHighlight.value === ci ? -1 : ci;
    };
    row.addEventListener('click', handler);
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });
}

// ---- Data loading ----
async function loadCells(embName = 'pca') {
  if (points) { scene.remove(points); points.geometry.dispose(); points = null; }
  if (sphereMesh) { scene.remove(sphereMesh); sphereMesh.geometry.dispose(); sphereMesh = null; }

  if (!manifest) manifest = await loadManifest();
  if (!markers)  markers  = await loadJSON('/data/' + manifest.markers);

  // Supplementary data loaded once
  if (!genesIndex && manifest.genes) {
    genesIndex = await loadJSON('/data/' + manifest.genes).catch(() => null);
    if (genesIndex) setupGeneInput();
  }
  if (!annotationData && manifest.annotation) {
    annotationData = await loadJSON('/data/' + manifest.annotation).catch(() => null);
  }
  if (!uncertaintyBuf && manifest.obs.uncertainty) {
    uncertaintyBuf = await loadU8('/data/' + manifest.obs.uncertainty.file).catch(() => null);
  }
  if (!uniforms.uLUT.value && manifest.lut_cividis) {
    const raw = await loadU8('/data/' + manifest.lut_cividis).catch(() => null);
    if (raw) {
      const tex = new THREE.DataTexture(raw, 256, 1, THREE.RGBAFormat);
      tex.needsUpdate = true;
      uniforms.uLUT.value = tex;
    }
  }

  const emb = manifest.embeddings[embName];
  const isSynth = !!emb.synthetic;
  const nCells = emb.n_cells ?? manifest.n_cells;
  const clusterPath = isSynth ? emb.cluster_file : manifest.obs.cluster.file;

  const positions  = await loadF32('/data/' + emb.file);
  clusterCodes = await loadU8('/data/' + clusterPath);

  if (positions.length !== nCells * 3) throw new Error('positions: size mismatch');
  if (clusterCodes.length !== nCells)  throw new Error('cluster codes: size mismatch');

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',  new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aCluster',  new THREE.BufferAttribute(clusterCodes, 1));

  // Gene expression — zeros until a gene is selected (synthetic has no gene data)
  const aValue = new Float32Array(nCells);
  geometry.setAttribute('aValue', new THREE.BufferAttribute(aValue, 1));

  // Uncertainty — zeros for synthetic embeddings
  const aUncertainty = new Float32Array(nCells);
  if (!isSynth && uncertaintyBuf) {
    for (let i = 0; i < nCells; i++) aUncertainty[i] = uncertaintyBuf[i] / 255;
  }
  geometry.setAttribute('aUncertainty', new THREE.BufferAttribute(aUncertainty, 1));

  material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true });
  points = new THREE.Points(geometry, material);
  scene.add(points);

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

  // Reset gene mode on embedding switch
  if (isSynth && uniforms.uMode.value === 1) {
    currentGene = null;
    uniforms.uMode.value = 0;
    const inp = document.getElementById('gene-input');
    if (inp) inp.value = '';
    updateGeneLegend();
  }

  setupPicking();
  if (variant === 'spheres') setVariant('spheres');
  updateLegendPanel();
  updateBarChart();
}

const embSelect = document.getElementById('embSelect');
if (embSelect) embSelect.addEventListener('change', () => {
  loadCells(embSelect.value).catch(err => { console.error(err); hud.textContent = String(err); });
});

loadCells('pca').catch(err => { console.error(err); });

function update() {
  if (pickTarget && pointerClient) {
    const i = pickGPU(pointerClient.x, pointerClient.y);
    showTooltip(i, pointerClient.x, pointerClient.y);
  }
}
// ---- CONTENT END ----

// ---- HUD and render loop ----
const hud = document.getElementById('hud');
let frames = 0, last = performance.now(), prev = last;

function animate(now) {
  requestAnimationFrame(animate);
  update();
  prev = now;
  controls.update();
  renderer.render(scene, camera);
  frames++;
  if (now - last > 500) {
    const fps = Math.round(frames * 1000 / (now - last));
    const ri = renderer.info.render;
    hud.textContent = `${hudInfo} · ${ri.calls} calls · ${ri.points} pts · ${ri.triangles} tris · ${fps} FPS`;
    frames = 0; last = now;
  }
}
requestAnimationFrame(animate);
