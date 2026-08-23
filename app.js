const state = {
  manifest: null,
  maps: null,
  memoryMaps: {},
  details: {},
  memoryLinks: [],
  outcomeMethod: "memory",
  selected: null,
  highlights: { question: new Set(), memory: new Set() },
  transforms: {},
};

const plots = Object.fromEntries(["memory", "train", "test", "ood"].map((kind) => [kind, document.getElementById(`${kind}Plot`)]));
const metas = Object.fromEntries(["memory", "train", "test", "ood"].map((kind) => [kind, document.getElementById(`${kind}Meta`)]));
const OUTCOME_LABELS = {
  covered_at_6: "Recovered by rank 6",
  covered_at_10: "Recovered at ranks 7–10",
  recovered_after_10: "Recovered after rank 10",
  unrecovered: "Never recovered",
  not_available: "No outcome data",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return response.json();
}

function showError(message) {
  const node = document.getElementById("errorBox");
  node.textContent = message || "";
  node.style.display = message ? "block" : "none";
}

function pointColor(point, kind) {
  if (kind === "memory") return "#d97706";
  if (point.split === "train") return "#2f66cc";
  if (point.split === "test") return "#0f8d58";
  return "#9b5de5";
}

function initTransform(kind) { state.transforms[kind] = { x: 0, y: 0, scale: 1 }; }
function applyTransform(kind) {
  const value = state.transforms[kind] || { x: 0, y: 0, scale: 1 };
  for (const group of plots[kind].querySelectorAll("g.plot-layer")) {
    group.setAttribute("transform", `translate(${value.x} ${value.y}) scale(${value.scale})`);
  }
}
function resetPlot(kind) { initTransform(kind); applyTransform(kind); }

function installPanZoom(kind) {
  const svg = plots[kind];
  initTransform(kind);
  let dragging = false, last = null, start = null, startPoint = null, moved = false;
  svg.addEventListener("pointerdown", (event) => {
    dragging = true; last = {x:event.clientX,y:event.clientY}; start = {...last};
    startPoint = event.target.closest ? event.target.closest(".point") : null; moved = false;
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!dragging || !last) return;
    if (Math.hypot(event.clientX-start.x,event.clientY-start.y)>4) moved=true;
    const transform=state.transforms[kind]; transform.x+=event.clientX-last.x; transform.y+=event.clientY-last.y;
    last={x:event.clientX,y:event.clientY}; applyTransform(kind);
  });
  svg.addEventListener("pointerup", () => {
    if (startPoint && !moved) selectPoint(kind,startPoint.dataset.id);
    dragging=false; last=null; start=null; startPoint=null; moved=false;
  });
  svg.addEventListener("pointercancel", () => { dragging=false; last=null; start=null; startPoint=null; moved=false; });
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const transform=state.transforms[kind], factor=event.deltaY<0?1.12:.89;
    const next=Math.max(.35,Math.min(9,transform.scale*factor));
    const rect=svg.getBoundingClientRect(), mx=((event.clientX-rect.left)/rect.width)*1000, my=((event.clientY-rect.top)/rect.height)*700;
    transform.x=mx-(mx-transform.x)*(next/transform.scale); transform.y=my-(my-transform.y)*(next/transform.scale); transform.scale=next;
    applyTransform(kind);
  },{passive:false});
}

function renderPlot(kind, points) {
  const svg=plots[kind], group=document.createElementNS("http://www.w3.org/2000/svg","g");
  group.classList.add("points","plot-layer"); svg.replaceChildren(group);
  for (const point of points) {
    const node=document.createElementNS("http://www.w3.org/2000/svg","g");
    node.classList.add("point"); node.dataset.kind=kind; node.dataset.id=point.id; node.dataset.instanceId=point.instance_id||"";
    node.setAttribute("transform",`translate(${point.x} ${point.y})`);
    const hit=document.createElementNS("http://www.w3.org/2000/svg","circle"); hit.setAttribute("r",kind==="memory"?"13":"12"); hit.setAttribute("fill","transparent"); hit.setAttribute("pointer-events","all"); node.appendChild(hit);
    const circle=document.createElementNS("http://www.w3.org/2000/svg","circle"); circle.classList.add("point-dot"); circle.setAttribute("r",kind==="memory"?"5.2":"4.6"); circle.setAttribute("fill",pointColor(point,kind)); circle.setAttribute("fill-opacity",kind==="memory"?".76":".82"); circle.setAttribute("stroke","#fff"); circle.setAttribute("stroke-width","1"); node.appendChild(circle);
    const title=document.createElementNS("http://www.w3.org/2000/svg","title"); node.dataset.baseTitle=`${point.id}\n${(point.label||point.question||point.content||"").slice(0,260)}`; title.textContent=node.dataset.baseTitle; node.appendChild(title);
    group.appendChild(node);
  }
  applyTransform(kind);
}

