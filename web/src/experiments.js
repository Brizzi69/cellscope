import * as THREE from 'three';

// Transform cell number i from model space to pixel coordinates, step by step.
export function projectByHand(i) {
  const { camera, points, renderer } = window.cs;
  const pos = points.geometry.attributes.position;
  const v = new THREE.Vector4(pos.getX(i), pos.getY(i), pos.getZ(i), 1);
  camera.updateMatrixWorld();

  // 1: world space
  v.applyMatrix4(points.matrixWorld);
  console.log('1 world space:   ', v.x.toFixed(4), v.y.toFixed(4), v.z.toFixed(4), v.w.toFixed(4));

  // 2: view space
  v.applyMatrix4(camera.matrixWorldInverse);
  console.log('2 view space:    ', v.x.toFixed(4), v.y.toFixed(4), v.z.toFixed(4), v.w.toFixed(4));

  // 3: clip space
  v.applyMatrix4(camera.projectionMatrix);
  console.log('3 clip space:    ', v.x.toFixed(4), v.y.toFixed(4), v.z.toFixed(4), v.w.toFixed(4));

  // 4: NDC (perspective divide: x/w, y/w, z/w)
  const ndcX = v.x / v.w;
  const ndcY = v.y / v.w;
  const ndcZ = v.z / v.w;
  console.log('4 NDC:           ', ndcX.toFixed(4), ndcY.toFixed(4), ndcZ.toFixed(4));

  // 5: pixels (map NDC [-1,1] to canvas size; y axis is flipped in screen space)
  const canvas = renderer.domElement;
  const px = (ndcX + 1) / 2 * canvas.width;
  const py = (1 - ndcY) / 2 * canvas.height;
  console.log('5 pixels:        ', px.toFixed(1), py.toFixed(1));

  // Reference result from the library for comparison
  const ref = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).project(camera);
  console.log('library NDC:     ', ref.x.toFixed(4), ref.y.toFixed(4), ref.z.toFixed(4));
  console.log('match:', Math.abs(ndcX - ref.x) < 1e-4 && Math.abs(ndcY - ref.y) < 1e-4 ? '✓' : '✗');
}
