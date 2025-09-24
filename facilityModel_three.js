// facilityModel_three.js — Parametric warehouse only (no GLB)
// Works with THREE global (three.min.js) and MapLibre custom 3D layer.

(function () {
  const LAYER_ID = "facility-3d";
  const DOCK_LAYER_ID = "wh-docks";
  const DOCK_SOURCE_ID = "wh-docks-src";

  // colors
  const COLORS = {
    floor: 0x5c6370,       // slate
    wall: 0xf2efe8,        // warm ivory
    dockInbound: 0x60a5fa, // blue
    dockOutbound: 0x00c853, // green
    conveyor: 0x2f3a4a,    // dark steel
    bayPallet: 0xe5b76b,   // pallet boxes
    bayBag: 0x9bb2c7,      // cool grey
    lineApron: 0x93c5fd    // soft blue
  };

  // state
  let current = null; // {map, design, layer, camera, scene, renderer, merc, scale, group}
  let kpiDiv = null;

  // ---- small utils ----
  const rad = (deg) => (deg || 0) * Math.PI / 180;

  function ensureKPI() {
    if (!kpiDiv) {
      kpiDiv = document.createElement("div");
      kpiDiv.id = "kpiDock";
      kpiDiv.style.cssText =
        "position:fixed; right:14px; top:14px; z-index:15; background:rgba(10,12,16,.9); color:#eaf1f7; border:1px solid #2a2f36; border-radius:10px; padding:10px 12px; font:13px/1.35 system-ui; box-shadow:0 8px 24px rgba(0,0,0,.25); display:none;";
      kpiDiv.textContent = "Required docks: 6 (5 inbound + 1 outbound overlap)";
      document.body.appendChild(kpiDiv);
    }
    return kpiDiv;
  }

  // Expose KPI toggle so playDesignWarehouse can call it on the KPI mark.
  function showKPI(on=true) {
    const el = ensureKPI();
    el.style.display = on ? "block" : "none";
  }

  // text sprite (for BAY labels etc)
  function makeTextSprite(text, hex = 0xffffff, px = 64) {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 256;
    const g = canvas.getContext("2d");
    g.clearRect(0,0,canvas.width,canvas.height);
    g.fillStyle = "rgba(0,0,0,0)";
    g.fillRect(0,0,canvas.width,canvas.height);
    g.font = `bold ${px}px system-ui, Segoe UI, Roboto, sans-serif`;
    g.fillStyle = "#e9edf2";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, canvas.width/2, canvas.height/2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const spr = new THREE.Sprite(mat);
    // size in meters: ~ (w,h) scaled later by mercator scale
    spr.userData.canvas = canvas;
    return spr;
  }

  function removeIfExists(map, id, isLayer=true) {
    try { if (isLayer ? map.getLayer(id) : map.getSource(id)) {
      isLayer ? map.removeLayer(id) : map.removeSource(id);
    }} catch(e){}
  }

  function addDockPulsePoint(map, lon, lat) {
    removeIfExists(map, DOCK_LAYER_ID, true);
    removeIfExists(map, DOCK_SOURCE_ID, false);
    map.addSource(DOCK_SOURCE_ID, {
      type: "geojson",
      data: { type:"FeatureCollection", features:[
        { type:"Feature", properties:{}, geometry:{ type:"Point", coordinates:[lon, lat] } }
      ]}
    });
    map.addLayer({
      id: DOCK_LAYER_ID, type:"circle", source: DOCK_SOURCE_ID,
      paint: { "circle-color":"#60a5fa", "circle-radius": 6, "circle-opacity":0.95 }
    });
  }

  // build parametric model into a group at origin (0,0,0). We'll attach transform via matrix in render.
  function buildGeometry(group, design, scale) {
    const fp = design.footprint || { width_m: 120, depth_m: 80, height_m: 12, rotation_deg: 0 };
    const W = fp.width_m, D = fp.depth_m, H = fp.height_m;
    const s = scale;

    const upZ = H * s;

    // ---- lights ----
    const amb = new THREE.AmbientLight(0xffffff, 0.55);
    group.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(120*s, -160*s, 180*s);
    group.add(dir);

    // ---- floor slab ----
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(W*s, D*s, 0.6*s),
      new THREE.MeshPhongMaterial({ color: COLORS.floor, shininess: 12 })
    );
    floor.position.set(0, 0, 0.3*s);
    group.add(floor);

    // ---- walls ----
    const t = 0.6; // wall thickness (m)
    const wallMat = new THREE.MeshPhongMaterial({ color: COLORS.wall, shininess: 8 });
    const walls = new THREE.Group();
    const north = new THREE.Mesh(new THREE.BoxGeometry(W*s, t*s, H*s), wallMat);
    north.position.set(0, (D/2 - t/2)*s, H*s/2);
    const south = new THREE.Mesh(new THREE.BoxGeometry(W*s, t*s, H*s), wallMat);
    south.position.set(0, (-D/2 + t/2)*s, H*s/2);
    const east = new THREE.Mesh(new THREE.BoxGeometry(t*s, D*s, H*s), wallMat);
    east.position.set((W/2 - t/2)*s, 0, H*s/2);
    const west = new THREE.Mesh(new THREE.BoxGeometry(t*s, D*s, H*s), wallMat);
    west.position.set((-W/2 + t/2)*s, 0, H*s/2);
    walls.add(north, south, east, west);
    group.add(walls);

    // ---- dock doors (5 north inbound, 5 south outbound) ----
    const dockW = W / 6; // spacing bays
    const doorW = Math.min(8, dockW * 0.82);  // m
    const doorH = Math.min(6, H * 0.66);      // m
    const frameT = 0.35;

    function addDoor(xm, ym, inbound=true) {
      const door = new THREE.Group();
      const frameMat = new THREE.MeshPhongMaterial({ color: inbound? COLORS.dockInbound : COLORS.dockOutbound, shininess: 20 });
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW*s, frameT*s, frameT*s), frameMat);
      lintel.position.set(0, 0, (doorH+frameT/2)*s);
      const postL = new THREE.Mesh(new THREE.BoxGeometry(frameT*s, frameT*s, doorH*s), frameMat);
      postL.position.set((-doorW/2 + frameT/2)*s, 0, (doorH/2)*s);
      const postR = postL.clone(); postR.position.x = (doorW/2 - frameT/2)*s;
      door.add(lintel, postL, postR);
      door.position.set(xm*s, ym*s, (H*0.05)*s);
      group.add(door);
    }

    for (let i=0;i<5;i++) {
      const x = -W/2 + dockW*(i+1);
      addDoor(x,  D/2 - t/2, true);   // inbound north
      addDoor(x, -D/2 + t/2, false);  // outbound south
    }

    // ---- bays ----
    (design.bays||[]).forEach(b=>{
      const [x,y,w,h] = b.rect_m;
      const isBag = (b.type||'').toLowerCase().includes('bag');
      const col = isBag ? COLORS.bayBag : 0x8897a8;
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(w*s, h*s, 0.2*s),
        new THREE.MeshPhongMaterial({ color: col, shininess: 6, transparent:true, opacity:0.85 })
      );
      pad.position.set((x+w/2 - W/2)*s + W*s/2 - W*s/2, (y+h/2 - D/2)*s + D*s/2 - D*s/2, 0.1*s);
      // Shift to center origin: x,y are already local from (0,0) top-left? The JSON uses [0,0] as internal SW?
      // We'll interpret rect_m coordinates as from bottom-left corner of floor.
      pad.position.set((x - W/2 + w/2)*s, (y - D/2 + h/2)*s, 0.1*s);
      group.add(pad);

      // pallets
      if (!isBag) {
        for (let i=0;i<Math.max(1, Math.floor((w*h)/60)); i++){
          const bx = (x + (i%3+0.5)*(w/3) - W/2)*s;
          const by = (y + (Math.floor(i/3)+0.5)*(h/3) - D/2)*s;
          const stack = new THREE.Mesh(
            new THREE.BoxGeometry(4*s, 4*s, 2*s),
            new THREE.MeshPhongMaterial({ color: COLORS.bayPallet, shininess: 8 })
          );
          stack.position.set(bx, by, 1.2*s);
          group.add(stack);
        }
      }

      // label
      const label = makeTextSprite((b.type||'').toUpperCase() || "BAY");
      // sprite size in meters
      label.scale.set(20*s, 8*s, 1);
      label.position.set((x - W/2 + w/2)*s, (y - D/2 + h/2)*s, 6*s);
      group.add(label);
    });

    // ---- conveyors ----
    const convGrp = new THREE.Group();
    (design.conveyors||[]).forEach(c=>{
      const pts = (c.points_m||[]).map(p=>new THREE.Vector3((p[0]-W/2)*s, (p[1]-D/2)*s, 1.2*s));
      if (pts.length<2) return;
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.TubeGeometry(curve, 60, 0.5*s, 8, false);
      const mat = new THREE.MeshPhongMaterial({ color: COLORS.conveyor, shininess: 12 });
      const mesh = new THREE.Mesh(tube, mat);
      convGrp.add(mesh);
    });
    group.add(convGrp);

    // ---- truck aprons (polylines) ----
    function addApron(points, color) {
      const pts = points.map(p=>new THREE.Vector3((p[0])*s, (p[1])*s, 0.35*s)); // already local meters?
      // Interpret truckPaths_m as local meters relative to center (matches your JSON)
      const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, mat);
      group.add(line);
    }
    if (design.truckPaths_m?.inbound)  addApron(design.truckPaths_m.inbound, COLORS.lineApron);
    if (design.truckPaths_m?.outbound) addApron(design.truckPaths_m.outbound, COLORS.lineApron);

    // rotate whole facility by footprint.rotation_deg (Z-up)
    group.rotation.z = rad(fp.rotation_deg||0);

    // "IN"/"OUT" labels on walls (sprites)
    const inLabel = makeTextSprite("IN");
    inLabel.scale.set(12*s, 6*s, 1);
    inLabel.position.set(0, (D/2 - 1.5)*s, 6*s);
    group.add(inLabel);
    const outLabel = makeTextSprite("OUT");
    outLabel.scale.set(14*s, 6*s, 1);
    outLabel.position.set(0, (-D/2 + 1.5)*s, 6*s);
    group.add(outLabel);
  }

  function build(map, design) {
    // dispose previous
    if (current && map.getLayer(LAYER_ID)) {
      try { map.removeLayer(LAYER_ID); } catch(e){}
    }

    const anchor = design.anchor || { lat: 22.94, lon: 72.62 };
    // pulse point for DOCKS animation
    addDockPulsePoint(map, anchor.lon, anchor.lat);

    // mercator scale
    const merc = maplibregl.MercatorCoordinate.fromLngLat([anchor.lon, anchor.lat], 0);
    const scale = merc.meterInMercatorCoordinateUnits();

    const customLayer = {
      id: LAYER_ID,
      type: 'custom',
      renderingMode: '3d',
      onAdd: function (map_, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();

        // Use the map's GL context
        this.renderer = new THREE.WebGLRenderer({
          canvas: map_.getCanvas(),
          context: gl,
          antialias: true
        });
        this.renderer.autoClear = false;
        this.scene.add(new THREE.Group()); // placeholder

        this.group = new THREE.Group();
        this.scene.add(this.group);
        buildGeometry(this.group, design, scale);
      },
      render: function (gl, matrix) {
        const m = new THREE.Matrix4().fromArray(matrix);

        // translate to anchor & scale meters -> mercator units (flip Y)
        const l = new THREE.Matrix4()
          .makeTranslation(merc.x, merc.y, merc.z)
          .scale(new THREE.Vector3(scale, -scale, scale));

        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        map.triggerRepaint();
      }
    };

    map.addLayer(customLayer);

    current = {
      map, design, merc, scale,
      layer: customLayer
    };

    // (Optional) show KPI automatically after a short delay if PlayDesignWarehouse doesn't call us
    setTimeout(()=> showKPI(true), 16000);

    return Promise.resolve();
  }

  window.FacilityModel = { build, showKPI };
})();
