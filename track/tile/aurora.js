// aurora.js: Tracks' fifth look, "Aurora" (claude/mixtape-3c-track-renderer-notes.md, R3c-12), drawn as approved in
// claude/raku-track-aurora-mockup.html. Our own drawing, inspired by Spectra (Shimmer Math Labs,
// https://shimmermathlabs.com/spectra.html): no code of theirs. Three worlds, each with its own tuned settings:
//   Tide   the song's recent past as diagonal ribbons: new sound enters at the right and drifts left, fading
//   Bloom  rings are the frequencies, calmly; a breathing cloud at the centre; a slow wave from it now and then (PB6)
//   Prism  each ray a frequency, mirrored all the way round (14 facets), turning slowly
// The music is kept as a strip of spectrum history (64 bands × 256 moments). Drawn with WebGL (one small shader per
// world) when the browser offers it, else with a 2D canvas that draws the same ideas more simply. Nothing here touches
// the page beyond its two canvases.
//
//   const aurora = createAurora(glCanvas, canvas2d);
//   aurora.resize(width, height, scale);
//   aurora.step(dt, bands(64), playing, world);      // every frame, whatever the look (so switching shows the past)
//   aurora.draw(world, time);                        // only while Aurora shows
//   aurora.gl                                        // true when drawn with WebGL

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
// Per world: intensity, distortion, glow, colour cycling, memory (seconds), scan lines, a palette of four.
export const WORLDS = Object.freeze({
  tide:  { int: 1.8, dist: 0.8, glow: 1.2, cyc: 1.0, mem: 18, scan: 1, pal: ['#3fb8b0', '#c9d48a', '#b48fd0', '#e48a7c'] },
  bloom: { int: 2.1, dist: 1.1, glow: 1.6, cyc: 0.8, mem: 24, scan: 0, pal: ['#8f7ad8', '#c7b8f0', '#6f8fc8', '#b3cf86'] },
  prism: { int: 2.2, dist: 0.6, glow: 1.5, cyc: 1.5, mem: 16, scan: 1, pal: ['#d9a0b8', '#5f7f9c', '#9fc8c8', '#e7b8a0'] },
});
export const NB = 64, NC = 256;

// Bloom's own rhythm (PB6, approved Nov 20): switched on by the music, fading up over about 3 s when it starts and down
// over about 4 s when it stops; the cloud (twice the old core) breathes every 12 s; a wave every 12 s, crossing in 8 s,
// on the wall clock, rolling out only while the music is on.
export const BLOOM = Object.freeze({ every: 12, cross: 8, breath: 12, cloud: 2, up: 3, down: 4 });
/** The wave at clock time t (s) with the light on at `on`: its radius (the rings reach about 0.6), strength, the cloud's swell. */
export function bloomWave(t, on, B = BLOOM) {
  const ph = ((t % B.every) + B.every) % B.every;
  const travel = ph / B.cross;
  const r = travel < 1 ? 0.03 + travel * 0.72 : -1;
  const amp = (travel < 1 ? Math.min(1, ph / 0.6) * Math.pow(1 - travel, 1.2) : 0) * on;
  const dp = Math.min(ph, B.every - ph);
  return { r, amp, swell: Math.exp(-(dp * dp) / 0.5) * on };
}
/** The "on" level after dt seconds: towards 1 while playing, towards 0 when not. */
export function stepOn(on, dt, playing, B = BLOOM) {
  return on + ((playing ? 1 : 0) - on) * Math.min(1, (dt / (playing ? B.up : B.down)) * 2.5);
}   // 64 bands (bass to treble) × 256 moments of history

