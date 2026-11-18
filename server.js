// Carla — servidor del juego en directo (tipo Kahoot)
// Arranca con:  npm install  &&  npm start
// Variables opcionales: PORT (lo pone Render solo), ADMIN_PASSWORD (contraseña del presentador)

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const QRCode = require("qrcode");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "carla";
const QUESTION_SECONDS = 20; // tiempo para responder cada pregunta
const READY_SECONDS = 5;     // cuenta atrás "¡Prepárate!" antes de cada pregunta
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, "questions.json"), "utf8"));

// ---------- estado del juego (en memoria) ----------
const game = {
  pin: newPin(),
  phase: "lobby",      // lobby | ready | question | reveal | board | end
  qi: 0,
  phaseEndsAt: 0,
  qStartedAt: 0,
  timer: null,
  players: new Map(),  // pid -> {name, score, gain, answers:{qi:{c,ms}}, sockets:Set}
  dist: [0, 0, 0, 0],
};
function newPin() { return String(Math.floor(100000 + Math.random() * 900000)); }

const clean = s => String(s || "").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿<>]/g, "").trim().slice(0, 20);
const points = ms => Math.max(0, Math.round(1000 * (1 - Math.min(ms, QUESTION_SECONDS * 1000) / (QUESTION_SECONDS * 1000) / 2)));
const ranking = () => [...game.players.entries()].sort((a, b) => b[1].score - a[1].score);
const answeredCount = () => [...game.players.values()].filter(p => p.answers[game.qi]).length;

function setPhase(phase, seconds, after) {
  clearTimeout(game.timer);
  game.phase = phase;
  game.phaseEndsAt = seconds ? Date.now() + seconds * 1000 : 0;
  if (seconds && after) game.timer = setTimeout(after, seconds * 1000);
  broadcast();
}
function startQuestion() {
  game.dist = [0, 0, 0, 0];
  setPhase("ready", READY_SECONDS, openQuestion);
}
function openQuestion() {
  game.qStartedAt = Date.now();
  setPhase("question", QUESTION_SECONDS, reveal);
}
function reveal() {
  if (game.phase !== "question") return;
  const Q = QUESTIONS[game.qi];
  game.dist = [0, 0, 0, 0];
  for (const p of game.players.values()) {
    const a = p.answers[game.qi]; p.gain = 0;
    if (a) { game.dist[a.c]++; if (a.c === Q.c) { p.gain = points(a.ms); p.score += p.gain; } }
  }
  setPhase("reveal");
}
function next() {
  if (game.phase === "reveal") setPhase(game.qi === QUESTIONS.length - 1 ? "end" : "board");
  else if (game.phase === "board") { game.qi++; startQuestion(); }
}
function resetGame() {
  clearTimeout(game.timer);
  game.qi = 0; game.dist = [0, 0, 0, 0];
  for (const p of game.players.values()) { p.score = 0; p.gain = 0; p.answers = {}; }
  setPhase("lobby");
}
function newRoom() {
  clearTimeout(game.timer);
  for (const p of game.players.values()) for (const ws of p.sockets) send(ws, { t: "kicked" });
  game.players.clear(); game.pin = newPin(); game.qi = 0;
  setPhase("lobby");
}

// ---------- vistas que se envían a cada pantalla ----------
function common() {
  const Q = QUESTIONS[game.qi];
  const s = {
    t: "state", phase: game.phase, qi: game.qi, n: QUESTIONS.length,
    left: game.phaseEndsAt ? Math.max(0, game.phaseEndsAt - Date.now()) : 0,
    qs: QUESTION_SECONDS, answered: answeredCount(), np: game.players.size,
  };
  if (game.phase !== "lobby") s.q = { q: Q.q, a: Q.a };
  if (["reveal", "board", "end"].includes(game.phase)) { s.correct = Q.c; s.dist = game.dist; }
  return s;
}
function hostView() {
  const s = common();
  s.pin = game.pin;
  s.players = ranking().map(([, p]) => ({ name: p.name, score: p.score, gain: p.gain, online: p.sockets.size > 0, answered: !!p.answers[game.qi] }));
  return s;
}
function playerView(pid) {
  const s = common();
  const rk = ranking(), idx = rk.findIndex(([id]) => id === pid), p = game.players.get(pid);
  if (p) s.me = { name: p.name, score: p.score, gain: p.gain, rank: idx + 1, answer: p.answers[game.qi] ? p.answers[game.qi].c : null };
  if (game.phase === "end") s.top = rk.slice(0, 3).map(([, x]) => [x.name, x.score]);
  return s;
}

