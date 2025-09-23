// playDesignWarehouse.js
// Orchestrates the warehouse design play (stub for now)
window.PlayDesignWarehouse = {
  async run(map, designUrl, narrationUrl) {
    try {
      const design = await (await fetch(designUrl)).json();
      const narration = await (await fetch(narrationUrl)).json();

      // Simple placeholder — in future add Three.js overlay
      Narrator.sayLinesOnce([
        "The warehouse appears finished.",
        "You can see docks, conveyors, and sortation bays in action.",
        "Inbound trucks arrive together, outbound overlaps, so six docks are required.",
        "Throughput calculations are shown on the dashboard."
      ],950,0.95);

      // TODO: call FacilityModel.build() here
      if(window.FacilityModel){
        FacilityModel.build(map, design);
      }
    } catch(e){
      console.error("Warehouse design load error",e);
    }
  }
};
