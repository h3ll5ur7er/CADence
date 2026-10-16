/**
 * A model as one self-contained HTML file: its meshes and a small WebGL viewer (turn, zoom, pan,
 * measure, show and hide parts, explode), for people without CADence. No network, no libraries.
 */

/** One part of the model: a body, or an instance of a component's body in an assembly. */
export interface ViewerPart {
  readonly name: string;
  /** `#rrggbb`; absent: the app's body colour. */
  readonly color?: string;
  readonly opacity?: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** Line segments (pairs of points) of the edges. */
  readonly edges: Float32Array;
  /** Where the part sits: 4 × 4, column-major; absent where it was modelled. */
  readonly transform?: readonly number[];
}

export interface ViewerModel {
  readonly title: string;
  readonly parts: readonly ViewerPart[];
}

const base64 = (array: Float32Array | Uint32Array): string => {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** The model as an HTML page. */
export function viewerHtml(model: ViewerModel): string {
  const data = {
    title: model.title,
    parts: model.parts.map((p) => ({
      name: p.name,
      color: p.color ?? '#9fb2bb',
      opacity: p.opacity ?? 1,
      transform: p.transform ?? null,
      positions: base64(p.positions),
      normals: base64(p.normals),
      indices: base64(p.indices),
      edges: base64(p.edges),
    })),
  };
  // `</` would end the script element early.
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="CADence">
<title>${escapeHtml(model.title)}</title>
<style>
  html, body { height: 100%; margin: 0; font: 13px system-ui, sans-serif; color: #1d2a30; background: #eef2f3; }
  canvas { display: block; width: 100%; height: 100%; touch-action: none; }
  .panel { position: fixed; top: 12px; left: 12px; max-width: 260px; max-height: calc(100% - 24px); overflow: auto; padding: 10px 12px; border-radius: 8px; background: rgba(255,255,255,.92); box-shadow: 0 2px 10px rgba(0,0,0,.12); }
  h1 { margin: 0 0 6px; font-size: 15px; }
  label { display: flex; gap: 6px; align-items: center; margin: 3px 0; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
  .row { display: flex; gap: 6px; margin-top: 8px; }
  button { font: inherit; padding: 3px 8px; border: 1px solid #b9c6cb; border-radius: 5px; background: #fff; cursor: pointer; }
  button[aria-pressed="true"] { background: #0f766e; border-color: #0f766e; color: #fff; }
  #measure-result { margin-top: 6px; font-variant-numeric: tabular-nums; }
  .hint { margin-top: 8px; color: #5b6b71; font-size: 11px; }
  .made { position: fixed; right: 12px; bottom: 10px; color: #5b6b71; font-size: 11px; }
</style>
</head>
<body>
<canvas id="view" aria-label="${escapeHtml(model.title)}"></canvas>
<div class="panel">
  <h1>${escapeHtml(model.title)}</h1>
  <div id="parts"></div>
  <label id="explode-row" hidden>Explode <input id="explode" type="range" min="0" max="1" step="0.01" value="0"></label>
  <div class="row"><button id="fit" type="button">Fit</button><button id="measure" type="button" aria-pressed="false">Measure</button></div>
  <div id="measure-result" role="status"></div>
  <div class="hint">Drag to turn, right-drag or Shift-drag to pan, wheel to zoom. Lengths in millimetres.</div>
</div>
<div class="made">Made with CADence</div>
<script id="model" type="application/json">${json}</script>
<script>(${String(runViewer)})(JSON.parse(document.getElementById('model').textContent));</script>
</body>
</html>
`;
}

type Vec3 = [number, number, number];
type Mat4 = number[];

interface EncodedPart {
  name: string;
  color: string;
  opacity: number;
  transform: number[] | null;
  positions: string;
  normals: string;
  indices: string;
  edges: string;
}

/**
 * The viewer, run in the exported page. It is serialized with `String(runViewer)`, so it must not use
 * anything from outside its own body.
 */
function runViewer(data: { title: string; parts: EncodedPart[] }): void {
  const decode = (text: string) => {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  };
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
  const normalize = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));
  const multiply = (a: Mat4, b: Mat4): Mat4 => {
    const out = new Array<number>(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] = (out[c * 4 + r] as number) + (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
    return out;
  };
  const apply = (m: Mat4, p: Vec3): Vec3 => [
    (m[0] as number) * p[0] + (m[4] as number) * p[1] + (m[8] as number) * p[2] + (m[12] as number),
    (m[1] as number) * p[0] + (m[5] as number) * p[1] + (m[9] as number) * p[2] + (m[13] as number),
    (m[2] as number) * p[0] + (m[6] as number) * p[1] + (m[10] as number) * p[2] + (m[14] as number),
  ];
  const rotate = (m: Mat4, n: Vec3): Vec3 => normalize([
    (m[0] as number) * n[0] + (m[4] as number) * n[1] + (m[8] as number) * n[2],
    (m[1] as number) * n[0] + (m[5] as number) * n[1] + (m[9] as number) * n[2],
    (m[2] as number) * n[0] + (m[6] as number) * n[1] + (m[10] as number) * n[2],
  ]);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const hex = (color: string): Vec3 => [parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255];

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true }) as WebGLRenderingContext;
  gl.getExtension('OES_element_index_uint');
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
  };
  const program = gl.createProgram() as WebGLProgram;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec3 p; attribute vec3 n; uniform mat4 mvp; varying vec3 vn; void main(){ vn = n; gl_Position = mvp * vec4(p, 1.0); }'));
  gl.attachShader(
    program,
    shader(
      gl.FRAGMENT_SHADER,
      'precision mediump float; varying vec3 vn; uniform vec3 color; uniform vec3 light; uniform float alpha; uniform float lit; void main(){ float d = abs(dot(normalize(vn), light)); vec3 c = mix(color, color * (0.45 + 0.6 * d), lit); gl_FragColor = vec4(c, alpha); }',
    ),
  );
  gl.linkProgram(program);
  gl.useProgram(program);
  const at = { p: gl.getAttribLocation(program, 'p'), n: gl.getAttribLocation(program, 'n') };
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const u = { mvp: uniform('mvp'), color: uniform('color'), light: uniform('light'), alpha: uniform('alpha'), lit: uniform('lit') };

  // Parts in world space (their transforms applied once; exploding moves them as a whole).
  const parts = data.parts.map((part) => {
    const transform = part.transform ?? identity;
    const local = new Float32Array(decode(part.positions));
    const localNormals = new Float32Array(decode(part.normals));
    const positions = new Float32Array(local.length);
    const normals = new Float32Array(local.length);
    for (let i = 0; i < local.length; i += 3) {
      positions.set(apply(transform, [local[i] as number, local[i + 1] as number, local[i + 2] as number]), i);
      normals.set(rotate(transform, [localNormals[i] as number, localNormals[i + 1] as number, localNormals[i + 2] as number]), i);
    }
    const edgesLocal = new Float32Array(decode(part.edges));
    const edges = new Float32Array(edgesLocal.length);
    for (let i = 0; i < edgesLocal.length; i += 3) edges.set(apply(transform, [edgesLocal[i] as number, edgesLocal[i + 1] as number, edgesLocal[i + 2] as number]), i);
    const indices = new Uint32Array(decode(part.indices));
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, positions[i + k] as number);
        max[k] = Math.max(max[k] as number, positions[i + k] as number);
      }
    }
    const buffer = (target: number, array: ArrayBufferView) => {
      const b = gl.createBuffer() as WebGLBuffer;
      gl.bindBuffer(target, b);
      gl.bufferData(target, array, gl.STATIC_DRAW);
      return b;
    };
    return {
      name: part.name,
      color: hex(part.color),
      opacity: part.opacity,
      visible: true,
      positions,
      indices,
      center: scale(add(min, max), 0.5),
      min,
      max,
      buffers: { p: buffer(gl.ARRAY_BUFFER, positions), n: buffer(gl.ARRAY_BUFFER, normals), i: buffer(gl.ELEMENT_ARRAY_BUFFER, indices), e: buffer(gl.ARRAY_BUFFER, edges) },
      edgeCount: edges.length / 3,
      offset: [0, 0, 0] as Vec3,
    };
  });
  const box = parts.reduce(
    (b, p) => ({ min: [Math.min(b.min[0], p.min[0]), Math.min(b.min[1], p.min[1]), Math.min(b.min[2], p.min[2])] as Vec3, max: [Math.max(b.max[0], p.max[0]), Math.max(b.max[1], p.max[1]), Math.max(b.max[2], p.max[2])] as Vec3 }),
    { min: [Infinity, Infinity, Infinity] as Vec3, max: [-Infinity, -Infinity, -Infinity] as Vec3 },
  );
  const center = scale(add(box.min, box.max), 0.5);
  const size = Math.max(length(sub(box.max, box.min)), 1);

  // Camera: turns about the target, Z up.
  const view = { yaw: -0.8, pitch: 0.6, distance: size * 1.6, target: center };
  const eye = (): Vec3 => add(view.target, scale([Math.cos(view.pitch) * Math.cos(view.yaw), Math.cos(view.pitch) * Math.sin(view.yaw), Math.sin(view.pitch)], view.distance));
  const matrices = () => {
    const e = eye();
    const f = normalize(sub(view.target, e));
    const s = normalize(cross(f, [0, 0, 1]));
    const up = cross(s, f);
    const viewMatrix = [s[0], up[0], -f[0], 0, s[1], up[1], -f[1], 0, s[2], up[2], -f[2], 0, -dot(s, e), -dot(up, e), dot(f, e), 1];
    const aspect = canvas.width / Math.max(canvas.height, 1);
    const near = view.distance / 100;
    const far = view.distance * 10;
    const t = 1 / Math.tan((35 * Math.PI) / 360);
    const projection = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
    return { viewMatrix, projection, eye: e, forward: f, right: s, up };
  };
  const measured: Vec3[] = [];

  const draw = () => {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * ratio);
    canvas.height = Math.floor(canvas.clientHeight * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.933, 0.949, 0.953, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const m = matrices();
    gl.uniform3fv(u.light, normalize(sub(m.eye, view.target)).map((v, i) => v + (i === 2 ? 0.4 : 0)));
    for (const part of parts) {
      if (!part.visible) continue;
      const model = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, part.offset[0], part.offset[1], part.offset[2], 1];
      gl.uniformMatrix4fv(u.mvp, false, multiply(m.projection, multiply(m.viewMatrix, model)));
      gl.bindBuffer(gl.ARRAY_BUFFER, part.buffers.p);
      gl.enableVertexAttribArray(at.p);
      gl.vertexAttribPointer(at.p, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, part.buffers.n);
      gl.enableVertexAttribArray(at.n);
      gl.vertexAttribPointer(at.n, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(u.color, part.color);
      gl.uniform1f(u.alpha, part.opacity);
      gl.uniform1f(u.lit, 1);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.buffers.i);
      gl.drawElements(gl.TRIANGLES, part.indices.length, gl.UNSIGNED_INT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disableVertexAttribArray(at.n);
      gl.vertexAttrib3f(at.n, 0, 0, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, part.buffers.e);
      gl.vertexAttribPointer(at.p, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(u.color, [0.16, 0.2, 0.22]);
      gl.uniform1f(u.lit, 0);
      gl.drawArrays(gl.LINES, 0, part.edgeCount);
    }
    // Measured points and the line between them.
    if (measured.length) {
      gl.disable(gl.DEPTH_TEST);
      const points = new Float32Array(measured.flatMap((p) => p));
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, points, gl.STREAM_DRAW);
      gl.uniformMatrix4fv(u.mvp, false, multiply(m.projection, m.viewMatrix));
      gl.vertexAttribPointer(at.p, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(u.color, [0.86, 0.15, 0.15]);
      gl.uniform1f(u.alpha, 1);
      if (measured.length === 2) gl.drawArrays(gl.LINES, 0, 2);
      gl.drawArrays(gl.POINTS, 0, measured.length);
      gl.deleteBuffer(b);
    }
  };

  // The point of a visible part under the cursor (Möller–Trumbore against every triangle).
  const pick = (x: number, y: number): Vec3 | undefined => {
    const m = matrices();
    const rect = canvas.getBoundingClientRect();
    const t = Math.tan((35 * Math.PI) / 360);
    const aspect = rect.width / Math.max(rect.height, 1);
    const nx = ((x - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((y - rect.top) / rect.height) * 2;
    const direction = normalize(add(m.forward, add(scale(m.right, nx * t * aspect), scale(m.up, ny * t))));
    let best: { distance: number; point: Vec3 } | undefined;
    for (const part of parts) {
      if (!part.visible) continue;
      const p = part.positions;
      const origin = sub(m.eye, part.offset);
      for (let i = 0; i < part.indices.length; i += 3) {
        const v = (k: number): Vec3 => {
          const j = (part.indices[i + k] as number) * 3;
          return [p[j] as number, p[j + 1] as number, p[j + 2] as number];
        };
        const a = v(0);
        const e1 = sub(v(1), a);
        const e2 = sub(v(2), a);
        const h = cross(direction, e2);
        const det = dot(e1, h);
        if (Math.abs(det) < 1e-12) continue;
        const s = sub(origin, a);
        const uu = dot(s, h) / det;
        if (uu < 0 || uu > 1) continue;
        const q = cross(s, e1);
        const vv = dot(direction, q) / det;
        if (vv < 0 || uu + vv > 1) continue;
        const distance = dot(e2, q) / det;
        if (distance > 0 && (!best || distance < best.distance)) best = { distance, point: add(add(origin, scale(direction, distance)), part.offset) };
      }
    }
    return best?.point;
  };

  // The panel: parts, explode, fit, measure.
  const list = document.getElementById('parts') as HTMLElement;
  for (const part of parts) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.addEventListener('change', () => {
      part.visible = box.checked;
      draw();
    });
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = `rgb(${part.color.map((c) => Math.round(c * 255)).join(',')})`;
    label.append(box, swatch, document.createTextNode(part.name));
    list.append(label);
  }
  const explode = document.getElementById('explode') as HTMLInputElement;
  (document.getElementById('explode-row') as HTMLElement).hidden = parts.length < 2;
  explode.addEventListener('input', () => {
    const amount = Number(explode.value);
    for (const part of parts) part.offset = scale(sub(part.center, center), amount * 1.2);
    draw();
  });
  (document.getElementById('fit') as HTMLElement).addEventListener('click', () => {
    view.target = center;
    view.distance = size * 1.6;
    draw();
  });
  const measureButton = document.getElementById('measure') as HTMLButtonElement;
  const result = document.getElementById('measure-result') as HTMLElement;
  measureButton.addEventListener('click', () => {
    const on = measureButton.getAttribute('aria-pressed') !== 'true';
    measureButton.setAttribute('aria-pressed', String(on));
    measured.length = 0;
    result.textContent = on ? 'Click two points on the model.' : '';
    draw();
  });

  let drag: { x: number; y: number; button: number; shift: boolean; moved: boolean } | undefined;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.button === 2 || drag.shift) {
      const m = matrices();
      const per = (view.distance * 0.9) / canvas.clientHeight;
      view.target = add(view.target, add(scale(m.right, -dx * per), scale(m.up, dy * per)));
    } else {
      view.yaw -= dx * 0.008;
      view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + dy * 0.008));
    }
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    const click = drag && !drag.moved && drag.button === 0;
    drag = undefined;
    if (!click || measureButton.getAttribute('aria-pressed') !== 'true') return;
    const point = pick(e.clientX, e.clientY);
    if (!point) return;
    if (measured.length === 2) measured.length = 0;
    measured.push(point);
    result.textContent = measured.length === 2 ? `Distance ${length(sub(measured[1] as Vec3, measured[0] as Vec3)).toFixed(2)} mm` : 'Click a second point.';
    draw();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.distance = Math.max(size * 0.05, view.distance * Math.exp(e.deltaY * 0.001));
    draw();
  }, { passive: false });
  window.addEventListener('resize', draw);
  draw();
}
