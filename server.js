const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

/**
 * ============================================================
 *  DECK (10 tờ dò) — 5 cặp màu, mỗi cặp 2 tờ (A/B)
 *  Title đổi theo yêu cầu:
 *    - "TÂN TÂN"   -> "RỰC RỠ"
 *    - "MIỀN TÂY"  -> "THÀNH CÔNG"
 *    - "HÊN XUI"   -> "HUY HOÀNG"
 * ============================================================
 */

// Helper: lấy cột theo hệ số (1-9, 10-19, ..., 80-90)
function decadeCol(n) {
  if (n === 90) return 8;
  return Math.floor(n / 10);
}

// Generate 15 numbers theo rule: tổng 15 số/ block 3x9, mỗi row max 5 số
// (để cho ra đúng kiểu lô tô truyền thống có ô trống)
function generateBlock15(seedNumbers) {
  // seedNumbers: nếu có thì dùng lại; nếu không tự sinh
  if (seedNumbers && Array.isArray(seedNumbers) && seedNumbers.length === 15) {
    return seedNumbers.slice().sort((a, b) => a - b);
  }

  // Mỗi block chọn 15 số ngẫu nhiên từ 1..90 (không trùng trong block)
  const set = new Set();
  while (set.size < 15) {
    set.add(1 + Math.floor(Math.random() * 90));
  }
  return Array.from(set).sort((a, b) => a - b);
}

// Build a full card: 3 blocks * 15 numbers = 45 numbers total (non-duplicate)
function generateCardNumbers45() {
  const used = new Set();
  const blocks = [];

  for (let b = 0; b < 3; b++) {
    const blockSet = new Set();
    while (blockSet.size < 15) {
      const n = 1 + Math.floor(Math.random() * 90);
      if (used.has(n)) continue;
      used.add(n);
      blockSet.add(n);
    }
    blocks.push(Array.from(blockSet).sort((a, b) => a - b));
  }
  return blocks;
}

// Make complementary card for pair B: dùng các số "đối" theo cột để tạo cảm giác tương phản
// (Không bắt buộc 100% đối từng số, nhưng đảm bảo khác biệt rõ)
function makeComplementBlocks(blocksA) {
  const used = new Set();
  const blocksB = [];

  // map n -> "đối" trong cùng decade, kiểu 1<->9, 2<->8...; 10<->19...
  function mirrorInDecade(n) {
    if (n === 90) return 80; // 90 đối 80 (tuỳ ý)
    const d = decadeCol(n); // 0..8
    const start = d * 10;
    const end = d === 8 ? 90 : d * 10 + 9;
    // nếu decade 0 (1-9): start=0, end=9 (nhưng ta không dùng 0)
    // điều chỉnh cho decade 0: range 1..9
    const s = d === 0 ? 1 : start;
    const e = d === 8 ? 90 : end;
    return s + (e - n);
  }

  for (let b = 0; b < 3; b++) {
    const arr = blocksA[b].slice().sort((a, b) => a - b);
    const cand = [];

    for (const n of arr) {
      let m = mirrorInDecade(n);
      // tránh trùng trong toàn card B
      let guard = 0;
      while (used.has(m) && guard < 40) {
        // thử lân cận cùng decade
        m = m === 90 ? 89 : m + 1;
        if (m > 90) m = 1;
        guard++;
      }
      cand.push(m);
      used.add(m);
    }

    // nếu vì tránh trùng mà thiếu/dup, fix nhẹ
    const setBlock = new Set(cand);
    while (setBlock.size < 15) {
      const x = 1 + Math.floor(Math.random() * 90);
      if (used.has(x)) continue;
      used.add(x);
      setBlock.add(x);
    }
    blocksB.push(Array.from(setBlock).sort((a, b) => a - b));
  }

  return blocksB;
}

