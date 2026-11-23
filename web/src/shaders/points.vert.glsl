attribute float aCluster;
attribute float aValue;         // gene expression 0-1 (0 when unused)
attribute float aUncertainty;   // neighbourhood purity 0=certain 1=uncertain

uniform float uWorldSize;
uniform float uPxPerUnit;
uniform float uHighlight;
uniform vec3  uPalette[12];
uniform sampler2D uLUT;         // cividis colormap, 256x1 RGBA
uniform int   uMode;            // 0=cluster colour, 1=gene expression
uniform float uUncertaintyAmount;
uniform int   uCVD;             // 0=normal, 1=deuteranopia simulation

varying vec3 vColor;

vec3 deuteranopia(vec3 c) {
  // Viénot et al. 1999 deuteranopia simulation (linearised sRGB)
  return vec3(
    0.56667 * c.r + 0.43333 * c.g,
    0.55833 * c.r + 0.44167 * c.g,
    0.24167 * c.g + 0.75833 * c.b
  );
}

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uWorldSize * uPxPerUnit / -mv.z;

  if (uMode == 1) {
    vColor = texture2D(uLUT, vec2(aValue, 0.5)).rgb;
  } else {
    int code = min(int(aCluster + 0.5), 11);
    vColor = uPalette[code];
  }

  // B4 highlight: highlighted cluster gets larger and lighter
  if (uHighlight >= 0.0 && abs(aCluster - uHighlight) < 0.5) {
    gl_PointSize *= 1.6;
    vColor = mix(vColor, vec3(1.0), 0.3);
  }

  // Uncertainty desaturation toward grey
  float grey = dot(vColor, vec3(0.299, 0.587, 0.114));
  vColor = mix(vColor, vec3(grey), aUncertainty * uUncertaintyAmount);

  // CVD simulation (deuteranopia)
  if (uCVD == 1) {
    vColor = deuteranopia(vColor);
  }
}
