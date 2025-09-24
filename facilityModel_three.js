// facilityModel_three.js — Track-A 3D façade (robust load + autoscale + fallback)
(function () {
  const GLB_URL = "data/warehouse_aslali.glb";

  let map = null, design = null;
  let rootEl = null, renderer = null, scene = null, camera = null, glb = null, rafId = null;

  let dockHighlights = [];
  let pulseUntil = 0;
  let _origSetPaintProperty = null;

  const $   = (sel)=>document.querySelector(sel);
  const log = (...a)=>{ try{ console.log("[FacilityModel]", ...a);}catch(_){} };
  const warn= (...a)=>{ try{ console.warn("[FacilityModel]", ...a);}catch(_){} };
  const err = (...a)=>{ try{ console.error("[FacilityModel]", ...a);}catch(_){} };

  function makeRoot(container) {
    const el = document.createElement("div");
    el.id = "three-root";
    el.style.cssText = "position:absolute;inset:0;z-index:3;pointer-events:none;display:none;";
    container.appendChild(el);
    return el;
  }
  function makeRenderer(el) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setSize(el.clientWidth, Math.max(1, el.clientHeight));
    // Cross-version color space handling:
    if ("outputColorSpace" in r && THREE.SRGBColorSpace) r.outputColorSpace = THREE.SRGBColorSpace;
    else if ("outputEncoding" in r && THREE.sRGBEncoding) r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.NoToneMapping;
    el.appendChild(r.domElement);
    return r;
  }
  function makeCamera() {
    const w = rootEl.clientWidth, h = Math.max(1, rootEl.clientHeight);
    const cam = new THREE.PerspectiveCamera(45, w / h, 0.01, 10000);
    cam.position.set(2, 1.2, 2);
    cam.lookAt(0, 0, 0);
    return cam;
  }
  function addLights(s) {
    s.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(3, 5, 4);
    s.add(dir);
  }
  const boxOf = (obj)=> new THREE.Box3().setFromObject(obj);

  function centerAndAutoscaleToFootprint(obj) {
    const fp = design?.footprint || { width_m: 120, depth_m: 80, height_m: 12 };
    const b = boxOf(obj);
    const size = new THREE.Vector3(); b.getSize(size);
    const center = new THREE.Vector3(); b.getCenter(center);
    obj.position.sub(center);
    const eps = 1e-6;
    const w = Math.max(size.x, eps), d = Math.max(size.z, eps);
    const s = Math.min(fp.width_m / w, fp.depth_m / d);
    const within = (w/fp.width_m > 0.5 && w/fp.width_m < 2) && (d/fp.depth_m > 0.5 && d/fp.depth_m < 2);
    if (!within) { obj.scale.setScalar(s); log("autoscale", {w:w.toFixed(3), d:d.toFixed(3), s:s.toFixed(3)}); }
  }
  function fitCameraToObject(cam, obj) {
    const b = boxOf(obj);
    const size = new THREE.Vector3(); b.getSize(size);
    const center = new THREE.Vector3(); b.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = (maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)))) * 1.6;
    cam.position.set(center.x + dist, center.y + dist * 0.7, center.z + dist);
    cam.lookAt(center);
  }
  function animate() {
    rafId = requestAnimationFrame(animate);
    const now = performance.now();
    const active = now < pulseUntil;
    for (const m of dockHighlights) {
      if (active) {
        const t = (pulseUntil - now) / 1600;
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
    const w = rootEl.clientWidth, h = Math.max(1, rootEl.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ---- MapLibre layer for 2D dock dots (keeps DOCKS mark working) ----
  function mPerDeg(latDeg) {
    const lat = latDeg * Math.PI / 180;
    return { mPerDegLat: 111320, mPerDegLon: 111320 * Math.cos(lat) };
  }
  function offsetMetersToLonLat(lat0, lon0, dx_m, dy_m) {
    const { mPerDegLat, mPerDegLon } = mPerDeg(lat0);
    return [lon0 + dx_m / mPerDegLon, lat0 + dy_m / mPerDegLat];
  }
  function ensureDockLayer() {
    if (!map || !design) return;
    const anchor = design.anchor || { lat: 22.94, lon: 72.62 };
    const fp = design.footprint || { width_m: 120, depth_m: 80 };
    const inbound = [];
    for (let i=0;i<5;i++){
      const x = ((i + 0.5) / 5 - 0.5) * fp.width_m;
      const y = +fp.depth_m / 2;
      inbound.push(offsetMetersToLonLat(anchor.lat, anchor.lon, x, y));
    }
    const outbound = [ offsetMetersToLonLat(anchor.lat, anchor.lon, 0, -fp.depth_m/2) ];
    const feats = [
      ...inbound.map(p=>({type:"Feature",properties:{dir:"in"}, geometry:{type:"Point",coordinates:p}})),
      ...outbound.map(p=>({type:"Feature",properties:{dir:"out"},geometry:{type:"Point",coordinates:p}}))
    ];
    if (!map.getSource("wh-docks-src")) {
      map.addSource("wh-docks-src", { type:"geojson", data:{ type:"FeatureCollection", features:feats } });
    } else {
      map.getSource("wh-docks-src").setData({ type:"FeatureCollection", features:feats });
    }
    if (!map.getLayer("wh-docks")) {
      map.addLayer({
        id:"wh-docks", type:"circle", source:"wh-docks-src",
        paint:{
          "circle-color":["match",["get","dir"],"in","#60a5fa","out","#34d399","#9ca3af"],
          "circle-radius":6,"circle-opacity":0.95,
          "circle-stroke-color":"#0b0b0d","circle-stroke-width":1
        }
      });
    }
  }
  function hookDockPulse() {
    if (_origSetPaintProperty) return;
    _origSetPaintProperty = map.setPaintProperty.bind(map);
    map.setPaintProperty = (layerId, prop, value, klass) => {
      const r = _origSetPaintProperty(layerId, prop, value, klass);
      if (layerId === "wh-docks" && prop === "circle-radius") pulseUntil = performance.now() + 1600;
      return r;
    };
  }

  // ---- 3D dock highlights (5 north + 1 south) ----
  function buildDockHighlightsAround(glbRoot) {
    const box = boxOf(glbRoot);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const W = size.x, D = size.z; if (!(W>0 && D>0)) { warn("dock highlights skipped: empty bbox"); return; }
    const northZ = center.z + D * 0.5 + 0.01;
    const southZ = center.z - D * 0.5 + 0.01;
    const y = box.min.y + 0.02;
    const matIn  = new THREE.MeshBasicMaterial({ color:0x60a5fa, transparent:true, opacity:0.35 });
    const matOut = new THREE.MeshBasicMaterial({ color:0x34d399, transparent:true, opacity:0.35 });

    for (let i=0;i<5;i++){
      const x = center.x + ((i + 0.5) / 5 - 0.5) * W;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W / (5 + 0.25), D * 0.06), matIn);
      m.position.set(x, y, northZ); m.rotation.x = -Math.PI/2; scene.add(m); dockHighlights.push(m);
    }
    { const m = new THREE.Mesh(new THREE.PlaneGeometry(W / 5, D * 0.06), matOut);
      m.position.set(center.x, y, southZ); m.rotation.x = -Math.PI/2; scene.add(m); dockHighlights.push(m); }
  }

  // ---- KPI to stats ----
  function computeThroughputUPH() {
    const docks = Array.isArray(design?.docks) ? design.docks : [];
    const inbound = docks.filter(d=>String(d.type||"").toLowerCase()==="inbound").length || 5;
    const overlapOut = Number(design?.peak_overlap?.outbound ?? 1);
    const concurrent = inbound + overlapOut; // 5 + 1 = 6
    const turn = Number(design?.dock_turn_min ?? 12);
    return Math.round((concurrent * 60) / Math.max(1, turn));
  }
  function writeKPIToStats() {
    const uph = computeThroughputUPH();
    const tbody = $("#statsTable tbody"); if(!tbody) return;
    tbody.innerHTML = "";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>Aslali Warehouse</td><td>—</td><td class="pos">+${uph}/hr</td><td class="neg">-${uph}/hr</td>`;
    tbody.appendChild(tr);
  }

  // ---- Fallback geometry if GLB missing ----
  function addFallbackWarehouse() {
    warn("Using fallback placeholder geometry (GLB missing or invalid).");
    const fp = design?.footprint || { width_m:120, depth_m:80, height_m:12 };
    const geom = new THREE.BoxGeometry(fp.width_m, fp.height_m, fp.depth_m);
    const mat  = new THREE.MeshStandardMaterial({ color:0xdedede, metalness:0, roughness:0.9, transparent:true, opacity:0.95 });
    glb = new THREE.Mesh(geom, mat); glb.position.set(0, fp.height_m/2, 0); scene.add(glb);
  }

  async function build(mapInstance, designJson) {
    dispose();
    map = mapInstance; design = designJson || {};
    const container = map.getContainer ? map.getContainer() : (document.getElementById("stage") || document.body);

    rootEl = makeRoot(container);
    rootEl.style.display = "";                     // ensure visible before measuring
    renderer = makeRenderer(rootEl);
    scene = new THREE.Scene();
    camera = makeCamera();
    addLights(scene);

    let loaded = false;
    await new Promise((resolve) => {
      // Cross-version/global detection for GLTFLoader
      const LoaderCtor =
        (window.GLTFLoader && typeof window.GLTFLoader === "function") ? window.GLTFLoader :
        (THREE.GLTFLoader && typeof THREE.GLTFLoader === "function") ? THREE.GLTFLoader :
        null;

      if (!LoaderCtor) {
        err("GLTFLoader not available on window or THREE.");
        resolve(); return;
      }
      const loader = new LoaderCtor();
      loader.load(
        `${GLB_URL}?v=${Date.now()}`,
        (gltf) => {
          try {
            glb = gltf.scene || gltf.scenes?.[0];
            if (!glb) throw new Error("no scene in glb");
            scene.add(glb);
            centerAndAutoscaleToFootprint(glb);
            fitCameraToObject(camera, glb);
            buildDockHighlightsAround(glb);
            loaded = true;
            log("GLB loaded OK");
          } catch (e) { err("GLB parse error:", e); }
          resolve();
        },
        undefined,
        (e) => { err("GLB load failed:", e?.message||e); resolve(); }
      );
    });

    if (!loaded) {
      addFallbackWarehouse();
      fitCameraToObject(camera, glb);
      buildDockHighlightsAround(glb);
    }

    ensureDockLayer(); hookDockPulse();

    show(); onResize(); writeKPIToStats(); animate();
    window.addEventListener("resize", onResize);
    if (map && map.on) map.on("resize", onResize);
  }

  function show(){ if(rootEl) rootEl.style.display = ""; }
  function hide(){ if(rootEl) rootEl.style.display = "none"; }
  function dispose() {
    try{
      if (rafId) cancelAnimationFrame(rafId); rafId = null;
      dockHighlights.length = 0;
      if (renderer) { renderer.dispose?.(); renderer.domElement?.parentNode?.removeChild(renderer.domElement); }
      rootEl?.parentNode?.removeChild(rootEl);
      rootEl = null; renderer = null; scene = null; camera = null; glb = null;
      if (map && _origSetPaintProperty) { map.setPaintProperty = _origSetPaintProperty; _origSetPaintProperty = null; }
      if (map?.getLayer?.("wh-docks"))     try{ map.removeLayer("wh-docks"); }catch(_){}
      if (map?.getSource?.("wh-docks-src"))try{ map.removeSource("wh-docks-src"); }catch(_){}
      window.removeEventListener("resize", onResize);
      if (map && map.off) map.off("resize", onResize);
    }catch(_){}
  }

  window.FacilityModel = {
    build, show, hide, dispose,
    pulseDocks: ()=>{ pulseUntil = performance.now() + 1600; }
  };
})();