// 5 cặp màu: red, blue, green, purple, orange
// Tên cặp:
const PAIRS = [
  { key: "red", colorLabel: "Đỏ", title: "RỰC RỠ" },         // formerly TÂN TÂN
  { key: "blue", colorLabel: "Xanh dương", title: "THÀNH CÔNG" }, // formerly MIỀN TÂY
  { key: "green", colorLabel: "Xanh lá", title: "THÀNH CÔNG" },   // (bạn muốn 5 cặp 5 màu, title có thể trùng)
  { key: "purple", colorLabel: "Tím", title: "HUY HOÀNG" },   // formerly HÊN XUI
  { key: "orange", colorLabel: "Cam", title: "HUY HOÀNG" },   // (title có thể trùng)
];

function createDeck10() {
  const out = [];
  for (const p of PAIRS) {
    const blocksA = generateCardNumbers45();
    const blocksB = makeComplementBlocks(blocksA);

    out.push({
      id: `${p.key}-A`,
      title: p.title,
      color: p.key,
      colorLabel: p.colorLabel,
      variant: "A",
      blocks: blocksA,
    });

    out.push({
      id: `${p.key}-B`,
      title: p.title,
      color: p.key,
      colorLabel: p.colorLabel,
      variant: "B",
      blocks: blocksB,
    });
  }
  return out;
}

const deck = createDeck10();

/**
 * ============================================================
 *  ROOMS / GAME STATE
 * ============================================================
 */

const rooms = new Map();

function makeRoomId() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    maxPlayers: room.maxPlayers,
    hostId: room.hostId,
    status: room.status, // waiting|playing|ended
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.id === room.hostId,
      cardId: p.cardId || null,
      score: p.score || 0,
      eliminated: !!p.eliminated,
    })),
    usedCardIds: room.usedCardIds.slice(),
    calledNumbers: room.calledNumbers.slice(),
    currentNumber: room.currentNumber,
  };
}

function roomsListPublic() {
  const arr = [];
  for (const room of rooms.values()) {
    arr.push({
      id: room.id,
      name: room.name,
      maxPlayers: room.maxPlayers,
      playerCount: room.players.length,
      status:
        room.status === "waiting"
          ? "Đang chờ"
          : room.status === "playing"
          ? "Đang chơi"
          : "Kết thúc",
    });
  }
  arr.sort((a, b) => a.name.localeCompare(b.name));
  return arr;
}

function broadcastRooms() {
  io.emit("rooms:list", roomsListPublic());
}

function emitToast(sock, type, message) {
  sock.emit("toast", { type, message });
}

function addChat(room, from, text) {
  const msg = { from, text, at: Date.now() };
  io.to(room.id).emit("chat:msg", msg);
}

function allPlayersSelected(room) {
  return room.players.length >= 2 && room.players.every((p) => !!p.cardId);
}

function startCalling(room) {
  stopCalling(room);
  room.status = "playing";
  room.calledNumbers = [];
  room.currentNumber = null;

  // numbers 1..90 shuffled
  room.remainingNumbers = Array.from({ length: 90 }, (_, i) => i + 1);
  for (let i = room.remainingNumbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [room.remainingNumbers[i], room.remainingNumbers[j]] = [room.remainingNumbers[j], room.remainingNumbers[i]];
  }

  room.timer = setInterval(() => {
    if (room.status !== "playing") return;
    if (!room.remainingNumbers.length) {
      room.status = "ended";
      stopCalling(room);
      io.to(room.id).emit("game:update", publicRoom(room));
      io.to(room.id).emit("round:ended", { room: publicRoom(room), reason: { winnerName: null } });
      return;
    }
    const n = room.remainingNumbers.shift();
    room.currentNumber = n;
    room.calledNumbers.push(n);
    io.to(room.id).emit("game:update", publicRoom(room));
  }, 10000);
}

function stopCalling(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
}

function validateClaim(room, player) {
  // Player must have a card
  const card = deck.find((c) => c.id === player.cardId);
  if (!card) return false;

  // Win condition: "KINH" -> all numbers on card must be called
  const allNums = card.blocks.flat();
  const called = new Set(room.calledNumbers);
  return allNums.every((n) => called.has(n));
}

