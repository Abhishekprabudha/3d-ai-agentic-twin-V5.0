// facilityModel_three.js — Parametric warehouse overlay (no GLB)
// Renders a full warehouse using primitives on a MapLibre custom 3D layer.
// Exposes: window.FacilityModel = { build(map, designJson), showKPI(on) }

(function () {
  const LAYER_ID = "facility-3d";
  const DOCK_LAYER_ID = "wh-docks";
  const DOCK_SOURCE_ID = "wh-docks-src";

  const COLORS = {
    floor: 0x5c6370,        // slate
    wall:  0xf2efe8,        // warm ivory
    dockIn: 0x60a5fa,       // blue
    dockOut: 0x00c853,      // green
    conveyor: 0x2f3a4a,     // dark steel
    bayPallet: 0xe5b76b,    // pallet boxes
    bayPad: 0x9bb2c7,       // cool grey
    apron: 0x93c5fd         // soft blue
  };

  let kpiDiv = null;

  function ensureKPI() {
    if (!kpiDiv) {
      kpiDiv = document.createElement("div");
      kpiDiv.style.cssText = [
        "position:fixed; right:14px; top:14px; z-index:15;",
        "background:rgba(10,12,16,.9); color:#eaf1f7;",
        "border:1px solid #2a2f36; border-radius:10px;",
        "padding:10px 12px; font:13px/1.35 system-ui;",
        "box-shadow:0 8px 24px rgba(0,0,0,.25); display:none;"
      ].join("");
      kpiDiv.textContent = "Required docks: 6 (5 inbound + 1 outbound overlap)";
      document.body.appendChild(kpiDiv);
    }
    return kpiDiv;
  }
  function showKPI(on = true) {
    ensureKPI().style.display = on ? "block" : "none";
  }
  const deg2rad = (d) => (d || 0) * Math.PI / 180;

  function removeIf(map, id, isLayer = true) {
    try {
      if (isLayer ? map.getLayer(id) : map.getSource(id)) {
        isLayer ? map.removeLayer(id) : map.removeSource(id);
      }
    } catch (e) {}
  }

  function addDockPulsePoint(map, lon, lat) {
    removeIf(map, DOCK_LAYER_ID, true);
    removeIf(map, DOCK_SOURCE_ID, false);
    map.addSource(DOCK_SOURCE_ID, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lon, lat] } }]
      }
    });
    map.addLayer({
      id: DOCK_LAYER_ID, type: "circle", source: DOCK_SOURCE_ID,
      paint: { "circle-color": "#60a5fa", "circle-radius": 6, "circle-opacity": 0.95 }
    });
  }

  function makeTextSprite(text, px = 64) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 256;
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.font = `bold ${px}px system-ui, Segoe UI, Roboto, sans-serif`;
    g.fillStyle = "#e9edf2";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(text || ""), c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  }

  // Build ALL geometry in METERS (s = 1). The map matrix will scale meters -> mercator units.
  function buildGeometry(group, design) {
    const fp = design.footprint || { width_m: 120, depth_m: 80, height_m: 12, rotation_deg: 0 };
    const W = fp.width_m, D = fp.depth_m, H = fp.height_m;

    // Lights
    group.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(120, -160, 180);
    group.add(dir);

    // Floor
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(W, D, 0.6),
      new THREE.MeshPhongMaterial({ color: COLORS.floor, shininess: 12 })
    );
    floor.position.set(0, 0, 0.3);
    group.add(floor);

    // Walls
    const t = 0.6; // thickness
    const wallMat = new THREE.MeshPhongMaterial({ color: COLORS.wall, shininess: 8 });
    const north = new THREE.Mesh(new THREE.BoxGeometry(W, t, H), wallMat);
    north.position.set(0, (D / 2 - t / 2), H / 2);
    const south = new THREE.Mesh(new THREE.BoxGeometry(W, t, H), wallMat);
    south.position.set(0, (-D / 2 + t / 2), H / 2);
    const east = new THREE.Mesh(new THREE.BoxGeometry(t, D, H), wallMat);
    east.position.set((W / 2 - t / 2), 0, H / 2);
    const west = new THREE.Mesh(new THREE.BoxGeometry(t, D, H), wallMat);
    west.position.set((-W / 2 + t / 2), 0, H / 2);
    const walls = new THREE.Group();
    walls.add(north, south, east, west);
    group.add(walls);

    // Dock doors (5 north inbound, 5 south outbound)
    const dockGap = W / 6;
    const doorW = Math.min(8, dockGap * 0.82);
    const doorH = Math.min(6, H * 0.66);
    const frameT = 0.35;
    function addDoor(x, y, inbound) {
      const g = new THREE.Group();
      const mat = new THREE.MeshPhongMaterial({ color: inbound ? COLORS.dockIn : COLORS.dockOut, shininess: 22 });
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW, frameT, frameT), mat);
      lintel.position.set(0, 0, doorH + frameT / 2);
      const postL = new THREE.Mesh(new THREE.BoxGeometry(frameT, frameT, doorH), mat);
      postL.position.set(-doorW / 2 + frameT / 2, 0, doorH / 2);
      const postR = postL.clone(); postR.position.x = doorW / 2 - frameT / 2;
      g.add(lintel, postL, postR);
      g.position.set(x, y, 0.1);
      group.add(g);
    }
    for (let i = 0; i < 5; i++) {
      const x = -W / 2 + dockGap * (i + 1);
      addDoor(x, ( D / 2 - t / 2), true );  // inbound north
      addDoor(x, (-D / 2 + t / 2), false);  // outbound south
    }

    // Bays: interpret rect_m as [x,y,w,h] from BOTTOM-LEFT of floor (meters)
    (design.bays || []).forEach(b => {
      const [x, y, w, h] = b.rect_m;
      const isBag = (b.type || "").toLowerCase().includes("bag");
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, 0.2),
        new THREE.MeshPhongMaterial({ color: COLORS.bayPad, shininess: 6, transparent: true, opacity: 0.85 })
      );
      pad.position.set((x - W / 2 + w / 2), (y - D / 2 + h / 2), 0.1);
      group.add(pad);

      if (!isBag) {
        const n = Math.max(1, Math.floor((w * h) / 60));
        for (let i = 0; i < n; i++) {
          const bx = x + ((i % 3) + 0.5) * (w / 3);
          const by = y + (Math.floor(i / 3) + 0.5) * (h / 3);
          const pallet = new THREE.Mesh(
            new THREE.BoxGeometry(4, 4, 2),
            new THREE.MeshPhongMaterial({ color: COLORS.bayPallet, shininess: 8 })
          );
          pallet.position.set(bx - W / 2, by - D / 2, 1.1);
          group.add(pallet);
        }
      }

      const lbl = makeTextSprite((b.type || "BAY").toUpperCase(), 64);
      lbl.scale.set(20, 8, 1);
      lbl.position.set((x - W / 2 + w / 2), (y - D / 2 + h / 2), 6);
      group.add(lbl);
    });

    // Conveyors: interpret points_m as meters centered at (0,0)
    (design.conveyors || []).forEach(c => {
      const pts = (c.points_m || []).map(p => new THREE.Vector3(p[0], p[1], 1.2));
      if (pts.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.TubeGeometry(curve, 60, 0.5, 8, false);
      const mesh = new THREE.Mesh(tube, new THREE.MeshPhongMaterial({ color: COLORS.conveyor, shininess: 12 }));
      group.add(mesh);
    });

    // Truck aprons: interpret truckPaths_m as meters centered at (0,0)
    function addApron(points, color) {
      if (!points || points.length < 2) return;
      const vecs = points.map(p => new THREE.Vector3(p[0], p[1], 0.3));
      const geo = new THREE.BufferGeometry().setFromPoints(vecs);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
      group.add(line);
    }
    if (design.truckPaths_m?.inbound)  addApron(design.truckPaths_m.inbound,  COLORS.apron);
    if (design.truckPaths_m?.outbound) addApron(design.truckPaths_m.outbound, COLORS.apron);

    // IN/OUT wall labels
    const inLbl = makeTextSprite("IN", 64);  inLbl.scale.set(12, 6, 1); inLbl.position.set(0,  D/2 - 1.5, 6); group.add(inLbl);
    const outLbl = makeTextSprite("OUT", 64); outLbl.scale.set(14, 6, 1); outLbl.position.set(0, -D/2 + 1.5, 6); group.add(outLbl);

    // Apply rotation about Z (degrees)
    group.rotation.z = deg2rad(fp.rotation_deg || 0);
  }

  function build(map, design) {
    // clean previous layers/sources
    removeIf(map, LAYER_ID, true);
    removeIf(map, DOCK_LAYER_ID, true);
    removeIf(map, DOCK_SOURCE_ID, false);

    // anchor & pulse point
    const anchor = design.anchor || { lat: 22.94, lon: 72.62 };
    addDockPulsePoint(map, anchor.lon, anchor.lat);

    // Mercator scaling
    const merc = maplibregl.MercatorCoordinate.fromLngLat([anchor.lon, anchor.lat], 0);
    const metersToMerc = merc.meterInMercatorCoordinateUnits();

    // Custom 3D layer
    const customLayer = {
      id: LAYER_ID,
      type: "custom",
      renderingMode: "3d",
      onAdd: function (map_, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();

        // Use map's WebGL context; do not clear
        this.renderer = new THREE.WebGLRenderer({
          canvas: map_.getCanvas(),
          context: gl,
          antialias: true
        });
        this.renderer.autoClear = false;

        this.group = new THREE.Group();
        this.scene.add(this.group);

        // Build all geometry in meters (we'll scale in the matrix)
        buildGeometry(this.group, design);
      },
      render: function (gl, matrix) {
        // map projection matrix
        const m = new THREE.Matrix4().fromArray(matrix);
        // translate to anchor and scale meters->mercator (flip Y)
        const l = new THREE.Matrix4()
          .makeTranslation(merc.x, merc.y, merc.z)
          .scale(new THREE.Vector3(metersToMerc, -metersToMerc, metersToMerc));

        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);

        // keep repainting smoothly (for any subtle animations later)
        map.triggerRepaint();
      },
      onRemove: function () {
        try { this.renderer.dispose(); } catch(e){}
      }
    };

    map.addLayer(customLayer);
    return Promise.resolve();
  }

  window.FacilityModel = { build, showKPI };
})();
