const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// ====== GAME CONFIG ======
const MIN_NUM = 1;
const MAX_NUM = 90;
const CALL_INTERVAL_MS = 10_000; // 10s
const MAX_CARDS = 10;

// ====== In-memory store ======
/**
 * rooms[roomId] = {
 *   id, name, maxPlayers,
 *   hostId,
 *   status: "waiting" | "playing" | "ended",
 *   createdAt,
 *   players: Map(socketId => { id, name, cardId, eliminated, score }),
 *   usedCardIds: Set,
 *   calledNumbers: number[],
 *   remainingNumbers: Set<number>,
 *   currentNumber: number|null,
 *   timer: NodeJS.Timeout|null,
 * }
 */
const rooms = new Map();

// ====== Utility ======
function uid(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function now() {
  return Date.now();
}

function getRoomPublic(room) {
  const playersArr = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    cardId: p.cardId,
    eliminated: p.eliminated,
    score: p.score,
    isHost: p.id === room.hostId,
  }));

  return {
    id: room.id,
    name: room.name,
    maxPlayers: room.maxPlayers,
    hostId: room.hostId,
    status: room.status,
    createdAt: room.createdAt,
    players: playersArr,
    usedCardIds: Array.from(room.usedCardIds),
    calledNumbers: room.calledNumbers,
    currentNumber: room.currentNumber,
  };
}

function broadcastRoomsList() {
  const list = Array.from(rooms.values()).map((r) => ({
    id: r.id,
    name: r.name,
    maxPlayers: r.maxPlayers,
    playerCount: r.players.size,
    status: r.status === "waiting" ? "Đang chờ" : r.status === "playing" ? "Đang chơi" : "Kết thúc",
  }));
  io.emit("rooms:list", list);
}

function makeNumbersSet(min = MIN_NUM, max = MAX_NUM) {
  const s = new Set();
  for (let i = min; i <= max; i++) s.add(i);
  return s;
}

function pickRandomFromSet(set) {
  const idx = Math.floor(Math.random() * set.size);
  let i = 0;
  for (const val of set) {
    if (i === idx) return val;
    i++;
  }
  return null;
}

// ====== Card Deck (10 cards, 5 colors, each color has 2 complementary cards) ======
// Each card is 15 numbers (3x5). Complement mapping: n -> 91 - n
function buildDeck() {
  // Pre-chosen bases (15 unique each). You can edit if you want different layouts.
  const bases = [
    [1, 7, 12, 18, 25, 31, 36, 42, 49, 53, 58, 64, 71, 77, 85],
    [3, 9, 14, 20, 27, 33, 39, 45, 50, 56, 60, 66, 72, 79, 88],
    [2, 8, 15, 22, 28, 34, 40, 46, 52, 57, 62, 68, 73, 81, 90],
    [4, 10, 16, 23, 29, 35, 41, 47, 54, 59, 63, 69, 74, 82, 86],
    [5, 11, 17, 24, 30, 32, 38, 44, 51, 55, 61, 67, 70, 76, 84],
  ];
  const colors = [
    { key: "red", label: "Đỏ" },
    { key: "blue", label: "Xanh dương" },
    { key: "green", label: "Xanh lá" },
    { key: "purple", label: "Tím" },
    { key: "orange", label: "Cam" },
  ];

  const deck = [];
  for (let i = 0; i < 5; i++) {
    const base = bases[i].slice().sort((a, b) => a - b);
    const comp = base.map((n) => 91 - n).sort((a, b) => a - b);

    deck.push({
      id: `${colors[i].key}-A`,
      color: colors[i].key,
      colorLabel: colors[i].label,
      variant: "A",
      numbers: base,
    });
    deck.push({
      id: `${colors[i].key}-B`,
      color: colors[i].key,
      colorLabel: colors[i].label,
      variant: "B",
      numbers: comp,
    });
  }
  return deck;
}

const DECK = buildDeck();

