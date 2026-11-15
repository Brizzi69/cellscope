varying float vIndex;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  if (dot(p, p) > 1.0) discard;
  float id = vIndex + 1.0;
  float r = mod(id, 256.0);
  float g = mod(floor(id / 256.0), 256.0);
  float b = floor(id / 65536.0);
  gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
}
