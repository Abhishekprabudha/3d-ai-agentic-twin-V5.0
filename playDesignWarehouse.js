// playDesignWarehouse.js — timeline-driven orchestration for the Design Warehouse play
// Consumes:
//   - designUrl: matches your schema (anchor, footprint, docks, bays, conveyors, truckPaths)
//   - narrationUrl: [{ t: seconds, text: string, mark?: "ZOOM"|"BUILD"|"DOCKS"|"KPI"|"NETWORK" }]
//
// Requires: window.Narrator, window.FacilityModel, MapLibre map

(function(){
  const NET_SRC = "design-network-src";
  const NET_LYR = "design-network-connector";

  // helper: safe layer removal
  function removeNetwork(map){
    if(map.getLayer(NET_LYR)) map.removeLayer(NET_LYR);
    if(map.getSource(NET_SRC)) map.removeSource(NET_SRC);
  }

  // helper: speak and show chat bubble
  async function say(line){
    if (window.Narrator) {
      await window.Narrator.sayLinesOnce([String(line)], 800, 0.95);
    }
  }

  // helper: pulse docks briefly for the DOCKS mark
  function pulseDocks(map){
    // we assume facilityModel added a circle layer with id "wh-docks"
    const L = "wh-docks";
    if(!map.getLayer(L)) return;
    let k = 0; const base = 6;
    const id = setInterval(()=>{
      if(!map.getLayer(L)){ clearInterval(id); return; }
      const r = base + 2.5*Math.sin(k);
      map.setPaintProperty(L, "circle-radius", r);
      k += 0.55;
    }, 80);
    setTimeout(()=>{
      clearInterval(id);
      if(map.getLayer(L)) map.setPaintProperty(L, "circle-radius", base);
    }, 1600);
  }

  // helper: fit view to three cities (Delhi–Ahmedabad–Mumbai) and show connector
  function showNationalConnector(map, ahd){
    // Delhi, Ahmedabad (from design), Mumbai
    const DELHI = [77.2090, 28.6139];
    const AHD   = [ahd.lon, ahd.lat];
    const MUM   = [72.8777, 19.0760];

    removeNetwork(map);
    map.addSource(NET_SRC, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [DELHI, AHD, MUM] }
        }]
      }
    });
    map.addLayer({
      id: NET_LYR, type: "line", source: NET_SRC,
      paint: { "line-color":"#60a5fa", "line-width":4, "line-opacity":0.95 }
    });

    // fit bounds
    const b = new maplibregl.LngLatBounds();
    [DELHI, AHD, MUM].forEach(c=>b.extend(c));
    map.fitBounds(b, { padding:{ top:60, left:320, right:60, bottom:80 }, duration: 2400, maxZoom: 6.8 });
  }

  // run all timeline marks relative to now
  function scheduleTimeline(map, design, timeline){
    const t0 = performance.now();

    const runMark = (mark) => {
      const m = String(mark||"").toUpperCase();
      if (m === "ZOOM") {
        const a = design.anchor || { lon: 72.62, lat: 22.94 };
        map.flyTo({ center:[a.lon, a.lat], zoom: 14, pitch: 45, bearing: 18, duration: 4200 });
      } else if (m === "BUILD") {
        if (window.FacilityModel) window.FacilityModel.build(map, design);
      } else if (m === "DOCKS") {
        pulseDocks(map);
      } else if (m === "KPI") {
        // (optional) hook to compute & show throughput on your stats panel
      } else if (m === "NETWORK") {
        const a = design.anchor || { lon: 72.62, lat: 22.94 };
        showNationalConnector(map, a);
      }
    };

    for (const step of timeline) {
      const atMs = Math.max(0, (Number(step.t)||0) * 1000);
      setTimeout(async ()=>{
        if (step.text) await say(step.text);
        if (step.mark) runMark(step.mark);
      }, atMs - (performance.now() - t0));
    }
  }

  window.PlayDesignWarehouse = {
    async run(map, designUrl, narrationUrl) {
      try {
        // If your files are at repo root, pass "warehouse_design_aslali.json" and "narration_design_aslali.json"
        const [design, narrationRaw] = await Promise.all([
          fetch(designUrl).then(r=>r.json()),
          fetch(narrationUrl).then(r=>r.json())
        ]);

        // Narration file is an array of { t, text, mark }
        const timeline = Array.isArray(narrationRaw) ? narrationRaw : [];

        // Start immediately: announce intent (nice touch for UX)
        await say("Designing a warehouse in the Aslali industrial area of Ahmedabad.");

        // Schedule the entire play (ZOOM → BUILD → DOCKS → KPI → NETWORK)
        scheduleTimeline(map, design, timeline);

      } catch (e) {
        console.error("Warehouse design load error", e);
        if (window.Narrator) window.Narrator.sayOnce("Could not load warehouse design. Check console for details.");
      }
    }
  };
})();
