// facilityModel.js — FULL DROP-IN
// Renders a 3D(ish) warehouse scene inside MapLibre (no Three.js).
// Expects design schema with fields: center, building.polygon, docks,
// belts.manual, belts.mechanical, bays[], truck_paths[], trucks[], labels[].

(function(){
  const LYR = {
    GROUND: "facility-ground",
    BUILDING: "facility-building",
    BAYS: "facility-bays",
    BELT_MAN: "facility-belt-manual",
    BELT_MEC: "facility-belt-mech",
    DOCKS: "facility-docks",
    LABELS: "facility-labels",
    TRUCK_PATHS: "facility-truck-paths",
    TRUCKS: "facility-trucks"
  };
  const SRC = {
    GEO: "facility-geo",
    TRUCKS: "facility-trucks-src"
  };

  // Keep some state so we can cleanly replace the scene
  const state = {
    anim: null,
    trucks: [],
    lastTs: 0
  };

  function removeIfExists(map){
    // layers (reverse-safe: remove only if present)
    [LYR.TRUCKS, LYR.TRUCK_PATHS, LYR.LABELS, LYR.DOCKS, LYR.BELT_MAN, LYR.BELT_MEC, LYR.BAYS, LYR.BUILDING, LYR.GROUND]
    .forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });

    // sources
    [SRC.TRUCKS, SRC.GEO].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
  }

  function stopAnim(){
    if (state.anim) cancelAnimationFrame(state.anim);
    state.anim = null;
  }

  function kmBetween(a, b) {
    const toRad = (v) => v * Math.PI/180, R = 6371;
    const dLat = toRad(b[1]-a[1]), dLon = toRad(b[0]-a[0]);
    const la1 = toRad(a[1]), la2 = toRad(b[1]);
    const x = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(x));
  }

  function buildLengths(coords){
    const L=[0];
    for(let i=1;i<coords.length;i++) L[i]=L[i-1]+kmBetween(coords[i-1], coords[i]);
    return L;
  }

  function pointOnLine(coords, Lcum, distKm){
    const total=Lcum[Lcum.length-1]||0.000001;
    let d = distKm % total;
    for(let i=1;i<Lcum.length;i++){
      if(d<=Lcum[i]){
        const t=(d-Lcum[i-1])/((Lcum[i]-Lcum[i-1])||1e-6);
        const a=coords[i-1], b=coords[i];
        return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
      }
    }
    return coords[coords.length-1];
  }

  function expandPoly(poly, scale=1.25){
    // naive centroid scale—good enough for a soft ground halo
    let cx=0, cy=0;
    poly.forEach(([x,y])=>{ cx+=x; cy+=y; });
    cx/=poly.length; cy/=poly.length;
    return poly.map(([x,y])=>[cx+(x-cx)*scale, cy+(y-cy)*scale]);
  }

  function makeFeature(geom, props={}){ return { type:"Feature", geometry:geom, properties:props }; }

  function addSourcesAndLayers(map, design){
    const feats = [];

    const buildingPoly = (design?.building?.polygon)||[];
    if (buildingPoly.length < 3) {
      console.warn("facilityModel: design.building.polygon missing/invalid");
    }

    // ground halo
    if (buildingPoly.length >= 3) {
      feats.push(makeFeature({ type:"Polygon", coordinates:[expandPoly(buildingPoly, 1.35)] }, { kind:"ground" }));
      feats.push(makeFeature({ type:"Polygon", coordinates:[buildingPoly] }, { kind:"building", height: design?.building?.height_m || 12 }));
    }

    // bays
    (design?.bays||[]).forEach((poly,i)=>{
      if(Array.isArray(poly) && poly.length>=3){
        feats.push(makeFeature({ type:"Polygon", coordinates:[poly] }, { kind:"bay", idx:i+1 }));
      }
    });

    // belts
    const man = design?.belts?.manual; if (Array.isArray(man) && man.length>=2) feats.push(makeFeature({ type:"LineString", coordinates:man }, { kind:"belt_manual" }));
    const mec = design?.belts?.mechanical; if (Array.isArray(mec) && mec.length>=2) feats.push(makeFeature({ type:"LineString", coordinates:mec }, { kind:"belt_mech" }));

    // docks
    (design?.docks||[]).forEach((p,i)=>{
      if (Array.isArray(p) && p.length===2) feats.push(makeFeature({ type:"Point", coordinates:p }, { kind:"dock", idx:i+1 }));
    });

    // truck paths (thin for context)
    (design?.truck_paths||[]).forEach((p)=> {
      if (Array.isArray(p?.coords) && p.coords.length>=2){
        feats.push(makeFeature({ type:"LineString", coordinates:p.coords }, { kind:"truck_path", id:p.id||"" }));
      }
    });

    // labels
    (design?.labels||[]).forEach(l=>{
      if (Array.isArray(l?.at) && l.at.length===2){
        feats.push(makeFeature({ type:"Point", coordinates:l.at }, { kind:"label", text:l.text||"" }));
      }
    });

    // add the static geo source+layers
    if (!map.getSource(SRC.GEO)) {
      map.addSource(SRC.GEO, { type:"geojson", data:{ type:"FeatureCollection", features:feats } });

      // ground
      map.addLayer({
        id: LYR.GROUND, type:"fill", source:SRC.GEO,
        filter:["==",["get","kind"],"ground"],
        paint:{ "fill-color":"#394151", "fill-opacity":0.35 }
      });

      // building
      map.addLayer({
        id: LYR.BUILDING, type:"fill-extrusion", source:SRC.GEO,
        filter:["==",["get","kind"],"building"],
        paint:{
          "fill-extrusion-color":"#bfc7d3",
          "fill-extrusion-opacity":0.92,
          "fill-extrusion-height":["*",["to-number",["get","height"]],1],
          "fill-extrusion-base":0
        }
      });

      // bays
      map.addLayer({
        id: LYR.BAYS, type:"fill", source:SRC.GEO,
        filter:["==",["get","kind"],"bay"],
        paint:{ "fill-color":"#00d08a", "fill-opacity":0.35, "fill-outline-color":"#00a873" }
      });

      // belts
      map.addLayer({
        id: LYR.BELT_MEC, type:"line", source:SRC.GEO,
        filter:["==",["get","kind"],"belt_mech"],
        paint:{ "line-color":"#2dd4bf", "line-width":4, "line-dasharray":[1.5,1.2] }
      });
      map.addLayer({
        id: LYR.BELT_MAN, type:"line", source:SRC.GEO,
        filter:["==",["get","kind"],"belt_manual"],
        paint:{ "line-color":"#f59e0b", "line-width":3, "line-dasharray":[0.8,1.1] }
      });

      // docks
      map.addLayer({
        id: LYR.DOCKS, type:"circle", source:SRC.GEO,
        filter:["==",["get","kind"],"dock"],
        paint:{
          "circle-radius":6,
          "circle-color":"#111827",
          "circle-stroke-color":"#ffffff",
          "circle-stroke-width":2
        }
      });

      // truck paths
      map.addLayer({
        id: LYR.TRUCK_PATHS, type:"line", source:SRC.GEO,
        filter:["==",["get","kind"],"truck_path"],
        paint:{ "line-color":"#94a3b8", "line-width":1.5, "line-opacity":0.7 }
      });

      // labels
      map.addLayer({
        id: LYR.LABELS, type:"symbol", source:SRC.GEO,
        filter:["==",["get","kind"],"label"],
        layout:{
          "text-field":["get","text"],
          "text-size":12,
          "text-justify":"center",
          "text-anchor":"top"
        },
        paint:{
          "text-color":"#e5e7eb",
          "text-halo-color":"#0b0b0d",
          "text-halo-width":1.2
        }
      });
    } else {
      // update if already there
      map.getSource(SRC.GEO).setData({ type:"FeatureCollection", features:feats });
    }
  }

  function prepareAndAnimateTrucks(map, design){
    stopAnim();

    // build path lookup
    const pathMap = {};
    (design?.truck_paths||[]).forEach(p=>{
      if(Array.isArray(p?.coords) && p.coords.length>=2){
        pathMap[p.id] = {
          coords: p.coords,
          Lcum: buildLengths(p.coords),
          speed_kmps: (p.speed_mps||5)/1000
        };
      }
    });

    // prepare truck states
    state.trucks = (design?.trucks||[]).map(t=>{
      const path = pathMap[t.path];
      const total = path?.Lcum?.[path.Lcum.length-1] || 0;
      return {
        id: t.id,
        kind: (t.id||"").toLowerCase().includes("out") ? "outbound" : "inbound",
        path,
        distKm: total*(t.phase||0)
      };
    });

    // dynamic source/layer
    if(!map.getSource(SRC.TRUCKS)){
      map.addSource(SRC.TRUCKS, { type:"geojson", data:{ type:"FeatureCollection", features:[] } });
      map.addLayer({
        id: LYR.TRUCKS, type:"circle", source:SRC.TRUCKS,
        paint:{
          "circle-radius":5,
          "circle-color":[
            "match",["get","kind"],
            "inbound","#38bdf8",
            "outbound","#f43f5e",
            "#cbd5e1"
          ],
          "circle-stroke-width":1.5,
          "circle-stroke-color":"#0b0b0d"
        }
      });
    }

    // tick
    const tick = ()=>{
      const src = map.getSource(SRC.TRUCKS);
      if(!src) return;

      const now = performance.now();
      const dt = Math.min(0.05, (now - (state.lastTs || now))/1000);
      state.lastTs = now;

      for(const T of state.trucks){
        if(!T.path) continue;
        T.distKm += T.path.speed_kmps * dt;
      }
      const feats = state.trucks.filter(t=>t.path).map(t=>{
        const p = pointOnLine(t.path.coords, t.path.Lcum, t.distKm);
        return makeFeature({ type:"Point", coordinates:p }, { id:t.id, kind:t.kind });
      });

      src.setData({ type:"FeatureCollection", features:feats });
      state.anim = requestAnimationFrame(tick);
    };
    state.anim = requestAnimationFrame(tick);
  }

  window.FacilityModel = {
    build(map, design){
      // design fallback guard
      if(!design || !design.building){
        console.warn("facilityModel: invalid design; aborting.");
        return;
      }
      // remove old scene, then add everything again
      removeIfExists(map);
      addSourcesAndLayers(map, design);
      prepareAndAnimateTrucks(map, design);

      if (window.Narrator) {
        window.Narrator.sayOnce("Warehouse scene rendered: building, docks, conveyors, bays, and truck flows.");
      }
    },
    clear(map){
      stopAnim();
      removeIfExists(map);
    }
  };
})();
