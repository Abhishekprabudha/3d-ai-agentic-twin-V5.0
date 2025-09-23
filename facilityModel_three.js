// facilityModel_three.js — GLB loader version
// Requires: THREE + GLTFLoader + MapLibre on the page
// Usage: FacilityModel.build(map, design)
// design.anchor.lat / .lon is where the GLB is placed

(function(){
  const TAG = "[FacilityModel]";
  const SRC2D = "wh2d-src";
  const L2D = {
    LABEL: "wh2d-label"
  };

  // fallback 2D label so at least *something* appears
  function draw2D(map, design){
    const feats = [{
      type:"Feature", properties:{ kind:"label", text:"Aslali Warehouse" },
      geometry:{ type:"Point", coordinates:[design.anchor.lon, design.anchor.lat] }
    }];
    if(!map.getSource(SRC2D)){
      map.addSource(SRC2D, { type:"geojson", data:{ type:"FeatureCollection", features:feats }});
    } else {
      map.getSource(SRC2D).setData({ type:"FeatureCollection", features:feats });
    }
    if(!map.getLayer(L2D.LABEL)){
      map.addLayer({ id:L2D.LABEL, type:"symbol", source:SRC2D,
        filter:["==",["get","kind"],"label"],
        layout:{ "text-field":["get","text"], "text-size":14, "text-offset":[0,1.2], "text-anchor":"top" },
        paint:{ "text-color":"#e5e7eb", "text-halo-color":"#0b0b0d", "text-halo-width":1.2 }
      });
    }
  }

  // load GLB as custom layer
  function buildGLBLayer(map, design){
    if(!window.THREE || !window.THREE.GLTFLoader){
      console.warn(TAG, "Three.js or GLTFLoader missing — fallback only.");
      return {ok:false};
    }
    console.log(TAG, "Loading GLB warehouse …");

    const A = design.anchor;
    const worldScale = 1.0;

    // Mercator anchor point
    const M = maplibregl.MercatorCoordinate.fromLngLat([A.lon, A.lat], 0);

    // setup scene + loader
    const scene = new THREE.Scene();
    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(300,400,200);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const loader = new THREE.GLTFLoader();
    loader.load(
      "warehouse_aslali.glb",  // <-- your GLB file in repo root
      (gltf)=>{
        const model = gltf.scene;
        model.position.set(M.x*worldScale, M.y*worldScale, M.z || 0);
        model.scale.set(1,1,1);   // tweak if needed
        scene.add(model);
        console.log(TAG, "GLB added to scene.");
        if(window.Narrator) window.Narrator.sayOnce("Warehouse 3-D model loaded.");
      },
      (xhr)=>{ console.log(TAG, `GLB ${(xhr.loaded/xhr.total*100).toFixed(1)}% loaded`); },
      (err)=>{ console.error(TAG,"GLB load error:", err); }
    );

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

    try{
      if(map.getLayer(custom.id)) map.removeLayer(custom.id);
      map.addLayer(custom);
      return {ok:true};
    }catch(e){
      console.error(TAG, "Failed to add custom layer:", e);
      return {ok:false, err:e};
    }
  }

  window.FacilityModel = {
    build(map, design){
      console.log(TAG,"build() called with anchor", design.anchor);

      // Quick marker so you always see anchor
      new maplibregl.Marker({color:"#00d08a"})
        .setLngLat([design.anchor.lon, design.anchor.lat])
        .addTo(map);

      const res = buildGLBLayer(map, design);
      if(!res.ok){
        draw2D(map, design);
        if(window.Narrator) window.Narrator.sayOnce("Warehouse fallback view shown.");
      }
    },
    clear(map){
      if(map.getLayer("warehouse-3d")) map.removeLayer("warehouse-3d");
      if(map.getSource(SRC2D)) map.removeSource(SRC2D);
    }
  };
})();
