"use strict";
const $ = id => document.getElementById(id);
function node(tag, value, ...children) {
  const result = document.createElement(tag);
  if (value !== null && value !== undefined) result.textContent = value;
  result.append(...children);
  return result;
}
function button(label, fn) {
  const b = node("button",label);
  b.type="button";
  b.addEventListener("click",()=>run(fn,b));
  return b;
}
async function run(fn,b) {
  if(b) b.disabled=true;
  try { await fn(); } catch(error) { status(error.message,true); }
  finally { if(b) b.disabled=false; }
}
function status(message,error=false) {
  $("status").textContent=message;
  $("status").classList.toggle("error",error);
}
async function api(action,data) {
  const response=await fetch("/api/"+action,data===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const value=await response.json();
  if(!response.ok) throw Error(value.error || "Request failed.");
  return value;
}
let controller;
async function stream(action,data) {
  if(controller) controller.abort();
  const request=new AbortController();
  controller=request;
  $("cancel").hidden=false;
  $("answer").textContent="";
  if($("sources")) $("sources").replaceChildren();
  status("Waiting for local Ollama…");
  try {
    const response=await fetch("/api/"+action,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data),signal:request.signal});
    if(!response.ok) throw Error((await response.json()).error);
    const reader=response.body.getReader(), decoder=new TextDecoder();
    let pending="";
    while(true) {
      const {done,value}=await reader.read();
      pending+=decoder.decode(value,{stream:!done});
      let end;
      while((end=pending.indexOf("\n"))>=0) {
        const item=JSON.parse(pending.slice(0,end)); pending=pending.slice(end+1);
        if(item.error) throw Error(item.error);
        if(item.sources) showSources(item.sources);
        if(item.token) $("answer").textContent+=item.token;
      }
      if(done) break;
    }
    status("Response complete.");
  } catch(error) {
    if(error.name!=="AbortError") throw error;
    status("Response cancelled.");
  } finally {
    if(controller===request) {controller=null; $("cancel").hidden=true;}
  }
}
function option(select,value,label,selected=false) {
  const item=node("option",label); item.value=value; item.selected=selected; select.append(item);
}
function selectList(id,items,empty) {
  const select=$(id), current=select.value;
  select.replaceChildren();
  option(select,"",empty);
  for(const [value,label] of items) option(select,value,label,String(value)===current);
}
function form(id,fn) {
  $(id).addEventListener("submit",event=>{
    event.preventDefault();
    run(()=>fn(Object.fromEntries(new FormData(event.target)),event.target),event.submitter);
  });
}
function textBlock(parent,title,body) {
  const item=node("details",null,node("summary",title),node("pre",body));
  parent.append(item);return item;
}
function empty(parent,value) {parent.append(node("p",value));}
function download(name,text,type="text/plain") {
  const blob=text instanceof Blob?text:new Blob([text],{type});
  const a=node("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function binary(file) {
  if(file.size>30_000_000) throw Error(file.name+" exceeds 30 MB.");
  return new Promise((resolve,reject)=>{
    const reader=new FileReader(); reader.onerror=()=>reject(reader.error);
    reader.onload=()=>resolve({name:file.name,data:reader.result.split(",")[1]});
    reader.readAsDataURL(file);
  });
}
function graph(container,edges,open) {
  container.replaceChildren();
  if(!edges.length) return empty(container,"No relationships match.");
  const ns="http://www.w3.org/2000/svg";
  const svg=document.createElementNS(ns,"svg");
  const visible=edges.slice(0,25);
  svg.setAttribute("viewBox","0 0 840 "+(visible.length*38+30));
  visible.forEach((edge,i)=>{
    const y=26+i*38;
    const line=document.createElementNS(ns,"path");
    line.setAttribute("d","M260 "+y+" H568");
    line.setAttribute("class","connection");
    svg.append(line);
    for(const [x,label,anchor] of [[245,edge.from,"end"],[414,edge.kind,"middle"],[587,edge.to,"start"]]) {
      const text=document.createElementNS(ns,"text");
      text.setAttribute("x",x); text.setAttribute("y",y+5); text.setAttribute("text-anchor",anchor);
      text.textContent=label.length>32?label.slice(0,29)+"…":label;
      const title=document.createElementNS(ns,"title"); title.textContent=label;text.append(title);
      if(open && x!==414) {
        text.setAttribute("tabindex","0"); text.setAttribute("role","button");
        text.addEventListener("click",()=>run(()=>open(label)));
        text.addEventListener("keydown",event=>{if(event.key==="Enter")run(()=>open(label));});
      }
      svg.append(text);
    }
  });
  container.append(svg);
  if(edges.length>visible.length) empty(container,"Showing "+visible.length+" of "+edges.length+" links. Filter to narrow the graph.");
}
async function loadModels() {
  const value=await api("models");
  if($("model")) selectList("model",value.chat.map(name=>[name,name]),"Automatic chat model");
  if($("embedding")) selectList("embedding",value.embedding.map(name=>[name,name]),"Automatic embedding model");
  const health=$("health");
  health.textContent=value.offline?"Ollama offline":value.chat.length+" chat · "+value.embedding.length+" embedding";
  health.dataset.online=String(!value.offline);
}
function showPane(id) {
  for(const pane of document.querySelectorAll("main > section")) pane.hidden=pane.id!==id;
  for(const tab of document.querySelectorAll("nav button[data-pane]")) tab.setAttribute("aria-current",String(tab.dataset.pane===id));
}
function metrics(parent,items) {
  parent.replaceChildren(...items.map(([label,value])=>node("div",null,node("strong",value),node("span",label))));
}
function today() {
  const now=new Date();return new Date(now-Date.parse("1970-01-01")-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
function showSources(items) {
  const list=$("sources");list.replaceChildren();
  for(const [i,item] of items.entries()) textBlock(list,item.name?"[D"+item.id+"] "+item.name+" · "+item.section:
    "[S"+(i+1)+"] "+item.path+":"+item.start+"–"+item.end,item.text);
}

document.addEventListener("DOMContentLoaded",()=>{
  document.documentElement.dataset.theme=localStorage.getItem("theme") || (matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");
  $("theme").addEventListener("click",()=>{
    document.documentElement.dataset.theme=document.documentElement.dataset.theme==="dark"?"light":"dark";
    localStorage.setItem("theme",document.documentElement.dataset.theme);
  });
  $("sidebar").addEventListener("click",()=>document.body.classList.toggle("collapsed"));
  $("health").addEventListener("click",()=>run(loadModels));
  for(const tab of document.querySelectorAll("nav button[data-pane]")) tab.addEventListener("click",()=>showPane(tab.dataset.pane));
  document.addEventListener("keydown",event=>{
    if(event.key==="/"&&!event.metaKey&&!event.ctrlKey&&!["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)){
      const search=document.querySelector("section:not([hidden]) [type=search]");
      if(search){event.preventDefault();search.focus();}
    }
  });
  if($("cancel")) $("cancel").addEventListener("click",()=>controller?.abort());
  run(loadModels);
  run(startApp);
});
let docs=[],cards=[],edges=[];
async function startApp(){
  form("doc-import",()=>importFiles([...$("docs").files,...$("folder").files]));
  for(const event of ["dragenter","dragover","dragleave","drop"]) $("drop").addEventListener(event,e=>{
    e.preventDefault();$("drop").classList.toggle("active",event==="dragenter"||event==="dragover");
    if(event==="drop") run(()=>importFiles([...e.dataTransfer.files]));
  });
  $("find-doc").addEventListener("input",renderDocs);
  $("graph-filter").addEventListener("input",renderGraph);
  $("c-query").addEventListener("submit",event=>{
    event.preventDefault();
    const values=Object.fromEntries(new FormData(event.target));
    const ask=event.submitter?.value==="ask";
    run(async()=>{
      if(ask){await stream("ask",values);await loadHistory();}
      else {showSources(await api("search",values));$("answer").textContent="";status("Search complete.");}
    },event.submitter);
  });
  form("new-card",async(data,target)=>{await api("card",data);target.reset();await loadCards();status("Flashcard saved.");});
  form("edge",async(data,target)=>{await api("edge",data);target.reset();await loadGraph();status("Relationship saved.");});
  form("exam-form",async(data,target)=>{await api("exam",data);target.reset();await loadExams();status("Exam saved.");});
  form("schedule-form",async(data)=>{
    const plan=await api("schedule",data), target=$("schedule-list");
    target.replaceChildren();
    for(const day of [...new Set(plan.map(x=>x.date))]) textBlock(target,day,plan.filter(x=>x.date===day).map(x=>x.subject+" · "+x.minutes+" min · "+x.activity).join("\n"));
    if(!plan.length) empty(target,"Add an exam within the next 120 days.");
  });
  form("suggest-edges",async(data)=>{
    status("Extracting relationships with Ollama…");
    const found=await api("suggest-edges",{...data,model:$("model").value}), target=$("edge-suggestions");
    target.replaceChildren();
    for(const item of found){
      const row=node("p",null,node("span",item.source+" → "+item.relation+" → "+item.target+" "),
        button("Save relationship",async()=>{await api("edge",item);row.remove();await loadGraph();}));
      target.append(row);
    }
    status(found.length+" relationships suggested.");
  });
  await Promise.all([loadDocs(),loadCards(),loadHistory(),loadGraph(),loadExams()]);
}
async function importFiles(files){
  const usable=files.filter(file=>/\.(pdf|pptx|docx|txt|md|csv|ipynb|jpe?g|png|tiff?|heic)$/i.test(file.name));
  if(!usable.length) throw Error("Choose supported files to import.");
  const metadata=Object.fromEntries(new FormData($("doc-import")));
  let imported=0,duplicates=0; const errors=[];
  for(const file of usable){
    status("Importing "+file.name+"…");
    try{
      const result=await api("import",{...metadata,...await binary(file)});
      if(result.duplicate) duplicates++;else imported++;
    }catch(error){errors.push(file.name+" — "+error.message);}
  }
  await loadDocs();
  status(imported+" imported · "+duplicates+" duplicates"+(errors.length?" · "+errors.join(" / "):""),Boolean(errors.length));
}
async function loadDocs(){
  docs=await api("documents");
  selectList("subject",[...new Set(docs.map(x=>x.subject).filter(Boolean))].sort().map(x=>[x,x]),"All subjects");
  selectList("document",docs.map(x=>[x.id,x.name]),"All documents");
  selectList("edge-doc",docs.map(x=>[x.id,x.name]),"Choose a document");
  renderDocs();updateStats();
}
function updateStats(){
  const due=cards.filter(i=>i.due<=today()).length;
  metrics($("c-metrics"),[["Documents",docs.length],["Subjects",new Set(docs.map(x=>x.subject).filter(Boolean)).size],["Reviews due",due]]);
}
function renderDocs(){
  const target=$("doc-list");target.replaceChildren();
  const query=$("find-doc").value.toLowerCase();
  for(const item of docs.filter(x=>Object.values(x).join(" ").toLowerCase().includes(query))){
    const a=node("article",null,node("h3",item.name),node("p",[item.semester,item.subject,item.topic,item.tags].filter(Boolean).join(" · ")));
    const buttons=node("div",null,
      button("Preview",async()=>{
        const sections=await api("preview",{id:item.id}), preview=$("preview");preview.replaceChildren();
        if(!sections.length) empty(preview,"No selectable text was found. Download the original to view it.");
        for(const first of sections) textBlock(preview,first.section,first.text);
        preview.querySelector("details")?.setAttribute("open","");
      }),
      button("Original",async()=>{
        const value=await api("original",{id:item.id});
        download(value.name,new Blob([Uint8Array.from(atob(value.data),ch=>ch.charCodeAt(0))]));
      }),
      button("Delete",async()=>{if(confirm("Delete "+item.name+" from CORTEX?")){await api("delete-doc",{id:item.id});$("preview").replaceChildren();await loadDocs();}})
    );buttons.className="row";a.append(buttons);target.append(a);
  }
  if(!target.children.length) empty(target,"No documents match.");
}
async function loadCards(){
  cards=await api("cards");updateStats();
  const due=cards.filter(i=>i.due<=today()), target=$("cards");target.replaceChildren();
  metrics($("study-metrics"),[["Saved cards",cards.length],["Due now",due.length],["Reviewed",cards.filter(x=>x.reviews).length]]);
  for(const card of due){
    const a=textBlock(target,card.question,card.answer);
    for(const [label,remembered] of [["Revisit",false],["Remembered",true]]) a.append(button(label,async()=>{await api("review",{id:card.id,remembered});await loadCards();}));
  }
  if(!due.length) empty(target,"Nothing is due today.");
}
async function loadHistory(){
  const target=$("history");target.replaceChildren();
  for(const item of await api("history")) textBlock(target,item.question,item.answer);
  if(!target.children.length) empty(target,"Your completed answers will appear here.");
}
async function loadGraph(){edges=await api("graph");renderGraph();}
function renderGraph(){
  const query=$("graph-filter").value.toLowerCase();
  const items=edges.filter(x=>[x.source,x.target,x.relation].join(" ").toLowerCase().includes(query));
  graph($("graph"),items.map(x=>({from:x.source,to:x.target,kind:x.relation})),label=>{
    $("graph-filter").value=label;renderGraph();
  });
  const list=$("edge-list");list.replaceChildren();
  for(const item of items) list.append(node("p",null,node("span",item.source+" → "+item.relation+" → "+item.target+" "),
    button("Remove",async()=>{if(confirm("Remove this relationship?")){await api("delete-edge",{id:item.id});await loadGraph();}})));
}

async function loadExams(){
  const list=$("exam-list");list.replaceChildren();
  for(const item of await api("exams")) list.append(node("p",null,node("span",item.subject+" · "+item.exam_date+" "),
    button("Remove exam",async()=>{if(confirm("Remove "+item.subject+"?")){await api("delete-exam",{id:item.id});await loadExams();}})));
  if(!list.children.length)empty(list,"No exams planned.");
}
