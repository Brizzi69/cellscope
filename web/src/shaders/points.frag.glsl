varying vec3 vColor;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;      // -1..1 inside the point's square
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;                   // cut the square to a disc

  // B4 task 3: fake sphere shading
  // compute a surface normal pointing toward the light as if the disc is a sphere
  vec3 n = vec3(p, sqrt(1.0 - r2));
  vec3 l = normalize(vec3(0.6, 0.8, 1.0));
  float diff = max(dot(n, l), 0.0);
  vec3 lit = vColor * (0.35 + 0.65 * diff);

  // soft edge using smoothstep so the rim fades instead of hard-clipping
  float alpha = smoothstep(1.0, 0.85, r2);

  gl_FragColor = vec4(lit, alpha);
}
