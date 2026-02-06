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
 *  FIXED DECK (10 tờ dò mẫu) — mỗi hàng đúng 5 số
 *  Mỗi tờ = 9 hàng, mỗi hàng 5 số.
 *  Server sẽ tự map sang grid 9x9 theo cột thập phân:
 *    cột 1: 1-9, cột 2: 10-19, ..., cột 9: 80-90
 * ============================================================
 */

function decadeCol(n) {
  if (n === 90) return 8;
  return Math.floor(n / 10);
}

function rowsToGrid(rows9) {
  // grid 9x9, null là ô trống
  const grid = Array.from({ length: 9 }, () => Array(9).fill(null));
  for (let r = 0; r < 9; r++) {
    const nums = rows9[r] || [];
    for (const n of nums) {
      const c = decadeCol(n);
      // nếu trùng cột (hiếm), đẩy sang cột trống gần nhất (fallback)
      if (grid[r][c] === null) grid[r][c] = n;
      else {
        let placed = false;
        for (let k = 1; k < 9; k++) {
          const left = c - k;
          const right = c + k;
          if (left >= 0 && grid[r][left] === null) {
            grid[r][left] = n;
            placed = true;
            break;
          }
          if (right < 9 && grid[r][right] === null) {
            grid[r][right] = n;
            placed = true;
            break;
          }
        }
        if (!placed) {
          // bỏ qua nếu không còn chỗ (gần như không xảy ra)
        }
      }
    }
  }
  return grid;
}

function rowsToBlocks(rows9) {
  // 3 block * 15 số để client hiển thị tách 3 bảng con
  const blocks = [];
  for (let b = 0; b < 3; b++) {
    const flat = [];
    for (let r = b * 3; r < b * 3 + 3; r++) {
      flat.push(...rows9[r]);
    }
    blocks.push(flat);
  }
  return blocks;
}

/**
 * 10 tờ dò mẫu (đúng theo ảnh bạn gửi)
 * Map màu theo 5 cặp: blue, red, green, purple, orange
 * A/B là 1 cặp.
 *
 * Bạn có thể đổi title nếu muốn (mình giữ theo yêu cầu rename trước đó):
 *  - Blue: THÀNH CÔNG
 *  - Red:  RỰC RỠ
 *  - Green: THÀNH CÔNG
 *  - Purple: HUY HOÀNG
 *  - Orange: HUY HOÀNG
 */
