import { Box3, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera, RingGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * A WebXR session showing a glTF model (metres, Y up) at real size (CAD-180). A ring marks the
 * surface the camera looks at; a tap sets the model down there, standing on it. Loaded only when a
 * session starts: WebXR renders through WebGL, so it has its own small renderer.
 */
export async function runArSession(started: unknown, glb: Uint8Array): Promise<void> {
  const session = started as XRSession;
  const renderer = new WebGLRenderer({ alpha: true, antialias: true });
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x8899aa, 2));
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.set(0.5, 1, 0.3);
  scene.add(sun);
  const camera = new PerspectiveCamera();

  const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  // Centred over the point it is set down on, its lowest point on the surface.
  const box = new Box3().setFromObject(gltf.scene);
  const centre = box.getCenter(new Vector3());
  gltf.scene.position.set(-centre.x, -box.min.y, -centre.z);
  const model = new Group();
  model.add(gltf.scene);
  model.visible = false;
  scene.add(model);

  const ring = new Mesh(new RingGeometry(0.04, 0.05, 40).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x0f766e }));
  ring.matrixAutoUpdate = false;
  ring.visible = false;
  scene.add(ring);

  await renderer.xr.setSession(session);
  const viewer = await session.requestReferenceSpace('viewer');
  const hits = await session.requestHitTestSource?.({ space: viewer });
  session.addEventListener('select', () => {
    if (!ring.visible) return;
    model.position.setFromMatrixPosition(ring.matrix);
    model.visible = true;
  });
  renderer.setAnimationLoop((_time, frame?: XRFrame) => {
    const space = renderer.xr.getReferenceSpace();
    const pose = frame && hits && space ? frame.getHitTestResults(hits)[0]?.getPose(space) : undefined;
    ring.visible = pose !== undefined;
    if (pose) ring.matrix.fromArray(pose.transform.matrix);
    renderer.render(scene, camera);
  });
  await new Promise<void>((resolve) => session.addEventListener('end', () => resolve()));
  renderer.setAnimationLoop(null);
  hits?.cancel();
  renderer.dispose();
}
