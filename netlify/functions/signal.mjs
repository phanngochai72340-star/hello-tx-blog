// 谁拖地 · 联网对战信令函数（Netlify Functions v2 + Blobs）
// 纯 HTTPS 轮询，无需 WebSocket，零额外账号成本。
import { getStore } from "@netlify/blobs";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const ROOM_TTL = 2 * 3600 * 1000; // 房间 2 小时过期
const HB_TIMEOUT = 25000;          // 25s 无心跳视为离线
const SEATS = 4;

const ok = (d) => new Response(JSON.stringify({ ok: true, ...d }), { headers: HEADERS });
const bad = (m, s = 400) => new Response(JSON.stringify({ ok: false, error: m }), { status: s, headers: HEADERS });
const newPid = (p = "p") => p + Math.random().toString(36).slice(2, 10);
const now = () => Date.now();

async function getRoom(store, code) {
  const r = await store.get(`room-${code}`, { type: "json" });
  if (!r) return null;
  if (now() - r.created > ROOM_TTL) { await store.delete(`room-${code}`); return null; }
  return r;
}
const saveRoom = (store, room) => store.setJSON(`room-${room.code}`, room);

function pubState(room) {
  const t = now();
  const players = {};
  for (const [id, p] of Object.entries(room.players)) {
    players[id] = { ...p, online: p.ai ? true : t - p.hb < HB_TIMEOUT };
  }
  return { ...room, players };
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: HEADERS });
  const store = getStore("shuotuodi-rooms");
  const url = new URL(req.url);

  // 读取房间状态（轮询用）
  if (req.method === "GET") {
    const code = url.searchParams.get("code");
  
  // ===== DEBUG（联调后删除）=====
  if (action === "dbgwrite") {
    await store.setJSON("dbg-key", { t: now(), mark: "hello" });
    const back = await store.get("dbg-key", { type: "json" });
    return ok({ wrote: true, readBack: back });
  }

  if (action === "dbgroom") {
    const c = String(body.code || "");
    const raw = await store.get(`room-${c}`);
    let parsed = null, perr = "";
    try { parsed = raw ? JSON.parse(raw) : null; } catch(e){ perr = String(e).slice(0,80); }
    const viaJson = await store.get(`room-${c}`, { type: "json" });
    return ok({ key: `room-${c}`, rawType: typeof raw, rawLen: raw ? raw.length : -1,
      parseErr: perr, hasCreated: parsed && ("created" in parsed),
      created: parsed && parsed.created, nowMs: now(),
      ttl: 2*3600*1000, expired: parsed ? (now() - parsed.created > 2*3600*1000) : null,
      viaJsonNull: viaJson === null });
  }

  if (action === "dbgread") {
    const back = await store.get("dbg-key", { type: "json" });
    const listed = await store.list();
    return ok({ readBack: back, keys: (listed.blobs||[]).map(b=>b.key).slice(0,10) });
  }

  if (!code) return bad("missing code");
    const room = await getRoom(store, code);
    if (!room) return bad("房间不存在或已过期", 404);
    return ok({ state: pubState(room) });
  }
  if (req.method !== "POST") return bad("method not allowed", 405);

  let body = {};
  try { body = await req.json(); } catch { return bad("bad json"); }
  const { action, code, pid } = body;

  // 建房
  if (action === "create") {
    const name = String(body.name || "玩家").slice(0, 8);
    let roomCode, tries = 0;
    do {
      roomCode = String(Math.floor(1000 + Math.random() * 9000));
      tries++;
    } while (tries < 20 && await store.get(`room-${roomCode}`, { type: "json" }));
    const p = newPid();
    const room = {
      code: roomCode, host: p, created: now(),
      cfg: { mech: "none", rounds: 10 },
      phase: "lobby", round: 0,
      players: { [p]: { name, hb: now(), ai: null, managed: false, joined: 1 } },
      contrib: {}, punish: {},
    };
    await saveRoom(store, room);
    return ok({ code: roomCode, pid: p });
  }


  // ===== DEBUG（联调后删除）=====
  if (action === "dbgwrite") {
    await store.setJSON("dbg-key", { t: now(), mark: "hello" });
    const back = await store.get("dbg-key", { type: "json" });
    return ok({ wrote: true, readBack: back });
  }

  if (action === "dbgroom") {
    const c = String(body.code || "");
    const raw = await store.get(`room-${c}`);
    let parsed = null, perr = "";
    try { parsed = raw ? JSON.parse(raw) : null; } catch(e){ perr = String(e).slice(0,80); }
    const viaJson = await store.get(`room-${c}`, { type: "json" });
    return ok({ key: `room-${c}`, rawType: typeof raw, rawLen: raw ? raw.length : -1,
      parseErr: perr, hasCreated: parsed && ("created" in parsed),
      created: parsed && parsed.created, nowMs: now(),
      ttl: 2*3600*1000, expired: parsed ? (now() - parsed.created > 2*3600*1000) : null,
      viaJsonNull: viaJson === null });
  }

  if (action === "dbgread") {
    const back = await store.get("dbg-key", { type: "json" });
    const listed = await store.list();
    return ok({ readBack: back, keys: (listed.blobs||[]).map(b=>b.key).slice(0,10) });
  }

  if (!code) return bad("missing code");
  const room = await getRoom(store, code);
  if (!room) return bad("房间不存在或已过期", 404);
  const me = room.players[pid];
  const isHost = pid && pid === room.host;
  const needMe = () => { if (!me) throw new Error("not in room"); };
  const needHost = () => { if (!isHost) throw new Error("host only"); };

  try {
    switch (action) {
      case "join": {
        if (room.phase !== "lobby") throw new Error("对局已开始，无法加入");
        const humans = Object.values(room.players).filter((p) => !p.ai).length;
        if (humans >= SEATS) throw new Error("房间已满");
        let name = String(body.name || "玩家").slice(0, 8);
        const names = new Set(Object.values(room.players).map((p) => p.name));
        if (names.has(name)) name = name + Math.floor(Math.random() * 90 + 10);
        const p = newPid();
        const joined = Math.max(0, ...Object.values(room.players).map((x) => x.joined || 0)) + 1;
        room.players[p] = { name, hb: now(), ai: null, managed: false, joined };
        await saveRoom(store, room);
        return ok({ pid: p, name });
      }
      case "cfg": {
        needMe(); needHost();
        if (room.phase !== "lobby") throw new Error("对局已开始");
        if (body.mech) room.cfg.mech = body.mech;
        if (body.rounds) room.cfg.rounds = Math.min(20, Math.max(3, +body.rounds || 10));
        await saveRoom(store, room);
        return ok({});
      }
      case "addai": {
        needMe(); needHost();
        if (room.phase !== "lobby") throw new Error("对局已开始");
        if (Object.keys(room.players).length >= SEATS) throw new Error("座位已满");
        const ai = ["selfish", "cond", "rand"].includes(body.ai) ? body.ai : "cond";
        const p = newPid("ai");
        const joined = Math.max(0, ...Object.values(room.players).map((x) => x.joined || 0)) + 1;
        const aiName = { selfish: "AI·自私", cond: "AI·跟投", rand: "AI·随缘" }[ai];
        room.players[p] = { name: aiName, hb: now(), ai, managed: false, joined };
        await saveRoom(store, room);
        return ok({ aiPid: p });
      }
      case "remove": {
        needMe(); needHost();
        if (!room.players[body.target]) throw new Error("no such player");
        if (body.target === room.host) throw new Error("cannot remove host");
        delete room.players[body.target];
        await saveRoom(store, room);
        return ok({});
      }
      case "manage": {
        needMe(); needHost();
        const t = room.players[body.target];
        if (!t) throw new Error("no such player");
        t.managed = !!body.on;
        if (body.on) t.hb = now();
        await saveRoom(store, room);
        return ok({});
      }
      case "start": {
        needMe(); needHost();
        if (room.phase !== "lobby") throw new Error("already started");
        if (Object.keys(room.players).length !== SEATS) throw new Error(`需要凑满 ${SEATS} 个座位（含 AI）才能开始`);
        room.phase = "play"; room.round = 1;
        room.phaseAt = now();
        await saveRoom(store, room);
        return ok({});
      }
      case "contrib": {
        needMe();
        if (room.phase !== "play") throw new Error("not in play phase");
        const target = body.forPid || pid;
        const tp = room.players[target];
        if (!tp) throw new Error("no such player");
        // 代投：仅房主可为 AI 或被托管玩家代投
        if (target !== pid && !(isHost && (tp.ai || tp.managed))) throw new Error("forbidden");
        const r = +body.round || room.round;
        const g = Math.min(10, Math.max(0, Math.round(+body.g)));
        room.contrib[r] = room.contrib[r] || {};
        room.contrib[r][target] = g;
        tp.hb = now();
        await saveRoom(store, room);
        return ok({});
      }
      case "punish": {
        needMe();
        if (room.phase !== "punish") throw new Error("not in punish phase");
        const target = body.forPid || pid;
        const tp = room.players[target];
        if (!tp) throw new Error("no such player");
        if (target !== pid && !(isHost && (tp.ai || tp.managed))) throw new Error("forbidden");
        const r = +body.round || room.round;
        room.punish[r] = room.punish[r] || {};
        room.punish[r][target] = String(body.target || "");
        tp.hb = now();
        await saveRoom(store, room);
        return ok({});
      }
      case "advance": {
        needMe(); needHost();
        const to = body.to;
        if (!["play", "punish", "end"].includes(to)) throw new Error("bad phase");
        room.phase = to;
        if (body.round) room.round = +body.round;
        room.phaseAt = now();
        await saveRoom(store, room);
        return ok({});
      }
      case "hb": {
        needMe();
        me.hb = now();
        await saveRoom(store, room);
        return ok({});
      }
      case "leave": {
        needMe();
        delete room.players[pid];
        const rest = Object.entries(room.players).sort((a, b) => (a[1].joined || 0) - (b[1].joined || 0));
        if (rest.length === 0) { await store.delete(`room-${code}`); return ok({ closed: true }); }
        if (room.host === pid) {
          // 房主转让给最早加入的真人（无真人则最早者）
          const humans = rest.filter(([, p]) => !p.ai);
          room.host = (humans[0] || rest[0])[0];
        }
        await saveRoom(store, room);
        return ok({ host: room.host });
      }
      default:
        return bad("unknown action");
    }
  } catch (e) {
    return bad(e.message || "error");
  }
};

export const config = { path: "/api/signal" };
