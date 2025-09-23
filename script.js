/* =========================================================================
   Agentic Twin — Disrupt → Correct → Normal + Hub Addition + City Addition (v6.5)
   Enhancements:
   1) City Addition = two-stage narration (Baseline → Proposal) with the
      Guwahati hub icon + movements revealed only at the proposal stage.
   2) During City Addition (both baseline and proposal), the rest of India
      continues moving as-is (base network trucks kept running), and in the
      proposal stage we also keep Kolkata ↔ Guwahati movements visible.
   ======================================================================= */

/* -------------------- tiny debug pill -------------------- */
let __DBG=null;
function debug(msg){
  if(!__DBG){
    __DBG=document.createElement("div");
    __DBG.style.cssText="position:fixed;left:8px;bottom:8px;z-index:9999;background:rgba(0,0,0,.55);color:#eaf1f7;font:12px system-ui;padding:6px 8px;border-radius:6px;pointer-events:none";
    document.body.appendChild(__DBG);
  }
  __DBG.textContent=msg||"";
}
window.addEventListener("error",(e)=>debug(`Error: ${e.message||e}`));

/* -------------------- config -------------------- */
const STYLE_URL="style.json";
const MAP_INIT={center:[78.9629,21.5937],zoom:5.5,minZoom:3,maxZoom:12};
const WAREHOUSE_ICON_SRC="warehouse_iso.png";
const AUTO_FIT=false; // keep OFF
const HUB_ID="H_NAG";
const DEFAULT_CAPACITY_UNITS=10;
const DEFAULT_SPEED_KMPH=55;

/* -------------------- anchors -------------------- */
const CITY={
  WH1:{name:"WH1 — Delhi",     lat:28.6139, lon:77.2090},
  WH2:{name:"WH2 — Mumbai",    lat:19.0760, lon:72.8777},
  WH3:{name:"WH3 — Bangalore", lat:12.9716, lon:77.5946},
  WH4:{name:"WH4 — Hyderabad", lat:17.3850, lon:78.4867},
  WH5:{name:"WH5 — Kolkata",   lat:22.5726, lon:88.3639}
};
const HUB={ H_NAG:{name:"Hub — Nagpur", lat:21.1458, lon:79.0882} };

/* ---- Seven Sisters anchors + Guwahati hub ---- */
const NE7 = {
  NE_AP:{ name:"Itanagar — Arunachal Pradesh", lat:27.0844, lon:93.6053 },
  NE_AS:{ name:"Guwahati — Assam",             lat:26.1445, lon:91.7362 },
  NE_MN:{ name:"Imphal — Manipur",             lat:24.8170, lon:93.9368 },
  NE_ML:{ name:"Shillong — Meghalaya",         lat:25.5788, lon:91.8933 },
  NE_MZ:{ name:"Aizawl — Mizoram",             lat:23.7271, lon:92.7176 },
  NE_NL:{ name:"Kohima — Nagaland",            lat:25.6747, lon:94.1100 },
  NE_TR:{ name:"Agartala — Tripura",           lat:23.8315, lon:91.2868 }
};
const HUB_CITY = { H_GUW:{ name:"Hub — Guwahati", lat:26.1445, lon:91.7362 } };

/* -------------------- route polylines (lat,lon) -------------------- */
const RP={
  "WH1-WH2":[[28.6139,77.2090],[27.0,76.8],[25.6,75.2],[24.1,73.5],[23.0,72.6],[21.17,72.83],[19.9,72.9],[19.076,72.8777]],
  "WH2-WH3":[[19.0760,72.8777],[18.52,73.8567],[16.9,74.5],[15.9,74.5],[13.8,76.4],[12.9716,77.5946]],
  "WH3-WH1":[[12.9716,77.5946],[16.0,78.1],[17.3850,78.4867],[21.0,79.1],[26.9,78.0],[28.6139,77.2090]],
  "WH4-WH1":[[17.3850,78.4867],[21.1458,79.0882],[27.1767,78.0081],[28.6139,77.2090]],
  "WH4-WH2":[[17.3850,78.4867],[18.0,76.5],[18.52,73.8567],[19.0760,72.8777]],
  "WH4-WH3":[[17.3850,78.4867],[16.0,77.8],[14.8,77.3],[13.34,77.10],[12.9716,77.5946]],
  "WH4-WH5":[[17.3850,78.4867],[18.0,82.0],[19.2,84.8],[21.0,86.0],[22.5726,88.3639]],
  "WH5-WH1":[[22.5726,88.3639],[23.6,86.1],[24.3,83.0],[25.4,81.8],[26.45,80.35],[27.1767,78.0081],[28.6139,77.2090]],
  "WH5-WH2":[[22.5726,88.3639],[23.5,86.0],[22.5,84.0],[21.5,81.5],[21.1,79.0],[20.3,76.5],[19.3,74.5],[19.0760,72.8777]],
  "WH5-WH3":[[22.5726,88.3639],[21.15,85.8],[19.5,85.8],[17.9,82.7],[16.5,80.3],[13.3409,77.1010],[12.9716,77.5946]]
};
/* Hub spokes (Nagpur) — included only in Hub mode */
RP["WH1-H_NAG"]=[[28.6139,77.2090],[26.5,78.2],[24.7,79.0],[22.8,79.2],[21.1458,79.0882]];
RP["WH2-H_NAG"]=[[19.0760,72.8777],[19.6,74.8],[20.2,76.9],[20.7,78.4],[21.1458,79.0882]];
RP["WH3-H_NAG"]=[[12.9716,77.5946],[14.6,78.6],[16.8,79.3],[19.0,79.4],[21.1458,79.0882]];
RP["WH4-H_NAG"]=[[17.3850,78.4867],[18.6,78.9],[19.8,79.2],[20.6,79.2],[21.1458,79.0882]];
RP["WH5-H_NAG"]=[[22.5726,88.3639],[21.7,86.4],[21.2,83.8],[21.2,81.5],[21.1458,79.0882]];

/* ---- Curved roads for City Addition ---- */
/* Baseline: WH5 → Seven Sisters (gentle bends for road-like look) */
RP["WH5-NE_AP"]=[[22.5726,88.3639],[24.5,89.0],[26.0,92.0],[27.0844,93.6053]];
RP["WH5-NE_AS"]=[[22.5726,88.3639],[24.2,89.6],[25.5,90.8],[26.1445,91.7362]];
RP["WH5-NE_MN"]=[[22.5726,88.3639],[23.5,90.4],[24.0,92.0],[24.8170,93.9368]];
RP["WH5-NE_ML"]=[[22.5726,88.3639],[23.8,90.2],[24.8,91.2],[25.5788,91.8933]];
RP["WH5-NE_MZ"]=[[22.5726,88.3639],[23.0,90.0],[23.4,91.3],[23.7271,92.7176]];
RP["WH5-NE_NL"]=[[22.5726,88.3639],[24.3,89.7],[25.0,92.0],[25.6747,94.1100]];
RP["WH5-NE_TR"]=[[22.5726,88.3639],[23.2,89.0],[23.5,90.2],[23.8315,91.2868]];