function getCardById(cardId) {
  return DECK.find((c) => c.id === cardId) || null;
}

// Win condition: all numbers on your card must have been called (system only checks when you claim)
function checkWin(cardId, calledNumbers) {
  const card = getCardById(cardId);
  if (!card) return false;
  const called = new Set(calledNumbers);
  return card.numbers.every((n) => called.has(n));
}

function stopRoomTimer(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
}

function startGame(room) {
  room.status = "playing";
  room.calledNumbers = [];
  room.currentNumber = null;
  room.remainingNumbers = makeNumbersSet(MIN_NUM, MAX_NUM);

  // When starting a new round, reset eliminated flags but KEEP scores
  for (const p of room.players.values()) {
    p.eliminated = false;
  }

  stopRoomTimer(room);

  room.timer = setInterval(() => {
    // If room got deleted or not playing, stop
    if (!rooms.has(room.id) || room.status !== "playing") {
      stopRoomTimer(room);
      return;
    }

    if (room.remainingNumbers.size === 0) {
      // No more numbers -> end
      endRound(room, { type: "no_more_numbers" });
      return;
    }

    const num = pickRandomFromSet(room.remainingNumbers);
    room.remainingNumbers.delete(num);
    room.currentNumber = num;
    room.calledNumbers.push(num);

    io.to(room.id).emit("game:update", getRoomPublic(room));
  }, CALL_INTERVAL_MS);

  // Immediately call 1 number at start (optional). Comment if you want wait 10s.
  callOneImmediate(room);

  io.to(room.id).emit("game:update", getRoomPublic(room));
  broadcastRoomsList();
}

function callOneImmediate(room) {
  if (room.remainingNumbers.size === 0) return;
  const num = pickRandomFromSet(room.remainingNumbers);
  room.remainingNumbers.delete(num);
  room.currentNumber = num;
  room.calledNumbers.push(num);
}

function endRound(room, reason) {
  stopRoomTimer(room);
  room.status = "ended";
  room.currentNumber = null;
  io.to(room.id).emit("round:ended", { room: getRoomPublic(room), reason });
  broadcastRoomsList();
}

function canStart(room) {
  if (room.players.size < 2) return false;
  for (const p of room.players.values()) {
    if (!p.cardId) return false;
  }
  return true;
}

function isHost(room, socketId) {
  return room.hostId === socketId;
}

