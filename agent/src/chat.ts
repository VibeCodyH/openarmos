// The agent's HTTP surface: a status/chat dashboard plus a small JSON API.
// Home Assistant owns the heavy dashboard; this is just Armos's own window.

import http from "node:http";
import { config, state } from "./config.ts";
import { generate } from "./ollama.ts";
import * as store from "./store.ts";
import type { BatteryController } from "./battery.ts";

const json = (res: http.ServerResponse, code: number, body: unknown): void => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const readBody = (req: http.IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

// Never throws — a malformed body becomes an empty object, so the route's own
// validation returns a clean 400 instead of hanging the socket.
const parseJson = (raw: string): Record<string, unknown> => {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const CHAT_SYSTEM =
  "You are Armos, a local home-security assistant. Answer ONLY from the event log provided. " +
  "Be brief and concrete. If the log doesn't contain the answer, say you have no record of it.";

async function answerChat(message: string): Promise<string> {
  const events = store.recent(50);
  const log = events
    .map((e) => {
      const when = new Date(e.ts * 1000).toISOString();
      const who = e.label === "person" ? (e.face ?? "unknown person") : e.label;
      return `- ${when} | ${e.camera} | ${who} | ${e.zones.join(",") || "-"} | ${e.assessment.level}`;
    })
    .join("\n");
  const prompt = `Event log (newest first):\n${log || "(empty)"}\n\nQuestion: ${message}`;
  try {
    return await generate(prompt, CHAT_SYSTEM);
  } catch (err) {
    return `Couldn't reach the local model: ${(err as Error).message}`;
  }
}

export function startServer(battery: BatteryController | null = null): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (path === "/healthz") return json(res, 200, { ok: true });

    if (path === "/api/state") {
      return json(res, 200, {
        ...state,
        frigatePublicUrl: config.frigatePublicUrl,
        battery: battery ? { mode: true, cameras: battery.status() } : { mode: false },
      });
    }

    // Wake a battery camera for an event window. This is the vendor-neutral hook:
    // point any motion source at it (HA automation, ONVIF/PIR script, the "Wake"
    // button, a plain curl). Body: {"camera":"front_door"} — omit to wake all.
    if (path === "/trigger" && req.method === "POST") {
      if (!battery) return json(res, 200, { batteryMode: false, note: "battery mode disabled; nothing to wake" });
      const camera = parseJson(await readBody(req)).camera;
      if (typeof camera === "string" && camera) battery.wake(camera);
      else battery.wakeAll();
      console.log(`[trigger] wake ${typeof camera === "string" && camera ? camera : "all"}`);
      return json(res, 200, { cameras: battery.status(), activeSeconds: config.batteryActiveSeconds });
    }

    if (path === "/api/events") return json(res, 200, store.recent(50));

    if (path === "/mute" && req.method === "POST") {
      const muted = parseJson(await readBody(req)).muted;
      if (typeof muted !== "boolean") return json(res, 400, { error: "muted must be a boolean" });
      state.muted = muted;
      console.log(`[mute] -> ${muted}`);
      return json(res, 200, { muted: state.muted });
    }

    if (path === "/mode" && req.method === "POST") {
      const mode = parseJson(await readBody(req)).mode;
      if (mode === "home" || mode === "away" || mode === "night") {
        state.mode = mode;
        console.log(`[mode] -> ${mode}`);
        return json(res, 200, state);
      }
      return json(res, 400, { error: "mode must be home|away|night" });
    }

    if (path === "/chat" && req.method === "POST") {
      const message = parseJson(await readBody(req)).message;
      if (typeof message !== "string" || !message.trim()) {
        return json(res, 400, { error: "message required" });
      }
      return json(res, 200, { answer: await answerChat(message) });
    }

    if (path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }

    json(res, 404, { error: "not found" });
  });

  server.listen(config.port, () => console.log(`[http] Armos on :${config.port}`));
  return server;
}