function renderOutcomeLegend() {
  const colors=state.manifest?.outcome_colors||{}, node=document.getElementById("outcomeLegend");
  const heading=state.outcomeMethod==="memory"?"Dot colors · selected memory setting":"Dot colors · Question → Question baseline (unchanged across memory settings)";
  node.innerHTML=`<strong>${escapeHtml(heading)}</strong>`+Object.entries(OUTCOME_LABELS).filter(([key])=>key!=="not_available").map(([key,label])=>`<span><i class="outcome-swatch" style="background:${escapeHtml(colors[key]||"#64748b")}"></i>${escapeHtml(label)}</span>`).join("");
}

function applyOutcomeColors() {
  const colors=state.manifest?.outcome_colors||{}, methodLabel=state.outcomeMethod==="memory"?"Memory retrieval":"Question → Question";
  const splitLabels={train:"training questions",test:"in-domain test questions",ood:"OOD200 questions"};
  for (const kind of ["train","test","ood"]) {
    const counts={covered_at_6:0,covered_at_10:0,recovered_after_10:0,unrecovered:0,not_available:0};
    for (const node of plots[kind].querySelectorAll(".point")) {
      const evaluation=state.details[node.dataset.id]?.evaluation?.[state.outcomeMethod]||{};
      const outcome=evaluation.outcome||"not_available", dot=node.querySelector(".point-dot"); counts[outcome]=(counts[outcome]||0)+1;
      if (dot) { dot.setAttribute("fill",colors[outcome]||colors.not_available||"#64748b"); dot.setAttribute("fill-opacity",".9"); }
      node.dataset.outcome=outcome;
      const rank=evaluation.cover_rank==null?"":` (cover rank ${evaluation.cover_rank})`;
      const title=node.querySelector("title"); if (title) title.textContent=`${node.dataset.baseTitle}\n${methodLabel}: ${OUTCOME_LABELS[outcome]||outcome}${rank}`;
    }
    const total=state.maps[kind]?.length||0;
    const countItems=[
      ["covered_at_6",counts.covered_at_6],
      ["covered_at_10",counts.covered_at_10],
      ["recovered_after_10",counts.recovered_after_10],
      ["unrecovered",counts.unrecovered],
    ];
    metas[kind].classList.add("outcome-meta");
    metas[kind].innerHTML=`<span class="meta-total">${total} ${escapeHtml(splitLabels[kind])}</span>`+countItems.map(([outcome,count])=>`<span class="outcome-count" title="${escapeHtml(OUTCOME_LABELS[outcome]||outcome)}"><i class="outcome-count-dot" style="background:${escapeHtml(colors[outcome]||colors.not_available||"#64748b")}"></i><b>${count}</b><span>${total?((count/total)*100).toFixed(1):"0.0"}%</span></span>`).join("");
  }
  renderOutcomeLegend();
}

function renderMemoryLinks(edges) {
  const svg=plots.memory, points=new Map((state.maps.memory||[]).map((point)=>[point.id,point]));
  svg.querySelector("g.memory-links")?.remove();
  const group=document.createElementNS("http://www.w3.org/2000/svg","g");
  group.classList.add("memory-links","plot-layer");
  const seen=new Set();
  for (const edge of edges||[]) {
    const source=points.get(edge.source), target=points.get(edge.target);
    if (!source || !target || source.id===target.id) continue;
    const key=[source.id,target.id].sort().join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    const line=document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1",source.x); line.setAttribute("y1",source.y);
    line.setAttribute("x2",target.x); line.setAttribute("y2",target.y);
    const title=document.createElementNS("http://www.w3.org/2000/svg","title");
    title.textContent=`${source.id} \u2194 ${target.id}`; line.appendChild(title); group.appendChild(line);
  }
  const pointGroup=svg.querySelector("g.points");
  svg.insertBefore(group,pointGroup); applyTransform("memory");
}

function updateHighlights() {
  for (const [kind,svg] of Object.entries(plots)) for (const node of svg.querySelectorAll(".point")) {
    node.classList.remove("selected","hit","mem-hit");
    if (state.selected?.kind===kind && state.selected?.id===node.dataset.id) node.classList.add("selected");
    if (kind!=="memory" && state.highlights.question.has(node.dataset.instanceId||"")) node.classList.add("hit");
    if (kind==="memory" && state.highlights.memory.has(node.dataset.id||"")) node.classList.add("mem-hit");
  }
}

function renderToolList(id, tools, expected) {
  const required=new Set(expected||[]), node=document.getElementById(id);
  node.innerHTML=(tools||[]).map((tool,index)=>`<div class="tool-row ${required.has(tool)?"correct":"wrong"}"><span>${index+1}</span><span>${escapeHtml(tool)}</span></div>`).join("")||`<div class="tool-row wrong"><span>–</span><span>No tools</span></div>`;
}

