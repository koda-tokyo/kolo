// Kanban view of the factory (KoLo 2.0, M15c), served at GET /factory. Self-contained: inline
// CSS and JS, no CDN, no data in the page. The page takes the token from the URL fragment
// (`/factory#token=…`, never sent to the server) or asks for it, keeps it in memory, reads the
// factory API with it and follows `factory.card` events on the WebSocket. Everything rendered
// goes through textContent; nothing from the API is parsed as HTML. Light mode, SVG icons, no
// emoji.
import { PROTOCOL_VERSION } from "../gateway/protocol/schema/protocol-schemas.js";

export const FACTORY_VIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "connect-src 'self' ws: wss:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const STYLE = `
:root{color-scheme:light;--fg:#1a1a1a;--muted:#5c5c5c;--line:#d9d9d9;--bg:#fff;--card:#f7f7f7;--accent:#c4220a;--ok:#1b6e3a;--bad:#a11a1a;--warn:#8a5a00}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);background:var(--bg)}
header{display:flex;gap:16px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line)}
header h1{font-size:17px;margin:0;font-weight:600}
header .spacer{flex:1}
header select,header input,header button,.detail button{font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:4px;background:#fff;color:var(--fg)}
header button,.detail button{cursor:pointer}
button.primary{border-color:var(--accent);background:var(--accent);color:#fff}
button:disabled{opacity:.5;cursor:default}
#status{color:var(--muted);font-size:13px}
#status.bad{color:var(--bad)}
main{display:grid;grid-template-columns:1fr 380px;min-height:calc(100vh - 57px)}
.board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(200px,1fr);gap:12px;padding:16px 20px;overflow-x:auto;align-items:start}
.col{background:var(--card);border:1px solid var(--line);border-radius:6px;min-height:200px}
.col h2{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:0;padding:10px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between}
.col h2 .n{font-weight:400}
.cards{padding:8px}
.card{background:#fff;border:1px solid var(--line);border-radius:4px;padding:8px 10px;margin-bottom:8px;cursor:pointer}
.card:hover,.card.sel{border-color:var(--accent)}
.card .t{font-weight:600;margin-bottom:2px}
.card .m{color:var(--muted);font-size:12px;display:flex;gap:8px;flex-wrap:wrap}
.card .m svg{width:12px;height:12px;vertical-align:-1px;margin-right:3px;stroke:currentColor;fill:none;stroke-width:1.8}
.detail{border-left:1px solid var(--line);padding:16px 20px;overflow:auto}
.detail h2{font-size:15px;margin:0 0 4px}
.detail .muted{color:var(--muted);font-size:13px}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:12px 0;font-size:13px}
.facts dt{color:var(--muted)}.facts dd{margin:0;word-break:break-all}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.tl{margin:0;padding:0;list-style:none}
.tl li{padding:6px 0;border-top:1px solid var(--line);font-size:13px}
.tl .h{display:flex;gap:8px;color:var(--muted);font-size:12px}
.tl .k{font-weight:600;color:var(--fg)}
.tl .k.error{color:var(--bad)}.tl .k.pr,.tl .k.merge{color:var(--ok)}
.ev{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:8px 10px;margin:8px 0;font-size:13px}
.ev a,.facts a{color:var(--accent)}
code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.badge{display:inline-block;padding:0 6px;border-radius:999px;border:1px solid var(--line);font-size:11px;color:var(--muted)}
.badge.ready{color:var(--ok);border-color:var(--ok)}.badge.failed{color:var(--bad);border-color:var(--bad)}.badge.running{color:var(--warn);border-color:var(--warn)}
#gate{padding:40px 20px;max-width:520px}
#gate input{width:100%;margin:8px 0}
@media (max-width:900px){main{grid-template-columns:1fr}.detail{border-left:0;border-top:1px solid var(--line)}}
`;

const ICONS = {
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  branch:
    '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11c0 4-12 2-12 6"/></svg>',
  job: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12h8M8 8h8M8 16h5"/></svg>',
  pr: '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10M18 17v-6a4 4 0 0 0-4-4h-3"/><path d="M13 4l-3 3 3 3"/></svg>',
};

const SCRIPT = `
(function(){
  var PROTO=__PROTO__;
  var COLUMNS=["inbox","spec","build","review","ready","merged","failed"];
  var ICONS=__ICONS__;
  var token="",boards=[],cards={},board="",selected="",ws=null,evidenceCache={};
  var $=function(id){return document.getElementById(id)};
  var el=function(tag,cls,text){var e=document.createElement(tag);if(cls){e.className=cls}if(text!==undefined){e.textContent=String(text)}return e};
  var icon=function(name){var s=el("span");s.innerHTML=ICONS[name]||"";return s.firstChild};
  var status=function(text,bad){var s=$("status");s.textContent=text;s.className=bad?"bad":""};
  function readFragment(){var m=/(?:^#|&)token=([^&]+)/.exec(location.hash||"");if(m){token=decodeURIComponent(m[1]);history.replaceState(null,"",location.pathname+location.search)}}
  function api(method,path,body){
    return fetch(path,{method:method,headers:Object.assign({authorization:"Bearer "+token},body?{"content-type":"application/json"}:{}),body:body?JSON.stringify(body):undefined})
      .then(function(r){return r.text().then(function(t){var j={};try{j=JSON.parse(t)}catch(e){}return {status:r.status,ok:r.ok,body:j}})});
  }
  function load(){
    return api("GET","/api/factory/boards").then(function(r){
      if(r.status===401){throw new Error("unauthorized: the token was not accepted")}
      if(r.status===403){throw new Error("forbidden: the credential needs the attach scope")}
      if(!r.ok){throw new Error("boards: HTTP "+r.status)}
      boards=r.body.boards||[];
      if(!board&&boards.length){board=boards[0].id}
      return api("GET","/api/factory/cards?limit=1000"+(board?"&board="+encodeURIComponent(board):""));
    }).then(function(r){
      if(!r.ok){throw new Error("cards: HTTP "+r.status)}
      cards={};(r.body.cards||[]).forEach(function(c){cards[c.id]=c});
      render();
    });
  }
  function renderBoards(){
    var sel=$("board");sel.textContent="";
    boards.forEach(function(b){var o=el("option","",b.name+" ("+b.id+")");o.value=b.id;if(b.id===board){o.selected=true}sel.appendChild(o)});
    if(!boards.length){var o=el("option","","no boards yet");sel.appendChild(o)}
  }
  function render(){
    renderBoards();
    var root=$("board-root");root.textContent="";
    COLUMNS.forEach(function(col){
      var box=el("section","col");var list=Object.keys(cards).map(function(k){return cards[k]}).filter(function(c){return c.column===col&&(!board||c.boardId===board)});
      list.sort(function(a,b){return a.updatedAt<b.updatedAt?1:-1});
      var h=el("h2");h.appendChild(el("span","",col));h.appendChild(el("span","n",String(list.length)));box.appendChild(h);
      var wrap=el("div","cards");
      list.forEach(function(c){
        var card=el("div","card"+(c.id===selected?" sel":""));card.appendChild(el("div","t",c.title||c.goal.slice(0,80)));
        var m=el("div","m");
        var o=el("span");o.appendChild(icon("user"));o.appendChild(document.createTextNode(c.owner));m.appendChild(o);
        if(c.runningJobId){var r=el("span","badge running","running");m.appendChild(r)}
        if(c.pr){var p=el("span");p.appendChild(icon("pr"));p.appendChild(document.createTextNode("PR"+(c.pr.number?" #"+c.pr.number:"")));m.appendChild(p)}
        else if(c.branch){var b=el("span");b.appendChild(icon("branch"));b.appendChild(document.createTextNode(c.branch));m.appendChild(b)}
        if(c.jobIds&&c.jobIds.length){var j=el("span");j.appendChild(icon("job"));j.appendChild(document.createTextNode(c.jobIds.length+(c.jobIds.length===1?" job":" jobs")));m.appendChild(j)}
        card.appendChild(m);
        card.addEventListener("click",function(){select(c.id)});
        wrap.appendChild(card);
      });
      box.appendChild(wrap);root.appendChild(box);
    });
    if(selected){renderDetail()}
  }
  function select(id){selected=id;render();api("GET","/api/factory/cards/"+encodeURIComponent(id)).then(function(r){if(r.ok){cards[id]=Object.assign({},cards[id],r.body.card,{running:r.body.running});renderDetail()}})}
  function fact(dl,k,v,node){dl.appendChild(el("dt","",k));var dd=el("dd");if(node){dd.appendChild(node)}else{dd.textContent=v}dl.appendChild(dd)}
  function openEvidence(jobId){
    status("loading evidence for job "+jobId);
    fetch("/evidence/"+encodeURIComponent(jobId),{headers:{authorization:"Bearer "+token}}).then(function(r){
      if(!r.ok){throw new Error("evidence: HTTP "+r.status)}
      return r.blob();
    }).then(function(b){var u=URL.createObjectURL(b);window.open(u,"_blank");status("evidence opened in a new tab")}).catch(function(e){status(String(e.message||e),true)});
  }
  function evidenceSummary(jobId,box){
    if(evidenceCache[jobId]){return fill(evidenceCache[jobId])}
    api("GET","/api/jobs/"+encodeURIComponent(jobId)+"/evidence").then(function(r){if(r.ok){evidenceCache[jobId]=r.body.summary;fill(r.body.summary)}else{box.appendChild(el("div","muted","no evidence recorded"))}});
    function fill(s){
      box.textContent="";
      var line=el("div");line.appendChild(el("strong","","job "+jobId.slice(0,8)+" "));var st=el("span","badge "+(s.status==="succeeded"?"ready":s.status==="failed"?"failed":""),s.status);line.appendChild(st);box.appendChild(line);
      box.appendChild(el("div","muted",s.events+" events, "+s.toolCalls+" tool calls ("+s.toolErrors+" failed), "+(s.signed?"signed":"unsigned")));
      var a=el("a","","open evidence");a.href="#";a.addEventListener("click",function(ev){ev.preventDefault();openEvidence(jobId)});box.appendChild(a);
      box.appendChild(document.createTextNode("  "));var c=el("code","","/evidence/"+jobId);box.appendChild(c);
    }
  }
  function action(method,path,body){
    return api(method,path,body).then(function(r){
      if(r.status===403){throw new Error("forbidden: moving, running and cancelling need an admin or owner credential")}
      if(!r.ok){throw new Error((r.body&&r.body.error)||("HTTP "+r.status))}
      status("ok");return r.body;
    }).catch(function(e){status(String(e.message||e),true)});
  }
  function renderDetail(){
    var c=cards[selected];var d=$("detail");d.textContent="";
    if(!c){d.appendChild(el("p","muted","Select a card."));return}
    d.appendChild(el("h2","",c.title));
    d.appendChild(el("p","muted",c.goal));
    var dl=el("dl","facts");
    fact(dl,"Column",c.column);fact(dl,"Owner",c.owner);fact(dl,"Repository",c.repo);fact(dl,"Board",c.boardId);
    if(c.engineTaskId){fact(dl,"Engine task",c.engineTaskId)}
    if(c.branch){fact(dl,"Branch",c.branch)}
    if(c.pr){var a=el("a","",c.pr.url);a.href=c.pr.url;a.target="_blank";a.rel="noopener noreferrer";fact(dl,"Pull request","",a)}
    fact(dl,"Policy",c.policy&&c.policy.autoMerge?"auto-merge (needs the merge permission)":"stop at ready");
    if(c.error){var e=el("span","",c.error);e.style.color="var(--bad)";fact(dl,"Error","",e)}
    if(c.summary){fact(dl,"Summary",c.summary)}
    fact(dl,"Updated",c.updatedAt);
    d.appendChild(dl);
    var acts=el("div","actions");
    var run=el("button","primary",c.column==="failed"?"Retry run":"Run");run.disabled=!!c.runningJobId||(c.column!=="inbox"&&c.column!=="failed");
    run.addEventListener("click",function(){action("POST","/api/factory/cards/"+encodeURIComponent(c.id)+"/run",{}).then(function(){select(c.id)})});acts.appendChild(run);
    var cancel=el("button","","Cancel run");cancel.disabled=!c.runningJobId;
    cancel.addEventListener("click",function(){action("POST","/api/factory/cards/"+encodeURIComponent(c.id)+"/cancel")});acts.appendChild(cancel);
    var sel=el("select");var opt0=el("option","","move to…");opt0.value="";sel.appendChild(opt0);
    COLUMNS.forEach(function(col){if(col!==c.column){var o=el("option","",col);o.value=col;sel.appendChild(o)}});
    sel.addEventListener("change",function(){if(sel.value){action("POST","/api/factory/cards/"+encodeURIComponent(c.id)+"/move",{to:sel.value}).then(function(){select(c.id)})}});acts.appendChild(sel);
    d.appendChild(acts);
    (c.jobIds||[]).slice().reverse().forEach(function(jobId){var box=el("div","ev");box.appendChild(el("div","muted","job "+jobId));d.appendChild(box);evidenceSummary(jobId,box)});
    d.appendChild(el("h2","","Timeline"));
    var ul=el("ul","tl");(c.timeline||[]).slice().reverse().forEach(function(t){
      var li=el("li");var h=el("div","h");h.appendChild(el("span","k "+t.kind,t.kind));h.appendChild(el("span","",t.by));h.appendChild(el("span","",t.ts));li.appendChild(h);li.appendChild(el("div","",t.text));ul.appendChild(li);
    });d.appendChild(ul);
  }
  function connect(){
    try{
      var proto=location.protocol==="https:"?"wss://":"ws://";ws=new WebSocket(proto+location.host);
    }catch(e){status("live updates unavailable ("+e+")",true);return}
    ws.addEventListener("open",function(){ws.send(JSON.stringify({type:"req",id:"factory-connect",method:"connect",params:{minProtocol:PROTO,maxProtocol:PROTO,client:{id:"kolo-factory-view",version:"factory",platform:"web",mode:"probe"},role:"operator",scopes:["operator.read"],auth:{token:token}}}))});
    ws.addEventListener("message",function(ev){
      var f;try{f=JSON.parse(ev.data)}catch(e){return}
      if(f.type==="res"&&f.id==="factory-connect"){status(f.ok?"live":"live updates refused: "+((f.error&&f.error.message)||"unauthorized"),!f.ok);return}
      if(f.type==="event"&&f.event==="factory.card"&&f.payload&&f.payload.card){
        var c=f.payload.card;if(cards[c.id]){cards[c.id]=Object.assign({},cards[c.id],c,{timeline:undefined})}else{cards[c.id]=c}
        if(f.payload.kind==="board.created"){load();return}
        render();if(selected===c.id){select(c.id)}
      }
    });
    ws.addEventListener("close",function(){status("live updates closed; refresh to reconnect",true)});
  }
  function start(){
    $("gate").hidden=true;$("app").hidden=false;
    load().then(function(){status("loaded");connect()}).catch(function(e){status(String(e.message||e),true);$("gate").hidden=false;$("app").hidden=true});
  }
  $("gate-form").addEventListener("submit",function(e){e.preventDefault();token=$("gate-token").value.trim();$("gate-token").value="";if(token){start()}});
  $("board").addEventListener("change",function(){board=$("board").value;selected="";load()});
  $("reload").addEventListener("click",function(){load().then(function(){status("reloaded")})});
  readFragment();
  if(token){start()}
})();
`;

export function renderFactoryHtml(): string {
  const script = SCRIPT.replace("__PROTO__", String(PROTOCOL_VERSION)).replace(
    "__ICONS__",
    JSON.stringify(ICONS),
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Factory</title><style>${STYLE}</style></head>
<body>
<div id="gate">
<h1>Factory</h1>
<p class="muted">Enter the gateway token or a pairing access token (attach scope to read; admin to move, run or cancel). The token stays in this tab's memory. You can also open <code>/factory#token=…</code>.</p>
<form id="gate-form"><input id="gate-token" type="password" autocomplete="off" placeholder="Token" aria-label="Token"><button type="submit" class="primary">Open board</button></form>
</div>
<div id="app" hidden>
<header><h1>Factory</h1><select id="board" aria-label="Board"></select><button id="reload" type="button">Reload</button><span class="spacer"></span><span id="status"></span></header>
<main><div class="board" id="board-root"></div><aside class="detail" id="detail"><p class="muted">Select a card.</p></aside></main>
</div>
<script>${script}</script>
</body></html>
`;
}