export function createHistory() {
  const data = new Float32Array(NB * NC);   // [column][band]
  const live = new Float32Array(NB);
  let head = 0, acc = 0;
  return {
    data, live,
    get head() { return head; },
    get frac() { return acc; },
    // the eased spectrum written into the newest column; a new column every memory / 250 s while playing
    step(dt, bands, playing, mem) {
      const k = Math.min(1, dt * 6);
      for (let b = 0; b < NB; b++) live[b] += ((playing ? bands[b] || 0 : 0) - live[b]) * k;
      if (playing) {
        acc += dt / (mem / 250);
        while (acc >= 1) { acc -= 1; head = (head + 1) % NC; }
      }
      data.set(live, head * NB);
    },
    // age 0..1 of the memory, f 0..1 bass to treble (for the 2D fallback)
    at(age, f) {
      let c = head - 1 + acc - age * 249; c = ((Math.round(c) % NC) + NC) % NC;
      const fb = Math.max(0, Math.min(NB - 1, f * (NB - 1))), b0 = Math.floor(fb), b1 = Math.min(NB - 1, b0 + 1), u = fb - b0;
      return data[c * NB + b0] * (1 - u) + data[c * NB + b1] * u;
    },
    level() { let s = 0; for (let b = 0; b < NB; b++) s += live[b]; return s / NB; },
  };
}

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
const COMMON = `
precision highp float;
uniform sampler2D u_hist; uniform vec2 u_res;
uniform float u_head, u_time, u_cycle, u_int, u_dist, u_glow, u_scan, u_level;
uniform vec3 u_c0, u_c1, u_c2, u_c3;
uniform float u_wave, u_waveAmp, u_swell, u_on, u_breath, u_csize;
float hist(float age, float f) {
  float x = (u_head - age * 249.0 + 0.5) / 256.0;
  return texture2D(u_hist, vec2(x, clamp(f, 0.0, 1.0) * (63.0 / 64.0) + 0.5 / 64.0)).r;
}
vec3 pal(float t) {
  t = fract(t) * 4.0; float k = floor(t); float u = smoothstep(0.0, 1.0, t - k);
  vec3 a = k < 0.5 ? u_c0 : k < 1.5 ? u_c1 : k < 2.5 ? u_c2 : u_c3;
  vec3 b = k < 0.5 ? u_c1 : k < 1.5 ? u_c2 : k < 2.5 ? u_c3 : u_c0;
  return mix(a, b, u);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 finish(vec3 c) {
  vec3 bg = vec3(0.035, 0.05, 0.085);
  c = bg + (1.0 - exp(-c * 1.5));
  vec2 uv = gl_FragCoord.xy / u_res;
  c *= mix(0.72, 1.0, smoothstep(0.95, 0.25, length(uv - 0.5)));
  c *= 1.0 - u_scan * 0.09 * step(0.5, fract(gl_FragCoord.y * 0.5));
  c += (hash(gl_FragCoord.xy + fract(u_time * 7.0) * 91.0) - 0.5) * 0.04;
  return c;
}
`;
const FRAG = {
  // Tide: the song's recent past as diagonal ribbons; new sound enters at the right and drifts left, fading;
  // bass at the bottom, treble at the top; a broad ribbon rides the overall loudness.
  tide: COMMON + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res; float asp = u_res.x / u_res.y;
  vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
  float an = 0.36, cs = cos(an), sn = sin(an);
  vec2 q = vec2(cs * p.x + sn * p.y, -sn * p.x + cs * p.y);
  float L = 0.5 * (asp * cs + sn), Hh = 0.5 * (asp * sn + cs);
  q.y += u_dist * (0.03 * sin(q.x * 4.0 + u_time * 0.45) + 0.018 * sin(q.x * 9.0 - u_time * 0.7 + q.y * 5.0));
  float age = clamp((L - q.x) / (2.0 * L), 0.0, 1.0);
  float f = clamp((q.y + Hh) / (2.0 * Hh), 0.0, 1.0);
  float e = (hist(age - 0.015, f) + hist(age, f) + hist(age + 0.015, f)) / 3.0;
  float rib = pow(0.5 + 0.5 * cos(f * 4.0 * 6.28318 + u_time * 0.12), 1.3);
  float fade = 1.0 - age * 0.5;
  float I = (0.16 + rib * (0.16 + e * u_int * 0.5)) * fade;
  float lv = (hist(age, 0.15) + hist(age, 0.4) + hist(age, 0.7)) / 3.0;
  float cy = 0.18 * sin(q.x * 2.2 + u_time * 0.25);
  float w = 0.05 + 0.09 * lv;
  float broad = exp(-pow((q.y - cy) / w, 2.0)) * (0.16 + lv * u_int * 0.45) * fade;
  vec3 col = pal(f * 1.0 + q.x * 0.12 + u_cycle);
  float J = I + broad;
  gl_FragColor = vec4(finish(col * J * 1.3 + col * u_glow * 0.5 * J * J), 1.0);
}`,
  // Bloom (new Nov 20, PB6): rings are the frequencies, bass near the centre, treble outside, following the music
  // calmly (a longer stretch of the past, a smaller swing); the inner rings stay round (the wobble fades in away from the
  // centre); a soft drifting cloud at the centre that breathes on its own; a very slow wave released from the cloud now
  // and then, brightening the rings it crosses and bulging them gently outward. All of it switched on by the music
  // (u_on), not following its loudness.
  bloom: COMMON + `
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, m = 0.5; for (int k = 0; k < 4; k++) { s += m * vnoise(p); p *= 2.03; m *= 0.5; } return s; }
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y; float r0 = length(p); float a = atan(p.y, p.x);
  float wob = smoothstep(0.06, 0.32, r0);
  float r = r0 + wob * u_dist * (0.012 * sin(a * 3.0 + u_time * 0.4) + 0.007 * sin(a * 5.0 - u_time * 0.55));
  float d = r - u_wave;
  float bulge = exp(-d * d / 0.008) * u_waveAmp;
  float rr = r - 0.03 * bulge;
  float band = exp(-d * d / 0.0035) * u_waveAmp;
  float f = clamp(rr / 0.6, 0.0, 1.0);
  float ea = f * 0.35;
  float eavg = (hist(ea, f) + hist(ea + 0.04, f) + hist(ea + 0.08, f) + hist(ea + 0.12, f)) / 4.0;
  float e = u_on * (0.22 + 0.5 * eavg);
  float ring = 0.5 + 0.5 * cos(f * 7.0 * 6.28318 - u_time * 0.35);
  ring = pow(ring, mix(4.0, 1.3, clamp(e, 0.0, 1.0)));
  float edge = smoothstep(1.15, 0.7, r / 0.6);
  float inner = smoothstep(0.05 * u_csize, 0.17 * u_csize, r0);
  float I = (0.07 + ring * (0.10 + e * u_int * 0.5) * (1.0 + 0.8 * band)) * edge * inner + band * 0.16 * edge;
  float cr = 0.14 * u_csize * (1.0 + 0.4 * u_swell);
  vec2 q = p * 5.0 + vec2(u_time * 0.05, -u_time * 0.035);
  float n = fbm(q + fbm(q * 0.7 + u_time * 0.02));
  float cloud = exp(-r0 * r0 / (cr * cr)) * (0.2 + 1.1 * n * n) * (0.10 + u_on * (0.28 + 0.34 * u_breath) + u_swell * 0.4);
  vec3 col = pal(f * 0.9 + 0.06 * sin(a * 2.0 + u_time * 0.2) + u_cycle);
  vec3 ccol = mix(u_c0, u_c1, n);
  float J = I;
  gl_FragColor = vec4(finish(col * J * 1.3 + col * u_glow * 0.5 * J * J + ccol * cloud * 2.3), 1.0);
}`,
  // Prism: each ray a frequency, mirrored all the way round (14 facets); rays lengthen and brighten with their part
  // of the music; the whole pattern turns slowly.
  prism: COMMON + `
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y; float r = length(p);
  float a = atan(p.y, p.x) + u_time * 0.035;
  float seg = 6.28318 / 14.0; float k = a / seg;
  float m = abs(fract(k) - 0.5) * 2.0;
  float f = clamp(m + u_dist * 0.03 * sin(r * 8.0 - u_time * 0.6), 0.0, 1.0);
  float e = hist(clamp(r / 0.9, 0.0, 1.0) * 0.5, f);
  float reach = 0.10 + e * u_int * 0.22;
  float ray = smoothstep(reach, reach * 0.25, r) * (0.4 + 0.6 * e);
  float facet = mix(0.55, 1.0, step(0.5, fract(floor(k) * 0.5)));
  float base = 0.30 * (0.35 + 0.65 * m) * facet * smoothstep(1.5, 0.05, r);
  float I = base + ray * 0.55 + exp(-r * r * 90.0) * (0.05 + u_level * 0.25);
  vec3 col = pal(m * 0.6 + r * 0.35 + u_cycle);
  gl_FragColor = vec4(finish(col * I * 1.3 + col * u_glow * 0.5 * I * I), 1.0);
}`,
};

// WebGL, or null when the browser doesn't offer it (or a shader won't build).
function createAuroraGL(cv) {
  let gl = null;
  try { gl = cv.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true }) || cv.getContext('experimental-webgl'); } catch { gl = null; }
  if (!gl) return null;
  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const NAMES = ['u_wave', 'u_waveAmp', 'u_swell', 'u_on', 'u_breath', 'u_csize', 'u_hist', 'u_res', 'u_head', 'u_time', 'u_cycle', 'u_int', 'u_dist', 'u_glow', 'u_scan', 'u_level', 'u_c0', 'u_c1', 'u_c2', 'u_c3'];
  const progs = {};
  try {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    for (const w of Object.keys(FRAG)) {
      const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG[w]));
      gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; for (const n of NAMES) u[n] = gl.getUniformLocation(p, n);
      progs[w] = { p, u };
    }
  } catch { return null; }
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, NC, NB, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(NC * NB));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const col = new Uint8Array(NB);
  let lastHead = -1;
  return {
    resize(w, h, scale) { cv.width = Math.max(1, Math.round(w * scale)); cv.height = Math.max(1, Math.round(h * scale)); },
    draw(world, hist, time, light) {
      const W = WORLDS[world], P = progs[world];
      // upload the newest column (and the one just finished, when the head moved)
      const put = (c) => { for (let b = 0; b < NB; b++) col[b] = Math.round(Math.min(1, hist.data[c * NB + b]) * 255); gl.texSubImage2D(gl.TEXTURE_2D, 0, c, 0, 1, NB, gl.LUMINANCE, gl.UNSIGNED_BYTE, col); };
      if (lastHead !== -1 && lastHead !== hist.head) put(lastHead);
      put(hist.head); lastHead = hist.head;
      gl.viewport(0, 0, cv.width, cv.height);
      gl.useProgram(P.p); const u = P.u;
      gl.uniform1i(u.u_hist, 0); gl.uniform2f(u.u_res, cv.width, cv.height);
      gl.uniform1f(u.u_head, hist.head - 1 + hist.frac); gl.uniform1f(u.u_time, time);
      gl.uniform1f(u.u_cycle, time * 0.012 * W.cyc); gl.uniform1f(u.u_int, W.int); gl.uniform1f(u.u_dist, W.dist);
      gl.uniform1f(u.u_glow, W.glow); gl.uniform1f(u.u_scan, W.scan); gl.uniform1f(u.u_level, hist.level());
      W.pal.forEach((h, i) => gl.uniform3fv(u['u_c' + i], hex(h)));
      gl.uniform1f(u.u_wave, light.wave.r); gl.uniform1f(u.u_waveAmp, light.wave.amp); gl.uniform1f(u.u_swell, light.wave.swell);
      gl.uniform1f(u.u_on, light.on); gl.uniform1f(u.u_breath, light.breath); gl.uniform1f(u.u_csize, BLOOM.cloud);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

// The 2D fallback: the same three ideas, drawn more simply.
export function drawAurora2D(g, W, H, world, hist, time, light = { on: 1, breath: 0.5, wave: { r: -1, amp: 0, swell: 0 } }) {
  const S = WORLDS[world], pal = S.pal.map(hex);
  const palAt = (t, a) => {
    t = ((t % 1) + 1) % 1 * 4; const k = Math.floor(t), u = t - k, c0 = pal[k % 4], c1 = pal[(k + 1) % 4];
    const c = c0.map((v, i) => Math.round((v + (c1[i] - v) * u) * 255));
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  };
  const cyc = time * 0.012 * S.cyc;
  g.save();
  g.fillStyle = '#090d16'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  if (world === 'tide') {
    g.translate(W / 2, H / 2); g.rotate(-0.36);
    const L = W * 0.62, Hh = H * 0.85, slices = 40;
    for (let r = 0; r < 5; r++) {
      const f = (r + 0.5) / 5, y = Hh / 2 - f * Hh;
      for (let i = 0; i < slices; i++) {
        const x0 = -L + (i / slices) * 2 * L, age = 1 - i / slices, e = hist.at(age, f);
        const wob = S.dist * 10 * Math.sin(x0 / 60 + time * 0.45);
        const th = 22 + e * 34, a = (0.14 + e * 0.45) * (1 - age * 0.5);
        const gr = g.createLinearGradient(0, y + wob - th, 0, y + wob + th);
        gr.addColorStop(0, palAt(f * 0.75 + cyc, 0)); gr.addColorStop(0.5, palAt(f * 0.75 + x0 / W * 0.2 + cyc, a)); gr.addColorStop(1, palAt(f * 0.75 + cyc, 0));
        g.fillStyle = gr; g.fillRect(x0 - 2, y + wob - th, 2 * L / slices + 4, th * 2);
      }
    }
  } else if (world === 'bloom') {
    const cx = W / 2, cy = H / 2, R = H * 0.6, wv = light.wave;
    for (let j = 0; j < 9; j++) {
      const f = (j + 0.5) / 9; if (f * 0.6 < 0.1 * BLOOM.cloud) continue;
      const e = light.on * (0.22 + 0.5 * hist.at(f * 0.35 + 0.05, f));
      const d = f * 0.6 - wv.r, band = Math.exp(-d * d / 0.004) * wv.amp;
      const rad = f * R + band * 0.022 * H;
      g.strokeStyle = palAt(f * 0.9 + cyc, 0.12 + e * 0.6 + band * 0.3); g.lineWidth = 2 + e * 10;
      g.shadowColor = palAt(f * 0.9 + cyc, 1); g.shadowBlur = 8 + e * 16 * S.glow;
      g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.stroke();
    }
    g.shadowBlur = 0;
    if (wv.amp > 0.01) { g.strokeStyle = palAt(0.3 + cyc, 0.22 * wv.amp); g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, wv.r / 0.6 * R, 0, Math.PI * 2); g.stroke(); }
    const cr = H * 0.14 * BLOOM.cloud * (1 + 0.4 * wv.swell);
    for (let k = 0; k < 5; k++) {
      const ox = Math.sin(time * 0.05 + k * 1.7) * cr * 0.35, oy = Math.cos(time * 0.04 + k * 2.3) * cr * 0.3;
      const core = g.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, cr * (0.8 + 0.25 * k / 4));
      core.addColorStop(0, palAt(0.25 + k * 0.05 + cyc, (0.05 + light.on * (0.10 + 0.12 * light.breath) + wv.swell * 0.12)));
      core.addColorStop(1, palAt(0.3 + cyc, 0));
      g.fillStyle = core; g.fillRect(0, 0, W, H);
    }
  } else {
    const cx = W / 2, cy = H / 2, R = H, n = 14, sub = 6, seg = Math.PI * 2 / n, rot = time * 0.035;
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < sub; j++) {
        const m = Math.abs((j + 0.5) / sub - 0.5) * 2, e = hist.at(0.2, m);
        const reach = (0.10 + e * S.int * 0.22) * R, a0 = rot + k * seg + (j / sub) * seg, a1 = a0 + seg / sub;
        const facet = k % 2 ? 0.55 : 1;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(reach, R * 0.9));
        gr.addColorStop(0, palAt(m * 0.6 + cyc, (0.35 + e * 0.6) * facet));
        gr.addColorStop(Math.min(0.99, reach / (R * 0.9)), palAt(m * 0.6 + 0.2 + cyc, 0.22 * facet));
        gr.addColorStop(1, palAt(m * 0.6 + 0.35 + cyc, 0.06));
        g.fillStyle = gr; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * 0.9, a0, a1); g.closePath(); g.fill();
      }
    }
  }
  g.restore();
  if (S.scan) { g.fillStyle = 'rgba(0,0,0,.08)'; for (let y = 0; y < H; y += 2) g.fillRect(0, y, W, 1); }
}

// Aurora for the tile: WebGL on its own canvas when it can, else the 2D fallback on the looks' canvas.
// options.noGL forces the fallback (the stand-in host's switch, to check it).
export function createAurora(glCanvas, canvas2d, options = {}) {
  const gl = options.noGL ? null : createAuroraGL(glCanvas);
  const g = canvas2d.getContext('2d');
  const hist = createHistory();
  let W = 0, H = 0;
  // Bloom's light: the on level, the clock (wall time, steady whatever the music does), the breathing and the wave
  let on = 0, clock = 0;
  const light = () => ({ on, breath: 0.5 + 0.5 * Math.sin((clock * 2 * Math.PI) / BLOOM.breath), wave: bloomWave(clock, on) });
  return {
    get gl() { return !!gl; },
    resize(w, h, scale) { W = w; H = h; if (gl) gl.resize(w, h, scale); },
    step(dt, bands, playing, world) { hist.step(dt, bands, playing, (WORLDS[world] || WORLDS.tide).mem); on = stepOn(on, dt, playing); clock += dt; },
    get on() { return on; },
    draw(world, time) {
      if (!W || !H) return;
      if (!WORLDS[world]) world = 'tide';
      const L = light();
      if (gl) gl.draw(world, hist, time, L);
      else drawAurora2D(g, W, H, world, hist, time, L);
    },
  };
}
