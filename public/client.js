const socket = io();

// ===== State =====
let deck = [];
let rooms = [];
let currentView = "home";

let selfId = null;
let currentRoom = null; // room public object
let myMarked = new Set(); // local tick only
let chatMessages = [];

// Cache ảnh vé để không render canvas lại hoài
// key: `${cardId}|${size}` => dataURL
const ticketImageCache = new Map();

// ===== DOM =====
const el = (id) => document.getElementById(id);

const viewHome = el("viewHome");
const viewCreate = el("viewCreate");
const viewJoin = el("viewJoin");
const viewLobby = el("viewLobby");
const viewGame = el("viewGame");

const toast = el("toast");

const inputPlayerName = el("inputPlayerName");
const goCreate = el("goCreate");
const goJoin = el("goJoin");

const inputRoomName = el("inputRoomName");
const inputMaxPlayers = el("inputMaxPlayers");
const btnCreateRoom = el("btnCreateRoom");

const roomsList = el("roomsList");

const lobbyRoomTitle = el("lobbyRoomTitle");
const lobbyRoomMeta = el("lobbyRoomMeta");
const playersList = el("playersList");
const deckGrid = el("deckGrid");
const btnStartGame = el("btnStartGame");
const btnResetGame = el("btnResetGame");

const currentNumber = el("currentNumber");
const historyNumbers = el("historyNumbers");
const scoreBoard = el("scoreBoard");
const myCardGrid = el("myCardGrid");
const myCardMeta = el("myCardMeta");
const statusBadge = el("statusBadge");
const btnClaim = el("btnClaim");

const btnOpenChat = el("btnOpenChat");
const btnCloseChat = el("btnCloseChat");
const chatModal = el("chatModal");
const btnLeaveRoom = el("btnLeaveRoom");

const chatBoxLobby = el("chatBoxLobby");
const chatInputLobby = el("chatInputLobby");
const chatSendLobby = el("chatSendLobby");

const chatBoxGame = el("chatBoxGame");
const chatInputGame = el("chatInputGame");
const chatSendGame = el("chatSendGame");

const chatBoxModal = el("chatBoxModal");
const chatInputModal = el("chatInputModal");
const chatSendModal = el("chatSendModal");

// ===== Helpers =====
function showToast(type, message) {
  toast.classList.remove("hidden", "ok", "err", "warn");
  if (type === "success" || type === "ok") toast.classList.add("ok");
  else if (type === "warn") toast.classList.add("warn");
  else toast.classList.add("err");
  toast.textContent = message;

  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 2600);
}

function ensureName() {
  const name = (inputPlayerName.value || "").trim();
  if (!name) {
    showToast("error", "Bạn cần nhập tên trước.");
    return null;
  }
  return name;
}