// Self-contained dashboard — no external assets. Event cards link to the Frigate
// clip; thumbnails load the Frigate snapshot and quietly drop if there's no media.
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenArmos</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;font:15px/1.5 system-ui,-apple-system,sans-serif;background:#0d1117;color:#e6edf3}
header{position:sticky;top:0;z-index:2;background:rgba(13,17,23,.85);backdrop-filter:blur(8px);padding:12px 20px;border-bottom:1px solid #21262d;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
h1{font-size:17px;margin:0;letter-spacing:.3px}
.spacer{flex:1}
.chips button,.mute,select{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:7px;padding:6px 12px;cursor:pointer;font:inherit}
.chips button{margin-right:6px;text-transform:capitalize}
.chips button.on{background:#1f6feb;border-color:#388bfd}
.mute.muted{background:#5a1e1e;border-color:#b62324}
.batt{font-size:12px;padding:5px 10px;border-radius:20px;background:#21262d;border:1px solid #30363d}
.batt.on{background:#1a4d2e;border-color:#238636}
.wake{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:7px;padding:6px 12px;cursor:pointer;font:inherit;margin-left:6px}
.wake:hover{border-color:#388bfd}
main{max-width:860px;margin:0 auto;padding:20px}
.toolbar{display:flex;align-items:center;gap:12px;margin:6px 0 12px}
.toolbar h2{margin:0;font-size:15px;color:#adbac7}
.ev{display:flex;gap:12px;text-decoration:none;color:inherit;border:1px solid #21262d;border-left-width:4px;border-radius:10px;padding:10px;margin:8px 0;transition:transform .08s,border-color .08s}
.ev:hover{transform:translateY(-1px);border-color:#30363d}
.ev.info{border-left-color:#30363d}.ev.notice{border-left-color:#9e6a03}.ev.alert{border-left-color:#d15704}.ev.critical{border-left-color:#f85149}
.thumb{width:96px;height:72px;object-fit:cover;border-radius:6px;background:#161b22;flex:none}
.body{flex:1;min-width:0}
.who{font-size:14px}.sum{color:#adbac7;font-size:13px;margin:2px 0}
.meta{color:#768390;font-size:12px}
.lvl{align-self:center;font-size:11px;text-transform:uppercase;letter-spacing:.5px;padding:3px 9px;border-radius:20px;white-space:nowrap}
.lvl.info{background:#21262d}.lvl.notice{background:#9e6a03}.lvl.alert{background:#bb4400}.lvl.critical{background:#b62324}
.empty{color:#768390;padding:20px 0}
.chat{margin-top:28px}.chat h2{font-size:15px;color:#adbac7}
.chat form{display:flex;gap:8px}
.chat input{flex:1;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:7px;padding:9px}
.chat button{background:#1f6feb;color:#fff;border:0;border-radius:7px;padding:9px 16px;cursor:pointer}
#answer{margin-top:12px;white-space:pre-wrap;color:#adbac7}
</style></head><body>
<header>
<h1>🗿 OpenArmos</h1>
<span class="chips" id="modeChips"></span>
<button class="mute" id="muteBtn">…</button>
<span id="batteryBox"></span>
<span class="spacer"></span>
</header>
<main>
<div class="toolbar"><h2>Activity</h2>
<select id="filter">
<option value="0">All levels</option><option value="1">Notice +</option><option value="2">Alert +</option><option value="3">Critical only</option>
</select></div>
<div id="events"><div class="empty">loading…</div></div>
<div class="chat"><h2>Ask Armos</h2>
<form id="chatf"><input id="msg" placeholder="who came by today?" autocomplete="off"><button>Ask</button></form>
<div id="answer"></div></div>
</main>
<script>
var FRIG="",MODES=["home","away","night"],RANK={info:0,notice:1,alert:2,critical:3},EVENTS=[],LAST_SIG="";
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function setMode(m){fetch("/mode",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mode:m})}).then(loadState)}
function toggleMute(){var muted=!document.getElementById("muteBtn").classList.contains("muted");fetch("/mute",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({muted:muted})}).then(loadState)}
function loadState(){return fetch("/api/state").then(function(r){return r.json()}).then(function(s){
  FRIG=s.frigatePublicUrl||"";
  document.getElementById("modeChips").innerHTML=MODES.map(function(m){return '<button data-mode="'+m+'" class="'+(s.mode===m?"on":"")+'">'+m+'</button>'}).join("");
  document.querySelectorAll("[data-mode]").forEach(function(b){b.onclick=function(){setMode(b.dataset.mode)}});
  var mb=document.getElementById("muteBtn");mb.textContent=s.muted?"🔕 Muted":"🔔 Alerts on";mb.className="mute"+(s.muted?" muted":"");
  var bb=document.getElementById("batteryBox");
  if(s.battery&&s.battery.mode){var cams=s.battery.cameras||[];
    var awake=cams.filter(function(c){return c.state==="awake"}).map(function(c){return c.camera});
    var waking=cams.some(function(c){return c.state==="waking"});
    var label=awake.length?"👁 Awake · "+awake.map(esc).join(", "):waking?"⏳ Waking…":"💤 Asleep";
    bb.innerHTML='<span class="batt'+(awake.length?" on":"")+'">'+label+'</span>'
      +'<button class="wake" id="wakeBtn">Wake</button>';
    document.getElementById("wakeBtn").onclick=function(){fetch("/trigger",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(loadState)};
  }else bb.innerHTML=""})}
function loadEvents(){return fetch("/api/events").then(function(r){return r.json()}).then(function(es){EVENTS=es;renderEvents()})}
function renderEvents(){
  var min=+document.getElementById("filter").value;
  var list=EVENTS.filter(function(e){return RANK[e.assessment.level]>=min});
  // Only rebuild the DOM when something actually changed — otherwise the 5s
  // poll re-creates the thumbnail <img> nodes and they flicker on every reload.
  var sig=min+"#"+list.map(function(e){return e.id+":"+e.assessment.level+":"+e.summary}).join("|");
  if(sig===LAST_SIG)return;
  LAST_SIG=sig;
  var box=document.getElementById("events");
  if(!list.length){box.innerHTML='<div class="empty">no events yet</div>';return}
  box.innerHTML=list.map(function(e){
    var lvl=e.assessment.level,who=e.label==="person"?(e.face||"unknown person"):e.label;
    var clip=FRIG+"/api/events/"+encodeURIComponent(e.id)+"/clip.mp4";
    var thumb=FRIG+"/api/events/"+encodeURIComponent(e.id)+"/thumbnail.jpg";
    var when=new Date(e.ts*1000).toLocaleString();
    return '<a class="ev '+lvl+'" href="'+clip+'" target="_blank" rel="noreferrer" title="Open clip in Frigate">'
      +'<img class="thumb" src="'+thumb+'" alt="" onerror="this.remove()">'
      +'<div class="body"><div class="who"><b>'+esc(who)+'</b> · '+esc(e.camera)+' · '+esc(e.zones.join(", ")||"—")+'</div>'
      +'<div class="sum">'+esc(e.summary)+'</div><div class="meta">'+when+' · clip ↗</div></div>'
      +'<span class="lvl '+lvl+'">'+lvl+' '+e.assessment.score+'</span></a>'}).join("")}
document.getElementById("muteBtn").onclick=toggleMute;
document.getElementById("filter").onchange=renderEvents;
document.getElementById("chatf").onsubmit=function(ev){ev.preventDefault();var m=document.getElementById("msg").value.trim();if(!m)return;
  document.getElementById("answer").textContent="…";
  fetch("/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:m})}).then(function(r){return r.json()}).then(function(r){document.getElementById("answer").textContent=r.answer||r.error})};
loadState();loadEvents();setInterval(function(){loadEvents();loadState()},5000);
</script></body></html>`;
