/**
 * Standalone TaskLatch Proof Gate illustration. No evaluator, wallet, or RPC code.
 * Three.js r180 is pinned by the example's import map. Serve over HTTP(S).
 */
export function mountProofGate(viewport, {
  controls = null,
  modelURL = new URL('./tasklatch-proof-gate.glb', import.meta.url),
} = {}) {
  if (!viewport) throw new TypeError('A Proof Gate viewport is required.');
  controls ??= viewport.closest('.hero') || document;
  const canvas = viewport.querySelector('canvas');
  const status = controls.querySelector('#load-status');
  const resultCopy = controls.querySelector('#result-copy');
  const motionButton = controls.querySelector('#motion-toggle');
  const replayButton = controls.querySelector('#replay');
  const buttons = [...controls.querySelectorAll('[data-result]')]
    .filter(element => element.tagName === 'BUTTON');
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(hover: none), (pointer: coarse)');
  const events = new AbortController();
  const assetAbort = new AbortController();
  const states = {
    accepted: {
      node: 'Accepted_Path',
      title: 'Accepted · 0.10 test USDC on Arc Testnet.',
      detail: 'The emerald route illustrates the accepted result passing the policy boundary.',
    },
    rejected1: {
      node: 'Rejected_Path_1',
      title: 'Rejected 1 · $0 payout.',
      detail: 'This amber route stops at the policy boundary. It does not join the settlement path.',
    },
    rejected2: {
      node: 'Rejected_Path_2',
      title: 'Rejected 2 · $0 payout.',
      detail: 'The second amber route also stays outside the gate. No payment is illustrated.',
    },
  };
  let THREE, renderer, scene, camera, pivot, model, mixer, intro, idle, environment;
  let visible = false, disposed = false, failed = false, ready = false, loading = false;
  let reduced = media.matches, paused = false, hovering = false, selected = 'accepted';
  let inIntro = false, raf = 0, lastFrame = 0, idleElapsed = 0, idleTicket = 0;
  let resizeObserver, intersectionObserver;
  let motionBounds, animationBounds, modelCenter;
  let measuredIntervals = [], renderCount = 0;
  const targetTilt = { x: 0, y: 0 };
  const pathMaterials = new Map();
  const coreMaterials = [];
  const trackedMaterials = new Set();
  const maxAngle = Math.PI / 40; // ±4.5°, below the ±5° brief limit.
  const viewDirection = { x: 8, y: 6.4, z: 11.8 }; // Blender (8, -11.8, 6.4), converted to glTF Y-up.

  function setStatus(message) { if (status) status.textContent = message; }
  function listen(target, type, handler, options = {}) {
    target?.addEventListener(type, handler, { ...options, signal: events.signal });
  }
  function updateButtons() {
    if (motionButton) {
      motionButton.disabled = !ready || failed || reduced;
      motionButton.textContent = reduced ? 'Reduced motion' : paused ? 'Resume motion' : 'Pause motion';
    }
    if (replayButton) replayButton.disabled = !ready || failed || reduced || !intro;
  }
  function mayAnimate() { return ready && !failed && !disposed && visible && !document.hidden && !reduced && !paused; }

  function paintResult() {
    viewport.dataset.result = selected;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.result === selected)));
    if (resultCopy) {
      const title = document.createElement('strong');
      title.textContent = states[selected].title;
      resultCopy.replaceChildren(title, document.createTextNode(` ${states[selected].detail}`));
    }
    applyHighlight();
  }
  function applyHighlight() {
    for (const [key, materials] of pathMaterials) {
      for (const { material, intensity } of materials) {
        if (material.emissive) material.emissiveIntensity = intensity * (key === selected ? 1.45 : 0.55);
      }
    }
    drawOnce();
  }
  function isolateMaterials(nodeName) {
    const items = [];
    model.getObjectByName(nodeName)?.traverse(node => {
      if (!node.isMesh) return;
      const source = Array.isArray(node.material) ? node.material : [node.material];
      const clones = source.map(original => {
        trackedMaterials.add(original); // Dispose originals even if no mesh still references them.
        const material = original.clone();
        trackedMaterials.add(material);
        items.push({ material, intensity: material.emissiveIntensity ?? 1 });
        return material;
      });
      node.material = Array.isArray(node.material) ? clones : clones[0];
    });
    return items;
  }

  function completePose() {
    if (!mixer) return;
    mixer.stopAllAction();
    if (intro) {
      intro.reset().setLoop(THREE.LoopOnce, 1);
      intro.clampWhenFinished = true;
      intro.play();
      mixer.setTime(intro.getClip().duration);
      intro.paused = true;
    }
    inIntro = false;
  }
  function beginIdle() {
    if (!idle || reduced) return;
    // The separate idle clip contains the completed decision state.
    intro?.stop();
    idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
  }
  function resetMotion() {
    targetTilt.x = targetTilt.y = 0;
    if (pivot) { pivot.rotation.set(0, 0, 0); pivot.position.set(0, 0, 0); }
    for (const { material, intensity } of coreMaterials) material.emissiveIntensity = intensity;
  }
  function setResult(key) {
    if (!Object.hasOwn(states, key) || disposed) return false;
    selected = key;
    if (ready) { completePose(); if (!paused && !reduced) beginIdle(); }
    paintResult();
    return true;
  }
  function stopLoop() {
    cancelAnimationFrame(raf); raf = 0; lastFrame = 0;
    viewport.dataset.animating = 'false';
  }
  function drawOnce() {
    if (!ready || failed || disposed || !visible || document.hidden) return;
    renderer.render(scene, camera);
    renderCount++;
  }
  function animate(now) {
    raf = 0;
    if (!mayAnimate()) { stopLoop(); return; }
    const interval = lastFrame ? now - lastFrame : 0;
    const dt = Math.min(interval / 1000, .05);
    lastFrame = now;
    if (interval > 0) {
      measuredIntervals.push(interval);
      if (measuredIntervals.length > 180) measuredIntervals.shift();
    }
    mixer?.update(dt);
    idleElapsed += dt;
    const smoothing = 1 - Math.exp(-7 * dt);
    pivot.rotation.x += (targetTilt.x - pivot.rotation.x) * smoothing;
    pivot.rotation.y += (targetTilt.y - pivot.rotation.y) * smoothing;
    // Ambient_Idle supplies the authored idle. Only the hover pulse is procedural.
    // It changes light intensity, never payment state or the model's transforms.
    for (const { material, intensity } of coreMaterials) {
      material.emissiveIntensity = intensity * (hovering ? 1 + .09 * (1 + Math.sin(idleElapsed * 3)) : 1);
    }
    drawOnce();
    if (mayAnimate()) raf = requestAnimationFrame(animate);
  }
  function refreshLoop() {
    if (mayAnimate()) {
      if (!raf) { viewport.dataset.animating = 'true'; lastFrame = 0; raf = requestAnimationFrame(animate); }
    } else { stopLoop(); drawOnce(); }
    updateButtons();
  }
  function replay() {
    if (!ready || !intro || reduced || disposed || failed) return;
    paused = false;
    mixer.stopAllAction();
    intro.reset().setLoop(THREE.LoopOnce, 1);
    intro.clampWhenFinished = true;
    intro.play(); inIntro = true;
    resetMotion(); refreshLoop();
  }
  function pause() { paused = true; resetMotion(); refreshLoop(); }
  function resume() {
    if (reduced || disposed) return;
    paused = false;
    if (!inIntro && idle && !idle.isRunning()) beginIdle();
    refreshLoop();
  }

  function fitCamera() {
    if (!renderer || !camera || !motionBounds) return;
    const { width, height } = viewport.getBoundingClientRect();
    if (!width || !height) return;
    const pixelCap = width < 600 || coarse.matches ? 1.25 : 1.5;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, pixelCap));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.set(viewDirection.x, viewDirection.y, viewDirection.z).normalize();
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const inverseViewRotation = camera.quaternion.clone().invert();
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanX = tanY * camera.aspect;
    let distance = 0;
    // Stable fit across all sampled animation bounds and all permitted parallax extremes.
    for (const corner of motionBounds) {
      const v = corner.clone().applyQuaternion(inverseViewRotation);
      distance = Math.max(distance, Math.abs(v.x) / tanX + v.z, Math.abs(v.y) / tanY + v.z);
    }
    distance *= 1.12;
    camera.position.normalize().multiplyScalar(distance);
    camera.near = Math.max(.01, distance / 150);
    camera.far = distance + 100;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    drawOnce();
  }

  function sampleMotionBounds() {
    const union = new THREE.Box3().setFromObject(model);
    for (const action of [intro, idle].filter(Boolean)) {
      mixer.stopAllAction();
      action.reset().setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
      const duration = action.getClip().duration;
      const steps = Math.max(1, Math.ceil(duration * 4));
      for (let i = 0; i <= steps; i++) {
        // setTime must see the action unpaused after reaching its end on a previous sample.
        action.paused = false;
        mixer.setTime(duration * i / steps);
        model.updateMatrixWorld(true);
        union.union(new THREE.Box3().setFromObject(model));
      }
    }
    mixer?.stopAllAction();
    animationBounds = union;
    modelCenter = union.getCenter(new THREE.Vector3());
    model.position.sub(modelCenter);
    model.updateMatrixWorld(true);
    const box = union.clone().translate(modelCenter.clone().negate());
    motionBounds = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const corner = new THREE.Vector3(x, y, z);
      for (const rx of [-maxAngle, 0, maxAngle]) for (const ry of [-maxAngle, 0, maxAngle]) {
        motionBounds.push(corner.clone().applyEuler(new THREE.Euler(rx, ry, 0)));
      }
    }
  }

  function disposeModel(root) {
    if (!root) return;
    const geometries = new Set(), materials = new Set(), textures = new Set();
    root.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) if (material) materials.add(material);
    });
    trackedMaterials.forEach(material => materials.add(material));
    materials.forEach(material => {
      Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); });
      material.dispose();
    });
    textures.forEach(texture => { texture.dispose(); texture.source?.data?.close?.(); });
    geometries.forEach(geometry => geometry.dispose());
    trackedMaterials.clear();
  }
  function release3D() {
    stopLoop();
    mixer?.stopAllAction();
    if (model && mixer) mixer.uncacheRoot(model);
    disposeModel(model); model = null;
    environment?.dispose(); environment = null;
    if (scene) scene.environment = null;
    renderer?.dispose(); renderer = null;
    pathMaterials.clear(); coreMaterials.length = 0;
    ready = false;
  }
  function fallback(message, error) {
    if (disposed) return;
    failed = true;
    assetAbort.abort();
    release3D();
    viewport.dataset.mode = 'poster';
    setStatus(message);
    updateButtons();
    viewport.dispatchEvent(new CustomEvent('proofgate:fallback', { detail: { message } }));
    if (error) console.warn('TaskLatch illustration: static fallback.', error);
  }

  async function initialize() {
    if (disposed || failed || loading || ready || !visible || document.hidden) return;
    loading = true;
    if (navigator.connection?.saveData) {
      fallback('Static preview · data-saving preference'); return;
    }
    setStatus('Static preview · preparing 3D');
    let loadTimeout;
    try {
      // Dynamic imports are intentional: a blocked CDN cannot disable the HTML controls.
      const imports = await Promise.race([
        Promise.all([import('three'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/environments/RoomEnvironment.js')]),
        new Promise((_, reject) => { loadTimeout = setTimeout(() => reject(new Error('Dependency load timed out')), 20000); }),
      ]);
      clearTimeout(loadTimeout);
      if (disposed || failed) return;
      THREE = imports[0];
      const { GLTFLoader } = imports[1];
      const { RoomEnvironment } = imports[2];
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.setClearColor(0x090f12, 0);
      renderer.shadowMap.enabled = false;
      renderer.transmissionResolutionScale = .5;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
      pivot = new THREE.Group(); scene.add(pivot);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      environment = pmrem.fromScene(room, .045);
      scene.environment = environment.texture;
      scene.environmentIntensity = .9;
      room.dispose(); pmrem.dispose();
      scene.add(new THREE.HemisphereLight(0xf3f1ea, 0x10382e, 1.0));
      const key = new THREE.DirectionalLight(0xfff5e5, 3.5); key.position.set(4, 7, 6); scene.add(key);
      const rim = new THREE.DirectionalLight(0xa9e2d1, 2); rim.position.set(-5, 2, -2); scene.add(rim);
      const fill = new THREE.DirectionalLight(0xd6e5ed, .8); fill.position.set(2, -2, 5); scene.add(fill);
      const assetURL = new URL(modelURL, document.baseURI);
      loadTimeout = setTimeout(() => assetAbort.abort(), 25000);
      const response = await fetch(assetURL, { signal: assetAbort.signal });
      if (!response.ok) throw new Error(`Model request failed: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      clearTimeout(loadTimeout);
      const gltf = await new GLTFLoader().parseAsync(bytes, new URL('.', assetURL).href);
      if (disposed || failed) { disposeModel(gltf.scene); return; }
      model = gltf.scene;
      // Blender studio lights are render-only; use a small predictable web lighting rig.
      const renderOnly = [];
      model.traverse(node => { if (node.isLight || node.isCamera) renderOnly.push(node); });
      renderOnly.forEach(node => node.removeFromParent());
      pivot.add(model);
      mixer = new THREE.AnimationMixer(model);
      const introClip = THREE.AnimationClip.findByName(gltf.animations, 'ProofGate_Intro');
      const idleClip = THREE.AnimationClip.findByName(gltf.animations, 'Ambient_Idle');
      intro = introClip ? mixer.clipAction(introClip) : null;
      idle = idleClip ? mixer.clipAction(idleClip) : null;
      sampleMotionBounds();
      Object.entries(states).forEach(([key, value]) => pathMaterials.set(key, isolateMaterials(value.node)));
      coreMaterials.push(...isolateMaterials('Core_Pulse'));
      completePose();
      fitCamera();
      mixer.addEventListener('finished', event => {
        if (event.action === intro) { inIntro = false; beginIdle(); }
      });
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
      if (disposed || failed) return;
      ready = true;
      applyHighlight();
      // Display a rendered complete pose before removing the immediate static poster.
      renderer.render(scene, camera); renderCount++;
      viewport.dataset.mode = '3d';
      setStatus(reduced ? 'Static complete state · reduced motion' : 'Illustration · select a result to highlight its path');
      if (reduced) { completePose(); resetMotion(); drawOnce(); }
      else if (intro && !paused) replay();
      else refreshLoop();
      viewport.dispatchEvent(new CustomEvent('proofgate:ready', { detail: { modelBytes: bytes.byteLength, clips: gltf.animations.map(clip => ({ name: clip.name, duration: clip.duration })) } }));
    } catch (error) {
      clearTimeout(loadTimeout);
      if (!disposed) fallback('Static preview · 3D unavailable', error);
    } finally { loading = false; }
  }
  function scheduleLoad() {
    if (disposed || ready || failed || loading || idleTicket || !visible || document.hidden) return;
    // Leave the poster a paint opportunity and schedule WebGL outside initial page rendering.
    if ('requestIdleCallback' in window) idleTicket = requestIdleCallback(() => { idleTicket = 0; initialize(); }, { timeout: 1200 });
    else idleTicket = setTimeout(() => { idleTicket = 0; initialize(); }, 100);
  }
  function onVisibility() {
    if (visible && !document.hidden) scheduleLoad();
    refreshLoop();
  }

  buttons.forEach(button => listen(button, 'click', () => setResult(button.dataset.result)));
  listen(motionButton, 'click', () => paused ? resume() : pause());
  listen(replayButton, 'click', replay);
  listen(viewport, 'pointermove', event => {
    if (reduced || paused || coarse.matches || event.pointerType === 'touch') return;
    const rect = viewport.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, 2 * (event.clientX - rect.left) / rect.width - 1));
    const y = Math.max(-1, Math.min(1, 2 * (event.clientY - rect.top) / rect.height - 1));
    targetTilt.x = y * maxAngle; targetTilt.y = x * maxAngle;
  }, { passive: true });
  listen(viewport, 'pointerenter', event => { hovering = !coarse.matches && event.pointerType !== 'touch'; });
  listen(viewport, 'pointerleave', () => { hovering = false; targetTilt.x = targetTilt.y = 0; });
  listen(document, 'visibilitychange', onVisibility);
  listen(media, 'change', event => {
    reduced = event.matches;
    if (ready && reduced) { completePose(); resetMotion(); }
    else if (ready && !paused) beginIdle();
    if (ready) setStatus(reduced ? 'Static complete state · reduced motion' : 'Illustration · select a result to highlight its path');
    refreshLoop();
  });
  listen(coarse, 'change', () => { resetMotion(); fitCamera(); });
  listen(canvas, 'webglcontextlost', event => { event.preventDefault(); fallback('Static preview · graphics context lost'); });
  listen(window, 'pagehide', event => {
    // BFCache pages keep resources paused and resume on pageshow. Full navigation releases them.
    if (event.persisted) stopLoop(); else dispose();
  });
  listen(window, 'pageshow', onVisibility);
  if ('IntersectionObserver' in window) {
    intersectionObserver = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      onVisibility();
    }, { threshold: 0 });
    intersectionObserver.observe(viewport);
  } else { visible = true; scheduleLoad(); }
  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(fitCamera); resizeObserver.observe(viewport);
  } else listen(window, 'resize', fitCamera, { passive: true });
  paintResult(); updateButtons();

  function dispose() {
    if (disposed) return;
    disposed = true;
    events.abort(); assetAbort.abort();
    intersectionObserver?.disconnect(); resizeObserver?.disconnect();
    if ('cancelIdleCallback' in window) cancelIdleCallback(idleTicket); else clearTimeout(idleTicket);
    release3D();
    viewport.dataset.mode = 'poster';
    viewport.dataset.animating = 'false';
    if (motionButton) motionButton.disabled = true;
    if (replayButton) replayButton.disabled = true;
    setStatus('Static preview');
  }
  return {
    setResult, replay, pause, resume, dispose,
    getMetrics() {
      const sorted = [...measuredIntervals].sort((a, b) => a - b);
      return {
        ready, mode: viewport.dataset.mode, selected, reducedMotion: reduced, paused,
        visible: visible && !document.hidden, animating: Boolean(raf), renderCount,
        threeRevision: THREE?.REVISION ?? null,
        drawCalls: renderer?.info.render.calls ?? null,
        triangles: renderer?.info.render.triangles ?? null,
        geometries: renderer?.info.memory.geometries ?? null,
        textures: renderer?.info.memory.textures ?? null,
        pixelRatio: renderer?.getPixelRatio() ?? null,
        animationBounds: animationBounds ? { min: animationBounds.min.toArray(), max: animationBounds.max.toArray() } : null,
        frameIntervalMeanMs: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null,
        frameIntervalP95Ms: sorted.length ? sorted[Math.floor((sorted.length - 1) * .95)] : null,
        frameSamples: sorted.length,
        // rAF intervals include browser scheduling; they are NOT GPU frame-time measurements.
      };
    },
  };
}

