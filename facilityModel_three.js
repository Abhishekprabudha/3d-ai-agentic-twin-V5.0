// facilityModel_three.js — Track-A 3D façade for Design Warehouse
// Works with your existing playDesignWarehouse.js and script.js as-is.

(function () {
  const GLB_URL = "data/warehouse_aslali.glb";

  // -------------------- state --------------------
  let map = null;
  let design = null;

  // three.js bits
  let rootEl = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let glb = null;
  let rafId = null;

  // highlights
  let dockHighlights = []; // meshes
  let pulseUntil = 0;

  // original MapLibre method (for monkeypatch)
  let _origSetPaintProperty = null;

  // -------------------- utils --------------------
  function $(sel) { return document.querySelector(sel); }

  function makeRoot(container) {
    const el = document.createElement("div");
    el.id = "three-root";
    el.style.cssText = "position:absolute;inset:0;z-index:3;pointer-events:none;display:none;";
    container.appendChild(el);
    return el;
    // Note: pointer-events:none so your UI & mouse on map stay usable.
  }

  function makeRenderer(el) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setSize(el.clientWidth, el.clientHeight);
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.NoToneMapping;
    el.appendChild(r.domElement);
    return r;
  }

  function makeCamera() {
    // Simple perspective with an isometric-ish view
    const aspect = rootEl.clientWidth / Math.max(1, rootEl.clientHeight);
    const cam = new THREE.PerspectiveCamera(45, aspect, 0.1, 5000);
    cam.position.set(2, 1.2, 2); // temporary; fit to model later
    cam.lookAt(0, 0, 0);
    return cam;
  }

  function addLights(s) {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 0.8);
    s.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 5, 4);
    s.add(dir);
  }

  function fitCameraToObject(cam, obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);

    // Aim camera from a pleasant diagonal
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = (maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)))) * 1.35;

    cam.position.set(center.x + dist, center.y + dist * 0.7, center.z + dist);
    cam.lookAt(center);
  }

  function animate() {
    rafId = requestAnimationFrame(animate);

    // subtle breathing for dock highlights when pulsing
    const now = performance.now();
    const active = now < pulseUntil;
    for (const m of dockHighlights) {
      if (active) {
        const t = (pulseUntil - now) / 1600; // ~1.6s window
        const k = 1 + 0.25 * Math.sin((1 - t) * Math.PI * 3);
        m.scale.setScalar(k);
        m.material.opacity = 0.35 + 0.35 * (1 - t);
      } else {
        m.scale.setScalar(1);
        m.material.opacity = 0.35;
      }
    }

    renderer.render(scene, camera);
  }

  function onResize() {
    if (!renderer || !camera || !rootEl) return;
    const w = rootEl.clientWidth;
    const h = Math.max(1, rootEl.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // -------------------- 2D dock layer for compatibility --------------------
  // Your DOCKS mark animates a MapLibre circle layer "wh-docks".
  // We add that layer and also hook setPaintProperty to trigger 3D pulses.
  function mPerDeg(latDeg) {
    const lat = latDeg * Math.PI / 180;
    const mPerDegLat = 111320;                       // approx
    const mPerDegLon = 111320 * Math.cos(lat);
    return { mPerDegLat, mPerDegLon };
  }

  function offsetMetersToLonLat(lat0, lon0, dx_m, dy_m) {
    // dx: east (+), dy: north (+)
    const { mPerDegLat, mPerDegLon } = mPerDeg(lat0);
    const dLon = dx_m / mPerDegLon;
    const dLat = dy_m / mPerDegLat;
    return [lon0 + dLon, lat0 + dLat];
  }

  function ensureDockLayer() {
    if (!map || !design) return;
    const anchor = design.anchor || { lat: 22.94, lon: 72.62 };
    const fp = design.footprint || { width_m: 120, depth_m: 80, rotation_deg: 0 };

    // Build 6 points (5 inbound north edge + 1 outbound south edge center)
    const inbound = [];
    const N = 5;
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N - 0.5) * fp.width_m; // -W/2 .. W/2 along X
      const y = +fp.depth_m / 2;                     // north edge (positive Y)
      inbound.push(offsetMetersToLonLat(anchor.lat, anchor.lon, x, y));
    }
    const outbound = [
      offsetMetersToLonLat(anchor.lat, anchor.lon, 0, -fp.depth_m / 2) // south edge center
    ];

    const feats = [
      ...inbound.map(p => ({ type: "Feature", properties: { dir: "in" }, geometry: { type: "Point", coordinates: p } })),
      ...outbound.map(p => ({ type: "Feature", properties: { dir: "out" }, geometry: { type: "Point", coordinates: p } }))
    ];

    if (!map.getSource("wh-docks-src")) {
      map.addSource("wh-docks-src", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
    } else {
      map.getSource("wh-docks-src").setData({ type: "FeatureCollection", features: feats });
    }

    if (!map.getLayer("wh-docks")) {
      map.addLayer({
        id: "wh-docks",
        type: "circle",
        source: "wh-docks-src",
        paint: {
          "circle-color": [
            "match", ["get", "dir"],
            "in", "#60a5fa",  // blue-ish inbound
            "out", "#34d399", // green-ish outbound
            "#9ca3af"
          ],
          "circle-radius": 6,
          "circle-opacity": 0.95,
          "circle-stroke-color": "#0b0b0d",
          "circle-stroke-width": 1
        }
      });
    }
  }

  function hookDockPulse() {
    if (!_origSetPaintProperty) {
      _origSetPaintProperty = map.setPaintProperty.bind(map);
      map.setPaintProperty = (layerId, prop, value, klass) => {
        // Mirror the call
        const r = _origSetPaintProperty(layerId, prop, value, klass);
        // If the DOCKS routine is pulsing the circle radius, start a 3D pulse too
        if (layerId === "wh-docks" && prop === "circle-radius") {
          pulseUntil = performance.now() + 1600; // ~1.6s pulse window
        }
        return r;
      };
    }
  }

  // -------------------- 3D dock highlights (six quads) --------------------
  function buildDockHighlightsAround(glbRoot) {
    // Build 6 translucent quads hugging the model's front/back edges.
    // We place them relative to the GLB bounding box (Track-A approximation).
    const box = new THREE.Box3().setFromObject(glbRoot);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);

    const W = size.x, D = size.z;
    const northZ = center.z + D * 0.5 + 0.01; // tiny lift to avoid z-fight
    const southZ = center.z - D * 0.5 + 0.01;
    const y = box.min.y + 0.02;

    const matIn = new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.35 });
    const matOut = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.35 });

    // 5 inbound along north edge
    const N = 5;
    for (let i = 0; i < N; i++) {
      const x = center.x + ((i + 0.5) / N - 0.5) * W;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W / (N + 0.25), D * 0.06), matIn);
      m.position.set(x, y, northZ);
      m.rotation.x = -Math.PI / 2;
      scene.add(m);
      dockHighlights.push(m);
    }
    // 1 outbound at south center
    {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W / 5, D * 0.06), matOut);
      m.position.set(center.x, y, southZ);
      m.rotation.x = -Math.PI / 2;
      scene.add(m);
      dockHighlights.push(m);
    }
  }

  // -------------------- KPI (Track-A) --------------------
  function computeThroughputUPH() {
    const docks = (design && Array.isArray(design.docks)) ? design.docks : [];
    const inbound = docks.filter(d => (d.type || "").toLowerCase() === "inbound").length || 5;
    // Peak overlap: 5 inbound + 1 outbound simultaneous by your boundary condition
    const overlapOut = (design && design.peak_overlap && Number(design.peak_overlap.outbound)) || 1;
    const concurrent = Math.min(inbound + overlapOut, inbound + (docks.length - inbound)); // cap by total
    const turn = (design && Number(design.dock_turn_min)) || 12; // minutes
    return Math.round((concurrent * 60) / Math.max(1, turn)); // units/hour
  }

  function writeKPIToStats() {
    const uph = computeThroughputUPH(); // e.g., 6 * 60/12 = 30
    const tbody = $("#statsTable tbody");
    if (!tbody) return;
    // Replace with a single design row (non-destructive to structure)
    tbody.innerHTML = "";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>Aslali Warehouse</td><td>—</td><td class="pos">+${uph}/hr</td><td class="neg">-${uph}/hr</td>`;
    tbody.appendChild(tr);
  }

  // -------------------- public API --------------------
  async function build(mapInstance, designJson) {
    // Clean previous
    dispose();

    map = mapInstance;
    design = designJson || {};

    // Root and renderer
    const container = map.getContainer ? map.getContainer() : (document.getElementById("stage") || document.body);
    rootEl = makeRoot(container);
    renderer = makeRenderer(rootEl);
    scene = new THREE.Scene();
    camera = makeCamera();
    addLights(scene);

    // Load GLB
    await new Promise((resolve, reject) => {
      const loader = new THREE.GLTFLoader();
      loader.load(
        GLB_URL,
        (gltf) => {
          glb = gltf.scene || gltf.scenes?.[0];
          scene.add(glb);
          fitCameraToObject(camera, glb);
          // Build dock highlights aligned to model bounds
          buildDockHighlightsAround(glb);
          resolve();
        },
        undefined,
        (err) => reject(err)
      );
    }).catch((e) => {
      console.error("GLB load failed:", e);
    });

    // Ensure MapLibre dock layer exists (for DOCKS mark compatibility)
    ensureDockLayer();
    hookDockPulse();

    // Show & start
    show();
    writeKPIToStats();
    animate();

    // Resize handling
    window.addEventListener("resize", onResize);
    if (map && map.on) map.on("resize", onResize);
  }

  function show() {
    if (rootEl) rootEl.style.display = "";
  }

  function hide() {
    if (rootEl) rootEl.style.display = "none";
  }

  function dispose() {
    try {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;

      if (renderer) {
        renderer.dispose?.();
        if (renderer.domElement?.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);

      rootEl = null; renderer = null; scene = null; camera = null; glb = null;
      dockHighlights.length = 0;

      // restore patched map method
      if (map && _origSetPaintProperty) {
        map.setPaintProperty = _origSetPaintProperty;
        _origSetPaintProperty = null;
      }
      if (map && map.getLayer && map.getLayer("wh-docks")) {
        try { map.removeLayer("wh-docks"); } catch(e){}
      }
      if (map && map.getSource && map.getSource("wh-docks-src")) {
        try { map.removeSource("wh-docks-src"); } catch(e){}
      }

      window.removeEventListener("resize", onResize);
      if (map && map.off) map.off("resize", onResize);
    } catch (_) {}
  }

  // Expose
  window.FacilityModel = {
    build,
    show,
    hide,
    dispose,
    // Optional explicit pulse API if you ever want to call it directly
    pulseDocks: () => { pulseUntil = performance.now() + 1600; }
  };
})();
