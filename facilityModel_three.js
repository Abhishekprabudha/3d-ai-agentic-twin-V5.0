// facilityModel_three.js — robust version with 3D + safe 2D fallback + loud logs
// Requires: THREE (loaded before this), MapLibre on the page.
// JSON schema: anchor{lat,lon}, footprint{width_m,depth_m,height_m}, docks[], bays[], conveyors[], truckPaths_m

(function(){
  const TAG = "[FacilityModel]";
  const SRC2D = "wh2d-src";
  const L2D = {
    GROUND:"wh2d-ground",
    BUILD:"wh2d-build",
    DOCKS:"wh2d-docks",
    LABEL:"wh2d-label"
  };

  // ------------ helpers ------------
  function metersPerDegLat(){ return 111_320; }
  function metersPerDegLon(latDeg){ return 111_320 * Math.cos(latDeg * Math.PI/180); }

  // return lng,lat for local x,y (m) where (0,0) is building SW corner
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

  // ------------ 2D fallback (always works) ------------
  function clear2D(map){
    [L2D.LABEL,L2D.DOCKS,L2D.BUILD,L2D.GROUND].forEach(id=>{ if(map.getLayer(id)) map.removeLayer(id); });
    if(map.getSource(SRC2D)) map.removeSource(SRC2D);
  }

  function draw2D(map, design){
    console.log(TAG, "Drawing 2D fallback …");
    const feats = [];

    // building polygon + soft ground halo
    const ring = buildingRing(design);
    feats.push({ type:"Feature", properties:{ kind:"ground" }, geometry:{ type:"Polygon", coordinates:[inflate(ring,1.35)] }});
    feats.push({ type:"Feature", properties:{ kind:"building", h: design.footprint.height_m||10 }, geometry:{ type:"Polygon", coordinates:[ring] }});

    // docks
    for(const d of docksAsPoints(design)){
      feats.push({ type:"Feature", properties:{ kind:"dock", id:d.id, t:d.type }, geometry:{ type:"Point", coordinates:d.coord } });
    }

    // label
    feats.push({ type:"Feature", properties:{ kind:"label", text:"Aslali Warehouse" },
      geometry:{ type:"Point", coordinates:[design.anchor.lon, design.anchor.lat] }});

    if(!map.getSource(SRC2D)){
      map.addSource(SRC2D, { type:"geojson", data:{ type:"FeatureCollection", features:feats }});
    } else {
      map.getSource(SRC2D).setData({ type:"FeatureCollection", features:feats });
    }

    if(!map.getLayer(L2D.GROUND)){
      map.addLayer({ id:L2D.GROUND, type:"fill", source:SRC2D,
        filter:["==",["get","kind"],"ground"],
        paint:{ "fill-color":"#243042", "fill-opacity":0.35 }
      });
    }
    if(!map.getLayer(L2D.BUILD)){
      map.addLayer({ id:L2D.BUILD, type:"fill", source:SRC2D,
        filter:["==",["get","kind"],"building"],
        paint:{ "fill-color":"#c6cdd8", "fill-opacity":0.9, "fill-outline-color":"#4b5563" }
      });
    }
    if(!map.getLayer(L2D.DOCKS)){
      map.addLayer({ id:L2D.DOCKS, type:"circle", source:SRC2D,
        filter:["==",["get","kind"],"dock"],
        paint:{
          "circle-radius":6,
          "circle-color":["match",["get","t"],"inbound","#1e40af","outbound","#7f1d1d","#111827"],
          "circle-stroke-color":"#ffffff","circle-stroke-width":2
        }
      });
    }
    if(!map.getLayer(L2D.LABEL)){
      map.addLayer({ id:L2D.LABEL, type:"symbol", source:SRC2D,
        filter:["==",["get","kind"],"label"],
        layout:{ "text-field":["get","text"], "text-size":13, "text-offset":[0,1.2], "text-anchor":"top" },
        paint:{ "text-color":"#e5e7eb", "text-halo-color":"#0b0b0d", "text-halo-width":1.2 }
      });
    }
  }

  function inflate(ring, scale){
    // crude centroid scale in lon/lat space (fine for small extents)
    let cx=0, cy=0; for(const [x,y] of ring){ cx+=x; cy+=y; } cx/=ring.length; cy/=ring.length;
    return ring.map(([x,y])=>[cx+(x-cx)*scale, cy+(y-cy)*scale]);
  }

  // ------------ 3D via Three.js custom layer ------------
  function build3DLayer(map, design){
    if(!window.THREE){
      console.warn(TAG, "THREE not found — falling back to 2D.");
      return { ok:false };
    }
    console.log(TAG, "Adding Three.js custom layer …");

    const worldScale = 1; // MapLibre already supplies a proj matrix → keep scaled units

    // Convert meters box to mercator meters relative to anchor
    const A = design.anchor;
    const w = design.footprint.width_m;
    const d = design.footprint.depth_m;
    const h = (design.footprint.height_m||12);

    // helper: meters → mercator units at anchor
    const lonScale = metersPerDegLon(A.lat);
    const latScale = metersPerDegLat();
    const metersToMercatorX = (m)=> m / lonScale * (Math.cos(A.lat*Math.PI/180) * lonScale); // balanced fudge
    const metersToMercatorY = (m)=> m / latScale * latScale;

    // Build a centered box (x east, y north, z up)
    const geom = new THREE.BoxGeometry(metersToMercatorX(w), metersToMercatorY(h), metersToMercatorY(d));
    const mat  = new THREE.MeshPhongMaterial({ color: 0xc6cdd8, transparent:true, opacity:0.95 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = false; mesh.receiveShadow = false;

    const scene = new THREE.Scene();
    scene.add(mesh);
    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(300,400,200);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const custom = {
      id: "warehouse-3d",
      type: "custom",
      renderingMode: "3d",
      onAdd: function(map, gl){
        this.camera = new THREE.Camera();
        this.scene = scene;
        this.renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl
        });
        this.renderer.autoClear = false;
      },
      render: function(gl, matrix){
        // MapLibre → THREE matrix
        const m = new THREE.Matrix4().fromArray(matrix);
        this.camera.projectionMatrix = m;
        this.renderer.state.reset();
        this.renderer.render(this.scene, this.camera);
        map.triggerRepaint();
      },
      onRemove: function(){
        try{ this.renderer.dispose(); }catch(e){}
      }
    };

    // position the mesh at the anchor using maplibre mercatorForCoordinate
    const M = maplibregl.MercatorCoordinate.fromLngLat([A.lon, A.lat], 0);
    mesh.position.set(M.x*worldScale, M.y*worldScale, M.z||0);

    // rotate so width goes east-west and depth north-south
    mesh.rotation.set(0,0,0);

    try{
      // Remove previous layer if present
      if(map.getLayer(custom.id)) map.removeLayer(custom.id);
      map.addLayer(custom);
      console.log(TAG, "Three.js layer added.");
      return { ok:true };
    }catch(err){
      console.error(TAG, "Failed to add Three layer:", err);
      return { ok:false, err };
    }
  }

  // ------------ public API ------------
  window.FacilityModel = {
    build(map, design){
      console.log(TAG, "build() called. Anchor:", design?.anchor, "Footprint:", design?.footprint);

      // quick visual ping at anchor — proves build() ran & JSON parsed
      try{
        new maplibregl.Marker({ color:"#00d08a" })
          .setLngLat([design.anchor.lon, design.anchor.lat])
          .addTo(map);
      }catch(e){
        console.warn(TAG, "Anchor marker failed:", e);
      }

      // Try 3D; if it fails, draw 2D so we still see *something*
      const res = build3DLayer(map, design);
      if(!res.ok){
        draw2D(map, design);
        if(window.Narrator) window.Narrator.sayOnce("Three-D render unavailable; showing 2-D plan.");
      }else{
        // Also draw small 2D docks so pulse works with your play file
        draw2D(map, design);
        if(window.Narrator) window.Narrator.sayOnce("Warehouse rendered (3-D + 2-D overlay).");
      }
    },
    clear(map){
      clear2D(map);
      if(map.getLayer("warehouse-3d")) map.removeLayer("warehouse-3d");
    }
  };
})();
