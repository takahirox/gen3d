import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// A read-only preview, with exact source names supplied by Blender in GLB extras.
// The preview is never used as the editable base or as preservation evidence.
export function partPicker(container, onToggle) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); container.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, .01, 10000);
  scene.background = new THREE.Color('#1c2532'); scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 3));
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  let model, chosen = new Set(), hovered, disposed = false;
  const meshes = [], raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  function paint() {
    for (const m of meshes) m.material.color.set(m.userData.part === hovered ? '#ffd995' : chosen.has(m.userData.part) ? '#9ce2c6' : '#71818e');
  }
  function hit(event) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - r.left) / r.width * 2 - 1, -(event.clientY - r.top) / r.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera); return raycaster.intersectObjects(meshes)[0]?.object.userData.part;
  }
  let down;
  renderer.domElement.onpointerdown = e => { down = [e.clientX, e.clientY]; };
  renderer.domElement.onpointerup = e => { if (down && Math.hypot(e.clientX-down[0], e.clientY-down[1]) < 5) { const part = hit(e); if (part) onToggle(part); } down = null; };
  const resize = new ResizeObserver(() => { const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; renderer.setSize(w,h); camera.aspect = w/h; camera.updateProjectionMatrix(); }); resize.observe(container);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene,camera); });
  return {
    async load(url, names) {
      const gltf = await new GLTFLoader().loadAsync(url);
      model = gltf.scene;
      if (disposed) { model.traverse(o => o.geometry?.dispose()); return; }
      model.traverse(o => {
        if (!o.isMesh) return;
        let parent = o, name;
        while (parent && !name) { name = parent.userData.gen3d_part; parent = parent.parent; }
        o.userData.part = names.includes(name) ? name : null;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) { for (const v of Object.values(m || {})) if (v?.isTexture) v.dispose(); m?.dispose(); }
        o.material = new THREE.MeshStandardMaterial({ color: '#71818e' });
        if (o.userData.part) meshes.push(o);
      });
      scene.add(model);
      const box = new THREE.Box3().setFromObject(model), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length() || 1;
      controls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(size, size*.6, size)); camera.far = Math.max(size*100, 1000); camera.near = size/1000; camera.updateProjectionMatrix(); controls.update(); paint();
      return new Set(meshes.map(m => m.userData.part));
    },
    select(names, highlight) { chosen = new Set(names); hovered = highlight; paint(); },
    dispose() {
      disposed = true; renderer.setAnimationLoop(null); resize.disconnect(); controls.dispose();
      model?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); renderer.dispose(); container.replaceChildren();
    }
  };
}
