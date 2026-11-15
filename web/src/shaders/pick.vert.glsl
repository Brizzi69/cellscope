attribute float aIndex;
uniform float uWorldSize;
uniform float uPxPerUnit;
varying float vIndex;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uWorldSize * uPxPerUnit / -mv.z;   // exactly as large as the visible point
  vIndex = aIndex;
}
