// Minimal viewer for GET /doc (KoLo 2.0, M4a). Self-contained: inline CSS + JS, no CDN, no
// data in the page. It asks for the gateway token, fetches /doc with it and renders operations
// with textContent only (plugin-supplied strings are never parsed as HTML). The token is kept in
// memory for the life of the tab and never stored.
export const DOC_VIEWER_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const DOC_VIEWER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KoLo Gateway API</title>
<style>
:root{--bg:#fff;--fg:#1b1d21;--muted:#5d636e;--line:#e3e5e9;--chip:#f3f4f6;--accent:#c4220a;
--get:#1d6b3a;--post:#1f4f99;--other:#6b4a1d;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#131417;--fg:#e8e9eb;--muted:#9aa0aa;--line:#2a2d33;
--chip:#1d1f24;--accent:#ff5a3c;--get:#5fc787;--post:#7aa7f0;--other:#d9a35b}}
body{margin:0;background:var(--bg);color:var(--fg);line-height:1.45}
main{max-width:960px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.4rem;margin:0 0 4px}h2{font-size:1.05rem;margin:28px 0 8px;text-transform:capitalize}
p.meta{color:var(--muted);margin:0 0 16px;font-size:.9rem}
form{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
input{flex:1 1 260px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
button{padding:8px 14px;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:6px;font:inherit;cursor:pointer}
details{border:1px solid var(--line);border-radius:8px;margin:6px 0;background:var(--bg)}
summary{display:flex;gap:10px;align-items:baseline;padding:8px 12px;cursor:pointer;flex-wrap:wrap}
.m{font:600 .78rem ui-monospace,monospace;min-width:52px;color:var(--other)}
.m.get{color:var(--get)}.m.post{color:var(--post)}
.p{font:.9rem ui-monospace,monospace;word-break:break-all}.s{color:var(--muted);font-size:.9rem}
.chip{font-size:.75rem;padding:1px 8px;border-radius:999px;background:var(--chip);color:var(--muted)}
pre{margin:0;padding:12px;overflow:auto;border-top:1px solid var(--line);font-size:.8rem;max-height:420px}
#status{color:var(--muted);font-size:.9rem}
</style>
</head>
<body>
<main>
<h1>KoLo Gateway API</h1>
<p class="meta">OpenAPI 3.1, generated from the gateway route registry. Raw JSON: <code>GET /doc</code> with the gateway token.</p>
<form id="f"><input id="t" type="password" autocomplete="off" placeholder="Gateway token" aria-label="Gateway token"><button type="submit">Load</button></form>
<p id="status">Enter the gateway token to load the document.</p>
<div id="out"></div>
</main>
<script>
(function(){
  var out=document.getElementById("out"),status=document.getElementById("status");
  function el(tag,cls,text){var e=document.createElement(tag);if(cls){e.className=cls}if(text!==undefined){e.textContent=String(text)}return e}
  function render(doc){
    out.textContent="";
    var info=doc.info||{};
    status.textContent=(info.title||"API")+" "+(info.version||"")+" \\u00b7 openapi "+doc.openapi;
    var groups={};
    Object.keys(doc.paths||{}).forEach(function(path){
      var item=doc.paths[path];
      Object.keys(item).forEach(function(method){
        var op=item[method],tag=(op.tags&&op.tags[0])||"other";
        (groups[tag]=groups[tag]||[]).push({path:path,method:method,op:op});
      });
    });
    Object.keys(groups).sort().forEach(function(tag){
      out.appendChild(el("h2","",tag));
      groups[tag].forEach(function(entry){
        var d=el("details"),s=el("summary");
        s.appendChild(el("span","m "+entry.method,entry.method.toUpperCase()));
        s.appendChild(el("span","p",entry.path));
        s.appendChild(el("span","s",entry.op.summary||""));
        var scope=entry.op["x-kolo-scope"];
        s.appendChild(el("span","chip",Array.isArray(scope)?scope.join(" | "):scope));
        d.appendChild(s);
        d.appendChild(el("pre","",JSON.stringify(entry.op,null,2)));
        out.appendChild(d);
      });
    });
    var extra=[["Undocumented routes",doc["x-kolo-undocumented-routes"]],["WebSocket protocol",doc["x-kolo-websocket"]]];
    extra.forEach(function(pair){
      if(!pair[1]){return}
      out.appendChild(el("h2","",pair[0]));
      var d=el("details");d.appendChild(el("summary","s",pair[0]));
      d.appendChild(el("pre","",JSON.stringify(pair[1],null,2)));out.appendChild(d);
    });
  }
  document.getElementById("f").addEventListener("submit",function(ev){
    ev.preventDefault();
    var token=document.getElementById("t").value.trim();
    status.textContent="Loading\\u2026";
    fetch("../doc",{headers:token?{Authorization:"Bearer "+token}:{},cache:"no-store"})
      .then(function(r){if(!r.ok){throw new Error("HTTP "+r.status)}return r.json()})
      .then(render)
      .catch(function(err){out.textContent="";status.textContent="Could not load /doc: "+err.message});
  });
})();
</script>
</body>
</html>
`;
