const socket = io();

// ===== State =====
let deck = [];
let rooms = [];
let currentView = "home";

let selfId = null;
let currentRoom = null;
let myMarked = new Set();
let chatMessages = [];

// Cache ảnh vé
const ticketImageCache = new Map();
const ticketLayoutCache = new Map();

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
  localStorage.setItem("loto_name", name);
  return name;
}

function getSavedName() {
  return (localStorage.getItem("loto_name") || "").trim();
}

function findMe(room) {
  if (!room) return null;
  let me = room.players.find((p) => p.id === selfId);
  if (me) return me;

  const saved = getSavedName();
  if (saved) {
    me = room.players.find((p) => (p.name || "").trim() === saved);
    if (me) return me;
  }
  return null;
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

// ===== Loto helpers =====
function decadeCol(n) {
  if (n === 90) return 8;
  return Math.floor(n / 10);
}

// ✅ Build grid 9x9 từ rows (chính xác 5 số / hàng)
function gridFromRows(rows9) {
  const grid = Array.from({ length: 9 }, () => Array(9).fill(null));
  for (let r = 0; r < 9; r++) {
    const nums = rows9[r] || [];
    for (const n of nums) {
      const c = decadeCol(n);
      if (grid[r][c] === null) grid[r][c] = n;
      else {
        // fallback: đặt vào ô trống gần nhất
        let placed = false;
        for (let k = 1; k < 9; k++) {
          const left = c - k;
          const right = c + k;
          if (left >= 0 && grid[r][left] === null) { grid[r][left] = n; placed = true; break; }
          if (right < 9 && grid[r][right] === null) { grid[r][right] = n; placed = true; break; }
        }
        if (!placed) { /* ignore */ }
      }
    }
  }
  return grid;
}

// Lấy grid 3x9 cho block b (0..2)
function getBlockGrid(card, b) {
  // ưu tiên card.rows -> đúng layout mẫu
  if (card.rows && card.rows.length === 9) {
    const full = gridFromRows(card.rows);
    const start = b * 3;
    return [full[start], full[start + 1], full[start + 2]];
  }

  // fallback: nếu server gửi sẵn grid
  if (card.grid && card.grid.length === 9) {
    const start = b * 3;
    return [card.grid[start], card.grid[start + 1], card.grid[start + 2]];
  }

  // fallback cũ nếu vẫn dùng blocks
  return Array.from({ length: 3 }, () => Array(9).fill(null));
}

// ===== Ticket themes =====
function getThemeByColor(colorKey) {
  const themes = {
    red: {
      paperTop: "rgba(255,252,238,0.98)",
      paperBottom: "rgba(255,232,210,0.97)",
      border: "rgba(210,70,70,0.55)",
      dot: "rgba(170,40,40,0.10)",
      title: "rgba(70,10,10,0.88)",
      meta: "rgba(70,10,10,0.62)",
      blankTop: "rgba(255,115,115,0.95)",
      blankBottom: "rgba(255,75,105,0.90)",
      blankStroke: "rgba(120,20,30,0.25)",
      cellStroke: "rgba(120,40,40,0.18)",
    },
    blue: {
      paperTop: "rgba(255,252,240,0.98)",
      paperBottom: "rgba(255,235,200,0.97)",
      border: "rgba(70,130,255,0.55)",
      dot: "rgba(40,90,170,0.10)",
      title: "rgba(10,35,70,0.88)",
      meta: "rgba(10,35,70,0.62)",
      blankTop: "rgba(255,205,110,0.95)",
      blankBottom: "rgba(255,175,70,0.92)",
      blankStroke: "rgba(120,70,0,0.25)",
      cellStroke: "rgba(40,70,120,0.18)",
    },
    green: {
      paperTop: "rgba(246,255,248,0.98)",
      paperBottom: "rgba(214,245,224,0.97)",
      border: "rgba(45,180,120,0.55)",
      dot: "rgba(25,120,80,0.10)",
      title: "rgba(10,55,35,0.88)",
      meta: "rgba(10,55,35,0.62)",
      blankTop: "rgba(120,235,170,0.95)",
      blankBottom: "rgba(45,227,142,0.90)",
      blankStroke: "rgba(10,90,55,0.25)",
      cellStroke: "rgba(20,90,60,0.18)",
    },
    purple: {
      paperTop: "rgba(255,245,252,0.98)",
      paperBottom: "rgba(255,220,240,0.97)",
      border: "rgba(255,105,180,0.55)",
      dot: "rgba(170,60,120,0.10)",
      title: "rgba(80,20,50,0.88)",
      meta: "rgba(80,20,50,0.62)",
      blankTop: "rgba(255,140,200,0.95)",
      blankBottom: "rgba(255,90,170,0.90)",
      blankStroke: "rgba(120,35,80,0.25)",
      cellStroke: "rgba(120,50,90,0.18)",
    },
    orange: {
      paperTop: "rgba(255,252,240,0.98)",
      paperBottom: "rgba(255,232,180,0.97)",
      border: "rgba(255,176,32,0.55)",
      dot: "rgba(150,95,0,0.10)",
      title: "rgba(50,35,0,0.88)",
      meta: "rgba(50,35,0,0.62)",
      blankTop: "rgba(255,201,69,0.95)",
      blankBottom: "rgba(255,176,32,0.92)",
      blankStroke: "rgba(120,70,0,0.25)",
      cellStroke: "rgba(120,70,0,0.18)",
    },
  };
  return themes[colorKey] || themes.orange;
}

// ===== Ticket layout =====
function getTicketLayout(cellSize) {
  if (ticketLayoutCache.has(cellSize)) return ticketLayoutCache.get(cellSize);

  const pad = 16;
  const gapBlock = 14;
  const cellGap = 10;

  const cols = 9;
  const rowsPerBlock = 3;
  const blocks = 3;
  const headerH = 58;

  const w = pad * 2 + cols * cellSize + (cols - 1) * cellGap;
  const h =
    pad * 2 +
    headerH +
    (rowsPerBlock * blocks) * cellSize +
    ((rowsPerBlock * blocks) - 1) * cellGap +
    (blocks - 1) * gapBlock;

  const layout = { pad, gapBlock, cellGap, cols, rowsPerBlock, blocks, headerH, w, h, cellSize };
  ticketLayoutCache.set(cellSize, layout);
  return layout;
}

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

  const theme = getThemeByColor(card.color);
  const L = getTicketLayout(cellSize);

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(L.w * 2);
  canvas.height = Math.floor(L.h * 2);
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);

  const bg = ctx.createLinearGradient(0, 0, 0, L.h);
  bg.addColorStop(0, theme.paperTop);
  bg.addColorStop(1, theme.paperBottom);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, L.w, L.h, 18, true);

  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.border;
  roundRect(ctx, 1, 1, L.w - 2, L.h - 2, 18, false, true);

  ctx.fillStyle = theme.dot;
  for (let i = 10; i < L.w; i += 18) {
    ctx.fillRect(i, 10, 2, 2);
    ctx.fillRect(i, L.h - 12, 2, 2);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = theme.title;
  ctx.font = "900 22px 'Be Vietnam Pro', system-ui, sans-serif";
  ctx.fillText((card.title || "LÔ TÔ").toUpperCase(), L.w / 2, L.pad + 18);

  ctx.fillStyle = theme.meta;
  ctx.font = "800 12px 'Be Vietnam Pro', system-ui, sans-serif";
  ctx.fillText(`${card.colorLabel || ""} ${card.variant || ""} • ${card.id || ""}`, L.w / 2, L.pad + 38);

  const startX = L.pad;
  let y = L.pad + L.headerH;

  for (let b = 0; b < 3; b++) {
    const grid3 = getBlockGrid(card, b);

    ctx.fillStyle = "rgba(255,255,255,0.30)";
    roundRect(
      ctx,
      startX - 6,
      y - 6,
      L.cols * L.cellSize + (L.cols - 1) * L.cellGap + 12,
      L.rowsPerBlock * L.cellSize + (L.rowsPerBlock - 1) * L.cellGap + 12,
      14,
      true
    );
    ctx.strokeStyle = theme.cellStroke;
    ctx.lineWidth = 1;
    roundRect(
      ctx,
      startX - 6,
      y - 6,
      L.cols * L.cellSize + (L.cols - 1) * L.cellGap + 12,
      L.rowsPerBlock * L.cellSize + (L.rowsPerBlock - 1) * L.cellGap + 12,
      14,
      false,
      true
    );

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 9; c++) {
        const val = grid3[r][c];
        const x = startX + c * (L.cellSize + L.cellGap);
        const yy = y + r * (L.cellSize + L.cellGap);

        if (val === null) {
          const g = ctx.createLinearGradient(x, yy, x, yy + L.cellSize);
          g.addColorStop(0, theme.blankTop);
          g.addColorStop(1, theme.blankBottom);
          ctx.fillStyle = g;
          roundRect(ctx, x, yy, L.cellSize, L.cellSize, 10, true);
          ctx.strokeStyle = theme.blankStroke;
          ctx.lineWidth = 1;
          roundRect(ctx, x, yy, L.cellSize, L.cellSize, 10, false, true);
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          roundRect(ctx, x, yy, L.cellSize, L.cellSize, 10, true);
          ctx.strokeStyle = theme.cellStroke;
          ctx.lineWidth = 1;
          roundRect(ctx, x, yy, L.cellSize, L.cellSize, 10, false, true);

          ctx.fillStyle = "rgba(12,12,12,0.92)";
          ctx.font = `900 ${Math.max(14, Math.floor(L.cellSize * 0.46))}px 'Be Vietnam Pro', system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(val), x + L.cellSize / 2, yy + L.cellSize / 2 + 1);
        }
      }
    }

    y += 3 * L.cellSize + 2 * L.cellGap + L.gapBlock;
  }

  const url = canvas.toDataURL("image/png");
  ticketImageCache.set(cacheKey, url);
  return url;
}

// ===== Overlay percent positioning =====
function buildOverlayRects(card, cellSize) {
  const L = getTicketLayout(cellSize);

  // full grid 9x9 theo rows
  let fullGrid;
  if (card.rows && card.rows.length === 9) fullGrid = gridFromRows(card.rows);
  else if (card.grid && card.grid.length === 9) fullGrid = card.grid;
  else fullGrid = Array.from({ length: 9 }, () => Array(9).fill(null));

  const rects = [];
  const startX = L.pad;
  let y = L.pad + L.headerH;

  for (let b = 0; b < 3; b++) {
    const startRow = b * 3;
    for (let r = 0; r < 3; r++) {
      const rr = startRow + r;
      for (let c = 0; c < 9; c++) {
        const val = fullGrid[rr][c];
        if (val === null) continue;

        const x = startX + c * (L.cellSize + L.cellGap);
        const yy = y + r * (L.cellSize + L.cellGap);

        rects.push({
          val,
          left: (x / L.w) * 100,
          top: (yy / L.h) * 100,
          width: (L.cellSize / L.w) * 100,
          height: (L.cellSize / L.h) * 100,
        });
      }
    }
    y += 3 * L.cellSize + 2 * L.cellGap + L.gapBlock;
  }

  return rects;
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

function renderLobby(room) {
  lobbyRoomTitle.textContent = `Phòng: ${room.name}`;
  const host = room.players.find((p) => p.id === room.hostId);
  lobbyRoomMeta.innerHTML = `Mã: <b>${room.id}</b> • ${room.players.length}/${room.maxPlayers} người • Chủ phòng: <b>${escapeHtml(
    host?.name || "?"
  )}</b>`;

  const me = findMe(room);
  const iAmHost = (me?.id || selfId) === room.hostId;

  const allSelected = room.players.length >= 2 && room.players.every((p) => !!p.cardId);
  btnStartGame.classList.toggle("hidden", !iAmHost || room.status !== "waiting");
  btnStartGame.disabled = !allSelected;

  btnResetGame.classList.toggle("hidden", !iAmHost || room.status !== "ended");

  // Players
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

  // Deck
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
  const me = findMe(room);

  currentNumber.textContent = room.currentNumber ?? "--";

  // history
  historyNumbers.innerHTML = "";
  const hist = room.calledNumbers.slice().reverse();
  hist.forEach((n, idx) => {
    const d = document.createElement("div");
    d.className = "hnum" + (idx === 0 ? " latest" : "");
    d.textContent = n;
    historyNumbers.appendChild(d);
  });

  // scoreboard
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

  // my ticket
  myCardGrid.innerHTML = "";
  if (!me?.cardId) {
    myCardMeta.textContent = "Bạn chưa chọn tờ dò.";
  } else {
    const c = deck.find((x) => x.id === me.cardId);
    const card = c || { id: me.cardId, title: "LÔ TÔ", color: "orange", colorLabel: "", variant: "", rows: [] };
    myCardMeta.textContent = c ? `${c.colorLabel} ${c.variant} • ID ${c.id}` : `ID ${me.cardId}`;

    const renderCellSize = 48;
    const imgUrl = renderTicketImage(card, renderCellSize);
    const canInteract = !!me && !me.eliminated && room.status === "playing";

    const wrap = document.createElement("div");
    wrap.className = "ticketPlayWrap";

    const img = document.createElement("img");
    img.className = "ticketPlayImg";
    img.src = imgUrl;

    const overlay = document.createElement("div");
    overlay.className = "ticketOverlayAbs" + (canInteract ? "" : " disabled");

    const rects = buildOverlayRects(card, renderCellSize);

    rects.forEach(({ val, left, top, width, height }) => {
      const cell = document.createElement("div");
      cell.className = "ovAbsCell" + (myMarked.has(val) ? " marked" : "");
      cell.style.left = `${left}%`;
      cell.style.top = `${top}%`;
      cell.style.width = `${width}%`;
      cell.style.height = `${height}%`;
      cell.title = String(val);

      if (canInteract) {
        cell.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (myMarked.has(val)) myMarked.delete(val);
          else myMarked.add(val);
          renderGame(room);
        });
      }

      overlay.appendChild(cell);
    });

    wrap.appendChild(img);
    wrap.appendChild(overlay);
    myCardGrid.appendChild(wrap);
  }

  if (room.status === "playing") statusBadge.textContent = me?.eliminated ? "Bị loại" : "Đang chơi";
  else if (room.status === "ended") statusBadge.textContent = "Kết thúc ván";
  else statusBadge.textContent = "Chờ";

  btnClaim.disabled = !me || me.eliminated || room.status !== "playing";
  btnClaim.textContent = me?.eliminated ? "Bạn đã bị loại" : "Báo KINH";

  renderChat();
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

btnOpenChat.addEventListener("click", () => chatModal.classList.remove("hidden"));
btnCloseChat.addEventListener("click", () => chatModal.classList.add("hidden"));
chatModal.addEventListener("click", (e) => {
  if (e.target === chatModal) chatModal.classList.add("hidden");
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
  ticketLayoutCache.clear();
});

socket.on("rooms:list", (list) => {
  rooms = list || [];
  if (currentView === "join") renderRooms();
});

socket.on("toast", ({ type, message }) => showToast(type, message));

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
