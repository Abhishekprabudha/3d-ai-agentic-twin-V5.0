// facilityModel.js — matches YOUR warehouse_design_aslali.json schema
// Renders an extruded building, docks, bays, conveyors and animates trucks.
// Depends on MapLibre already being on the page. No extra libs.

(function(){
  const SRC = {
    STATIC: "wh-static-src",
    TRUCKS: "wh-trucks-src"
  };
  const LYR = {
    GROUND: "wh-ground",
    BUILDING: "wh-building",
    BAYS: "wh-bays",
    CONV_MEC: "wh-conveyor-mech",
    CONV_MAN: "wh-conveyor-man",
    DOCKS: "wh-docks",
    LABELS: "wh-labels",
    TRUCK_PATHS: "wh-truck-paths",
    TRUCKS: "wh-trucks"
  };

  const state = { anim: null, lastTs: 0, trucks: [] };

  function stopAnim(){ if(state.anim) cancelAnimationFrame(state.anim); state.anim = null; }

  // ---- meters <-> degrees helpers (approx) ----
  function metersPerDegLat(){ return 111_320; }
  function metersPerDegLon(latDeg){
    const lat = latDeg * Math.PI/180;
    return 111_320 * Math.cos(lat);
  }
  function localToLngLat(anchor, x, y, width, depth){
    // local (0,0) at SW corner; +x east, +y north
    const sw = {
      lon: anchor.lon - (width/2) / metersPerDegLon(anchor.lat),
      lat: anchor.lat - (depth/2) / metersPerDegLat()
    };
    const lon = sw.lon + (x / metersPerDegLon(anchor.lat));
    const lat = sw.lat + (y / metersPerDegLat());
    return [lon, lat];
  }

  // ---- geometry builders from your schema ----
  function buildBuildingPolygon(design){
    const { anchor, footprint } = design;
    const w = footprint.width, d = footprint.depth;
    // corners (SW, SE, NE, NW, back to SW)
    const SW = localToLngLat(anchor, 0, 0, w, d);
    const SE = localToLngLat(anchor, w, 0, w, d);
    const NE = localToLngLat(anchor, w, d, w, d);
    const NW = localToLngLat(anchor, 0, d, w, d);
    return [SW, SE, NE, NW, SW];
  }
  function expandPoly(poly, scale=1.25){
    // simple centroid scale for a halo
    let cx=0, cy=0; for(const [x,y] of poly){ cx+=x; cy+=y; }
    cx/=poly.length; cy/=poly.length;
    return poly.map(([x,y])=>[cx+(x-cx)*scale, cy+(y-cy)*scale]);
  }

  function baysToPolys(design){
    const list=[];
    for(const b of (design.bays||[])){
      const [x,y,w,h]=b.rect||[];
      if([x,y,w,h].some(v=>typeof v!=="number")) continue;
      const p1 = localToLngLat(design.anchor, x,   y,   design.footprint.width, design.footprint.depth);
      const p2 = localToLngLat(design.anchor, x+w, y,   design.footprint.width, design.footprint.depth);
      const p3 = localToLngLat(design.anchor, x+w, y+h, design.footprint.width, design.footprint.depth);
      const p4 = localToLngLat(design.anchor, x,   y+h, design.footprint.width, design.footprint.depth);
      list.push({ poly:[p1,p2,p3,p4,p1], type:b.type||"bay" });
    }
    return list;
  }

  function conveyorsToLines(design){
    const mec=[], man=[];
    for(const c of (design.conveyors||[])){
      const pts=(c.points||[]).map(([x,y])=>localToLngLat(design.anchor,x,y,design.footprint.width,design.footprint.depth));
      if(pts.length<2) continue;
      if((c.type||"").toLowerCase()==="mechanical") mec.push(pts);
      else man.push(pts);
    }
    return { mec, man };
  }

  function docksToPoints(design){
    // distribute evenly along sides
    const N = [], S = [], E = [], W = [];
    for(const d of (design.docks||[])){
      const side=(d.side||"").toLowerCase();
      if(side==="north") N.push(d);
      else if(side==="south") S.push(d);
      else if(side==="east")  E.push(d);
      else if(side==="west")  W.push(d);
    }
    const w=design.footprint.width, dep=design.footprint.depth;
    const pts=[];
    const placeAlong = (arr, side)=>{
      const n=arr.length; if(!n) return;
      for(let i=0;i<n;i++){
        let x,y;
        switch(side){
          case "north": x = (i+1)*(w/(n+1)); y = dep; break;
          case "south": x = (i+1)*(w/(n+1)); y = 0;   break;
          case "east":  x = w; y = (i+1)*(dep/(n+1)); break;
          case "west":  x = 0; y = (i+1)*(dep/(n+1)); break;
        }
        pts.push({
          id: arr[i].id || `${side}_${i+1}`,
          type: (arr[i].type||"").toLowerCase()==="inbound" ? "inbound" : "outbound",
          coord: localToLngLat(design.anchor,x,y,w,dep)
        });
      }
    };
    placeAlong(N,"north"); placeAlong(S,"south"); placeAlong(E,"east"); placeAlong(W,"west");
    return pts;
  }

  // simple distance along a polyline (km)
  function kmBetween(a,b){
    const toRad=v=>v*Math.PI/180, R=6371;
    const dLat=toRad(b[1]-a[1]), dLon=toRad(b[0]-a[0]);
    const la1=toRad(a[1]), la2=toRad(b[1]);
    const x=Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(x));
  }
  function buildCumLen(coords){
    const L=[0]; for(let i=1;i<coords.length;i++) L[i]=L[i-1]+kmBetween(coords[i-1],coords[i]); return L;
  }
  function pointAtDist(coords, L, dKm){
    const tot=L[L.length-1]||1e-6; let d=dKm%tot;
    for(let i=1;i<L.length;i++){
      if(d<=L[i]){
        const t=(d-L[i-1])/((L[i]-L[i-1])||1e-6);
        const a=coords[i-1], b=coords[i];
        return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
      }
    }
    return coords[coords.length-1];
  }

  function removeOld(map){
    [LYR.TRUCKS, LYR.TRUCK_PATHS, LYR.LABELS, LYR.DOCKS, LYR.CONV_MAN, LYR.CONV_MEC, LYR.BAYS, LYR.BUILDING, LYR.GROUND]
      .forEach(id=>{ if(map.getLayer(id)) map.removeLayer(id); });
    [SRC.TRUCKS, SRC.STATIC]
      .forEach(id=>{ if(map.getSource(id)) map.removeSource(id); });
  }

  function addStatic(map, design){
    const features = [];

    // building + halo
    const buildingPoly = buildBuildingPolygon(design);
    const halo = expandPoly(buildingPoly, 1.35);
    features.push({ type:"Feature", properties:{ kind:"ground" }, geometry:{ type:"Polygon", coordinates:[halo] }});
    features.push({ type:"Feature", properties:{ kind:"building", height: design.footprint.height||12 }, geometry:{ type:"Polygon", coordinates:[buildingPoly] }});

    // bays
    for(const b of baysToPolys(design)){
      features.push({ type:"Feature", properties:{ kind:"bay", bayType:b.type }, geometry:{ type:"Polygon", coordinates:[b.poly] }});
    }

    // conveyors
    const belts = conveyorsToLines(design);
    belts.mec.forEach(line=>{
      features.push({ type:"Feature", properties:{ kind:"conv_mech" }, geometry:{ type:"LineString", coordinates:line }});
    });
    belts.man.forEach(line=>{
      features.push({ type:"Feature", properties:{ kind:"conv_man" }, geometry:{ type:"LineString", coordinates:line }});
    });

    // docks
    docksToPoints(design).forEach(d=>{
      features.push({ type:"Feature", properties:{ kind:"dock", dockType:d.type, id:d.id }, geometry:{ type:"Point", coordinates:d.coord }});
    });

    // truck paths (for context)
    if(Array.isArray(design.truckPaths?.inbound) && design.truckPaths.inbound.length>=2){
      features.push({ type:"Feature", properties:{ kind:"tpath", dir:"inbound" }, geometry:{ type:"LineString", coordinates:design.truckPaths.inbound }});
    }
    if(Array.isArray(design.truckPaths?.outbound) && design.truckPaths.outbound.length>=2){
      features.push({ type:"Feature", properties:{ kind:"tpath", dir:"outbound" }, geometry:{ type:"LineString", coordinates:design.truckPaths.outbound }});
    }

    map.addSource(SRC.STATIC, { type:"geojson", data:{ type:"FeatureCollection", features }});

    // layers
    map.addLayer({ id:LYR.GROUND, type:"fill", source:SRC.STATIC,
      filter:["==",["get","kind"],"ground"],
      paint:{ "fill-color":"#253045", "fill-opacity":0.35 }
    });
    map.addLayer({ id:LYR.BUILDING, type:"fill-extrusion", source:SRC.STATIC,
      filter:["==",["get","kind"],"building"],
      paint:{
        "fill-extrusion-color":"#c6cdd8",
        "fill-extrusion-opacity":0.93,
        "fill-extrusion-height":["to-number",["get","height"]]
      }
    });
    map.addLayer({ id:LYR.BAYS, type:"fill", source:SRC.STATIC,
      filter:["==",["get","kind"],"bay"],
      paint:{ "fill-color":"#00d08a", "fill-opacity":0.35, "fill-outline-color":"#00aa77" }
    });
    map.addLayer({ id:LYR.CONV_MEC, type:"line", source:SRC.STATIC,
      filter:["==",["get","kind"],"conv_mech"],
      paint:{ "line-color":"#14b8a6", "line-width":4, "line-dasharray":[1.6,1.2] }
    });
    map.addLayer({ id:LYR.CONV_MAN, type:"line", source:SRC.STATIC,
      filter:["==",["get","kind"],"conv_man"],
      paint:{ "line-color":"#f59e0b", "line-width":3, "line-dasharray":[0.9,1.1] }
    });
    map.addLayer({ id:LYR.DOCKS, type:"circle", source:SRC.STATIC,
      filter:["==",["get","kind"],"dock"],
      paint:{
        "circle-radius":6,
        "circle-color":["match",["get","dockType"],"inbound","#1e40af","outbound","#7f1d1d","#111827"],
        "circle-stroke-color":"#ffffff",
        "circle-stroke-width":2
      }
    });
    map.addLayer({ id:LYR.TRUCK_PATHS, type:"line", source:SRC.STATIC,
      filter:["==",["get","kind"],"tpath"],
      paint:{ "line-color":"#9aa6b2", "line-opacity":0.7, "line-width":1.5 }
    });

    // labels (simple)
    map.addLayer({ id:LYR.LABELS, type:"symbol", source:SRC.STATIC,
      filter:["in",["get","kind"],["literal",["dock"]]],
      layout:{ "text-field":["get","id"], "text-size":11, "text-anchor":"top", "text-offset":[0,0.8] },
      paint:{ "text-color":"#e5e7eb", "text-halo-color":"#0b0b0d", "text-halo-width":1.2 }
    });
  }

  function prepAndAnimateTrucks(map, design){
    stopAnim();

    // Build path models for inbound/outbound
    const paths = [];
    if(Array.isArray(design.truckPaths?.inbound) && design.truckPaths.inbound.length>=2){
      const coords = design.truckPaths.inbound;
      paths.push({ kind:"inbound", coords, L:buildCumLen(coords), speed_kmps: (6/3.6)/1000 });
    }
    if(Array.isArray(design.truckPaths?.outbound) && design.truckPaths.outbound.length>=2){
      const coords = design.truckPaths.outbound;
      paths.push({ kind:"outbound", coords, L:buildCumLen(coords), speed_kmps: (6/3.6)/1000 });
    }

    // Create some trucks (5 inbound, 5 outbound) if not specified
    const trucks = [];
    for(let i=0;i<5;i++) trucks.push({ id:`IN_${i+1}`, kind:"inbound", dKm: (paths[0]?.L.at(-1)||0) * (i/5) });
    for(let i=0;i<5;i++) trucks.push({ id:`OUT_${i+1}`, kind:"outbound", dKm: (paths[1]?.L.at(-1)||0) * (i/5) });

    state.trucks = trucks.map(t=>{
      const p = paths.find(x=>x.kind===t.kind);
      return { ...t, path:p };
    });

    // source + layer
    map.addSource(SRC.TRUCKS, { type:"geojson", data:{ type:"FeatureCollection", features:[] } });
    map.addLayer({ id:LYR.TRUCKS, type:"circle", source:SRC.TRUCKS,
      paint:{
        "circle-radius":5.5,
        "circle-color":["match",["get","kind"],"inbound","#38bdf8","outbound","#f43f5e","#cbd5e1"],
        "circle-stroke-width":1.6,
        "circle-stroke-color":"#0b0b0d"
      }
    });

    // tick
    const tick = ()=>{
      const src = map.getSource(SRC.TRUCKS);
      if(!src) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now-(state.lastTs||now))/1000);
      state.lastTs = now;

      const feats=[];
      for(const T of state.trucks){
        const P = T.path; if(!P) continue;
        T.dKm += P.speed_kmps * dt;
        const xy = pointAtDist(P.coords, P.L, T.dKm);
        feats.push({ type:"Feature", properties:{ id:T.id, kind:T.kind }, geometry:{ type:"Point", coordinates:xy }});
      }
      src.setData({ type:"FeatureCollection", features:feats });
      state.anim = requestAnimationFrame(tick);
    };
    state.anim = requestAnimationFrame(tick);
  }

  window.FacilityModel = {
    build(map, design){
      try{
        removeOld(map);
        addStatic(map, design);
        prepAndAnimateTrucks(map, design);
        if(window.Narrator){
          window.Narrator.sayOnce("Warehouse rendered from anchor/footprint schema. Docks, bays, conveyors, and truck flows are live.");
        }
      }catch(e){
        console.error("[FacilityModel] build error:", e);
        if(window.Narrator) window.Narrator.sayOnce("Render failed. Open console for details.");
      }
    },
    clear(map){
      stopAnim();
      removeOld(map);
    }
  };
})();
