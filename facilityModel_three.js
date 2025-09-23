/* facilityModel_three.js
   3D warehouse renderer for MapLibre using Three.js custom layer.

   Exposes:
     window.FacilityModel.build(map, designJSON)
     window.FacilityModel.clear(map)

   Requirements in index.html (before this file):
     <script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script>

   Works with your current /data/warehouse_design_aslali.json:
     {
       "anchor": { "lat": 22.94, "lon": 72.62 },
       "footprint": { "width": 120, "depth": 80, "height": 12 },
       "docks": [...], "bays": [...], "conveyors": [...],
       "truckPaths": { "inbound":[[lon,lat],...], "outbound":[[lon,lat],...] }
     }

   Notes:
   - If bays/conveyors are given in local meters (x,y), we convert them to lon/lat.
   - If they are already lon/lat pairs, we use as-is.
*/

(function () {
  if (!window.THREE) {
    console.error("[FacilityModel] THREE.js not found. Include it before facilityModel_three.js");
    return;
  }

  // ------------- utilities -------------
  const T = THREE;

  function metersPerDegLat() { return 111_320; }
  function metersPerDegLon(latDeg) {
    return 111_320 * Math.cos(latDeg * Math.PI / 180);
  }

  // Convert local design meters (0..width/0..depth) to lon/lat around anchor
  function localToLngLat(anchor, x, y, width, depth) {
    const sw = {
      lon: anchor.lon - (width / 2) / metersPerDegLon(anchor.lat),
      lat: anchor.lat - (depth / 2) / metersPerDegLat()
    };
    return [
      sw.lon + (x / metersPerDegLon(anchor.lat)),
      sw.lat + (y / metersPerDegLat())
    ];
  }

  // Detect if a [a,b] pair looks like lon/lat (loose check)
  function looksLonLat(p) {
    if (!Array.isArray(p) || p.length < 2) return false;
    const [x, y] = p;
    return (Math.abs(x) <= 180 && Math.abs(y) <= 90);
  }

  // Map lon/lat(+alt) to mercator units for Three.js
  function toMerc(map, lng, lat, altMeters = 0) {
    const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, altMeters);
    return new T.Vector3(mc.x, mc.y, mc.z);
  }

  function mercScaleAt(map, lat, lon) {
    const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: lon, lat: lat }, 0);
    // meter to mercator scale
    return mc.meterInMercatorCoordinateUnits();
  }

  // Build a smooth line (THREE.Line) from lon/lat points at a given altitude (meters)
  function buildLineFromLonLat(map, coords, altMeters, color, width = 2) {
    const geo = new T.BufferGeometry();
    const verts = [];
    for (const [lon, lat] of coords) {
      const v = toMerc(map, lon, lat, altMeters);
      verts.push(v.x, v.y, v.z);
    }
    geo.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(verts), 3));
    const mat = new T.LineBasicMaterial({ color, linewidth: width }); // linewidth ignored in most WebGL, but ok
    return new T.Line(geo, mat);
  }

  // Move a small box along a polyline (mercator coords), looping
  function TruckAnimator(pathLonLat, speedMetersPerSec, colorHex) {
    this.coords = pathLonLat || [];
    this.color = colorHex || 0xffffff;
    this.speed = Math.max(0.1, speedMetersPerSec || 2.0);
    this.distances = [];
    this.total = 0;
    this.mesh = null; // THREE.Mesh

    this._rebuild = (map) => {
      // Precompute mercator vertices and segment lengths
      this.merc = this.coords.map(([lon, lat]) =>
        toMerc(map, lon, lat, 1.5)
      );
      this.distances.length = 0;
      this.total = 0;
      for (let i = 1; i < this.merc.length; i++) {
        const d = this.merc[i].clone().sub(this.merc[i - 1]).length();
        this.total += d;
        this.distances.push(d);
      }
      if (!this.mesh) {
        const g = new T.BoxGeometry(1.8, 0.9, 0.9);
        const m = new T.MeshStandardMaterial({ color: this.color, metalness: 0.2, roughness: 0.6 });
        this.mesh = new T.Mesh(g, m);
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = false;
      }
      this._t = 0; // 0..total
    };

    this.addTo = (map, parent) => {
      if (!this.coords || this.coords.length < 2) return;
      this._rebuild(map);
      parent.add(this.mesh);
    };

    this.update = (dt) => {
      if (!this.mesh || this.merc.length < 2) return;
      this._t = (this._t + this.speed * dt) % this.total;
      // find segment
      let acc = 0;
      for (let i = 0; i < this.distances.length; i++) {
        const seg = this.distances[i];
        if (acc + seg >= this._t) {
          const t = (this._t - acc) / seg;
          const a = this.merc[i];
          const b = this.merc[i + 1];
          const pos = new T.Vector3().lerpVectors(a, b, t);
          this.mesh.position.copy(pos);
          // face direction
          const dir = b.clone().sub(a).normalize();
          const yaw = Math.atan2(dir.y, dir.x);
          this.mesh.rotation.set(0, 0, 0);
          // rotate around Z so long axis points along path in XY plane
          this.mesh.rotation.z = yaw;
          return;
        }
        acc += seg;
      }
    };
  }

  // ------------- custom layer state -------------
  const LAYER_ID = "facility-3d-layer";
  let _layerAdded = false;

  const state = {
    map: null,
    scene: null,
    camera: null,
    renderer: null,
    threeRoot: null,
    clock: new T.Clock(),
    animObjs: [],   // TruckAnimator instances
    cleanupFns: []
  };

  function resetState() {
    // remove refs to aid GC
    state.scene = null;
    state.camera = null;
    state.renderer = null;
    state.threeRoot = null;
    state.animObjs.length = 0;
    state.cleanupFns.forEach(fn => { try { fn(); } catch(_){} });
    state.cleanupFns.length = 0;
    _layerAdded = false;
  }

  // ------------- building the scene -------------
  function buildWarehouse(map, design) {
    const anchor = design.anchor || { lat: 22.94, lon: 72.62 };
    const fp = design.footprint || { width: 120, depth: 80, height: 12 };
    const scaleM = mercScaleAt(map, anchor.lat, anchor.lon);

    // Root object attached at anchor position (0,0,0 local)
    const root = new T.Group();
    const rootPos = toMerc(map, anchor.lon, anchor.lat, 0);
    root.position.copy(rootPos);

    // Ground halo
    {
      const gx = fp.width * 1.35 * scaleM;
      const gy = fp.depth * 1.35 * scaleM;
      const gz = 0.1 * scaleM;
      const geom = new T.BoxGeometry(gx, gy, gz);
      const mat = new T.MeshBasicMaterial({ color: 0x253045, transparent: true, opacity: 0.35 });
      const mesh = new T.Mesh(geom, mat);
      mesh.position.set(0, 0, gz * 0.5);
      root.add(mesh);
    }

    // Building (extruded box)
    {
      const bx = fp.width * scaleM;
      const by = fp.depth * scaleM;
      const bz = fp.height * scaleM;
      const geom = new T.BoxGeometry(bx, by, bz);
      const mat = new T.MeshPhongMaterial({ color: 0xc6cdd8, shininess: 40, side: T.DoubleSide });
      const mesh = new T.Mesh(geom, mat);
      mesh.position.set(0, 0, bz * 0.5);
      root.add(mesh);
    }

    // Simple white floor plate to see bays
    {
      const fx = fp.width * scaleM;
      const fy = fp.depth * scaleM;
      const geom = new T.PlaneGeometry(fx, fy);
      const mat = new T.MeshBasicMaterial({ color: 0x2b3340, transparent: true, opacity: 0.35, side: T.DoubleSide });
      const floor = new T.Mesh(geom, mat);
      floor.rotation.x = Math.PI / 2; // lay flat (plane is XY in three; we want XZ)
      // BUT our Box is centered; keep consistent: we placed box with X (east-west), Y (north-south), Z (up).
      // The plane here is XY; to match map plane XY, we keep rotation 0 and lift slightly.
      // (In mercator, Z is up; XY is map plane). So actually we don't rotate, just lift:
      floor.rotation.set(0, 0, 0);
      floor.position.set(0, 0, 0.02 * scaleM);
      root.add(floor);
    }

    // Bays (rects inside the footprint). They may be local meters or lon/lat.
    if (Array.isArray(design.bays)) {
      for (const b of design.bays) {
        const rect = b.rect || [];
        if (rect.length === 4) {
          const [x, y, w, h] = rect;
          // convert local (meters) to mercator offset
          const cx = (x + w / 2 - fp.width / 2) * scaleM;
          const cy = (y + h / 2 - fp.depth / 2) * scaleM;
          const geom = new T.BoxGeometry(w * scaleM, h * scaleM, 0.4 * scaleM);
          const mat = new T.MeshBasicMaterial({ color: 0x00d08a, transparent: true, opacity: 0.35 });
          const plate = new T.Mesh(geom, mat);
          plate.position.set(cx, cy, 0.25 * scaleM);
          root.add(plate);
        } else if (looksLonLat(rect[0])) {
          // future: polygon bays in lon/lat (not used now)
        }
      }
    }

    // Conveyors: lines; points may be local or lon/lat
    if (Array.isArray(design.conveyors)) {
      for (const c of design.conveyors) {
        let pts = c.points || [];
        if (!pts || pts.length < 2) continue;

        // Normalize to lon/lat
        if (!looksLonLat(pts[0])) {
          pts = pts.map(([x, y]) => localToLngLat(anchor, x, y, fp.width, fp.depth));
        }

        const color = (c.type || "").toLowerCase() === "mechanical" ? 0x14b8a6 : 0xf59e0b;
        const line = buildLineFromLonLat(map, pts, 1.2, color, 3);
        root.add(line);
      }
    }

    // Docks: small posts placed on perimeter side = north/south/east/west
    if (Array.isArray(design.docks)) {
      const n = { north: [], south: [], east: [], west: [] };
      for (const d of design.docks) {
        const side = (d.side || "").toLowerCase();
        if (side === "north") n.north.push(d);
        else if (side === "south") n.south.push(d);
        else if (side === "east") n.east.push(d);
        else if (side === "west") n.west.push(d);
      }
      const mkDock = (x, y, inbound) => {
        const r = 2.2 * scaleM;
        const geom = new T.CylinderGeometry(r, r, 3 * scaleM, 12);
        const mat = new T.MeshStandardMaterial({
          color: inbound ? 0x2563eb : 0xb91c1c,
          metalness: 0.1, roughness: 0.5
        });
        const m = new T.Mesh(geom, mat);
        m.position.set(x, y, 1.6 * scaleM);
        root.add(m);
      };
      const place = (arr, side) => {
        const len = arr.length;
        if (!len) return;
        for (let i = 0; i < len; i++) {
          let x = 0, y = 0;
          if (side === "north") { x = ((i + 1) * (fp.width / (len + 1)) - fp.width / 2) * scaleM; y = (fp.depth / 2) * scaleM; }
          if (side === "south") { x = ((i + 1) * (fp.width / (len + 1)) - fp.width / 2) * scaleM; y = (-fp.depth / 2) * scaleM; }
          if (side === "east") { x = (fp.width / 2) * scaleM; y = ((i + 1) * (fp.depth / (len + 1)) - fp.depth / 2) * scaleM; }
          if (side === "west") { x = (-fp.width / 2) * scaleM; y = ((i + 1) * (fp.depth / (len + 1)) - fp.depth / 2) * scaleM; }
          const inbound = (arr[i].type || "").toLowerCase() === "inbound";
          mkDock(x, y, inbound);
        }
      };
      place(n.north, "north"); place(n.south, "south");
      place(n.east, "east"); place(n.west, "west");
    }

    // Truck paths (lon/lat) + animated trucks
    const trs = [];
    const tp = design.truckPaths || {};
    if (Array.isArray(tp.inbound) && tp.inbound.length >= 2) {
      const line = buildLineFromLonLat(map, tp.inbound, 0.8, 0x60a5fa, 2);
      root.add(line);
      // 5 inbound trucks staggered
      for (let i = 0; i < 5; i++) {
        const anim = new TruckAnimator(tp.inbound, 8.0, 0x38bdf8);
        trs.push(anim);
      }
    }
    if (Array.isArray(tp.outbound) && tp.outbound.length >= 2) {
      const line = buildLineFromLonLat(map, tp.outbound, 0.8, 0xfca5a5, 2);
      root.add(line);
      for (let i = 0; i < 5; i++) {
        const anim = new TruckAnimator(tp.outbound, 8.0, 0xf43f5e);
        trs.push(anim);
      }
    }

    // Add a little light so meshes are visible
    {
      const amb = new T.AmbientLight(0xffffff, 0.8);
      root.add(amb);
      const dir = new T.DirectionalLight(0xffffff, 0.6);
      dir.position.set(100, -100, 200);
      root.add(dir);
    }

    // Prepare animators
    trs.forEach(a => a.addTo(map, root));
    state.animObjs = trs;

    return root;
  }

  function addCustomLayer(map, design) {
    if (_layerAdded) return;

    const customLayer = {
      id: LAYER_ID,
      type: "custom",
      renderingMode: "3d",

      onAdd: function (map_, gl) {
        state.map = map_;

        state.scene = new T.Scene();
        state.camera = new T.Camera();
        state.renderer = new T.WebGLRenderer({
          canvas: map_.getCanvas(),
          context: gl,
          antialias: true
        });
        state.renderer.autoClear = false;

        // build scene graph for this design
        state.threeRoot = buildWarehouse(map_, design);
        state.scene.add(state.threeRoot);

        // clean-up handlers
        state.cleanupFns.push(() => {
          try { state.scene.remove(state.threeRoot); } catch (_){}
          try { state.renderer.dispose(); } catch (_){}
        });
      },

      render: function (gl, matrix) {
        if (!state.scene || !state.camera || !state.renderer) return;

        // Sync camera from MapLibre
        const m = new T.Matrix4().fromArray(matrix);
        state.camera.projectionMatrix = m;

        // Advance animators
        const dt = state.clock.getDelta();
        for (const a of state.animObjs) a.update(dt);

        state.renderer.resetState();
        state.renderer.render(state.scene, state.camera);
        // Ask MapLibre to continue rendering for animation
        state.map.triggerRepaint();
      },

      onRemove: function () {
        resetState();
      }
    };

    map.addLayer(customLayer);
    _layerAdded = true;
  }

  // ------------- public API -------------
  window.FacilityModel = {
    build(map, design) {
      try {
        // remove old if exists
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(LAYER_ID)) map.removeSource(LAYER_ID);
      } catch (_) {}

      addCustomLayer(map, design);

      if (window.Narrator) {
        window.Narrator.sayOnce("3D facility loaded — docks, bays, conveyors, and animated yard trucks are visible.");
      }
    },

    clear(map) {
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      } catch (_) {}
      resetState();
    }
  };
})();