function setView(v) {
  currentView = v;
  for (const node of [viewHome, viewCreate, viewJoin, viewLobby, viewGame]) {
    node.classList.add("hidden");
  }
  if (v === "home") viewHome.classList.remove("hidden");
  if (v === "create") viewCreate.classList.remove("hidden");
  if (v === "join") viewJoin.classList.remove("hidden");
  if (v === "lobby") viewLobby.classList.remove("hidden");
  if (v === "game") viewGame.classList.remove("hidden");

  const inRoom = !!currentRoom;
  btnLeaveRoom.classList.toggle("hidden", !inRoom);
  btnOpenChat.classList.toggle("hidden", !inRoom);
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function openChatModal() {
  chatModal.classList.remove("hidden");
  renderChat();
}
function closeChatModal() {
  chatModal.classList.add("hidden");
}

// ===== Loto logic helpers (block 3x9) =====
function decadeCol(n) {
  if (n === 90) return 8;
  return Math.floor(n / 10);
}

// 15 numbers -> 3 rows x 9 cols, each row max 5 numbers, blanks are null
function buildBlockGrid15(numbers15) {
  const cols = Array.from({ length: 9 }, () => []);
  (numbers15 || [])
    .slice()
    .sort((a, b) => a - b)
    .forEach((n) => cols[decadeCol(n)].push(n));

  const grid = Array.from({ length: 3 }, () => Array(9).fill(null));
  const rowCount = [0, 0, 0];

  for (let c = 0; c < 9; c++) {
    const arr = cols[c];
    for (const n of arr) {
      let best = -1;
      let bestCnt = 999;

      for (let r = 0; r < 3; r++) {
        if (rowCount[r] >= 5) continue;
        if (grid[r][c] !== null) continue;
        if (rowCount[r] < bestCnt) {
          bestCnt = rowCount[r];
          best = r;
        }
      }

      if (best === -1) {
        for (let r = 0; r < 3; r++) {
          if (rowCount[r] < 5) {
            best = r;
            break;
          }
        }
      }

      if (best !== -1) {
        grid[best][c] = n;
        rowCount[best]++;
      }
    }
  }

  return grid;
}

// ===== Canvas ticket renderer (tấm hình) =====
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function renderTicketImage(card, cellSize = 42) {
  const cacheKey = `${card.id}|${cellSize}`;
  if (ticketImageCache.has(cacheKey)) return ticketImageCache.get(cacheKey);

  const pad = 16;
  const gapBlock = 14;
  const cellGap = 10;

  const cols = 9;
  const rowsPerBlock = 3;
  const blocks = 3;
  const rowsTotal = rowsPerBlock * blocks;

  const headerH = 58;

  const w = pad * 2 + cols * cellSize + (cols - 1) * cellGap;
  const h =
    pad * 2 +
    headerH +
    rowsTotal * cellSize +
    (rowsTotal - 1) * cellGap +
    (blocks - 1) * gapBlock;

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(w * 2); // retina
  canvas.height = Math.floor(h * 2);
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);

  // Paper-like background
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "rgba(255,252,238,0.98)");
  bg.addColorStop(1, "rgba(255,236,180,0.96)");
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, w, h, 18, true);

  // Border
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(160,110,0,0.45)";
  roundRect(ctx, 1, 1, w - 2, h - 2, 18, false, true);

  // Tiny pattern dots
  ctx.fillStyle = "rgba(150,95,0,0.10)";
  for (let i = 10; i < w; i += 18) {
    ctx.fillRect(i, 10, 2, 2);
    ctx.fillRect(i, h - 12, 2, 2);
  }

  // Header text
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "rgba(50,35,0,0.88)";
  ctx.font = "900 22px 'Be Vietnam Pro', system-ui, sans-serif";
  ctx.fillText((card.title || "LÔ TÔ").toUpperCase(), w / 2, pad + 18);

  ctx.fillStyle = "rgba(50,35,0,0.62)";
  ctx.font = "800 12px 'Be Vietnam Pro', system-ui, sans-serif";
  ctx.fillText(`${card.colorLabel || ""} ${card.variant || ""} • ${card.id || ""}`, w / 2, pad + 38);

  // Render 3 blocks
  const startX = pad;
  let y = pad + headerH;

  for (let b = 0; b < 3; b++) {
    const grid = buildBlockGrid15(card.blocks?.[b] || []);

    // block frame
    ctx.fillStyle = "rgba(255,255,255,0.30)";
    roundRect(
      ctx,
      startX - 6,
      y - 6,
      cols * cellSize + (cols - 1) * cellGap + 12,
      rowsPerBlock * cellSize + (rowsPerBlock - 1) * cellGap + 12,
      14,
      true
    );
    ctx.strokeStyle = "rgba(120,70,0,0.18)";
    ctx.lineWidth = 1;
    roundRect(
      ctx,
      startX - 6,
      y - 6,
      cols * cellSize + (cols - 1) * cellGap + 12,
      rowsPerBlock * cellSize + (rowsPerBlock - 1) * cellGap + 12,
      14,
      false,
      true
    );

    for (let r = 0; r < rowsPerBlock; r++) {
      for (let c = 0; c < cols; c++) {
        const val = grid[r][c];
        const x = startX + c * (cellSize + cellGap);
        const yy = y + r * (cellSize + cellGap);

        if (val === null) {
          // yellow blank
          const g = ctx.createLinearGradient(x, yy, x, yy + cellSize);
          g.addColorStop(0, "rgba(255,194,60,0.95)");
          g.addColorStop(1, "rgba(255,176,32,0.92)");
          ctx.fillStyle = g;
          roundRect(ctx, x, yy, cellSize, cellSize, 10, true);
          ctx.strokeStyle = "rgba(120,70,0,0.25)";
          ctx.lineWidth = 1;
          roundRect(ctx, x, yy, cellSize, cellSize, 10, false, true);
        } else {
          // number cell
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          roundRect(ctx, x, yy, cellSize, cellSize, 10, true);
          ctx.strokeStyle = "rgba(120,70,0,0.18)";
          ctx.lineWidth = 1;
          roundRect(ctx, x, yy, cellSize, cellSize, 10, false, true);

          // number text
          ctx.fillStyle = "rgba(12,12,12,0.92)";
          ctx.font = `900 ${Math.max(14, Math.floor(cellSize * 0.46))}px 'Be Vietnam Pro', system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(val), x + cellSize / 2, yy + cellSize / 2 + 1);
        }
      }
    }

    y += rowsPerBlock * cellSize + (rowsPerBlock - 1) * cellGap + gapBlock;
  }

  const url = canvas.toDataURL("image/png");
  ticketImageCache.set(cacheKey, url);
  return url;
}

// ===== Renderers =====
function renderRooms() {
  roomsList.innerHTML = "";
  if (!rooms.length) {
    roomsList.innerHTML = `<div class="muted small">Chưa có phòng nào. Hãy tạo phòng mới.</div>`;
    return;
  }

  for (const r of rooms) {
    const pillClass = r.status === "Đang chờ" ? "wait" : r.status === "Đang chơi" ? "play" : "end";
    const canJoin = r.status === "Đang chờ";
    const row = document.createElement("div");
    row.className = "room-item";
    row.innerHTML = `
      <div class="room-left">
        <div class="room-title">${escapeHtml(r.name)} <span class="pill ${pillClass}">${r.status}</span></div>
        <div class="room-meta">Mã phòng: <b>${r.id}</b> • ${r.playerCount}/${r.maxPlayers} người</div>
      </div>
      <div>
        <button class="btn ${canJoin ? "btn-primary" : "btn-ghost"}" ${canJoin ? "" : "disabled"}>
          ${canJoin ? "Vào phòng" : "Không vào được"}
        </button>
      </div>
    `;
    row.querySelector("button").addEventListener("click", () => {
      if (!canJoin) return;
      const name = ensureName();
      if (!name) return;
      socket.emit("room:join", { playerName: name, roomId: r.id });
    });
    roomsList.appendChild(row);
  }
}

function renderLobby(room) {
  lobbyRoomTitle.textContent = `Phòng: ${room.name}`;
  const host = room.players.find((p) => p.id === room.hostId);
  lobbyRoomMeta.innerHTML = `Mã: <b>${room.id}</b> • ${room.players.length}/${room.maxPlayers} người • Chủ phòng: <b>${escapeHtml(
    host?.name || "?"
  )}</b>`;

  const me = room.players.find((p) => p.id === selfId);
  const iAmHost = selfId === room.hostId;

  const allSelected = room.players.length >= 2 && room.players.every((p) => !!p.cardId);
  btnStartGame.classList.toggle("hidden", !iAmHost || room.status !== "waiting");
  btnStartGame.disabled = !allSelected;

  btnResetGame.classList.toggle("hidden", !iAmHost || room.status !== "ended");

  // Players list
  playersList.innerHTML = "";
  room.players.forEach((p) => {
    const row = document.createElement("div");
    row.className = "player-row";
    const tags = [];
    if (p.isHost) tags.push(`<span class="tag host">Chủ phòng</span>`);
    if (p.eliminated) tags.push(`<span class="tag elim">Bị loại</span>`);
    if (p.cardId) tags.push(`<span class="tag ready">Đã chọn</span>`);
    else tags.push(`<span class="tag wait">Chưa chọn</span>`);

    const canKick = iAmHost && room.status === "waiting" && !p.isHost && !p.cardId;
    row.innerHTML = `
      <div>
        <div class="player-name">${escapeHtml(p.name)} <span class="muted small">• ${p.score} điểm</span></div>
        <div class="player-tags">${tags.join("")}</div>
      </div>
      <div>
        ${canKick ? `<button class="btn btn-danger">Kick</button>` : ""}
      </div>
    `;
    if (canKick) {
      row.querySelector("button").addEventListener("click", () => {
        socket.emit("lobby:kick", { roomId: room.id, targetId: p.id });
      });
    }
    playersList.appendChild(row);
  });

  // Deck grid (ticket as IMAGE)
  deckGrid.innerHTML = "";
  deck.forEach((card) => {
    const used = room.usedCardIds.includes(card.id);
    const selectedByMe = me?.cardId === card.id;
    const disabled = used && !selectedByMe;

    const wrap = document.createElement("div");
    wrap.className = "deck-card" + (selectedByMe ? " selected" : "") + (disabled ? " disabled" : "");

    const imgUrl = renderTicketImage(card, 30);

    wrap.innerHTML = `
      <div class="ticket-img-wrap">
        <img class="ticket-img" src="${imgUrl}" alt="ticket"/>
        <div class="ticket-img-note muted tiny">${disabled ? "Đã có người chọn" : "Click để chọn tờ này"}</div>
      </div>
    `;

    wrap.addEventListener("click", () => {
      if (room.status !== "waiting") return;
      if (me?.eliminated) return;
      if (disabled) return;
      socket.emit("card:select", { roomId: room.id, cardId: card.id });
    });

    deckGrid.appendChild(wrap);
  });

  renderChat();
}

function renderGame(room) {
  const me = room.players.find((p) => p.id === selfId);

  currentNumber.textContent = room.currentNumber ?? "--";

  // History
  historyNumbers.innerHTML = "";
  const hist = room.calledNumbers.slice().reverse();
  hist.forEach((n, idx) => {
    const d = document.createElement("div");
    d.className = "hnum" + (idx === 0 ? " latest" : "");
    d.textContent = n;
    historyNumbers.appendChild(d);
  });

  // Scoreboard
  scoreBoard.innerHTML = "";
  room.players
    .slice()
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .forEach((p) => {
      const row = document.createElement("div");
      row.className = "player-row";
      const tags = [];
      if (p.isHost) tags.push(`<span class="tag host">Chủ phòng</span>`);
      if (p.eliminated) tags.push(`<span class="tag elim">Bị loại</span>`);
      row.innerHTML = `
        <div>
          <div class="player-name">${escapeHtml(p.name)} <span class="muted small">• ${p.score} điểm</span></div>
          <div class="player-tags">${tags.join("")}</div>
        </div>
        <div class="muted small">${p.cardId ? `Tờ: <b>${p.cardId}</b>` : "Chưa chọn"}</div>
      `;
      scoreBoard.appendChild(row);
    });

  // My ticket as IMAGE + overlay click
  myCardGrid.innerHTML = "";

  if (!me?.cardId) {
    myCardMeta.textContent = "Bạn chưa chọn tờ dò.";
  } else {
    const c = deck.find((x) => x.id === me.cardId);
    const card = c || { id: me.cardId, title: "LÔ TÔ", colorLabel: "", variant: "", blocks: [[], [], []] };
    myCardMeta.textContent = c ? `${c.colorLabel} ${c.variant} • ID ${c.id}` : `ID ${me.cardId}`;

    const imgUrl = renderTicketImage(card, 48);
    const canInteract = !me.eliminated && room.status === "playing";

    const wrap = document.createElement("div");
    wrap.className = "ticketPlayWrap";

    const img = document.createElement("img");
    img.className = "ticketPlayImg";
    img.src = imgUrl;

    const overlay = document.createElement("div");
    overlay.className = "ticketOverlay" + (canInteract ? "" : " disabled");

    const blocks = card.blocks || [[], [], []];
    const grids = blocks.map((b) => buildBlockGrid15(b || []));

    // 9 rows total, but we also insert 2 spacer rows => total 11 overlay rows
    // We build row by row, inserting spacers after rr=2 and rr=5
    for (let rr = 0; rr < 9; rr++) {
      for (let cc = 0; cc < 9; cc++) {
        const b = Math.floor(rr / 3);
        const r = rr % 3;
        const val = grids[b]?.[r]?.[cc] ?? null;

        const cell = document.createElement("div");
        cell.className = "ovCell" + (val === null ? " blank" : " num");

        if (val !== null) {
          if (myMarked.has(val)) cell.classList.add("marked");
          cell.title = String(val);

          if (canInteract) {
            cell.addEventListener("click", () => {
              if (myMarked.has(val)) myMarked.delete(val);
              else myMarked.add(val);
              renderGame(room);
            });
          }
        }
        overlay.appendChild(cell);
      }

      if (rr === 2 || rr === 5) {
        for (let i = 0; i < 9; i++) {
          const sp = document.createElement("div");
          sp.className = "ovCell spacer";
          overlay.appendChild(sp);
        }
      }
    }

    wrap.appendChild(img);
    wrap.appendChild(overlay);
    myCardGrid.appendChild(wrap);
  }

  // Status + claim button
  if (room.status === "playing") {
    statusBadge.textContent = me?.eliminated ? "Bị loại" : "Đang chơi";
  } else if (room.status === "ended") {
    statusBadge.textContent = "Kết thúc ván";
  } else {
    statusBadge.textContent = "Chờ";
  }

  btnClaim.disabled = !me || me.eliminated || room.status !== "playing";
  btnClaim.textContent = me?.eliminated ? "Bạn đã bị loại" : "Báo KINH";

  renderChat();
}

function renderChat() {
  const html = chatMessages
    .map(
      (m) => `
    <div class="msg">
      <div class="meta">${escapeHtml(m.from)} • ${formatTime(m.at)}</div>
      <div>${escapeHtml(m.text)}</div>
    </div>
  `
    )
    .join("");

  if (chatBoxLobby) chatBoxLobby.innerHTML = html;
  if (chatBoxGame) chatBoxGame.innerHTML = html;
  if (chatBoxModal) chatBoxModal.innerHTML = html;

  [chatBoxLobby, chatBoxGame, chatBoxModal].forEach((box) => {
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  });
}

// ===== UI Events =====
goCreate.addEventListener("click", () => {
  if (!ensureName()) return;
  setView("create");
});
goJoin.addEventListener("click", () => {
  if (!ensureName()) return;
  setView("join");
  renderRooms();
});

document.querySelectorAll("[data-back]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const to = btn.getAttribute("data-back");
    setView(to);
  });
});

btnCreateRoom.addEventListener("click", () => {
  const name = ensureName();
  if (!name) return;

  const roomName = (inputRoomName.value || "").trim();
  const maxPlayers = Number(inputMaxPlayers.value || 2);

  socket.emit("room:create", { playerName: name, roomName, maxPlayers });
});

btnStartGame.addEventListener("click", () => {
  if (!currentRoom) return;
  socket.emit("game:start", { roomId: currentRoom.id });
});

btnResetGame.addEventListener("click", () => {
  if (!currentRoom) return;
  socket.emit("game:reset", { roomId: currentRoom.id });
});

btnClaim.addEventListener("click", () => {
  if (!currentRoom) return;
  socket.emit("game:claim", { roomId: currentRoom.id });
});

btnLeaveRoom.addEventListener("click", () => {
  if (!currentRoom) return;
  socket.emit("room:leave", { roomId: currentRoom.id });
  currentRoom = null;
  selfId = null;
  chatMessages = [];
  myMarked = new Set();
  setView("home");
});

btnOpenChat.addEventListener("click", openChatModal);
btnCloseChat.addEventListener("click", closeChatModal);
chatModal.addEventListener("click", (e) => {
  if (e.target === chatModal) closeChatModal();
});

function wireChat(inputEl, sendBtn) {
  const send = () => {
    if (!currentRoom) return;
    const text = (inputEl.value || "").trim();
    if (!text) return;
    socket.emit("chat:send", { roomId: currentRoom.id, text });
    inputEl.value = "";
  };
  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
}

wireChat(chatInputLobby, chatSendLobby);
wireChat(chatInputGame, chatSendGame);
wireChat(chatInputModal, chatSendModal);

// ===== Socket Events =====
socket.on("deck:list", (d) => {
  deck = d || [];
  ticketImageCache.clear();
});

socket.on("rooms:list", (list) => {
  rooms = list || [];
  if (currentView === "join") renderRooms();
});

socket.on("toast", ({ type, message }) => {
  showToast(type, message);
});

socket.on("room:joined", ({ room, selfId: sid }) => {
  selfId = sid;
  currentRoom = room;
  myMarked = new Set();
  chatMessages = [];
  setView("lobby");
  renderLobby(room);
});

socket.on("lobby:update", (room) => {
  currentRoom = room;
  if (currentView !== "lobby") setView("lobby");
  renderLobby(room);
});

socket.on("game:update", (room) => {
  currentRoom = room;
  if (room.status === "playing") {
    if (currentView !== "game") setView("game");
    renderGame(room);
  } else {
    if (currentView !== "lobby") setView("lobby");
    renderLobby(room);
  }
});

socket.on("round:ended", ({ room, reason }) => {
  currentRoom = room;
  const winner = reason?.winnerName ? `🎉 ${reason.winnerName} KINH đúng! (+1 điểm)` : "Ván kết thúc.";
  showToast("ok", winner);
  setView("lobby");
  renderLobby(room);
});

socket.on("kicked", ({ message }) => {
  showToast("error", message || "Bạn đã bị kick.");
  currentRoom = null;
  selfId = null;
  chatMessages = [];
  myMarked = new Set();
  setView("home");
});

socket.on("chat:msg", (msg) => {
  chatMessages.push(msg);
  if (chatMessages.length > 200) chatMessages.shift();
  renderChat();
});

// ===== Init =====
setView("home");
