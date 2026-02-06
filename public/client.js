const socket = io();

// ===== State =====
let deck = [];
let rooms = [];
let currentView = "home";

let selfId = null;
let currentRoom = null; // room public object
let myMarked = new Set(); // local tick only
let chatMessages = []; // shared render for all chat boxes

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

function openChatModal() {
  chatModal.classList.remove("hidden");
  renderChat();
}
function closeChatModal() {
  chatModal.classList.add("hidden");
}

// ===== Renderers =====
function renderRooms() {
  roomsList.innerHTML = "";
  if (!rooms.length) {
    roomsList.innerHTML = `<div class="muted small">Chưa có phòng nào. Hãy tạo phòng mới.</div>`;
    return;
  }

  for (const r of rooms) {
    const pillClass = r.status === "Đang chờ" ? "wait" : (r.status === "Đang chơi" ? "play" : "end");
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
  const host = room.players.find(p => p.id === room.hostId);
  lobbyRoomMeta.innerHTML = `Mã: <b>${room.id}</b> • ${room.players.length}/${room.maxPlayers} người • Chủ phòng: <b>${escapeHtml(host?.name || "?" )}</b>`;

  const me = room.players.find(p => p.id === selfId);
  const iAmHost = selfId === room.hostId;

  // Start button only for host, enabled only if everyone selected
  const allSelected = room.players.length >= 2 && room.players.every(p => !!p.cardId);
  btnStartGame.classList.toggle("hidden", !iAmHost || room.status !== "waiting");
  btnStartGame.disabled = !allSelected;

  btnResetGame.classList.toggle("hidden", !iAmHost || room.status !== "ended");

  // Players list
  playersList.innerHTML = "";
  room.players.forEach(p => {
    const row = document.createElement("div");
    row.className = "player-row";
    const tags = [];
    if (p.isHost) tags.push(`<span class="tag host">Chủ phòng</span>`);
    if (p.eliminated) tags.push(`<span class="tag elim">Bị loại</span>`);
    if (p.cardId) tags.push(`<span class="tag ready">Đã chọn</span>`);
    else tags.push(`<span class="tag wait">Chưa chọn</span>`);

    const canKick = iAmHost && room.status === "waiting" && !p.isHost && !p.cardId; // only those not selected
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

  // Deck grid
  deckGrid.innerHTML = "";
  deck.forEach(card => {
    const used = room.usedCardIds.includes(card.id);
    const selectedByMe = me?.cardId === card.id;
    const disabled = used && !selectedByMe;

    const wrap = document.createElement("div");
    wrap.className = "deck-card" + (selectedByMe ? " selected" : "") + (disabled ? " disabled" : "");
    wrap.innerHTML = `
      <div class="deck-title">
        <div class="deck-name">${escapeHtml(card.colorLabel)} ${card.variant}</div>
        <div class="deck-color">ID: ${card.id}</div>
      </div>
      <div class="deck-mini">
        ${card.numbers.slice(0, 10).map(n => `<div class="mini-cell">${n}</div>`).join("")}
      </div>
      <div class="muted tiny" style="margin-top:8px">* 15 số (preview 10)</div>
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
  const me = room.players.find(p => p.id === selfId);
  const iAmHost = selfId === room.hostId;

  currentNumber.textContent = room.currentNumber ?? "--";

  // History (latest highlighted)
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
    .sort((a,b) => (b.score - a.score) || a.name.localeCompare(b.name))
    .forEach(p => {
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

  // My card grid
  myCardGrid.innerHTML = "";
  myMarked = myMarked || new Set();

  if (!me?.cardId) {
    myCardMeta.textContent = "Bạn chưa chọn tờ dò.";
  } else {
    const c = deck.find(x => x.id === me.cardId);
    myCardMeta.textContent = c ? `${c.colorLabel} ${c.variant} • ID ${c.id}` : `ID ${me.cardId}`;
    const numbers = c?.numbers || [];
    numbers.forEach((n) => {
      const cell = document.createElement("div");
      cell.className = "cell" + (myMarked.has(n) ? " marked" : "");
      cell.textContent = n;

      const canInteract = !me.eliminated && room.status === "playing";
      if (canInteract) {
        cell.addEventListener("click", () => {
          if (myMarked.has(n)) myMarked.delete(n);
          else myMarked.add(n);
          renderGame(room); // local rerender for tick
        });
      } else {
        cell.style.opacity = "0.6";
        cell.style.cursor = "not-allowed";
      }
      myCardGrid.appendChild(cell);
    });
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

  // Host reset button shows in lobby view, not here; but we keep UI consistent
  renderChat();
}

function renderChat() {
  const html = chatMessages.map(m => `
    <div class="msg">
      <div class="meta">${escapeHtml(m.from)} • ${formatTime(m.at)}</div>
      <div>${escapeHtml(m.text)}</div>
    </div>
  `).join("");

  if (chatBoxLobby) chatBoxLobby.innerHTML = html;
  if (chatBoxGame) chatBoxGame.innerHTML = html;
  if (chatBoxModal) chatBoxModal.innerHTML = html;

  // Auto scroll down
  [chatBoxLobby, chatBoxGame, chatBoxModal].forEach(box => {
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

document.querySelectorAll("[data-back]").forEach(btn => {
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
    // ended or waiting -> show lobby
    if (currentView !== "lobby") setView("lobby");
    renderLobby(room);
  }
});

socket.on("round:ended", ({ room, reason }) => {
  currentRoom = room;

  const winner = reason?.winnerName ? `🎉 ${reason.winnerName} KINH đúng! (+1 điểm)` : "Ván kết thúc.";
  showToast("ok", winner);

  // Back to lobby where host can reset for new round
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
  // Keep last 200
  if (chatMessages.length > 200) chatMessages.shift();
  renderChat();
});

// ===== Init =====
setView("home");