/* Proposal: H_GUW → Seven Sisters (fan-out) + WH5 ↔ H_GUW */
RP["WH5-H_GUW"]=[[22.5726,88.3639],[24.0,89.8],[25.2,90.8],[26.1445,91.7362]];
RP["H_GUW-NE_AP"]=[[26.1445,91.7362],[26.7,92.2],[27.0844,93.6053]];
RP["H_GUW-NE_MN"]=[[26.1445,91.7362],[25.6,92.4],[24.8170,93.9368]];
RP["H_GUW-NE_ML"]=[[26.1445,91.7362],[25.9,91.8],[25.5788,91.8933]];
RP["H_GUW-NE_MZ"]=[[26.1445,91.7362],[25.0,92.0],[23.7271,92.7176]];
RP["H_GUW-NE_NL"]=[[26.1445,91.7362],[25.8,92.6],[25.6747,94.1100]];
RP["H_GUW-NE_TR"]=[[26.1445,91.7362],[25.0,91.3],[23.8315,91.2868]];

/* NOTE: RP contains NE fan-outs, but we hide them from the base network;
   they’re added only when City Addition is active. */

const keyFor=(a,b)=>`${a}-${b}`;
const toLonLat=ll=>ll.map(p=>[p[1],p[0]]);
function getAnchor(id){
  return CITY[id] || HUB[id] || NE7[id] || HUB_CITY[id];
}
function getRoadLatLon(a,b){
  const k1=keyFor(a,b), k2=keyFor(b,a);
  if(RP[k1]) return RP[k1];
  if(RP[k2]) return [...RP[k2]].reverse();
  const ca=getAnchor(a)||{lat:21.1458,lon:79.0882};
  const cb=getAnchor(b)||{lat:21.1458,lon:79.0882};
  return [[ca.lat,ca.lon],[cb.lat,cb.lon]];
}
function expandIDsToLatLon(ids){
  const out=[];
  for(let i=0;i<ids.length-1;i++){
    const seg=getRoadLatLon(ids[i],ids[i+1]);
    if(i>0) seg.shift();
    out.push(...seg);
  }
  return out;
}

/* Build base network; when includeHub=false, hide hub spokes.
   IMPORTANT: exclude ANY NE_* or H_GUW links from the base set; they are added only in City Addition. */
function networkGeoJSON(includeHub){
  const keys=Object.keys(RP).filter(k=>
      (includeHub || !k.includes("H_NAG")) &&         // hide Nagpur spokes unless Hub mode
      !k.includes("H_GUW") &&                         // never include Guwahati links in base
      !k.includes("NE_")                              // never include Seven Sisters links in base
  );
  const features=keys.map(k=>({
    type:"Feature",properties:{id:k},geometry:{type:"LineString",coordinates:toLonLat(RP[k])}
  }));

  if (SHOW_NE && !SHOW_HUB_CITY) {
    // Baseline fan-out from Kolkata (explicit curved RPs above)
    for (const id of Object.keys(NE7)) {
      const k = `WH5-${id}`;
      const coords = RP[k] ? RP[k] : getRoadLatLon("WH5", id);
      features.push({ type:"Feature", properties:{id:k}, geometry:{type:"LineString",coordinates:toLonLat(coords)} });
    }
  } else if (SHOW_NE && SHOW_HUB_CITY) {
    // Proposal: WH5 ↔ H_GUW + H_GUW → NE_* (skip NE_AS self-link)
    features.push({
      type:"Feature", properties:{id:"WH5-H_GUW"},
      geometry:{type:"LineString",coordinates:toLonLat(getRoadLatLon("WH5","H_GUW"))}
    });
    for (const id of Object.keys(NE7)) {
      if (id === "NE_AS") continue;
      const k = `H_GUW-${id}`;
      const coords = RP[k] ? RP[k] : getRoadLatLon("H_GUW", id);
      features.push({ type:"Feature", properties:{id:k}, geometry:{type:"LineString",coordinates:toLonLat(coords)} });
    }
  }
  return {type:"FeatureCollection",features};
}

/* -------------------- scenarios -------------------- */
let SCN_BEFORE=null, SCN_AFTER=null, SCN_HUB=null;
let SCN_CITY_BASE=null, SCN_CITY_AFTER=null;

/* -------------------- default scenario (fallback) -------------------- */
const DEFAULT_BEFORE={
  warehouses:Object.keys(CITY).map(id=>({id,location:CITY[id].name.split("—")[1].trim(),inventory:500})),
  trucks:[
    {id:"T1", origin:"WH1", destination:"WH2", status:"On-Time", delay_hours:0, units:3, speed_kmph:55, od:"WH1-WH2"},
    {id:"T2", origin:"WH2", destination:"WH3", status:"On-Time", delay_hours:0, units:3, speed_kmph:55, od:"WH2-WH3"},
    {id:"T3", origin:"WH3", destination:"WH1", status:"On-Time", delay_hours:0, units:3, speed_kmph:55, od:"WH3-WH1"}
  ],
  policies:{ capacity_units:10, default_speed_kmph:55, use_hub:false }
};

/* -------------------- Disruption steps -------------------- */
const STEPS=[
  {id:"D1",route:["WH1","WH2"],reroute:[["WH1","WH4"],["WH4","WH2"]],
   cause:["Disruption one.","Delhi to Mumbai corridor is closed near Rajasthan.","All trucks on this corridor are safely paused.","Please click the Correct button to apply the AI fix."],
   fix:["AI has corrected the disruption.","Traffic is rerouted via Hyderabad: Delhi to Hyderabad, then Hyderabad to Mumbai.","Green links show the new safe detour. Flows are resuming."]},
  {id:"D2",route:["WH1","WH4"],reroute:[["WH1","WH2"],["WH2","WH4"]],
   cause:["Disruption two.","Delhi to Hyderabad is impacted by a long work zone.","All trucks on this corridor are paused in place.","Click Correct to rebalance via Mumbai."],
   fix:["AI has corrected the disruption.","We are diverting Delhi to Mumbai, and then Mumbai to Hyderabad.","Green segments confirm the balanced detour is active."]},
  {id:"D3",route:["WH5","WH2"],reroute:[["WH5","WH4"],["WH4","WH2"]],
   cause:["Disruption three.","Kolkata to Mumbai is constrained by flood-prone sections.","All trucks on this link are held.","Click Correct to divert through Hyderabad."],
   fix:["AI has corrected the disruption.","We route Kolkata to Hyderabad and onward to Mumbai.","Green links indicate the detour now in effect."]},
  {id:"D4",route:["WH2","WH3"],reroute:[["WH2","WH4"],["WH4","WH3"]],
   cause:["Disruption four.","Mumbai to Bangalore faces a crash-related closure.","All trucks on this corridor are paused.","Click Correct to go via Hyderabad."],
   fix:["AI has corrected the disruption.","Detour is Mumbai to Hyderabad, then Hyderabad to Bangalore.","Green links show the new route. Queues are clearing."]},
  {id:"D5",route:["WH5","WH3"],reroute:[["WH5","WH4"],["WH4","WH3"]],
   cause:["Final disruption.","Kolkata to Bangalore is blocked due to a landslide risk.","All trucks on this corridor are paused.","Click Correct to proceed with the safe detour."],
   fix:["AI has corrected the disruption.","We divert Kolkata to Hyderabad and then Hyderabad to Bangalore.","Green links confirm stable flow on the detour."]}
];

