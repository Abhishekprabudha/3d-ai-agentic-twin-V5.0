// facilityModel.js
// Stub for procedural 3D warehouse model
window.FacilityModel = {
  build(map, design){
    console.log("Building warehouse model", design);
    // Later: integrate Three.js custom layer
    // For now: drop a marker
    new maplibregl.Marker({color:"#00d08a"})
      .setLngLat([design.anchor.lon, design.anchor.lat])
      .addTo(map);
  }
};
