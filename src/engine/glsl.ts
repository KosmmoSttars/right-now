// Shared GLSL. Scene units are AU; the scene origin floats with the camera focus, so
// everything is drawn relative to uOrigin (the focus, heliocentric ecliptic).
// Ecliptic (x, y, z) maps to three.js (x, z, -y): the ecliptic is the XZ plane and
// ecliptic north is +Y.

export const KEPLER_GLSL = /* glsl */ `
// Needs three's <common> chunk (PI, PI2) included before it.
const float GAUSS_K = 0.01720209895;

vec3 eclToThree(vec3 p) { return vec3(p.x, p.z, -p.y); }

// Heliocentric ecliptic position on an ellipse from a, e, angles (radians) and mean anomaly.
vec3 keplerEllipse(float a, float e, float inc, float node, float peri, float M) {
  M = mod(M + PI, PI2) - PI;
  float E = M + 0.85 * e * (M < 0.0 ? -1.0 : 1.0);
  for (int k = 0; k < 9; k++) {
    E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  }
  float x = a * (cos(E) - e);
  float y = a * sqrt(max(0.0, 1.0 - e * e)) * sin(E);
  float cw = cos(peri), sw = sin(peri), cn = cos(node), sn = sin(node), ci = cos(inc), si = sin(inc);
  vec3 P = vec3(cw * cn - sw * sn * ci, cw * sn + sw * cn * ci, sw * si);
  vec3 Q = vec3(-sw * cn - cw * sn * ci, -sw * sn + cw * cn * ci, cw * si);
  return x * P + y * Q;
}
`;

/** Soft round point sprite, premultiplied for additive blending. */
export const POINT_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
out highp vec4 fragColor;
in vec3 vColor;
in float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * vAlpha;
  fragColor = vec4(vColor, a); // additive blending multiplies by alpha
}
`;

/** Pushes a vertex out of the clip volume (hidden point). */
export const HIDE = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0;';
