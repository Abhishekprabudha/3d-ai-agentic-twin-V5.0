// facilityModel_three.js — Three.js custom layer + 2D fallback (drop-in)
// Requires: THREE (loaded before), MapLibre already on page.
// JSON: anchor{lat,lon}, footprint{width_m,depth_m,height_m}, docks[], bays[], conveyors[], truckPaths_m

(function(){
  const TAG = "[FacilityModel]";
  const SRC2D = "wh2d-src";
  const L2D = { GROUND:"wh2d-ground", BUILD:"wh2d-build", DOCKS:"wh2d-docks", LABEL:"wh2d-label" };

  function metersPerDegLat(){ return 111_320; }
  function metersPerDegLon(latDeg){ return 111_320 * Math.cos(latDeg * Math.PI/180); }

  function localToLngLat(anchor, x, y, w, d){
    const sw = {
      lon: anchor.lon - (w/2) / metersPerDegLon(anchor.lat),
      lat: anchor.lat - (d/2) / metersPerDegLat()
    };
    const lon = sw.lon + (x / metersPerDegLon(anchor.lat));
    const lat = sw.lat + (y / metersPerDegLat());
    return [lon, lat];
  }

  function buildingRing(design){
    const w = design.footprint.width_m;
    const d = design.footprint.depth_m;
    const a = design.anchor;
    const SW = localToLngLat(a, 0, 0, w, d);
    const SE = localToLngLat(a, w, 0, w, d);
    const NE = localToLngLat(a, w, d, w, d);
    const NW = localToLngLat(a, 0, d, w, d);
    return [SW, SE, NE, NW, SW];
  }
  function inflate(ring, scale){
    let cx=0, cy=0; for(const [x,y] of ring){ cx+=x; cy+=y; } cx/=ring.length; cy/=ring.length;
    return ring.map(([x,y])=>[cx+(x-cx)*scale, cy+(y-cy)*scale]);
  }

  function docksAsPoints(design){
    const w = design.footprint.width_m;
    const d = design.footprint.depth_m;
    const N=[],S=[],E=[],W=[];
    for(const dk of (design.docks||[])){
      const side=(dk.side||"").toLowerCase();
      if(side==="north") N.push(dk); else if(side==="south") S.push(dk);
      else if(side==="east") E.push(dk); else if(side==="west") W.push(dk);
    }
    const pts=[];
    const place=(arr, side)=>{
      if(!arr.length) return;
      for(let i=0;i<arr.length;i++){
        let x,y;
        switch(side){
          case "north": x=(i+1)*(w/(arr.length+1)); y=d; break;
          case "south": x=(i+1)*(w/(arr.length+1)); y=0; break;
          case "east":  x=w; y=(i+1)*(d/(arr.length+1)); break;
          case "west":  x=0; y=(i+1)*(d/(arr.length+1)); break;
        }
        pts.push({
          id: arr[i].id || `${side}_${i+1}`,
          type: (arr[i].type||"").toLowerCase()==="inbound" ? "inbound" : "outbound",
          coord: localToLngLat(design.anchor,x,y,w,d)
        });
      }
    };
    place(N,"north"); place(S,"south"); place(E,"east"); place(W,"west");
    return pts;
  }

  // ---------- 2D fallback ----------
  function clear2D(map){
    [L2D.LABEL,L2D.DOCKS,L2D.BUILD,L2D.GROUND].forEach(id=>{ if(map.getLayer(id)) map.removeLayer(id); });
    if(map.getSource(SRC2D)) map.removeSource(SRC2D);
  }
  function draw2D(map, design){
    const feats = [];
    const ring = buildingRing(design);
    feats.push({ type:"Feature", properties:{ kind:"ground" }, geometry:{ type:"Polygon", coordinates:[inflate(ring,1.35)] }});
    feats.push({ type:"Feature", properties:{ kind:"building", h: design.footprint.height_m||10 }, geometry:{ type:"Polygon", coordinates:[ring] }});
    for(const d of docksAsPoints(design)){
      feats.push({ type:"Feature", properties:{ kind:"dock", id:d.id, t:d.type }, geometry:{ type:"Point", coordinates:d.coord }});
    }
    feats.push({ type:"Feature", properties:{ kind:"label", text:"Aslali Warehouse" }, geometry:{ type:"Point", coordinates:[design.anchor.lon, design.anchor.lat] }});
    if(!map.getSource(SRC2D)) map.addSource(SRC2D, { type:"geojson", data:{ type:"FeatureCollection", features:feats }});
    else map.getSource(SRC2D).setData({ type:"FeatureCollection", features:feats });

    if(!map.getLayer(L2D.GROUND)){
      map.addLayer({ id:L2D.GROUND, type:"fill", source:SRC2D,
        filter:["==",["get","kind"],"ground"], paint:{ "fill-color":"#243042", "fill-opacity":0.35 }});
    }
    if(!map.getLayer(L2D.BUILD)){
      map.addLayer({ id:L2D.BUILD, type:"fill", source:SRC2D,
        filter:["==",["get","kind"],"building"], paint:{ "fill-color":"#c6cdd8", "fill-opacity":0.9, "fill-outline-color":"#4b5563" }});
    }
    if(!map.getLayer(L2D.DOCKS)){
      map.addLayer({ id:L2D.DOCKS, type:"circle", source:SRC2D,
        filter:["==",["get","kind"],"dock"],
        paint:{ "circle-radius":6, "circle-color":["match",["get","t"],"inbound","#1e40af","outbound","#7f1d1d","#111827"],
                "circle-stroke-color":"#ffffff","circle-stroke-width":2 }});
    }
    if(!map.getLayer(L2D.LABEL)){
      map.addLayer({ id:L2D.LABEL, type:"symbol", source:SRC2D,
        filter:["==",["get","kind"],"label"],
        layout:{ "text-field":["get","text"], "text-size":13, "text-offset":[0,1.2], "text-anchor":"top" },
        paint:{ "text-color":"#e5e7eb", "text-halo-color":"#0b0b0d", "text-halo-width":1.2 }});
    }
  }

  // ---------- 3D (Three.js custom layer) ----------
  function addThreeLayer(map, design){
    if(!window.THREE){ console.warn(TAG, "THREE not found → 2D fallback"); return {ok:false}; }

    const { width_m:w, depth_m:d, height_m:h=12 } = design.footprint || {};
    const { lon, lat } = design.anchor || {};
    const mc = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0);
    const M = mc.meterInMercatorCoordinateUnits(); // meters → mercator units ✔

    // group at world position; mesh centered & lifted by h/2
    const group = new THREE.Group();
    group.position.set(mc.x, mc.y, mc.z || 0);

    const geom = new THREE.BoxGeometry(w*M, h*M, d*M);
    const mat  = new THREE.MeshPhongMaterial({ color: 0xc6cdd8, transparent:true, opacity:0.96 });
    const box  = new THREE.Mesh(geom, mat);
    box.position.set(0, (h*M)/2, 0); // sit on ground
    group.add(box);

    // soft ground pad
    const padGeom = new THREE.PlaneGeometry((w+20)*M, (d+20)*M);
    const padMat  = new THREE.MeshBasicMaterial({ color: 0x203040, transparent:true, opacity:0.25 });
    const pad = new THREE.Mesh(padGeom, padMat);
    pad.rotation.x = -Math.PI/2;
    group.add(pad);

    // lights
    const scene = new THREE.Scene();
    scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(200, 400, 200);
    scene.add(dir);

    const layer = {
      id: "warehouse-3d",
      type: "custom",
      renderingMode: "3d",
      onAdd(map, gl){
        this.camera = new THREE.Camera();
        this.scene  = scene;
        this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl });
        this.renderer.autoClear = false;
      },
      render(gl, matrix){
        const m = new THREE.Matrix4().fromArray(matrix);
        this.camera.projectionMatrix = m;
        this.renderer.state.reset();
        this.renderer.render(this.scene, this.camera);
        map.triggerRepaint();
      },
      onRemove(){
        try{ this.renderer.dispose(); }catch(e){}
      }
    };

    try{
      if(map.getLayer(layer.id)) map.removeLayer(layer.id);
      map.addLayer(layer);
      console.log(TAG, "3D layer added at", lon, lat, "scale M=", M);
      return {ok:true};
    }catch(e){
      console.error(TAG, "addLayer failed:", e);
      return {ok:false, err:e};
    }
  }

  // ---------- public ----------
  window.FacilityModel = {
    build(map, design){
      console.log(TAG, "build()", design);
      try{
        new maplibregl.Marker({ color:"#00d08a" })
          .setLngLat([design.anchor.lon, design.anchor.lat]).addTo(map);
      }catch(e){ console.warn(TAG, "marker failed", e); }

      const res = addThreeLayer(map, design);
      // keep 2D overlay so DOCKS pulse works & we always see *something*
      draw2D(map, design);
      if(res.ok){
        if(window.Narrator) window.Narrator.sayOnce("Warehouse rendered (3D + 2D overlay).");
      }else{
        if(window.Narrator) window.Narrator.sayOnce("3D unavailable; showing 2D plan.");
      }
    },
    clear(map){
      clear2D(map);
      if(map.getLayer("warehouse-3d")) map.removeLayer("warehouse-3d");
    }
  };
})();
