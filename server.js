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

// ====== Deck: 10 tờ dò (5 màu x A/B)
// 1 tờ dò hoàn chỉnh = 3 block (mỗi block 3x9, 15 số) => tổng 9x9, 45 số
function buildDeck() {
  const ticketsA = [
    {
      title: "TÂN TÂN",
      blocks: [
        [7, 16, 32, 66, 73, 18, 29, 46, 55, 88, 2, 23, 34, 50, 75],
        [4, 30, 40, 61, 78, 10, 27, 41, 56, 86, 20, 39, 59, 60, 83],
        [9, 24, 51, 64, 81, 3, 28, 48, 53, 80, 17, 37, 45, 63, 77],
      ],
    },
    {
      title: "MIỀN TÂY",
      blocks: [
        [1, 12, 25, 33, 70, 8, 19, 42, 54, 89, 6, 21, 38, 65, 76],
        [5, 14, 26, 47, 72, 11, 22, 35, 58, 84, 2, 29, 44, 60, 90],
        [3, 18, 27, 49, 71, 7, 16, 32, 66, 73, 4, 30, 40, 61, 78],
      ],
    },
    {
      title: "VUI VẺ",
      blocks: [
        [6, 15, 24, 52, 81, 9, 14, 28, 48, 80, 1, 17, 37, 45, 63],
        [2, 13, 29, 50, 75, 5, 10, 27, 41, 56, 20, 39, 59, 60, 83],
        [7, 16, 32, 66, 73, 8, 19, 42, 54, 89, 4, 30, 40, 61, 78],
      ],
    },
    {
      title: "HÊN XUI",
      blocks: [
        [9, 11, 23, 34, 75, 2, 18, 29, 46, 55, 7, 16, 32, 66, 73],
        [4, 10, 27, 41, 56, 20, 39, 59, 60, 83, 5, 14, 26, 47, 72],
        [1, 12, 25, 33, 70, 6, 21, 38, 65, 76, 3, 28, 48, 53, 80],
      ],
    },
    {
      title: "ĐẮC LỘC",
      blocks: [
        [8, 19, 42, 54, 89, 6, 15, 24, 52, 81, 1, 17, 37, 45, 63],
        [7, 16, 32, 66, 73, 4, 30, 40, 61, 78, 9, 24, 51, 64, 81],
        [2, 13, 29, 50, 75, 5, 14, 26, 47, 72, 3, 18, 27, 49, 71],
      ],
    },
  ];

  const colors = [
    { key: "red", label: "Đỏ" },
    { key: "blue", label: "Xanh dương" },
    { key: "green", label: "Xanh lá" },
    { key: "purple", label: "Tím" },
    { key: "orange", label: "Cam" },
  ];

  const deck = [];
  const comp = (n) => 91 - n;

  for (let i = 0; i < 5; i++) {
    const baseTicket = ticketsA[i];

    deck.push({
      id: `${colors[i].key}-A`,
      color: colors[i].key,
      colorLabel: colors[i].label,
      variant: "A",
      title: baseTicket.title,
      blocks: baseTicket.blocks.map((b) => b.slice()),
    });

    deck.push({
      id: `${colors[i].key}-B`,
      color: colors[i].key,
      colorLabel: colors[i].label,
      variant: "B",
      title: baseTicket.title,
      blocks: baseTicket.blocks.map((b) => b.map(comp)),
    });
  }

  return deck;
}

const DECK = buildDeck();

function getCardById(cardId) {
  return DECK.find((c) => c.id === cardId) || null;
}

/**
 * ✅ Rule KINH hiện tại: Hoàn thành BẤT KỲ 1 BLOCK (15 số).
 * Nếu bạn muốn "KINH cả tờ" (45 số) => đổi `.some` thành `.every`.
 */
function checkWin(cardId, calledNumbers) {
  const card = getCardById(cardId);
  if (!card) return false;
  const called = new Set(calledNumbers);
  return (card.blocks || []).some((block) => block.every((n) => called.has(n)));
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

  // Reset eliminated for new round (keep scores)
  for (const p of room.players.values()) {
    p.eliminated = false;
  }

  stopRoomTimer(room);

  // Call one number immediately (optional)
  callOneImmediate(room);

  room.timer = setInterval(() => {
    if (!rooms.has(room.id) || room.status !== "playing") {
      stopRoomTimer(room);
      return;
    }

    if (room.remainingNumbers.size === 0) {
      endRound(room, { type: "no_more_numbers" });
      return;
    }

    const num = pickRandomFromSet(room.remainingNumbers);
    room.remainingNumbers.delete(num);
    room.currentNumber = num;
    room.calledNumbers.push(num);

    io.to(room.id).emit("game:update", getRoomPublic(room));
  }, CALL_INTERVAL_MS);

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

  socket.emit(
    "rooms:list",
    Array.from(rooms.values()).map((r) => ({
      id: r.id,
      name: r.name,
      maxPlayers: r.maxPlayers,
      playerCount: r.players.size,
      status: r.status === "waiting" ? "Đang chờ" : r.status === "playing" ? "Đang chơi" : "Kết thúc",
    }))
  );

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

    const p = room.players.get(socket.id);
    if (p?.cardId) room.usedCardIds.delete(p.cardId);

    room.players.delete(socket.id);
    socket.leave(roomId);

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

    if (room.players.size === 0) {
      stopRoomTimer(room);
      rooms.delete(roomId);
      broadcastRoomsList();
      return;
    }

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

      if (room.usedCardIds.has(cardId) && player.cardId !== cardId) {
        throw new Error("Tờ dò này đã có người chọn.");
      }

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
      if (target.cardId) throw new Error("Chỉ kick người chưa chọn tờ dò.");

      room.players.delete(targetId);

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
      if (!canStart(room)) throw new Error("Cần tối thiểu 2 người và tất cả đã chọn xong tờ dò.");

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

      room.status = "waiting";
      room.calledNumbers = [];
      room.currentNumber = null;
      room.remainingNumbers = makeNumbersSet();
      stopRoomTimer(room);

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
