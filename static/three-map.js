/**
 * Dormant Three.js renderer retained for experimentation.
 *
 * The production UI does not import this module. Import it explicitly and call
 * mount() only when a 3D view is desired; stop() cancels its animation loop.
 */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js";

const LAYER_Y = { ux: 7, app: 0, db: -7 };
const COLORS = { cyan: 0x9cff32, amber: 0xff9e43, violet: 0xa663ff, rose: 0xff5e89, lime: 0xc7ff3d, blue: 0x45d9ff };
const KIND_COLORS = { class: 0xb267ff, struct: 0xb267ff, protocol: 0x45d9ff, enum: 0xff5e89, actor: 0xff5e89, function: 0xbaff35, method: 0xffb13b };

export class CyberSoulThreeMap {
  constructor(canvas, { activeLayer = "app" } = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("CyberSoulThreeMap requires a canvas");
    this.canvas = canvas;
    this.activeLayer = activeLayer;
    this.data = null;
    this.running = false;
    this.frame = 0;
    this.world = new THREE.Group();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x02080b, .019);
    this.camera = new THREE.PerspectiveCamera(52, 1, .1, 180);
    this.camera.position.set(13, 12, 16);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .07;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.controls.target.set(0, 0, 0);
    this.scene.add(this.world, new THREE.AmbientLight(0x86c86b, .8));
    const light = new THREE.PointLight(0x9cff32, 28, 52);
    light.position.set(5, 14, 8);
    this.scene.add(light);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  mount(data) {
    this.data = data;
    this.build();
    this.start();
  }

  setLayer(layer) {
    if (!(layer in LAYER_Y)) return;
    this.activeLayer = layer;
    this.build();
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    if (!this.running) this.render();
  }

  clear() {
    this.world.traverse((object) => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => material.dispose());
    });
    this.world.clear();
  }

  build() {
    this.clear();
    if (!this.data) return;
    Object.entries(this.data.layers).forEach(([layerName, layer]) => {
      const group = new THREE.Group();
      group.position.y = LAYER_Y[layerName];
      this.world.add(group);
      const columns = Math.max(1, Math.ceil(Math.sqrt(layer.categories.length)));
      const membersByCategory = new Map(layer.categories.map((category) => [category.id, layer.nodes.filter((node) => node.category === category.id)]));
      const centers = new Map();
      layer.categories.forEach((category, index) => {
        const x = (index % columns - (columns - 1) / 2) * 6.4;
        const z = (Math.floor(index / columns) - Math.floor(layer.categories.length / columns) / 2) * 4.4;
        centers.set(category.id, new THREE.Vector3(x, 0, z));
        const active = layerName === this.activeLayer;
        const color = active ? 0x83df16 : 0x53605b;
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(5.6, .22, 3.5),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .08, transparent: true, opacity: active ? .74 : .12, depthWrite: active }),
        );
        slab.position.set(x, 0, z);
        group.add(slab);
        if (!active) return;
        const members = membersByCategory.get(category.id) || [];
        const beacon = new THREE.Mesh(
          new THREE.CylinderGeometry(.25, .42, .7, 6),
          new THREE.MeshStandardMaterial({ color: COLORS[category.color] || COLORS.cyan, emissive: COLORS[category.color] || COLORS.cyan, emissiveIntensity: 1 }),
        );
        beacon.position.set(x, .46, z);
        group.add(beacon);
      });
      if (layerName !== this.activeLayer) return;
      const categoryByNode = new Map(layer.nodes.map((node) => [node.id, node.category]));
      const weights = new Map();
      layer.edges.forEach((edge) => {
        const from = categoryByNode.get(edge.from), to = categoryByNode.get(edge.to);
        if (!from || !to || from === to) return;
        const key = [from, to].sort().join("::");
        weights.set(key, (weights.get(key) || 0) + 1);
      });
      [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).forEach(([key]) => {
        const [fromId, toId] = key.split("::");
        const from = centers.get(fromId), to = centers.get(toId);
        if (!from || !to) return;
        const mid = from.clone().lerp(to, .5); mid.y = .35;
        const curve = new THREE.QuadraticBezierCurve3(from.clone().setY(.15), mid, to.clone().setY(.15));
        group.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(12)),
          new THREE.LineBasicMaterial({ color: 0x9fd84b, transparent: true, opacity: .32 }),
        ));
      });
    });
    this.render();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.render();
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  destroy() {
    this.stop();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clear();
    this.renderer.dispose();
  }
}