const FIXED_TICKETS = [
  // ===== BLUE PAIR (2 tờ vàng) =====
  {
    id: "blue-A",
    color: "blue",
    colorLabel: "Xanh dương",
    variant: "A",
    title: "THÀNH CÔNG",
    rows: [
      [7, 16, 32, 66, 73],
      [18, 29, 46, 55, 88],
      [2, 23, 34, 50, 75],
      [4, 30, 40, 61, 78],
      [10, 27, 41, 56, 86],
      [20, 39, 59, 60, 83],
      [9, 24, 51, 64, 81],
      [3, 28, 48, 53, 80],
      [17, 37, 45, 63, 77],
    ],
  },
  {
    id: "blue-B",
    color: "blue",
    colorLabel: "Xanh dương",
    variant: "B",
    title: "THÀNH CÔNG",
    rows: [
      [19, 35, 49, 71, 85],
      [8, 14, 47, 54, 74],
      [6, 25, 36, 62, 84],
      [15, 22, 58, 70, 89],
      [12, 31, 43, 68, 90],
      [1, 42, 65, 72, 87],
      [5, 21, 38, 52, 76],
      [13, 33, 57, 67, 82],
      [11, 26, 44, 69, 79],
    ],
  },

  // ===== RED PAIR =====
  {
    id: "red-A",
    color: "red",
    colorLabel: "Đỏ",
    variant: "A",
    title: "RỰC RỠ",
    rows: [
      [19, 32, 58, 64, 84],
      [13, 20, 48, 55, 77],
      [2, 21, 46, 75, 82],
      [6, 18, 39, 62, 70],
      [25, 41, 59, 74, 83],
      [17, 38, 44, 60, 86],
      [8, 22, 47, 66, 72],
      [9, 12, 37, 42, 88],
      [15, 36, 51, 68, 90],
    ],
  },
  {
    id: "red-B",
    color: "red",
    colorLabel: "Đỏ",
    variant: "B",
    title: "RỰC RỠ",
    rows: [
      [5, 29, 30, 56, 80],
      [10, 35, 54, 63, 81],
      [4, 26, 45, 61, 79],
      [3, 14, 43, 50, 71],
      [7, 23, 31, 52, 73],
      [11, 28, 49, 69, 89],
      [24, 34, 53, 67, 85],
      [27, 40, 57, 76, 87],
      [1, 16, 33, 65, 78],
    ],
  },

  // ===== GREEN PAIR =====
  {
    id: "green-A",
    color: "green",
    colorLabel: "Xanh lá",
    variant: "A",
    title: "THÀNH CÔNG",
    rows: [
      [16, 28, 45, 68, 87],
      [4, 29, 35, 55, 73],
      [9, 30, 54, 62, 88],
      [1, 21, 33, 52, 76],
      [8, 40, 50, 79, 81],
      [11, 20, 46, 63, 83],
      [27, 49, 59, 72, 80],
      [2, 19, 32, 48, 67],
      [14, 22, 57, 78, 90],
    ],
  },
  {
    id: "green-B",
    color: "green",
    colorLabel: "Xanh lá",
    variant: "B",
    title: "THÀNH CÔNG",
    rows: [
      [6, 18, 47, 69, 86],
      [13, 31, 44, 61, 70],
      [7, 24, 34, 56, 71],
      [5, 23, 41, 65, 74],
      [10, 37, 53, 60, 89],
      [17, 38, 42, 75, 84],
      [15, 25, 51, 77, 85],
      [12, 36, 43, 64, 82],
      [3, 26, 39, 58, 66],
    ],
  },

  // ===== PURPLE (PINK) PAIR =====
  {
    id: "purple-A",
    color: "purple",
    colorLabel: "Tím",
    variant: "A",
    title: "HUY HOÀNG",
    rows: [
      [18, 22, 55, 76, 87],
      [12, 38, 40, 66, 82],
      [1, 27, 42, 73, 85],
      [10, 34, 56, 63, 80],
      [6, 35, 43, 64, 71],
      [13, 21, 54, 74, 90],
      [7, 24, 32, 53, 67],
      [2, 36, 47, 65, 72],
      [11, 23, 45, 51, 81],
    ],
  },
  {
    id: "purple-B",
    color: "purple",
    colorLabel: "Tím",
    variant: "B",
    title: "HUY HOÀNG",
    rows: [
      [19, 28, 46, 68, 75],
      [5, 26, 39, 58, 78],
      [14, 37, 50, 69, 84],
      [3, 25, 57, 60, 86],
      [16, 31, 49, 77, 89],
      [8, 17, 48, 59, 79],
      [15, 20, 44, 52, 70],
      [4, 33, 41, 61, 83],
      [9, 29, 30, 62, 88],
    ],
  },

  // ===== ORANGE PAIR =====
  {
    id: "orange-A",
    color: "orange",
    colorLabel: "Cam",
    variant: "A",
    title: "HUY HOÀNG",
    rows: [
      [3, 15, 32, 60, 71],
      [10, 20, 43, 54, 85],
      [2, 26, 35, 59, 76],
      [6, 39, 49, 68, 73],
      [13, 29, 48, 50, 88],
      [22, 30, 53, 65, 82],
      [1, 25, 58, 69, 90],
      [7, 21, 41, 56, 87],
      [11, 37, 44, 61, 70],
    ],
  },
  {
    id: "orange-B",
    color: "orange",
    colorLabel: "Cam",
    variant: "B",
    title: "HUY HOÀNG",
    rows: [
      [12, 34, 40, 75, 89],
      [8, 16, 42, 55, 77],
      [5, 24, 33, 67, 83],
      [14, 27, 51, 78, 84],
      [18, 38, 46, 63, 81],
      [9, 47, 66, 79, 86],
      [4, 28, 31, 57, 72],
      [17, 36, 52, 64, 80],
      [19, 23, 45, 62, 74],
    ],
  },
];

// Build deck with grid + blocks for client compatibility
const deck = FIXED_TICKETS.map((t) => {
  const grid = rowsToGrid(t.rows);
  const blocks = rowsToBlocks(t.rows);
  return { ...t, grid, blocks };
});

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
    status: room.status,
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

  room.remainingNumbers = Array.from({ length: 90 }, (_, i) => i + 1);
  for (let i = room.remainingNumbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [room.remainingNumbers[i], room.remainingNumbers[j]] = [
      room.remainingNumbers[j],
      room.remainingNumbers[i],
    ];
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

/**
 * ✅ RULE KINH:
 * Thắng nếu tồn tại 1 hàng (5 số) mà tất cả 5 số đã nằm trong calledNumbers.
 */
function validateClaim(room, player) {
  const card = deck.find((c) => c.id === player.cardId);
  if (!card) return false;

  const called = new Set(room.calledNumbers);
  const rows9 = card.rows;

  for (const rowNums of rows9) {
    if (!rowNums || rowNums.length !== 5) continue;
    const ok = rowNums.every((n) => called.has(n));
    if (ok) return true;
  }
  return false;
}

/**
 * ============================================================
 *  SOCKET.IO
 * ============================================================
 */

io.on("connection", (socket) => {
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
      if (leaving.cardId) {
        room.usedCardIds = room.usedCardIds.filter((x) => x !== leaving.cardId);
      }
      room.players.splice(idx, 1);
    }

    socket.leave(room.id);

    if (room.hostId === socket.id) {
      if (room.players.length) room.hostId = room.players[0].id;
      else {
        stopCalling(room);
        rooms.delete(room.id);
        broadcastRooms();
        return;
      }
    }

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

    const alreadyUsed = room.usedCardIds.includes(cid);
    const selectingSame = player.cardId === cid;
    if (alreadyUsed && !selectingSame) return emitToast(socket, "error", "Tờ dò đã có người chọn.");

    if (player.cardId && player.cardId !== cid) {
      room.usedCardIds = room.usedCardIds.filter((x) => x !== player.cardId);
    }

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
    if (target.cardId) return; // chỉ kick người chưa chọn

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