// ---------- servidor web ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/qr.svg") {
    const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0];
    const target = `${proto}://${req.headers.host}/?pin=${game.pin}`;
    const svg = await QRCode.toString(target, { type: "svg", margin: 1, color: { dark: "#101631", light: "#ffffff" } });
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
    return res.end(svg);
  }
  if (url.pathname === "/health") { res.writeHead(200); return res.end("ok"); }
  const file = (url.pathname === "/" || url.pathname === "/presentar") ? "index.html" : url.pathname.slice(1);
  const full = path.join(__dirname, "public", path.normalize(file).replace(/^(\.\.[\/\\])+/, ""));
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("No encontrado"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
});

// ---------- tiempo real (WebSocket) ----------
const wss = new WebSocketServer({ server });
const hosts = new Set();
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast() {
  for (const ws of hosts) send(ws, hostView());
  for (const [pid, p] of game.players) for (const ws of p.sockets) send(ws, playerView(pid));
}

wss.on("connection", ws => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (typeof m !== "object" || !m) return;

    // presentador
    if (m.t === "host") {
      if (m.password !== ADMIN_PASSWORD) return send(ws, { t: "error", code: "bad_password" });
      ws.role = "host"; hosts.add(ws); return send(ws, hostView());
    }
    if (ws.role === "host") {
      if (m.t === "start" && game.phase === "lobby" && game.players.size) return startQuestion();
      if (m.t === "close" && game.phase === "question") return reveal();
      if (m.t === "next") return next();
      if (m.t === "again") return resetGame();
      if (m.t === "newroom") return newRoom();
      if (m.t === "kick") { const e = ranking()[m.i | 0]; if (e) { for (const s of e[1].sockets) send(s, { t: "kicked" }); game.players.delete(e[0]); broadcast(); } return; }
      return;
    }

    // jugador
    if (m.t === "join") {
      if (String(m.pin) !== game.pin) return send(ws, { t: "error", code: "bad_pin" });
      const name = clean(m.name); if (!name) return send(ws, { t: "error", code: "bad_name" });
      let pid = typeof m.pid === "string" && game.players.has(m.pid) ? m.pid : null;
      if (!pid) {
        if ([...game.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) return send(ws, { t: "error", code: "name_taken" });
        if (game.players.size >= 200) return send(ws, { t: "error", code: "full" });
        pid = crypto.randomUUID();
        game.players.set(pid, { name, score: 0, gain: 0, answers: {}, sockets: new Set() });
      }
      ws.role = "player"; ws.pid = pid;
      game.players.get(pid).sockets.add(ws);
      send(ws, { t: "joined", pid, pin: game.pin });
      return broadcast();
    }
    if (m.t === "answer" && ws.role === "player") {
      const p = game.players.get(ws.pid);
      if (!p || game.phase !== "question" || m.qi !== game.qi || p.answers[game.qi]) return;
      const c = m.c | 0; if (c < 0 || c > 3) return;
      p.answers[game.qi] = { c, ms: Date.now() - game.qStartedAt };
      if (answeredCount() >= game.players.size) return reveal(); // todos han respondido
      return broadcast();
    }
  });
  ws.on("close", () => {
    hosts.delete(ws);
    if (ws.pid && game.players.has(ws.pid)) { game.players.get(ws.pid).sockets.delete(ws); broadcast(); }
  });
});
// mantiene vivas las conexiones de los móviles
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 25000);

server.listen(PORT, () => console.log(`Quiz en http://localhost:${PORT}  ·  presentador: /presentar  ·  PIN ${game.pin}`));