// ====== Socket.IO ======
io.on("connection", (socket) => {
  socket.emit("deck:list", DECK);
  socket.emit("rooms:list", Array.from(rooms.values()).map((r) => ({
    id: r.id,
    name: r.name,
    maxPlayers: r.maxPlayers,
    playerCount: r.players.size,
    status: r.status === "waiting" ? "Đang chờ" : r.status === "playing" ? "Đang chơi" : "Kết thúc",
  })));

  socket.on("room:create", ({ playerName, roomName, maxPlayers }) => {
    try {
      const name = (playerName || "").trim().slice(0, 24);
      const rname = (roomName || "").trim().slice(0, 28);
      const mp = Math.max(2, Math.min(10, Number(maxPlayers || 2)));

      if (!name) throw new Error("Vui lòng nhập tên.");
      if (!rname) throw new Error("Vui lòng đặt tên phòng.");

      const id = uid(6);

      const room = {
        id,
        name: rname,
        maxPlayers: mp,
        hostId: socket.id,
        status: "waiting",
        createdAt: now(),
        players: new Map(),
        usedCardIds: new Set(),
        calledNumbers: [],
        remainingNumbers: makeNumbersSet(),
        currentNumber: null,
        timer: null,
      };

      room.players.set(socket.id, {
        id: socket.id,
        name,
        cardId: null,
        eliminated: false,
        score: 0,
      });

      rooms.set(id, room);

      socket.join(id);
      socket.emit("room:joined", { room: getRoomPublic(room), selfId: socket.id });
      broadcastRoomsList();
    } catch (e) {
      socket.emit("toast", { type: "error", message: e.message || "Tạo phòng thất bại." });
    }
  });

  socket.on("room:join", ({ playerName, roomId }) => {
    try {
      const name = (playerName || "").trim().slice(0, 24);
      const id = (roomId || "").trim();

      if (!name) throw new Error("Vui lòng nhập tên.");
      const room = rooms.get(id);
      if (!room) throw new Error("Không tìm thấy phòng.");
      if (room.status !== "waiting") throw new Error("Phòng đang chơi, không thể vào.");
      if (room.players.size >= room.maxPlayers) throw new Error("Phòng đã đủ người.");

      room.players.set(socket.id, {
        id: socket.id,
        name,
        cardId: null,
        eliminated: false,
        score: 0,
      });

      socket.join(id);
      io.to(id).emit("lobby:update", getRoomPublic(room));
      socket.emit("room:joined", { room: getRoomPublic(room), selfId: socket.id });
      broadcastRoomsList();
    } catch (e) {
      socket.emit("toast", { type: "error", message: e.message || "Tham gia phòng thất bại." });
    }
  });

  socket.on("room:leave", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    // Free card if had
    const p = room.players.get(socket.id);
    if (p?.cardId) room.usedCardIds.delete(p.cardId);

    room.players.delete(socket.id);
    socket.leave(roomId);

    // If host leaves -> assign new host if possible, else delete room
    if (room.hostId === socket.id) {
      const next = room.players.values().next().value;
      if (next) {
        room.hostId = next.id;
        io.to(roomId).emit("toast", { type: "info", message: "Chủ phòng đã rời. Đã chuyển quyền chủ phòng." });
      } else {
        stopRoomTimer(room);
        rooms.delete(roomId);
        broadcastRoomsList();
        return;
      }
    }

    // If room empty -> delete
    if (room.players.size === 0) {
      stopRoomTimer(room);
      rooms.delete(roomId);
      broadcastRoomsList();
      return;
    }

    // If playing and a player leaves, just update
    io.to(roomId).emit(room.status === "waiting" ? "lobby:update" : "game:update", getRoomPublic(room));
    broadcastRoomsList();
  });

  socket.on("card:select", ({ roomId, cardId }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Không tìm thấy phòng.");
      if (room.status !== "waiting") throw new Error("Đã vào ván chơi, không thể đổi tờ dò.");

      const card = getCardById(cardId);
      if (!card) throw new Error("Tờ dò không hợp lệ.");

      const player = room.players.get(socket.id);
      if (!player) throw new Error("Bạn không ở trong phòng.");

      // If card already used by someone else
      if (room.usedCardIds.has(cardId) && player.cardId !== cardId) {
        throw new Error("Tờ dò này đã có người chọn.");
      }

      // Free old
      if (player.cardId && player.cardId !== cardId) {
        room.usedCardIds.delete(player.cardId);
      }

      player.cardId = cardId;
      room.usedCardIds.add(cardId);

      io.to(roomId).emit("lobby:update", getRoomPublic(room));
    } catch (e) {
      socket.emit("toast", { type: "error", message: e.message || "Chọn tờ dò thất bại." });
    }
  });

  socket.on("lobby:kick", ({ roomId, targetId }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Không tìm thấy phòng.");
      if (!isHost(room, socket.id)) throw new Error("Chỉ chủ phòng được kick.");
      if (room.status !== "waiting") throw new Error("Chỉ kick được khi đang chờ.");
      if (!room.players.has(targetId)) throw new Error("Người chơi không tồn tại.");

      const target = room.players.get(targetId);
      // Only kick those who haven't selected card (as per your requirement)
      if (target.cardId) throw new Error("Chỉ kick người chưa chọn tờ dò.");

      room.players.delete(targetId);

      // Ensure they leave socket room
      io.to(targetId).emit("kicked", { message: "Bạn đã bị chủ phòng kick (chưa chọn tờ dò)." });
      io.sockets.sockets.get(targetId)?.leave(roomId);

      io.to(roomId).emit("lobby:update", getRoomPublic(room));
      broadcastRoomsList();
    } catch (e) {
      socket.emit("toast", { type: "error", message: e.message || "Kick thất bại." });
    }
  });

  socket.on("game:start", ({ roomId }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Không tìm thấy phòng.");
      if (!isHost(room, socket.id)) throw new Error("Chỉ chủ phòng được bắt đầu.");
      if (room.status !== "waiting") throw new Error("Phòng không ở trạng thái chờ.");
      if (!canStart(room)) throw new Error("Cần tối thiểu 2 người và tất cả đã chọn tờ dò.");

      startGame(room);
    } catch (e) {
      socket.emit("toast", { type: "error", message: e.message || "Bắt đầu thất bại." });
    }
  });

  socket.on("game:claim", ({ roomId }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Không tìm thấy phòng.");
      if (room.status !== "playing") throw new Error("Chưa ở trạng thái đang chơi.");

      const player = room.players.get(socket.id);
      if (!player) throw new Error("Bạn không ở trong phòng.");
      if (player.eliminated) throw new Error("Bạn đã bị loại.");

      if (!player.cardId) throw new Error("Bạn chưa chọn tờ dò.");

      const ok = checkWin(player.cardId, room.calledNumbers);

      if (ok) {
        player.score += 1;
        endRound(room, { type: "win", winnerId: player.id, winnerName: player.name });
      } else {
        player.eliminated = true;
        io.to(roomId).emit("toast", {
          type: "warn",
          message: `❌ ${player.name} báo KINH sai và đã bị loại!`,
        });
        io.to(roomId).emit("game:update", getRoomPublic(room));
      }
    } catch (e) {
      socket.emit("toast", { type: "error", message: e.message || "Báo KINH thất bại." });
    }
  });

  socket.on("game:reset", ({ roomId }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error("Không tìm thấy phòng.");
      if (!isHost(room, socket.id)) throw new Error("Chỉ chủ phòng được reset.");
      if (room.status !== "ended") throw new Error("Chỉ reset sau khi ván kết thúc.");

      // Back to waiting lobby; keep chosen cards to start quickly (you can change if want)
      room.status = "waiting";
      room.calledNumbers = [];
      room.currentNumber = null;
      room.remainingNumbers = makeNumbersSet();
      stopRoomTimer(room);

      // Remove eliminated, allow everyone interact again
      for (const p of room.players.values()) p.eliminated = false;

      io.to(roomId).emit("lobby:update", getRoomPublic(room));
      broadcastRoomsList();
    } catch (e) {
      socket.emit("toast", { type: "error", message: e.message || "Reset thất bại." });
    }
  });

  socket.on("chat:send", ({ roomId, text }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    const msg = (text || "").trim().slice(0, 300);
    if (!msg) return;

    io.to(roomId).emit("chat:msg", {
      from: player.name,
      text: msg,
      at: now(),
    });
  });

  socket.on("disconnect", () => {
    // Remove player from any room they were in
    for (const room of rooms.values()) {
      if (room.players.has(socket.id)) {
        const p = room.players.get(socket.id);
        if (p?.cardId) room.usedCardIds.delete(p.cardId);

        room.players.delete(socket.id);

        if (room.hostId === socket.id) {
          const next = room.players.values().next().value;
          if (next) {
            room.hostId = next.id;
            io.to(room.id).emit("toast", { type: "info", message: "Chủ phòng mất kết nối. Đã chuyển quyền chủ phòng." });
          } else {
            stopRoomTimer(room);
            rooms.delete(room.id);
            broadcastRoomsList();
            return;
          }
        }

        io.to(room.id).emit(room.status === "waiting" ? "lobby:update" : "game:update", getRoomPublic(room));
        broadcastRoomsList();
        return;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Lô-tô Miền Tây running at http://localhost:${PORT}`);
});