function setDetailMode(mode) {
  document.getElementById("questionMethodFields").hidden=mode==="memory";
  document.getElementById("memoryNoteFields").hidden=mode!=="memory";
}

function renderNoteTools(tools) {
  const node=document.getElementById("noteTools");
  node.innerHTML=(tools||[]).map((tool,index)=>`<div class="tool-row note-tool"><span>${index+1}</span><span>${escapeHtml(tool)}</span></div>`).join("")||`<div class="tool-row note-tool"><span>–</span><span>No tools recorded</span></div>`;
}

function chips(tools, required, requiredOnly=false) {
  return (tools||[]).map((tool)=>`<span class="summary-chip ${requiredOnly?"required":required.has(tool)?"hit":"extra"}">${escapeHtml(tool)}</span>`).join("")||`<span class="summary-chip extra">None</span>`;
}
function methodSummary(label, method, required) {
  const missing=method.missing_tools||[], complete=Boolean(method.complete);
  return `<div class="summary-method"><div class="summary-row-head"><strong>${escapeHtml(label)}</strong><span class="summary-score ${complete?"complete":"incomplete"}">${method.matched_count||0}/${method.required_count||0} required</span></div><div class="summary-chips">${chips(method.retrieved_tools,required)}</div>${missing.length?`<div class="summary-missing">Missing: ${missing.map(escapeHtml).join(", ")}</div>`:""}</div>`;
}
function renderSummary(payload) {
  const node=document.getElementById("retrievalSummary"), summary=payload?.retrieval_summary;
  if (!summary || payload.kind==="memory") { node.classList.remove("visible"); node.innerHTML=""; return; }
  const required=new Set(summary.required_tools||[]);
  node.innerHTML=`<div class="summary-title"><span>Retrieval summary</span><span class="summary-k">Top ${summary.top_k}</span></div><div class="summary-required"><div class="summary-row-head"><strong>Required tools</strong><span>${required.size}</span></div><div class="summary-chips">${chips([...required],required,true)}</div></div>${methodSummary("Question → Question",summary.question_method,required)}${methodSummary("Memory retrieval",summary.memory_method,required)}`;
  node.classList.add("visible");
}

function percent(value) { return `${(Number(value||0)*100).toFixed(1)}%`; }
function performanceMethod(label, metrics, accent) {
  return `<div class="performance-method ${accent}"><strong>${escapeHtml(label)}</strong><div><span>Coverage@6</span><b>${percent(metrics.coverage_at_6)}</b></div><div><span>Macro F1@6</span><b>${percent(metrics.macro_f1_at_6)}</b></div><div><span>Mean cover rank</span><b>${Number(metrics.mean_cover_rank||0).toFixed(2)}</b></div><div><span>Unrecovered</span><b>${Number(metrics.unrecovered_count||0)}</b></div></div>`;
}
function renderPerformance(payload) {
  const performance=payload.performance||{}, cards=[];
  for (const [key,label] of [["test","In-domain test"],["ood","OOD200"]]) {
    const split=performance[key]; if (!split) continue;
    cards.push(`<article class="performance-card"><div class="performance-card-head"><h3>${label}</h3><span>n=${split.sample_count}</span></div><div class="performance-methods">${performanceMethod("Question → Question",split.question||{},"question")}${performanceMethod("Memory retrieval",split.memory||{},"memory")}</div></article>`);
  }
  document.getElementById("performanceGrid").innerHTML=cards.join("");
}

function clearDetail() {
  document.getElementById("selectionDetail").textContent="Click a note or question point."; renderSummary(null);
  setDetailMode("question"); renderNoteTools([]);
  renderToolList("questionTools",[],[]); renderToolList("memoryTools",[],[]);
}
function renderDetail(payload) {
  const detail=document.getElementById("selectionDetail");
  if (payload.kind==="memory") {
    const item=payload.item; detail.textContent=[`Memory: ${item.id}`,`Context: ${item.context||""}`,"",item.content||"","",`Keywords: ${(item.keywords||[]).join(", ")}`,`Tags: ${(item.tags||[]).join(", ")}`].join("\n");
    setDetailMode("memory"); renderSummary(null); renderNoteTools(item.tools||[]); return;
  }
  setDetailMode("question"); renderNoteTools([]);
  const item=payload.item, evaluation=payload.evaluation?.[state.outcomeMethod]||{}, methodLabel=state.outcomeMethod==="memory"?"Memory retrieval":"Question → Question", rank=evaluation.cover_rank==null?"":` (cover rank ${evaluation.cover_rank})`;
  detail.textContent=[`${item.split} question: ${item.instance_id}`,`Template: ${item.template_id||""}`,`Required tools: ${(item.expected_tools||[]).join(", ")}`,`PCA shading: ${methodLabel} · ${OUTCOME_LABELS[evaluation.outcome]||"No outcome data"}${rank}`,"",item.question||""].join("\n");
  renderSummary(payload); renderToolList("questionTools",payload.question_tools||[],item.expected_tools||[]); renderToolList("memoryTools",payload.memory_tools||[],item.expected_tools||[]);
}

