// facilityModel.js — corrected converters + solid visual fallback
// Renders: ground halo, extruded building, bays, conveyors, docks, labels, truck paths, moving trucks.
// IMPORTANT: two coordinate spaces
//   1) Footprint local (0..width_m, 0..depth_m) => use footprintLocalToLngLat()
//   2) World-local meters offset from anchor (x_m east, y_m north) => use metersOffsetToLngLat()

(function () {
  const SRC = {
    STATIC: "wh-static-src",
    TRUCKS: "wh-trucks-src"
  };
  const LYR = {
    HALO: "wh-ground",
    BUILDING_FILL: "wh-building-fill",         // 2D fill fallback (always visible)
    BUILDING_EXTRUDE: "wh-building-extrude",   // 3D extrusion (if supported by style)
    BUILDING_OUTLINE: "wh-building-outline",
    BAYS: "wh-bays",
    CONV_MEC: "wh-conveyor-mech",
    CONV_MAN: "wh-conveyor-man",
    DOCKS: "wh-docks",
    LABELS: "wh-labels",
    TP_IN: "wh-truckpath-in",
    TP_OUT: "wh-truckpath-out",
    TRUCKS: "wh-trucks",
    ANCHOR: "wh-anchor"
  };

  const state = { anim: null, lastTs: 0, trucks: [] };

  function stopAnim() { if (state.anim) cancelAnimationFrame(state.anim); state.anim = null; }

  // --- geodesy helpers (approx near the anchor latitude)
  const R_LAT = 111_320; // m/deg
  const cosd = (deg) => Math.cos((deg * Math.PI) / 180);
  function metersPerDegLon(latDeg) { return R_LAT * cosd(latDeg); }

  // (1) Footprint local => anchor SW corner is (0,0), +x east, +y north
  function footprintLocalToLngLat(anchor, x, y, width_m, depth_m) {
    const dLon_m = metersPerDegLon(anchor.lat), dLat_m = R_LAT;
    const swLon = anchor.lon - (width_m / 2) / dLon_m;
    const swLat = anchor.lat - (depth_m / 2) / dLat_m;
    return [swLon + x / dLon_m, swLat + y / dLat_m];
  }

  // (2) World-local meters offset from center (anchor) => meters east/north
  function metersOffsetToLngLat(anchor, x_m, y_m) {
    const dLon_m = metersPerDegLon(anchor.lat), dLat_m = R_LAT;
    return [anchor.lon + x_m / dLon_m, anchor.lat + y_m / dLat_m];
  }

  // --- shape builders
  function buildingRing(design) {
    const w = design.footprint.width_m, d = design.footprint.depth_m;
    const SW = footprintLocalToLngLat(design.anchor, 0, 0, w, d);
    const SE = footprintLocalToLngLat(design.anchor, w, 0, w, d);
    const NE = footprintLocalToLngLat(design.anchor, w, d, w, d);
    const NW = footprintLocalToLngLat(design.anchor, 0, d, w, d);
    return [SW, SE, NE, NW, SW];
  }

  function expandRing(ring, scale = 1.3) {
    // crude centroid scale (ok for small footprint)
    let cx = 0, cy = 0;
    ring.forEach(([x, y]) => { cx += x; cy += y; });
    cx /= ring.length; cy /= ring.length;
    return ring.map(([x, y]) => [cx + (x - cx) * scale, cy + (y - cy) * scale]);
  }

  function baysToPolys(design) {
    const w = design.footprint.width_m, d = design.footprint.depth_m;
    const out = [];
    for (const b of (design.bays || [])) {
      const [x, y, bw, bh] = b.rect_m || [];
      if ([x, y, bw, bh].some(v => typeof v !== "number")) continue;
      const p1 = footprintLocalToLngLat(design.anchor, x, y, w, d);
      const p2 = footprintLocalToLngLat(design.anchor, x + bw, y, w, d);
      const p3 = footprintLocalToLngLat(design.anchor, x + bw, y + bh, w, d);
      const p4 = footprintLocalToLngLat(design.anchor, x, y + bh, w, d);
      out.push({ poly: [p1, p2, p3, p4, p1], type: b.type || "bay" });
    }
    return out;
  }

  function conveyorsToLines(design) {
    const w = design.footprint.width_m, d = design.footprint.depth_m;
    const mec = [], man = [];
    for (const c of (design.conveyors || [])) {
      const pts = (c.points_m || []).map(([x, y]) => footprintLocalToLngLat(design.anchor, x, y, w, d));
      if (pts.length < 2) continue;
      ((c.type || "").toLowerCase() === "mechanical" ? mec : man).push(pts);
    }
    return { mec, man };
  }

  function docksToPoints(design) {
    const w = design.footprint.width_m, d = design.footprint.depth_m;
    const N = [], S = [], E = [], W = [];
    for (const dck of (design.docks || [])) {
      const s = (dck.side || "").toLowerCase();
      if (s === "north") N.push(dck); else if (s === "south") S.push(dck);
      else if (s === "east") E.push(dck); else if (s === "west") W.push(dck);
    }
    const pts = [];
    const place = (arr, side) => {
      const n = arr.length; if (!n) return;
      for (let i = 0; i < n; i++) {
        let x, y;
        if (side === "north") { x = (i + 1) * (w / (n + 1)); y = d; }
        else if (side === "south") { x = (i + 1) * (w / (n + 1)); y = 0; }
        else if (side === "east") { x = w; y = (i + 1) * (d / (n + 1)); }
        else { x = 0; y = (i + 1) * (d / (n + 1)); }
        pts.push({
          id: arr[i].id || `${side}_${i + 1}`,
          kind: (arr[i].type || "").toLowerCase() === "inbound" ? "inbound" : "outbound",
          coord: footprintLocalToLngLat(design.anchor, x, y, w, d)
        });
      }
    };
    place(N, "north"); place(S, "south"); place(E, "east"); place(W, "west");
    return pts;
  }

  // --- distance helpers (for truck animation)
  function km(a, b) {
    const toRad = v => v * Math.PI / 180, R = 6371;
    const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
    const la1 = toRad(a[1]), la2 = toRad(b[1]);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function cumLen(coords) { const L = [0]; for (let i = 1; i < coords.length; i++) L[i] = L[i - 1] + km(coords[i - 1], coords[i]); return L; }
  function pointAt(coords, L, dKm) {
    const tot = L[L.length - 1] || 1e-6; let d = dKm % tot;
    for (let i = 1; i < L.length; i++) {
      if (d <= L[i]) {
        const t = (d - L[i - 1]) / ((L[i] - L[i - 1]) || 1e-6);
        const a = coords[i - 1], b = coords[i];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
    }
    return coords[coords.length - 1];
  }

  function removeOld(map) {
    Object.values(LYR).forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    Object.values(SRC).forEach(id => { if (map.getSource(id)) map.removeSource(id); });
  }

  function addStatic(map, design) {
    const features = [];

    // Building + halo
    const ring = buildingRing(design);
    const halo = expandRing(ring, 1.35);
    features.push({ type: "Feature", properties: { kind: "halo" }, geometry: { type: "Polygon", coordinates: [halo] } });
    features.push({
      type: "Feature",
      properties: { kind: "building", height_m: design.footprint.height_m || 12 },
      geometry: { type: "Polygon", coordinates: [ring] }
    });

    // Bays
    for (const b of baysToPolys(design)) {
      features.push({ type: "Feature", properties: { kind: "bay", bayType: b.type }, geometry: { type: "Polygon", coordinates: [b.poly] } });
    }

    // Conveyors
    const belts = conveyorsToLines(design);
    belts.mec.forEach(line => features.push({ type: "Feature", properties: { kind: "conv_mec" }, geometry: { type: "LineString", coordinates: line } }));
    belts.man.forEach(line => features.push({ type: "Feature", properties: { kind: "conv_man" }, geometry: { type: "LineString", coordinates: line } }));

    // Docks
    docksToPoints(design).forEach(d => features.push({ type: "Feature", properties: { kind: "dock", dir: d.kind, id: d.id }, geometry: { type: "Point", coordinates: d.coord } }));

    // Truck context paths (meters offset from center)
    const toLonLat = (arr) => arr.map(([x_m, y_m]) => metersOffsetToLngLat(design.anchor, x_m, y_m));
    if (Array.isArray(design.truckPaths_m?.inbound) && design.truckPaths_m.inbound.length >= 2)
      features.push({ type: "Feature", properties: { kind: "tpath_in" }, geometry: { type: "LineString", coordinates: toLonLat(design.truckPaths_m.inbound) } });
    if (Array.isArray(design.truckPaths_m?.outbound) && design.truckPaths_m.outbound.length >= 2)
      features.push({ type: "Feature", properties: { kind: "tpath_out" }, geometry: { type: "LineString", coordinates: toLonLat(design.truckPaths_m.outbound) } });

    // Anchor crosshair
    features.push({
      type: "Feature",
      properties: { kind: "anchor", label: "Aslali WH" },
      geometry: { type: "Point", coordinates: [design.anchor.lon, design.anchor.lat] }
    });

    map.addSource(SRC.STATIC, { type: "geojson", data: { type: "FeatureCollection", features } });

    // Layers (2D fallback always visible)
    map.addLayer({ id: LYR.HALO, type: "fill", source: SRC.STATIC, filter: ["==", ["get", "kind"], "halo"], paint: { "fill-color": "#253045", "fill-opacity": 0.35 } });
    map.addLayer({ id: LYR.BUILDING_FILL, type: "fill", source: SRC.STATIC, filter: ["==", ["get", "kind"], "building"], paint: { "fill-color": "#cfd8e3", "fill-opacity": 0.9 } });
    map.addLayer({ id: LYR.BUILDING_OUTLINE, type: "line", source: SRC.STATIC, filter: ["==", ["get", "kind"], "building"], paint: { "line-color": "#111827", "line-width": 2.0 } });

    // 3D extrusion (if style supports it, will render in addition to 2D fill)
    map.addLayer({
      id: LYR.BUILDING_EXTRUDE, type: "fill-extrusion", source: SRC.STATIC,
      filter: ["==", ["get", "kind"], "building"],
      paint: {
        "fill-extrusion-color": "#bfc8d4",
        "fill-extrusion-opacity": 0.93,
        "fill-extrusion-height": ["to-number", ["get", "height_m"]]
      }
    });

    map.addLayer({ id: LYR.BAYS, type: "fill", source: SRC.STATIC, filter: ["==", ["get", "kind"], "bay"], paint: { "fill-color": "#00d08a", "fill-opacity": 0.35, "fill-outline-color": "#00aa77" } });
    map.addLayer({ id: LYR.CONV_MEC, type: "line", source: SRC.STATIC, filter: ["==", ["get", "kind"], "conv_mec"], paint: { "line-color": "#14b8a6", "line-width": 4, "line-dasharray": [1.6, 1.2] } });
    map.addLayer({ id: LYR.CONV_MAN, type: "line", source: SRC.STATIC, filter: ["==", ["get", "kind"], "conv_man"], paint: { "line-color": "#f59e0b", "line-width": 3, "line-dasharray": [0.9, 1.1] } });
    map.addLayer({ id: LYR.DOCKS, type: "circle", source: SRC.STATIC, filter: ["==", ["get", "kind"], "dock"], paint: { "circle-radius": 6, "circle-color": ["match", ["get", "dir"], "inbound", "#1e40af", "outbound", "#7f1d1d", "#111827"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });

    // Truck paths (context)
    map.addLayer({ id: LYR.TP_IN, type: "line", source: SRC.STATIC, filter: ["==", ["get", "kind"], "tpath_in"], paint: { "line-color": "#60a5fa", "line-width": 2.5, "line-opacity": 0.8 } });
    map.addLayer({ id: LYR.TP_OUT, type: "line", source: SRC.STATIC, filter: ["==", ["get", "kind"], "tpath_out"], paint: { "line-color": "#f87171", "line-width": 2.5, "line-opacity": 0.8 } });

    // Anchor label
    map.addLayer({
      id: LYR.LABELS, type: "symbol", source: SRC.STATIC, filter: ["==", ["get", "kind"], "anchor"],
      layout: { "text-field": ["get", "label"], "text-size": 13, "text-anchor": "top", "text-offset": [0, 1.0] },
      paint: { "text-color": "#e5e7eb", "text-halo-color": "#0b0b0d", "text-halo-width": 1.2 }
    });
  }

  function prepAndAnimateTrucks(map, design) {
    stopAnim();

    // Build lon/lat paths from meters offsets (centered at anchor)
    const toLonLat = (arr) => arr.map(([x_m, y_m]) => metersOffsetToLngLat(design.anchor, x_m, y_m));
    const paths = [];
    if (Array.isArray(design.truckPaths_m?.inbound) && design.truckPaths_m.inbound.length >= 2) {
      const coords = toLonLat(design.truckPaths_m.inbound);
      paths.push({ kind: "inbound", coords, L: cumLen(coords), speed_kmps: (6 / 3.6) / 1000 });
    }
    if (Array.isArray(design.truckPaths_m?.outbound) && design.truckPaths_m.outbound.length >= 2) {
      const coords = toLonLat(design.truckPaths_m.outbound);
      paths.push({ kind: "outbound", coords, L: cumLen(coords), speed_kmps: (6 / 3.6) / 1000 });
    }

    // Seed trucks (5 each)
    const trucks = [];
    for (let i = 0; i < 5; i++) trucks.push({ id: `IN_${i + 1}`, kind: "inbound", dKm: (paths[0]?.L.at(-1) || 0) * (i / 5) });
    for (let i = 0; i < 5; i++) trucks.push({ id: `OUT_${i + 1}`, kind: "outbound", dKm: (paths[1]?.L.at(-1) || 0) * (i / 5) });
    state.trucks = trucks.map(t => ({ ...t, path: paths.find(p => p.kind === t.kind) }));

    // Source + layer
    map.addSource(SRC.TRUCKS, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: LYR.TRUCKS, type: "circle", source: SRC.TRUCKS,
      paint: {
        "circle-radius": 5.5,
        "circle-color": ["match", ["get", "kind"], "inbound", "#38bdf8", "outbound", "#f43f5e", "#cbd5e1"],
        "circle-stroke-width": 1.6, "circle-stroke-color": "#0b0b0d"
      }
    });

    // Keep trucks on top
    try { map.moveLayer(LYR.TRUCKS); } catch (_) {}

    const tick = () => {
      const src = map.getSource(SRC.TRUCKS); if (!src) return;
      const now = performance.now(); const dt = Math.min(0.05, (now - (state.lastTs || now)) / 1000); state.lastTs = now;
      const feats = [];
      for (const T of state.trucks) {
        const P = T.path; if (!P) continue;
        T.dKm += P.speed_kmps * dt;
        const xy = pointAt(P.coords, P.L, T.dKm);
        feats.push({ type: "Feature", properties: { id: T.id, kind: T.kind }, geometry: { type: "Point", coordinates: xy } });
      }
      src.setData({ type: "FeatureCollection", features: feats });
      state.anim = requestAnimationFrame(tick);
    };
    state.anim = requestAnimationFrame(tick);
  }

  window.FacilityModel = {
    build(map, design) {
      try {
        removeOld(map);
        addStatic(map, design);
        prepAndAnimateTrucks(map, design);
        if (window.Narrator) window.Narrator.sayOnce("Warehouse footprint, bays, conveyors, docks and trucks are live at Aslali.");
      } catch (e) {
        console.error("[FacilityModel] build error:", e);
        if (window.Narrator) window.Narrator.sayOnce("Render failed (see console).");
      }
    },
    clear(map) { stopAnim(); removeOld(map); }
  };
})();