/**
 * ============================================================
 *  SOCKET.IO
 * ============================================================
 */

io.on("connection", (socket) => {
  // send deck & rooms
  socket.emit("deck:list", deck);
  socket.emit("rooms:list", roomsListPublic());

  socket.on("room:create", ({ playerName, roomName, maxPlayers }) => {
    const name = String(playerName || "").trim();
    if (!name) return emitToast(socket, "error", "Bạn cần nhập tên.");

    const room = {
      id: makeRoomId(),
      name: String(roomName || "").trim() || "Phòng mới",
      maxPlayers: Math.max(2, Math.min(10, Number(maxPlayers || 2))),
      hostId: socket.id,
      status: "waiting",
      players: [],
      usedCardIds: [],
      calledNumbers: [],
      currentNumber: null,
      remainingNumbers: [],
      timer: null,
    };

    room.players.push({ id: socket.id, name, score: 0, cardId: null, eliminated: false });
    rooms.set(room.id, room);

    socket.join(room.id);
    socket.emit("room:joined", { room: publicRoom(room), selfId: socket.id });
    broadcastRooms();
  });

  socket.on("room:join", ({ playerName, roomId }) => {
    const name = String(playerName || "").trim();
    const rid = String(roomId || "").trim().toUpperCase();

    const room = rooms.get(rid);
    if (!room) return emitToast(socket, "error", "Không tìm thấy phòng.");
    if (room.status !== "waiting") return emitToast(socket, "error", "Phòng đang chơi, không thể vào.");
    if (room.players.length >= room.maxPlayers) return emitToast(socket, "error", "Phòng đã đủ người.");

    room.players.push({ id: socket.id, name, score: 0, cardId: null, eliminated: false });
    socket.join(room.id);
    socket.emit("room:joined", { room: publicRoom(room), selfId: socket.id });
    io.to(room.id).emit("lobby:update", publicRoom(room));
    broadcastRooms();
  });

  socket.on("room:leave", ({ roomId }) => {
    const rid = String(roomId || "").trim().toUpperCase();
    const room = rooms.get(rid);
    if (!room) return;

    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx !== -1) {
      const leaving = room.players[idx];

      // free card
      if (leaving.cardId) {
        room.usedCardIds = room.usedCardIds.filter((x) => x !== leaving.cardId);
      }

      room.players.splice(idx, 1);
    }

    socket.leave(room.id);

    // if host leaves -> assign new host
    if (room.hostId === socket.id) {
      if (room.players.length) {
        room.hostId = room.players[0].id;
      } else {
        stopCalling(room);
        rooms.delete(room.id);
        broadcastRooms();
        return;
      }
    }

    // if playing and everyone left etc.
    if (!room.players.length) {
      stopCalling(room);
      rooms.delete(room.id);
      broadcastRooms();
      return;
    }

    io.to(room.id).emit(room.status === "playing" ? "game:update" : "lobby:update", publicRoom(room));
    broadcastRooms();
  });

  socket.on("disconnect", () => {
    // remove from any room
    for (const room of rooms.values()) {
      const idx = room.players.findIndex((p) => p.id === socket.id);
      if (idx === -1) continue;

      const leaving = room.players[idx];
      if (leaving.cardId) {
        room.usedCardIds = room.usedCardIds.filter((x) => x !== leaving.cardId);
      }
      room.players.splice(idx, 1);

      if (room.hostId === socket.id) {
        if (room.players.length) room.hostId = room.players[0].id;
        else {
          stopCalling(room);
          rooms.delete(room.id);
          break;
        }
      }

      io.to(room.id).emit(room.status === "playing" ? "game:update" : "lobby:update", publicRoom(room));
      break;
    }

    broadcastRooms();
  });

  socket.on("card:select", ({ roomId, cardId }) => {
    const rid = String(roomId || "").trim().toUpperCase();
    const cid = String(cardId || "").trim();
    const room = rooms.get(rid);
    if (!room) return;
    if (room.status !== "waiting") return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    if (player.eliminated) return;

    // if used by others
    const alreadyUsed = room.usedCardIds.includes(cid);
    const selectingSame = player.cardId === cid;
    if (alreadyUsed && !selectingSame) return emitToast(socket, "error", "Tờ dò đã có người chọn.");

    // free old
    if (player.cardId && player.cardId !== cid) {
      room.usedCardIds = room.usedCardIds.filter((x) => x !== player.cardId);
    }

    // set new
    player.cardId = cid;
    if (!room.usedCardIds.includes(cid)) room.usedCardIds.push(cid);

    io.to(room.id).emit("lobby:update", publicRoom(room));
  });

  socket.on("lobby:kick", ({ roomId, targetId }) => {
    const rid = String(roomId || "").trim().toUpperCase();
    const tid = String(targetId || "").trim();
    const room = rooms.get(rid);
    if (!room) return;
    if (room.status !== "waiting") return;
    if (room.hostId !== socket.id) return;

    const idx = room.players.findIndex((p) => p.id === tid);
    if (idx === -1) return;
    const target = room.players[idx];
    if (target.id === room.hostId) return;

    // only kick who hasn't selected (as requirement)
    if (target.cardId) return;

    room.players.splice(idx, 1);

    io.to(tid).emit("kicked", { message: "Bạn bị chủ phòng kick vì chưa chọn tờ dò." });
    io.sockets.sockets.get(tid)?.leave(room.id);

    io.to(room.id).emit("lobby:update", publicRoom(room));
    broadcastRooms();
  });

  socket.on("game:start", ({ roomId }) => {
    const rid = String(roomId || "").trim().toUpperCase();
    const room = rooms.get(rid);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.status !== "waiting") return;
    if (!allPlayersSelected(room)) return emitToast(socket, "error", "Tất cả người chơi phải chọn tờ dò trước.");

    // reset eliminated flags (new round)
    room.players.forEach((p) => (p.eliminated = false));
    startCalling(room);
    io.to(room.id).emit("game:update", publicRoom(room));
    broadcastRooms();
  });

  socket.on("game:reset", ({ roomId }) => {
    const rid = String(roomId || "").trim().toUpperCase();
    const room = rooms.get(rid);
    if (!room) return;
    if (room.hostId !== socket.id) return;

    stopCalling(room);
    room.status = "waiting";
    room.calledNumbers = [];
    room.currentNumber = null;
    room.remainingNumbers = [];
    room.players.forEach((p) => (p.eliminated = false));

    io.to(room.id).emit("lobby:update", publicRoom(room));
    broadcastRooms();
  });

  socket.on("game:claim", ({ roomId }) => {
    const rid = String(roomId || "").trim().toUpperCase();
    const room = rooms.get(rid);
    if (!room) return;
    if (room.status !== "playing") return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    if (player.eliminated) return;

    const ok = validateClaim(room, player);

    if (ok) {
      player.score = (player.score || 0) + 1;
      room.status = "ended";
      stopCalling(room);

      io.to(room.id).emit("game:update", publicRoom(room));
      io.to(room.id).emit("round:ended", { room: publicRoom(room), reason: { winnerName: player.name } });
      broadcastRooms();
      return;
    }

    // wrong claim -> eliminate
    player.eliminated = true;
    emitToast(socket, "error", "Báo KINH sai! Bạn bị loại (chỉ xem + chat).");
    io.to(room.id).emit("game:update", publicRoom(room));
  });

  socket.on("chat:send", ({ roomId, text }) => {
    const rid = String(roomId || "").trim().toUpperCase();
    const room = rooms.get(rid);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const t = String(text || "").trim();
    if (!t) return;
    addChat(room, player.name, t);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Lô-tô Miền Tây running at http://localhost:${PORT}`);
});