function selectPoint(kind,id) {
  showError(""); state.selected={kind,id};
  if (kind==="memory") {
    const item=(state.maps.memory||[]).find((point)=>point.id===id); if (!item) return;
    state.highlights={question:new Set(),memory:new Set([id])}; renderDetail({kind:"memory",item}); updateHighlights(); return;
  }
  const payload=state.details[id]; if (!payload) { showError(`No precomputed detail for ${id}`); return; }
  state.highlights.question=new Set(payload.question_neighbor_ids||[]); state.highlights.memory=new Set(payload.memory_neighbor_ids||[]);
  renderDetail(payload); updateHighlights();
}

function renderMaps() {
  for (const kind of Object.keys(plots)) renderPlot(kind,state.maps[kind]||[]);
  metas.train.textContent=`${state.maps.train.length} training questions`;
  metas.test.textContent=`${state.maps.test.length} in-domain test questions`;
  metas.ood.textContent=`${state.maps.ood.length} OOD200 questions`;
}

async function loadVariant() {
  showError("");
  const key=document.getElementById("variantSelect").value, variant=state.manifest.variants[key];
  document.getElementById("statusText").textContent="Loading precomputed retrieval details…";
  const payload=await fetchJson(`./${variant.details}`);
  if (document.getElementById("variantSelect").value!==key) return;
  state.details=payload.details||{};
  const snapshot=variant.snapshot||"no_evolution", mapKey=variant.memory_map||snapshot;
  state.maps.memory=state.memoryMaps[mapKey]||state.maps.memory||[];
  initTransform("memory"); renderPlot("memory",state.maps.memory);
  const snapshotLabel=snapshot==="evolved"?"evolved":"no evolution";
  metas.memory.textContent=`${state.maps.memory.length} notes · ${snapshotLabel} · ${variant.fields_label||variant.field_variant}`;
  state.memoryLinks=payload.memory_links||[]; renderMemoryLinks(state.memoryLinks);
  applyOutcomeColors();
  const extra=variant.links==="jaccard"?` · L=${variant.link_count} · threshold=${variant.threshold} · ${variant.ranking_mode.replaceAll("_"," → ")}`:"";
  document.getElementById("configurationText").textContent=`${variant.label} · m=${state.manifest.retrieval.m}${extra}`;
  const linkStatus=state.memoryLinks.length?` · ${state.memoryLinks.length} directed links loaded`:"";
  document.getElementById("statusText").textContent=`Ready · ${variant.label}${linkStatus}`;
  state.selected=null; state.highlights={question:new Set(),memory:new Set()}; clearDetail(); updateHighlights();
  renderPerformance(payload);
}

async function bootstrap() {
  try {
    for (const kind of Object.keys(plots)) installPanZoom(kind);
    state.manifest=await fetchJson("./data/manifest.json");
    renderOutcomeLegend();
    const selector=document.getElementById("variantSelect"); selector.replaceChildren();
    for (const [key,variant] of Object.entries(state.manifest.variants)) {
      const option=document.createElement("option"); option.value=key; option.textContent=variant.label; selector.appendChild(option);
    }
    const mapPayload=await fetchJson(`./${state.manifest.files.maps}`);
    state.maps=mapPayload.maps; state.memoryMaps=mapPayload.memory_maps||{no_evolution:state.maps.memory};
    renderMaps(); await loadVariant();
    document.getElementById("variantSelect").addEventListener("change",()=>{state.outcomeMethod="memory"; document.getElementById("outcomeMethodSelect").value="memory"; loadVariant().catch((error)=>showError(error.message));});
    document.getElementById("outcomeMethodSelect").addEventListener("change",(event)=>{state.outcomeMethod=event.target.value; applyOutcomeColors(); if(state.selected&&state.selected.kind!=="memory") renderDetail(state.details[state.selected.id]);});
    for (const button of document.querySelectorAll("[data-reset]")) button.addEventListener("click",()=>resetPlot(button.dataset.reset));
  } catch (error) { showError(error?.message||String(error)); document.getElementById("statusText").textContent="Unable to load static data."; }
}

if (document.readyState==="loading") document.addEventListener("DOMContentLoaded",bootstrap); else bootstrap();