/* -------------------- Map setup -------------------- */
const map=new maplibregl.Map({
  container:"map", style:STYLE_URL,
  center:MAP_INIT.center, zoom:MAP_INIT.zoom,
  minZoom:MAP_INIT.minZoom, maxZoom:MAP_INIT.maxZoom,
  attributionControl:true
});
map.addControl(new maplibregl.NavigationControl({visualizePitch:false}),"top-left");

/* -------------------- overlay canvas for trucks & labels -------------------- */
let overlay=null, ctx=null;
function ensureCanvas(){
  overlay=document.getElementById("trucksCanvas");
  if(!overlay){
    overlay=document.createElement("canvas");
    overlay.id="trucksCanvas";
    overlay.style.cssText="position:absolute;inset:0;pointer-events:none;z-index:2;";
    map.getContainer().appendChild(overlay);
  }
  ctx=overlay.getContext("2d");
  resizeCanvas();
}
function resizeCanvas(){
  if(!overlay) return;
  const base=map.getCanvas(), dpr=window.devicePixelRatio||1;
  overlay.width=base.clientWidth*dpr; overlay.height=base.clientHeight*dpr;
  overlay.style.width=base.clientWidth+"px"; overlay.style.height=base.clientHeight+"px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener("resize",resizeCanvas);

/* -------------------- base network + highlight layers -------------------- */
let SHOW_HUB=false;      // Nagpur spokes & marker
let SHOW_NE=false;       // Seven Sisters (hidden until City Addition)
let SHOW_HUB_CITY=false; // Guwahati hub marker (proposal stage)

function ensureRoadLayers(){
  const net=networkGeoJSON(SHOW_HUB);
  if(!map.getSource("routes")) map.addSource("routes",{type:"geojson",data:net});
  else map.getSource("routes").setData(net);

  if(!map.getLayer("routes-halo")){
    map.addLayer({id:"routes-halo",type:"line",source:"routes",
      paint:{"line-color":"#9fb4ff","line-opacity":0.22,"line-width":7.5},
      layout:{"line-cap":"round","line-join":"round"}});
  }
  if(!map.getLayer("routes-base")){
    map.addLayer({id:"routes-base",type:"line",source:"routes",
      paint:{"line-color":"#ffffff","line-opacity":0.9,"line-width":3.0},
      layout:{"line-cap":"round","line-join":"round"}});
  }

  if(!map.getSource("alert")) map.addSource("alert",{type:"geojson",data:{type:"FeatureCollection",features:[]}})
  if(!map.getLayer("alert-red")){
    map.addLayer({id:"alert-red",type:"line",source:"alert",
      paint:{"line-color":"#ff6b6b","line-opacity":0.98,"line-width":4.6},
      layout:{"line-cap":"round","line-join":"round"}});
  }

  if(!map.getSource("fix")) map.addSource("fix",{type:"geojson",data:{type:"FeatureCollection",features:[]}})
  if(!map.getLayer("fix-green")){
    map.addLayer({id:"fix-green",type:"line",source:"fix",
      paint:{"line-color":"#00d08a","line-opacity":0.98,"line-width":5.8},
      layout:{"line-cap":"round","line-join":"round"}});
  }

  try { map.moveLayer("fix-green"); } catch(e) {}
}
function refreshRoadNetwork(){
  const src=map.getSource("routes");
  if(src) src.setData(networkGeoJSON(SHOW_HUB));
}

/* helpers for sources */
function featureForRoute(ids){
  return {type:"Feature",properties:{id:ids.join("-")},
    geometry:{type:"LineString",coordinates:toLonLat(expandIDsToLatLon(ids))}};
}
function setSourceFeatures(srcId,features){
  const src=map.getSource(srcId); if(!src) return;
  src.setData({type:"FeatureCollection",features:features||[]});
}

/* -------------------- warehouse icons + labels -------------------- */
const WH_IMG=new Image(); let WH_READY=false;
WH_IMG.onload=()=>{WH_READY=true;}; WH_IMG.onerror=()=>{WH_READY=false; debug("warehouse_iso.png missing at root");};
WH_IMG.src=`${WAREHOUSE_ICON_SRC}?v=${Date.now()}`;

const WH_BASE=26, WH_MIN=16, WH_MAX=34;
const sizeByZoom=z=>Math.max(WH_MIN,Math.min(WH_MAX, WH_BASE*(0.9+(z-5)*0.18)));
function drawLabelBox(text, p, z){
  const S=sizeByZoom(z);
  const label=text, pad=6, h=16, w=ctx.measureText(label).width+pad*2, py=p.y+S/2+12;
  ctx.fillStyle="rgba(10,10,12,.78)"; ctx.fillRect(p.x-w/2,py-h/2,w,h);
  ctx.fillStyle="#e8eef2"; ctx.textBaseline="middle"; ctx.fillText(label,p.x-w/2+pad,py);
}
function drawWarehouses(){
  if(!ctx) return; const z=map.getZoom();
  ctx.font="bold 11px system-ui, Segoe UI, Roboto, sans-serif";

  // Base five warehouses
  for(const id of Object.keys(CITY)){
    const c=CITY[id], p=map.project({lng:c.lon,lat:c.lat}), S=sizeByZoom(z);
    if(WH_READY) ctx.drawImage(WH_IMG, p.x-S/2, p.y-S/2, S, S);
    drawLabelBox(c.name, p, z);
  }

  // Nagpur hub marker ONLY in Hub mode
  if(SHOW_HUB){
    const c=HUB[HUB_ID]; const p=map.project({lng:c.lon,lat:c.lat}); const S=sizeByZoom(z);
    if(WH_READY) ctx.drawImage(WH_IMG, p.x-S/2, p.y-S/2, S, S);
    drawLabelBox(c.name, p, z);
  }

  // Seven Sisters icons only (no labels)
  if(SHOW_NE){
    for(const id of Object.keys(NE7)){
      const c=NE7[id], p=map.project({lng:c.lon,lat:c.lat}), S=sizeByZoom(z);
      if(WH_READY) ctx.drawImage(WH_IMG, p.x-S/2, p.y-S/2, S, S);
    }
  }
  // Guwahati hub marker only in proposal
  if(SHOW_HUB_CITY){
    const c=HUB_CITY.H_GUW; const p=map.project({lng:c.lon,lat:c.lat}); const S=sizeByZoom(z);
    if(WH_READY) ctx.drawImage(WH_IMG, p.x-S/2, p.y-S/2, S, S);
    drawLabelBox(c.name, p, z);
  }
}

/* -------------------- trucks -------------------- */
const trucks=[]; const truckNumberById=new Map();
const SPEED_MULTIPLIER=8.6, MIN_GAP_PX=50, CROSS_GAP_PX=34, LANES_PER_ROUTE=3, LANE_WIDTH_PX=6.5, MIN_STEP=0.010;

function defaultPathIDs(o,d){
  const k1=keyFor(o,d), k2=keyFor(d,o);
  if(RP[k1]||RP[k2]) return [o,d];
  if(getAnchor(o) && getAnchor(d)) return [o,d];
  return (o!=="WH4"&&d!=="WH4") ? [o,"WH4",d] : [o,d];
}
function hashStr(s){ let h=0; for(let i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0; } return Math.abs(h); }
function segProject(pt){ return map.project({lng:pt[1],lat:pt[0]}); }

function spawnTruck(tr, idx){
  const delayed=(tr.status||"").toLowerCase()==="delayed" || (tr.delay_hours||0)>0;
  const ids=defaultPathIDs(tr.origin,tr.destination);
  const latlon=expandIDsToLatLon(ids); if(latlon.length<2) return;

  const startT=Math.random()*0.55;
  const base=delayed?2.88:4.00;
  const speed=base*(0.92+Math.random()*0.16);
  const startDelay=300+Math.random()*800;
  const laneIndex=((hashStr(tr.id)%LANES_PER_ROUTE)+LANES_PER_ROUTE)%LANES_PER_ROUTE;

  trucks.push({
    id:tr.id, origin:tr.origin, dest:tr.destination,
    latlon, seg:0, t:startT, dir:1, speed,
    delayed, laneIndex,
    startAt:performance.now()+startDelay,
    paused:false, savedPath:null
  });
  truckNumberById.set(tr.id, idx+1);
}
function drawVectorTruck(g,w,h,delayed,number){
  const trW=w*0.78,trH=h*0.72;
  g.fillStyle="rgba(0,0,0,.25)"; g.beginPath(); g.ellipse(0,trH*0.35,trW*0.9,trH*0.42,0,0,Math.PI*2); g.fill();
  const grad=g.createLinearGradient(-trW/2,0,trW/2,0); grad.addColorStop(0,"#eef2f6"); grad.addColorStop(1,"#cfd7df");
  g.fillStyle=grad; g.strokeStyle="#6f7a86"; g.lineWidth=1.2; g.beginPath(); g.roundRect(-trW/2,-trH/2,trW,trH,3); g.fill(); g.stroke();
  const cw=w*0.34,ch=h*0.72,cg=g.createLinearGradient(-cw/2,0,cw/2,0); cg.addColorStop(0,"#b3bcc6"); cg.addColorStop(1,"#9aa5b2");
  g.fillStyle=cg; g.strokeStyle="#5f6771"; g.beginPath(); g.roundRect(-w/2,-ch/2,cw,ch,3); g.fill(); g.stroke();
  g.fillStyle="#26303a"; g.fillRect(-w/2+2,-ch*0.44,cw-4,ch*0.32);
  const R=7; g.fillStyle="#fff"; g.strokeStyle="#20262e"; g.lineWidth=1.2;
  g.beginPath(); g.arc(trW*0.18,-trH*0.2,R,0,Math.PI*2); g.fill(); g.stroke();
  g.fillStyle="#111"; g.font="bold 9px system-ui"; g.textAlign="center"; g.textBaseline="middle";
  g.fillText(String(number), trW*0.18, -trH*0.2);
  g.fillStyle=delayed?"#ff3b30":"#00c853"; g.beginPath(); g.arc(trW*0.32,-trH*0.28,3.2,0,Math.PI*2); g.fill();
}

/* animation */
let __lastTS=performance.now(), __dt=1/60;
function drawFrame(){
  if(!ctx) return;
  ctx.clearRect(0,0,overlay.width,overlay.height);
  const now=performance.now();

  for(const T of trucks){
    if(now<T.startAt) continue;

    const a=T.latlon[T.seg], b=T.latlon[T.seg+T.dir]||a;
    const aP=segProject(a), bP=segProject(b);
    const segLenPx=Math.max(1,Math.hypot(bP.x-aP.x,bP.y-aP.y));

    if(!T.paused){
      let pxPerSec=SPEED_MULTIPLIER*T.speed*(0.9+(map.getZoom()-4)*0.12);
      let step=(pxPerSec*__dt)/segLenPx;

      const myProg=T.t*segLenPx; let minLead=Infinity;
      for(const O of trucks){
        if(O===T||now<O.startAt) continue;
        if(O.latlon[O.seg]===T.latlon[T.seg] && O.latlon[O.seg+O.dir]===T.latlon[T.seg+T.dir] && O.dir===T.dir){
          const a2=segProject(O.latlon[O.seg]), b2=segProject(O.latlon[O.seg+O.dir]);
          const seg2=Math.max(1,Math.hypot(b2.x-a2.x,b2.y-a2.y));
          const oProg=O.t*seg2; if(oProg>myProg) minLead=Math.min(minLead,oProg-myProg);
        }
      }
      if(isFinite(minLead)&&minLead<MIN_GAP_PX) step*=Math.max(0.25,(minLead/MIN_GAP_PX)*0.7);

      const x1=aP.x+(bP.x-aP.x)*T.t, y1=aP.y+(bP.y-aP.y)*T.t; let nearest=Infinity;
      for(const O of trucks){ if(O===T||now<O.startAt) continue;
        const aO=segProject(O.latlon[O.seg]), bO=segProject(O.latlon[O.seg+O.dir]);
        const xO=aO.x+(bO.x-aO.x)*O.t, yO=aO.y+(bO.y-aO.y)*O.t;
        nearest=Math.min(nearest,Math.hypot(xO-x1,yO-y1));
      }
      if(isFinite(nearest)&&nearest<CROSS_GAP_PX) step*=Math.max(0.30,(nearest/CROSS_GAP_PX)*0.6);
      step=Math.max(step,MIN_STEP);

      T.t+=step;
      if(T.t>=1){ T.seg+=T.dir; T.t-=1; if(T.seg<=0){T.seg=0;T.dir=1;} else if(T.seg>=T.latlon.length-1){T.seg=T.latlon.length-1;T.dir=-1;} }
    }

    const theta=Math.atan2(bP.y-aP.y,bP.x-aP.x);
    const nx=-(bP.y-aP.y), ny=(bP.x-aP.x), nL=Math.max(1,Math.hypot(nx,ny));
    const laneZero=T.laneIndex-(LANES_PER_ROUTE-1)/2, off=laneZero*LANE_WIDTH_PX;
    const x=aP.x+(bP.x-aP.x)*T.t+(nx/nL)*off, y=aP.y+(bP.y-aP.y)*T.t+(ny/nL)*off;

    const z=map.getZoom(), scale=1.0+(z-4)*0.12, w=28*scale, h=14*scale;
    const num=truckNumberById.get(T.id)||0;
    ctx.save(); ctx.translate(x,y); ctx.rotate(theta); drawVectorTruck(ctx,w,h,T.delayed,num); ctx.restore();
  }
  drawWarehouses();
}

/* -------------------- Narration + Chat (city addition REPEAT) -------------------- */
const synth=window.speechSynthesis; let VOICE=null;
function pickVoice(){
  const vs=synth?.getVoices?.()||[];
  const prefs=[/en-IN/i,/English.+India/i,/Neural|Natural/i,/Microsoft|Google/i,/en-GB/i,/en-US/i];
  for(const p of prefs){ const v=vs.find(v=>p.test(v.name)||p.test(v.lang)); if(v) return v; }
  return vs[0]||null;
}
VOICE=pickVoice(); if(!VOICE&&synth) synth.onvoiceschanged=()=>{VOICE=pickVoice();};

const ChatUI = (() => {
  const msgs = document.getElementById('msgs');
  const input = document.getElementById('chatInput');
  const send = document.getElementById('chatSend');
  const muteBtn = document.getElementById('muteBtn');
  const clearBtn = document.getElementById('clearBtn');

  let onCommand = null;
  let muted = false;

  function stamp() {
    const d = new Date();
    return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  }
  function pushBubble(text, kind='system') {
    const div = document.createElement('div');
    div.className = `msg ${kind}`;
    div.innerHTML = `${escapeHTML(text)}<small>${stamp()}</small>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight + 200;
  }
  function escapeHTML(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  function handleSend(){
    const raw = (input.value||'').trim();
    if(!raw) return;
    pushBubble(raw, 'user');
    input.value = '';
    const cmd = raw.toLowerCase();
    if(onCommand){
      if(cmd === 'disrupt' || cmd === 'correct' || cmd === 'normal' ||
         cmd === 'hub' || cmd === 'add hub' || cmd === 'hub addition' || cmd === 'nagpur hub' ||
         cmd === 'city' || cmd === 'city addition'){
        onCommand(cmd);
      } else {
        pushBubble('Valid commands: Disrupt, Correct, Normal, Hub Addition, City Addition.', 'system');
      }
    }
  }

  send.addEventListener('click', handleSend);
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ handleSend(); }});
  muteBtn.addEventListener('click', ()=>{
    muted = !muted;
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.textContent = muted ? '🔇 Unmute' : '🔊 Mute';
    Narrator.setMuted(muted);
  });
  clearBtn.addEventListener('click', ()=>{ msgs.innerHTML = ''; });

  document.addEventListener('keydown', (e)=>{
    if((e.ctrlKey||e.metaKey) && (e.key==='m' || e.key==='M')){
      e.preventDefault();
      muteBtn.click();
    }
  });

  return {
    appendSystem: (t)=>pushBubble(t, 'system'),
    appendUser:   (t)=>pushBubble(t, 'user'),
    onCommand:    (fn)=>{ onCommand = fn; },
    setMuted:     (val)=>{ muted = !!val; muteBtn.setAttribute('aria-pressed', String(muted)); muteBtn.textContent = muted ? '🔇 Unmute' : '🔊 Mute'; }
  };
})();

/* ---- ROBUST Narrator ---- */
const Narrator = (() => {
  let muted = false;
  let currentRun = 0;
  const PASS_IDLE_GAP_MS = 700;

  function newRunToken(){ currentRun += 1; return currentRun; }
  function clearTTS(){ try{ synth?.cancel?.(); }catch(e){} }
  function wait(ms){ return new Promise(res=>setTimeout(res, ms)); }

  function speakOnceAsync(text, rate=0.95, runToken){
    return new Promise((resolve) => {
      if(muted || !synth || !text || runToken!==currentRun){ return resolve(); }
      const u = new SpeechSynthesisUtterance(String(text));
      if(VOICE) u.voice = VOICE;
      u.rate = rate; u.pitch = 1.0; u.volume = 1.0;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
    });
  }
  async function queueOnce(lines, gap=950, rate=0.95, runToken, preClear=false){
    if(preClear){ clearTTS(); }
    for(const line of lines){
      if(runToken!==currentRun) return;
      ChatUI.appendSystem(line);
      await speakOnceAsync(line, rate, runToken);
      if(runToken!==currentRun) return;
      if(gap>0) await wait(gap);
    }
  }

  return {
    sayLinesTwice: async (lines, gap=950, rate=0.95)=>{
      const run = newRunToken();
      clearTTS();
      await queueOnce(lines, gap, rate, run, false);
      if(run!==currentRun) return;
      await wait(PASS_IDLE_GAP_MS);
      if(run!==currentRun) return;
      await queueOnce(lines, gap, rate, run, false);
    },
     // inside: const Narrator = (() => { ... return { ... } })();
sayLinesOnce: async (lines, gap=950, rate=0.95) => {
  const run = newRunToken();
  clearTTS();
  await queueOnce(lines, gap, rate, run, false);
},
    sayOnce: (line)=>{
      const run = newRunToken();
      clearTTS();
      ChatUI.appendSystem(line);
      speakOnceAsync(line, 0.95, run);
    },
    clear: ()=>{ newRunToken(); clearTTS(); },
    setMuted: (m)=>{ muted = !!m; if(muted){ newRunToken(); clearTTS(); } }
  };
})();

/* -------------------- stats table helpers -------------------- */
const baseStats={}; let beforeStats=null; let afterStats=null; let hubStats=null;
let cityBaseStats=null; let cityAfterStats=null;

function computeStatsFromScenario(scn){
  const inC={}, outC={};
  (scn.trucks||[]).forEach(t=>{ outC[t.origin]=(outC[t.origin]||0)+1; inC[t.destination]=(inC[t.destination]||0)+1; });
  const stats={};
  (scn.warehouses||[]).forEach(w=>{
    stats[w.id]={ inv:w.inventory??0, in:inC[w.id]||0, out:outC[w.id]||0 };
  });
  return stats;
}
function renderStatsTable(pred, ids=null){
  const tbody=document.querySelector("#statsTable tbody"); if(!tbody) return; tbody.innerHTML="";
  const list = ids && ids.length ? ids : Object.keys(CITY);
  for(const id of list){
    const label = getAnchor(id)?.name || (CITY[id]?.name) || id;
    const s=pred[id]||{inv:"-",in:0,out:0};
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${label}</td><td>${s.inv}</td><td class="pos">+${s.in}</td><td class="neg">-${s.out}</td>`;
    tbody.appendChild(tr);
  }
}

/* -------------------- metrics -------------------- */
function haversineKm(a,b){
  const toRad=v=>v*Math.PI/180, R=6371;
  const dLat=toRad(b[0]-a[0]), dLon=toRad(b[1]-a[1]);
  const lat1=toRad(a[0]), lat2=toRad(b[0]);
  const x=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function pathDistanceKm(ids){
  const pts=expandIDsToLatLon(ids);
  let d=0; for(let i=0;i<pts.length-1;i++) d+=haversineKm([pts[i][0],pts[i][1]],[pts[i+1][0],pts[i+1][1]]);
  return d;
}
function truckDistanceKm(tr){ return pathDistanceKm([tr.origin, tr.destination]); }
function truckDriveMin(tr, scn){
  const speed = tr.speed_kmph || scn?.policies?.default_speed_kmph || DEFAULT_SPEED_KMPH;
  const km = truckDistanceKm(tr);
  return (km / speed) * 60;
}
function weightedStats(samples){
  const totalW = samples.reduce((s,x)=>s+(x.w||1),0) || 1;
  const mean = samples.reduce((s,x)=>s+(x.min*(x.w||1)),0)/totalW;
  const arr=[...samples].sort((a,b)=>a.min-b.min);
  let acc=0, p90T=0; const target=0.9*totalW;
  for(const x of arr){ acc += (x.w||1); if(acc>=target){ p90T=x.min; break; } }
  return { mean, p90:p90T, totalW };
}
function summarizeScenario(scn){
  const cap = scn?.policies?.capacity_units ?? DEFAULT_CAPACITY_UNITS;
  const useHub = !!(scn?.policies?.use_hub);
  const dwell = scn?.policies?.hub_dwell_min ?? 0;
  const batch = scn?.policies?.consolidation_window_min ?? 0;
  const movements = (scn.trucks||[]).length;
  const truckKm = (scn.trucks||[]).reduce((s,t)=>s+truckDistanceKm(t),0);

  let samples=[];
  if(useHub || (scn.trucks||[]).some(t=>t.origin.startsWith("H_")||t.destination.startsWith("H_"))){
    for(const t of (scn.trucks||[])){
      samples.push({min:truckDriveMin(t, scn)+dwell+batch, w:t.units||1});
    }
  } else {
    for(const t of (scn.trucks||[])) samples.push({min:truckDriveMin(t, scn), w:t.units||1});
  }

  const {mean, p90, totalW} = weightedStats(samples.length? samples : [{min:0,w:1}]);
  const util = (scn.trucks||[]).reduce((s,t)=>s+((t.units||0)/cap),0) / Math.max(1,(scn.trucks||[]).length);

  return { movements, truckKm, meanEta:Math.round(mean), p90Eta:Math.round(p90), utilization:Math.round(util*100), totalUnits:totalW };
}
const fmtInt = (n)=>Math.round(n).toLocaleString("en-US");
const roundKm = (km)=>Math.round(km/10)*10;
const fmtKm = (km)=>`${fmtInt(roundKm(km))} kilometers`;
const toHours1 = (min)=> (Math.round((min/60)*10)/10);
const fmtHours = (min)=>`${toHours1(min)} hours`;
function pctDeltaHuman(base, now){
  if(base===0) return {dir:"changed", pct:0};
  const d = Math.round(Math.abs((now-base)/base*100));
  const dir = (now<base) ? "decreased" : "increased";
  return {dir, pct:d};
}
function ppDeltaHuman(basePct, nowPct){
  const d = Math.round(nowPct - basePct);
  const dir = (d<0) ? "decreased" : "increased";
  return {dir, pp:Math.abs(d)};
}

/* -------------------- pause / reroute control -------------------- */
function odMatch(ids,o,d){ const a=ids[0], b=ids[ids.length-1]; return (a===o&&b===d)||(a===d&&b===o); }
function setTruckPath(T,latlon,toMid=false){ if(!latlon||latlon.length<2) return; T.latlon=latlon; T.seg=0; T.dir=1; T.t=toMid?0.5:0.0; }
function pauseAllOnRoute(step){
  const ids=step.route; const latlon=expandIDsToLatLon(ids);
  for(const T of trucks){
    const baseIDs=defaultPathIDs(T.origin,T.dest);
    if(odMatch(baseIDs, ids[0], ids[1])){
      if(!T.savedPath) T.savedPath={ latlon:[...T.latlon], seg:T.seg, t:T.t, dir:T.dir };
      setTruckPath(T, latlon, true);
      T.paused=true;
    }
  }
}
function unpauseAll(resetToSaved){
  for(const T of trucks){
    if(T.paused){
      if(resetToSaved && T.savedPath) setTruckPath(T, T.savedPath.latlon, false);
      T.paused=false; T.savedPath=null;
    }
  }
}
function reroutePaused(step){
  const full=step.reroute?.length ? expandIDsToLatLon(step.reroute.flat()) : null;
  if(!full) return 0;
  let released=0;
  for(const T of trucks){
    if(!T.paused) continue;
    setTruckPath(T, full, false);
    T.paused=false; T.savedPath=null; released++;
  }
  return released;
}

/* -------------------- state machine -------------------- */
let mode="normal"; let currentStepIdx=-1;
function setAlert(ids){ setSourceFeatures("alert",[featureForRoute(ids)]); }
function clearAlert(){ setSourceFeatures("alert",[]); }
function setFix(pairs){ setSourceFeatures("fix",(pairs||[]).map(pair=>featureForRoute(pair))); }
function clearFix(){ setSourceFeatures("fix",[]); }

function activateTrucksFromScenario(scn){
  trucks.length=0; truckNumberById.clear();
  (scn.trucks||[]).forEach((t,i)=>spawnTruck(t,i));
}

/* -------- NEW: merge helpers so other corridors keep moving during City Addition -------- */
function prefixTruckIds(trucksList, prefix){
  return (trucksList||[]).map((t, i)=>({
    ...t,
    id: `${prefix}${t.id || i}`
  }));
}
function buildCombinedScenario(baseScn, overlayScn, overlayPrefix){
  // Keep base warehouses/policies as-is; just concatenate trucks with namespacing
  const base = baseScn || {warehouses:[], trucks:[], policies:{}};
  const over = overlayScn || {warehouses:[], trucks:[], policies:{}};
  const trucksMerged = [
    ...(base.trucks||[]),
    ...prefixTruckIds(over.trucks||[], overlayPrefix||"NE_")
  ];
  return {
    warehouses: base.warehouses,          // stocks/labels UI is handled separately for NE
    trucks: trucksMerged,
    policies: base.policies || {}
  };
}

/* -------------------- Disrupt/Correct/Normal -------------------- */
function startDisrupt(){
  if(mode==="disrupt"){
    Narrator.sayLinesTwice(["A disruption is already active. Please click the Correct button to proceed."],900,0.92);
    return;
  }
  SHOW_HUB=false; SHOW_NE=false; SHOW_HUB_CITY=false; refreshRoadNetwork();
  currentStepIdx = (currentStepIdx + 1) % STEPS.length;
  const step=STEPS[currentStepIdx];
  clearFix(); setAlert(step.route);
  pauseAllOnRoute(step);

  renderStatsTable(beforeStats);
  Narrator.sayLinesTwice([...step.cause,"Once you are ready, please click the Correct button."], 950, 0.9);
  mode="disrupt";
}
function applyCorrect(){
  if(mode!=="disrupt"){
    Narrator.sayLinesTwice(["No active disruption. Click Disrupt first."],800,0.95);
    return;
  }
  SHOW_HUB=false; SHOW_NE=false; SHOW_HUB_CITY=false; refreshRoadNetwork();
  const step=STEPS[currentStepIdx];
  clearAlert(); setFix(step.reroute);
  reroutePaused(step);
  renderStatsTable(afterStats);
  Narrator.sayLinesTwice(step.fix, 950, 0.92);
  mode="fixed";
}
function backToNormal(){
  SHOW_HUB=false; SHOW_NE=false; SHOW_HUB_CITY=false; refreshRoadNetwork();
  Narrator.clear();
  clearAlert(); clearFix();
  activateTrucksFromScenario(SCN_BEFORE);
  renderStatsTable(beforeStats);
  Narrator.sayLinesTwice(["Returning to normal operations. All corridors white and flowing."], 900, 0.95);
  mode="normal";
}

/* -------------------- Hub Addition flow -------------------- */
function hubAddition(){
  if(!SCN_HUB){
    Narrator.sayLinesTwice(["Hub scenario not found in scenario_after.json (key 'hub')."], 800, 0.95);
    return;
  }
  Narrator.clear(); clearAlert(); clearFix();

  SHOW_NE=false; SHOW_HUB_CITY=false;
  SHOW_HUB=true; refreshRoadNetwork();

  activateTrucksFromScenario(SCN_HUB);
  renderStatsTable(hubStats||beforeStats);

  const baseS = summarizeScenario(SCN_BEFORE);
  const hubS  = summarizeScenario(SCN_HUB);

  const mov = pctDeltaHuman(baseS.movements, hubS.movements);
  const km  = pctDeltaHuman(baseS.truckKm, hubS.truckKm);
  const util= ppDeltaHuman(baseS.utilization, hubS.utilization);

  const lines=[
    "Hub Addition engaged — evaluating Nagpur as a consolidation hub.",
    `Truck movements ${mov.dir} by ${mov.pct} percent, from ${fmtInt(baseS.movements)} to ${fmtInt(hubS.movements)}.`,
    `Distance traveled ${km.dir} by ${km.pct} percent, from ${fmtKm(baseS.truckKm)} to ${fmtKm(hubS.truckKm)}.`,
    `Average utilization ${util.dir} by ${util.pp} percentage points, from ${baseS.utilization}% to ${hubS.utilization}%.`
  ];
  Narrator.sayLinesTwice(lines, 850, 0.92);
  mode="hub";
}

/* -------------------- City Addition flow (Seven Sisters + Guwahati) -------------------- */
async function cityAddition(){
  if(!SCN_CITY_BASE || !SCN_CITY_AFTER){
    Narrator.sayLinesOnce(["City Addition data not found. Please check 'city.baseline' in scenario_before.json and 'city.proposal' in scenario_after.json."], 800, 0.95);
    return;
  }
  Narrator.clear(); clearAlert(); clearFix();

  // Stage 1: Baseline (Kolkata → NE, no Guwahati hub) — KEEP other corridors moving
  SHOW_HUB=false; SHOW_HUB_CITY=false;
  SHOW_NE=true; refreshRoadNetwork();               // adds WH5→NE curved roads (no hub)
  // Merge: base trucks + NE baseline trucks (ID-namespaced to avoid clashes)
  const COMBINED_CITY_BASE = buildCombinedScenario(SCN_BEFORE, SCN_CITY_BASE, "NEB_");
  activateTrucksFromScenario(COMBINED_CITY_BASE);

  const NE_IDS = Object.keys(NE7);
  renderStatsTable(cityBaseStats, NE_IDS);

  const baseS = summarizeScenario(SCN_CITY_BASE);   // KPI lines focus on NE addition deltas
  const baselineLines = [
    "Opening service to the Seven Sisters (Arunachal Pradesh, Assam, Manipur, Meghalaya, Mizoram, Nagaland, Tripura).",
    "Baseline: Serving from the existing network without a Guwahati hub. Other corridors continue as-is.",
    `Baseline movements (North-East flows considered): ${fmtInt(baseS.movements)}.`,
    `Baseline distance (North-East flows): ${fmtKm(baseS.truckKm)}.`,
    `Average O→D time (North-East flows): ${fmtHours(baseS.meanEta)}.`,
    `90th percentile ETA (North-East flows): ${fmtHours(baseS.p90Eta)}.`,
    `Average truck utilization (North-East flows): ${baseS.utilization} percent.`
  ];
  await Narrator.sayLinesOnce(baselineLines, 900, 0.92);

  // Stage 2: Proposal (Guwahati hub appears now; fan-out switches to H_GUW)
  await new Promise(r=>setTimeout(r, 900));
  SHOW_HUB=false; SHOW_NE=true; SHOW_HUB_CITY=true; // reveal H_GUW + swap routes
  refreshRoadNetwork();

  // Merge: base trucks + NE proposal trucks (ID-namespaced). Ensures Kolkata ↔ Guwahati flows + rest of India continue.
  const COMBINED_CITY_PROPOSAL = buildCombinedScenario(SCN_BEFORE, SCN_CITY_AFTER, "NEP_");

  // If your city.proposal didn't include WH5↔H_GUW trucks, add a minimal fallback so the movement is visible.
  const hasWH5GUW = (SCN_CITY_AFTER.trucks||[]).some(t=>
    (t.origin==="WH5" && (t.destination==="H_GUW"||t.destination==="NE_AS")) ||
    (t.destination==="WH5" && (t.origin==="H_GUW"||t.origin==="NE_AS"))
  );
  if(!hasWH5GUW){
    (COMBINED_CITY_PROPOSAL.trucks).push(
      {id:"NEP_FALLBACK_1", origin:"WH5", destination:"H_GUW", units:3, speed_kmph:55, status:"On-Time"},
      {id:"NEP_FALLBACK_2", origin:"H_GUW", destination:"WH5", units:3, speed_kmph:55, status:"On-Time"}
    );
  }

  activateTrucksFromScenario(COMBINED_CITY_PROPOSAL);
  renderStatsTable(cityAfterStats, NE_IDS);

  const afterS = summarizeScenario(SCN_CITY_AFTER);
  const mov = pctDeltaHuman(baseS.movements, afterS.movements);
  const km  = pctDeltaHuman(baseS.truckKm, afterS.truckKm);
  const mean = pctDeltaHuman(baseS.meanEta, afterS.meanEta);
  const p90  = pctDeltaHuman(baseS.p90Eta,  afterS.p90Eta);
  const util = ppDeltaHuman(baseS.utilization, afterS.utilization);

  const proposalLines = [
    "Proposal: Add Guwahati hub and reassign the Seven Sisters to it (fan-out from Guwahati).",
    "Other corridors continue concurrently. Kolkata ↔ Guwahati movements are active.",
    `Truck movements (North-East flows) ${mov.dir} by ${mov.pct}% — from ${fmtInt(baseS.movements)} to ${fmtInt(afterS.movements)}.`,
    `Total truck-km (North-East flows) ${km.dir} by ${km.pct}% — from ${fmtKm(baseS.truckKm)} to ${fmtKm(afterS.truckKm)}.`,
    `Average O→D time (North-East flows) ${mean.dir} by ${toHours1(Math.abs(afterS.meanEta-baseS.meanEta))} hours — from ${fmtHours(baseS.meanEta)} to ${fmtHours(afterS.meanEta)}.`,
    `P90 ETA (North-East flows) ${p90.dir} by ${toHours1(Math.abs(afterS.p90Eta-baseS.p90Eta))} hours — from ${fmtHours(baseS.p90Eta)} to ${fmtHours(afterS.p90Eta)}.`,
    `Average truck utilization (North-East flows) ${util.dir} by ${Math.abs(util.pp)} pp — from ${baseS.utilization}% to ${afterS.utilization}%.`
  ];
  await Narrator.sayLinesOnce(proposalLines, 900, 0.92);

  mode="city";
}

/* -------------------- camera helper -------------------- */
function fitToBoundsOfAnchors(ids){
  const b=new maplibregl.LngLatBounds();
  ids.forEach(id=>{ const a=getAnchor(id); if(a) b.extend([a.lon,a.lat]); });
  if(b.isEmpty()) return;
  map.fitBounds(b,{padding:{top:60,left:60,right:320,bottom:60},duration:800,maxZoom:6.8});
}

/* -------------------- boot -------------------- */
const mapReady=new Promise(res=>map.on("load",res));
(async function start(){
  await mapReady;
  ensureCanvas(); ensureRoadLayers();

  // top-left buttons
  const ui=document.getElementById("ui")||document.body;
  const btnBefore=document.getElementById("btnBefore");
  const btnAfter=document.getElementById("btnAfter");
  if(btnBefore) btnBefore.textContent="Disrupt";
  if(btnAfter)  btnAfter.textContent="Correct";

  let btnNormal=document.getElementById("btnNormal");
  if(!btnNormal){
    btnNormal=document.createElement("button");
    btnNormal.id="btnNormal"; btnNormal.textContent="Normal";
    btnNormal.style.marginLeft="8px";
    ui.appendChild(btnNormal);
  }
  let btnHub=document.getElementById("btnHub");
  if(!btnHub){
    btnHub=document.createElement("button");
    btnHub.id="btnHub"; btnHub.textContent="Hub Addition";
    btnHub.style.marginLeft="8px";
    ui.appendChild(btnHub);
  }
  let btnCity=document.getElementById("btnCity");
  if(!btnCity){
    btnCity=document.createElement("button");
    btnCity.id="btnCity"; btnCity.textContent="City Addition";
    btnCity.style.marginLeft="8px";
    ui.appendChild(btnCity);
  }

  // wire buttons
  if(btnBefore) btnBefore.onclick=()=>startDisrupt();
  if(btnAfter)  btnAfter.onclick =()=>applyCorrect();
  btnNormal.onclick=()=>backToNormal();
  btnHub.onclick=()=>hubAddition();
  btnCity.onclick=()=>cityAddition();

  // wire chat commands
  ChatUI.onCommand((cmd)=>{
    if(cmd==='disrupt') startDisrupt();
    else if(cmd==='correct') applyCorrect();
    else if(cmd==='normal') backToNormal();
    else if(cmd==='hub' || cmd==='add hub' || cmd==='hub addition' || cmd==='nagpur hub') hubAddition();
    else if(cmd==='city' || cmd==='city addition') cityAddition();
  });

  // load scenarios
  const beforeRaw = await fetchOrDefault("scenario_before.json", DEFAULT_BEFORE);
  SCN_BEFORE = beforeRaw;
  const afterRaw  = await fetchOrDefault("scenario_after.json",  DEFAULT_BEFORE);
  SCN_AFTER = { warehouses: afterRaw.warehouses, trucks: afterRaw.trucks, policies: afterRaw.policies||{} };
  SCN_HUB   = afterRaw.hub ? { warehouses: afterRaw.hub.warehouses, trucks: afterRaw.hub.trucks, policies: afterRaw.hub.policies } : null;

  // City scenarios
  SCN_CITY_BASE  = beforeRaw.city?.baseline || null;
  SCN_CITY_AFTER = afterRaw.city?.proposal || null;

  // compute stats snapshots
  beforeStats = computeStatsFromScenario(SCN_BEFORE);
  afterStats  = computeStatsFromScenario(SCN_AFTER);
  hubStats    = SCN_HUB ? computeStatsFromScenario(SCN_HUB) : null;
  cityBaseStats  = SCN_CITY_BASE  ? computeStatsFromScenario(SCN_CITY_BASE)  : null;
  cityAfterStats = SCN_CITY_AFTER ? computeStatsFromScenario(SCN_CITY_AFTER) : null;
  Object.assign(baseStats, beforeStats);

  // spawn trucks from BEFORE scenario
  activateTrucksFromScenario(SCN_BEFORE);

  // initial camera — include base five; NE roads are hidden until City Addition
  const b=new maplibregl.LngLatBounds(); Object.values(CITY).forEach(c=>b.extend([c.lon,c.lat]));
  map.fitBounds(b,{padding:{top:60,left:60,right:320,bottom:60},duration:800,maxZoom:6.8});

  // start clean
  renderStatsTable(beforeStats);
  Narrator.sayLinesTwice([
    "Type Disrupt, Correct, Normal — or Hub Addition — or City Addition — to drive the simulation.",
    "🔊 Toggle narration with the Mute button or press Ctrl+M."
  ]);
})();

/* -------------------- fetch helper & tick -------------------- */
async function fetchOrDefault(file, fallback){
  try{ const r=await fetch(`${file}?v=${Date.now()}`,{cache:"no-store"}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  catch(e){ debug(`Using default scenario (${e.message})`); return fallback; }
}
function tick(){ const now=performance.now(); const dt=Math.min(0.05,(now-__lastTS)/1000); __lastTS=now; __dt=dt; drawFrame(); requestAnimationFrame(tick); }
requestAnimationFrame(tick);


