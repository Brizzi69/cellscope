import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { projectByHand } from './experiments.js';
import { loadManifest, loadF32, loadU8, loadJSON } from './data.js';
import vertexShader from './shaders/points.vert.glsl?raw';
import fragmentShader from './shaders/points.frag.glsl?raw';

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
});

// Handy for the browser console (F12): type  cs.camera  etc.
window.cs = { THREE, renderer, scene, camera, controls, projectByHand };

// ---- CONTENT START ----
// palette: 12 sRGB colours, one per cluster code
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

// B4 task 2: size slider wired to uWorldSize
const sizeSlider = document.getElementById('sizeSlider');
if (sizeSlider) sizeSlider.addEventListener('input', () => {
  uniforms.uWorldSize.value = parseFloat(sizeSlider.value);
});

let points = null, material = null, manifest = null, clusterCodes = null, markers = null;

async function loadCells() {
  manifest = await loadManifest();
  const positions = await loadF32('/data/' + manifest.embeddings.pca.file);
  clusterCodes = await loadU8('/data/' + manifest.obs.cluster.file);
  markers = await loadJSON('/data/' + manifest.markers);

  if (positions.length !== manifest.n_cells * 3) throw new Error('positions: size mismatch');
  if (clusterCodes.length !== manifest.n_cells) throw new Error('cluster codes: size mismatch');

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aCluster', new THREE.BufferAttribute(clusterCodes, 1));

  material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,   // needed for the soft-edge alpha in the fragment shader
  });
  points = new THREE.Points(geometry, material);
  scene.add(points);
  window.cs.points = points;
  window.cs.clusterCodes = clusterCodes;
  window.cs.manifest = manifest;

  // camera fit from Part 1
  geometry.computeBoundingSphere();
  const r = geometry.boundingSphere.radius;
  const fovRad = camera.fov * Math.PI / 180;
  camera.position.set(0, 0, (r / Math.sin(fovRad / 2)) * 1.2);
  controls.update();

  hudInfo = `${manifest.n_cells} cells · PCA · ${manifest.obs.cluster.categories.length} clusters`;
}

loadCells().catch((err) => { console.error(err); hud.textContent = String(err); });
function update(dt) { /* nothing to animate yet */ }
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
    hud.textContent = `${hudInfo}  ${Math.round(frames * 1000 / (now - last))} FPS`;
    frames = 0; last = now;
  }
}
requestAnimationFrame(animate);
