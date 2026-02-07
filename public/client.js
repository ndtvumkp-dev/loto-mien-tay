/* global io */
const socket = io();

const $ = (sel) => document.querySelector(sel);

let deck = [];
let rooms = [];
let room = null;
let selfId = null;

// tick local (mỗi người tự tick, không sync)
let marked = new Set(); // Set<number>
let lastToastTimer = null;

function toast(type, message) {
  if (lastToastTimer) clearTimeout(lastToastTimer);
  const old = $(".toast");
  if (old) old.remove();

  const el = document.createElement("div");
  el.className = `toast ${type || ""}`;
  el.textContent = message || "";
  document.body.appendChild(el);

  lastToastTimer = setTimeout(() => el.remove(), 2200);
}

function setView(html) {
  $("#app").innerHTML = html;
}

function topbar() {
  return `
    <div class="topbar">
      <div class="brand">
        <div class="logo">LT</div>
        <div class="title">
          <b>Lô-tô Miền Tây</b>
          <span>Online • Real-time • Team Play</span>
        </div>
      </div>
      <div class="actions">
        ${room ? `<button class="btn small" id="btnChatToggle">Chat</button>` : ``}
        ${room ? `<button class="btn danger small" id="btnLeave">Thoát phòng</button>` : ``}
      </div>
    </div>
  `;
}

/* ========= Views ========= */

function viewHome() {
  setView(`
    <div class="container">
      ${topbar()}
      <div class="card pad">
        <div class="row">
          <div class="field" style="min-width:260px; flex:1;">
            <label>Tên của bạn</label>
            <input class="input" id="playerName" placeholder="Nhập tên..." />
          </div>
        </div>
        <div class="hr"></div>
        <div class="row">
          <button class="btn primary" id="btnGoCreate">Tạo phòng</button>
          <button class="btn" id="btnGoJoin">Tham gia phòng</button>
        </div>
      </div>

      <div class="footer">Designed by NDTV</div>
    </div>
  `);

  $("#btnGoCreate").onclick = () => viewCreate();
  $("#btnGoJoin").onclick = () => viewJoin();
}

function viewCreate() {
  setView(`
    <div class="container">
      ${topbar()}
      <div class="card pad">
        <h3 style="margin:0 0 8px;">Tạo phòng</h3>
        <div class="row">
          <div class="field" style="min-width:240px; flex:1;">
            <label>Tên của bạn</label>
            <input class="input" id="playerName" placeholder="Nhập tên..." />
          </div>
          <div class="field" style="min-width:240px; flex:1;">
            <label>Tên phòng</label>
            <input class="input" id="roomName" placeholder="VD: Team Marketing" />
          </div>
          <div class="field" style="min-width:160px;">
            <label>Số người (2–10)</label>
            <select class="select" id="maxPlayers">
              ${Array.from({ length: 9 }, (_, i) => i + 2)
                .map((n) => `<option value="${n}">${n}</option>`)
                .join("")}
            </select>
          </div>
        </div>
        <div class="hr"></div>
        <div class="row">
          <button class="btn primary" id="btnCreate">Tạo & vào phòng</button>
          <button class="btn" id="btnBack">Quay lại</button>
        </div>
      </div>
    </div>
  `);

  $("#btnBack").onclick = () => viewHome();
  $("#btnCreate").onclick = () => {
    const playerName = $("#playerName").value.trim();
    const roomName = $("#roomName").value.trim();
    const maxPlayers = Number($("#maxPlayers").value);
    socket.emit("room:create", { playerName, roomName, maxPlayers });
  };
}

function viewJoin() {
  setView(`
    <div class="container">
      ${topbar()}
      <div class="card pad">
        <h3 style="margin:0 0 8px;">Tham gia phòng</h3>
        <div class="row">
          <div class="field" style="min-width:240px; flex:1;">
            <label>Tên của bạn</label>
            <input class="input" id="playerName" placeholder="Nhập tên..." />
          </div>
          <div class="field" style="min-width:240px; flex:1;">
            <label>Mã phòng</label>
            <input class="input" id="roomId" placeholder="VD: DF2AKG" />
          </div>
          <button class="btn primary" id="btnJoin">Vào phòng</button>
          <button class="btn" id="btnBack">Quay lại</button>
        </div>

        <div class="hr"></div>
        <div class="muted" style="margin-bottom:10px;">Danh sách phòng đang có:</div>
        <div id="roomsList" class="row" style="align-items:stretch;"></div>
      </div>
    </div>
  `);

  $("#btnBack").onclick = () => viewHome();
  $("#btnJoin").onclick = () => {
    const playerName = $("#playerName").value.trim();
    const roomId = $("#roomId").value.trim().toUpperCase();
    socket.emit("room:join", { playerName, roomId });
  };

  renderRoomsList();
}

function renderRoomsList() {
  const el = $("#roomsList");
  if (!el) return;
  el.innerHTML = "";

  const list = rooms.slice().filter((r) => r.status === "Đang chờ");
  if (!list.length) {
    el.innerHTML = `<div class="muted">Chưa có phòng đang chờ.</div>`;
    return;
  }

  list.forEach((r) => {
    const box = document.createElement("div");
    box.className = "card pad";
    box.style.width = "min(360px, 100%)";
    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px;">
        <div style="display:grid; gap:4px;">
          <b>${escapeHtml(r.name)}</b>
          <div class="muted" style="font-size:12px;">Mã: <b>${r.id}</b> • ${r.playerCount}/${r.maxPlayers} • ${r.status}</div>
        </div>
        <button class="btn small primary">Vào</button>
      </div>
    `;
    box.querySelector("button").onclick = () => {
      $("#roomId").value = r.id;
    };
    el.appendChild(box);
  });
}

function viewLobby() {
  if (!room) return viewHome();

  const isHost = room.hostId === selfId;

  setView(`
    <div class="container">
      ${topbar()}
      <div class="game-layout">
        <div class="left-stack">
          <div class="card pad">
            <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
              <div style="display:grid; gap:4px;">
                <b style="font-size:18px;">Phòng: ${escapeHtml(room.name)}</b>
                <div class="muted" style="font-size:12px;">
                  Mã: <b>${room.id}</b> • ${room.players.length}/${room.maxPlayers} •
                  <span class="badge ${room.status === "waiting" ? "good" : "warn"}">${room.status === "waiting" ? "Đang chờ" : "Đang chơi"}</span>
                </div>
              </div>
              ${
                isHost
                  ? `<button class="btn primary" id="btnStart" ${allSelected(room) ? "" : "disabled"}>Bắt đầu</button>`
                  : `<span class="badge">Chờ chủ phòng</span>`
              }
            </div>

            <div class="hr"></div>

            <div style="font-weight:700; margin-bottom:8px;">Người chơi</div>
            <div class="scoreList" id="playersList"></div>
          </div>
        </div>

        <div class="right-stack">
          <div class="card pad">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <div>
                <b>Chọn tờ dò (duy nhất)</b>
                <div class="muted" style="font-size:12px; margin-top:4px;">
                  Mỗi tờ chỉ 1 người được chọn. Chủ phòng chỉ bắt đầu khi mọi người đã chọn xong.
                </div>
              </div>
              <span class="badge">10 tờ • 5 cặp màu</span>
            </div>

            <div class="hr"></div>

            <div class="row" id="cardsList" style="align-items:stretch;"></div>
          </div>

          <div class="card pad">
            <b>Hướng dẫn nhanh</b>
            <div class="muted" style="font-size:13px; margin-top:8px; line-height:1.55;">
              1. Chọn 1 tờ dò (không trùng).<br/>
              2. Chờ chủ phòng bấm <b>Bắt đầu</b>.<br/>
              3. Khi số được call, bạn tự tick trên tờ dò.<br/>
              4. Khi tin là đã “KINH”, bấm <b>Báo KINH</b> (hệ thống sẽ quét đúng/sai).<br/>
              5. Báo sai → bị loại (chỉ xem + chat). Báo đúng → +1 điểm và kết thúc ván.
            </div>
          </div>
        </div>
      </div>
    </div>
  `);

  $("#btnLeave")?.addEventListener("click", leaveRoom);

  if (isHost) {
    const btnStart = $("#btnStart");
    if (btnStart) {
      btnStart.onclick = () => socket.emit("game:start", { roomId: room.id });
    }
  }

  renderLobbyPlayers();
  renderCardsForLobby();
}

function renderLobbyPlayers() {
  const list = $("#playersList");
  if (!list) return;

  const isHost = room.hostId === selfId;

  list.innerHTML = "";
  room.players.forEach((p) => {
    const row = document.createElement("div");
    row.className = "scoreItem";
    row.innerHTML = `
      <div class="left">
        <b>${escapeHtml(p.name)} ${p.isHost ? `<span class="badge" style="margin-left:6px;">Chủ phòng</span>` : ""}</b>
        <span>${p.cardId ? `Đã chọn: <b>${escapeHtml(p.cardId)}</b>` : `Chưa chọn`}</span>
      </div>
      <div class="right">
        ${
          isHost && !p.isHost && !p.cardId
            ? `<button class="btn small danger" data-kick="${p.id}">Kick</button>`
            : ``
        }
      </div>
    `;
    row.querySelector("[data-kick]")?.addEventListener("click", () => {
      socket.emit("lobby:kick", { roomId: room.id, targetId: p.id });
    });

    list.appendChild(row);
  });

  const btnStart = $("#btnStart");
  if (btnStart) btnStart.disabled = !allSelected(room);
}

function renderCardsForLobby() {
  const el = $("#cardsList");
  if (!el) return;

  el.innerHTML = "";

  deck.forEach((c) => {
    const used = room.usedCardIds.includes(c.id) && getMyCardId() !== c.id;

    const box = document.createElement("div");
    box.className = "card pad";
    box.style.width = "min(340px, 100%)";
    box.style.opacity = used ? "0.55" : "1";
    box.style.cursor = used ? "not-allowed" : "pointer";

    const preview = renderTicketMini(c);

    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <div>
          <b>${escapeHtml(c.title)}</b>
          <div class="muted" style="font-size:12px;">${escapeHtml(c.colorLabel)} ${c.variant} • ID: <b>${c.id}</b></div>
        </div>
        <span class="badge">${used ? "Đã có người chọn" : "Còn trống"}</span>
      </div>
      <div style="margin-top:10px;">${preview}</div>
      <div class="muted" style="margin-top:10px; font-size:12px; text-align:center;">
        ${used ? "Tờ này đã bị chọn" : "Click để chọn tờ này"}
      </div>
    `;

    if (!used) {
      box.onclick = () => {
        socket.emit("card:select", { roomId: room.id, cardId: c.id });
      };
    }

    el.appendChild(box);
  });
}

function renderTicketMini(card) {
  // mini 3 hàng đầu để preview nhanh
  const nums = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 9; c++) {
      nums.push(card.grid[r][c]);
    }
  }
  const html = `
    <div style="border-radius:14px; overflow:hidden; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.18); padding:10px;">
      <div style="display:grid; grid-template-columns:repeat(9, 1fr); gap:6px;">
        ${nums
          .map((n) => {
            if (n == null) return `<div style="height:28px;border-radius:8px;background:rgba(255,200,0,.18);"></div>`;
            return `<div style="height:28px;border-radius:8px;background:rgba(255,255,255,.10);display:grid;place-items:center;font-weight:800;">${n}</div>`;
          })
          .join("")}
      </div>
    </div>
  `;
  return html;
}

function viewGame() {
  if (!room) return viewHome();

  const me = room.players.find((p) => p.id === selfId);
  const myCard = deck.find((d) => d.id === me?.cardId);
  const eliminated = !!me?.eliminated;

  setView(`
    <div class="container">
      ${topbar()}
      <div class="game-layout">
        <!-- LEFT -->
        <div class="left-stack">
          <div class="card pad callCard">
            <div class="callHeader">
              <div>
                <div class="label">Số vừa call</div>
                <div class="callBig" id="currentNumber">${room.currentNumber ?? "—"}</div>
              </div>
              <button class="btn primary" id="btnClaim" ${eliminated ? "disabled" : ""}>Báo KINH</button>
            </div>

            <div class="hr"></div>

            <div style="font-weight:700; margin-bottom:8px;">Lịch sử số</div>
            <div class="history" id="history"></div>

            <div class="hr"></div>

            <div style="font-weight:700; margin-bottom:8px;">Bảng điểm</div>
            <div class="scoreList" id="score"></div>
          </div>
        </div>

        <!-- RIGHT -->
        <div class="right-stack">
          <div class="ticketWrap">
            ${
              myCard
                ? `
              <div class="ticketCard" data-color="${myCard.color}">
                <div class="ticketHeader">
                  <h2>${escapeHtml(myCard.title)}</h2>
                  <div class="sub">${escapeHtml(myCard.colorLabel)} ${myCard.variant} • ID: ${myCard.id}</div>
                </div>

                <div class="ticketGrid" id="ticketGrid"></div>
                <div class="ticketSplit"></div>
              </div>
              `
                : `<div class="card pad">Bạn chưa chọn tờ dò.</div>`
            }
          </div>

          <div class="card pad">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <b>Chat</b>
              <span class="badge ${eliminated ? "bad" : "good"}">${eliminated ? "Đã bị loại (chỉ chat)" : "Đang chơi"}</span>
            </div>

            <div class="hr"></div>

            <div class="chatBox" id="chatBox"></div>
            <div class="chatInputRow">
              <input class="input" id="chatInput" placeholder="Nhập tin nhắn..." />
              <button class="btn" id="chatSend">Gửi</button>
            </div>
            <div class="muted" style="font-size:12px; margin-top:8px;">
              * Tick chỉ để bạn theo dõi. Hệ thống chỉ quét khi bạn bấm “Báo KINH”.
            </div>
          </div>
        </div>
      </div>
    </div>
  `);

  $("#btnLeave")?.addEventListener("click", leaveRoom);

  $("#btnClaim")?.addEventListener("click", () => {
    socket.emit("game:claim", { roomId: room.id });
  });

  $("#chatSend")?.addEventListener("click", sendChat);
  $("#chatInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });

  renderHistory();
  renderScoreboard();
  renderTicket(myCard, eliminated);
}

function renderHistory() {
  const el = $("#history");
  if (!el) return;
  el.innerHTML = "";

  const arr = (room.calledNumbers || []).slice(-20).reverse();
  arr.forEach((n) => {
    const pill = document.createElement("div");
    pill.className = "pill";
    pill.textContent = n;
    el.appendChild(pill);
  });
}

function renderScoreboard() {
  const el = $("#score");
  if (!el) return;
  el.innerHTML = "";

  room.players.forEach((p) => {
    const row = document.createElement("div");
    row.className = "scoreItem";
    row.innerHTML = `
      <div class="left">
        <b>${escapeHtml(p.name)} ${p.isHost ? `<span class="badge" style="margin-left:6px;">Chủ phòng</span>` : ""}</b>
        <span>${p.eliminated ? "Đã bị loại" : "Đang chơi"} • Điểm: <b>${p.score || 0}</b></span>
      </div>
      <div class="right">Tờ: ${p.cardId ? escapeHtml(p.cardId) : "—"}</div>
    `;
    el.appendChild(row);
  });
}

function renderTicket(myCard, eliminated) {
  const gridEl = $("#ticketGrid");
  if (!gridEl || !myCard) return;

  gridEl.innerHTML = "";

  // mỗi user tự tick => giữ marked theo số
  // nếu đổi tờ dò => reset marked
  // (đơn giản: reset khi vào game: marked = new Set())
  // => nếu bạn muốn giữ qua refresh thì có thể dùng localStorage sau.

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const n = myCard.grid[r][c];
      const cell = document.createElement("div");

      if (n == null) {
        cell.className = "cell empty";
      } else {
        cell.className = "cell num";
        cell.textContent = n;

        if (marked.has(n)) cell.classList.add("marked");

        if (!eliminated) {
          cell.addEventListener("click", () => {
            if (marked.has(n)) marked.delete(n);
            else marked.add(n);
            cell.classList.toggle("marked");
          });
        } else {
          cell.style.cursor = "not-allowed";
          cell.style.opacity = "0.75";
        }
      }
      gridEl.appendChild(cell);
    }
  }
}

function sendChat() {
  const input = $("#chatInput");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  socket.emit("chat:send", { roomId: room.id, text });
  input.value = "";
}

function appendChat(from, text) {
  const box = $("#chatBox");
  if (!box) return;
  const p = document.createElement("p");
  p.className = "chatMsg";
  p.innerHTML = `<b>${escapeHtml(from)}:</b> ${escapeHtml(text)}`;
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}

/* ========= Helpers ========= */

function allSelected(roomObj) {
  return roomObj.players.length >= 2 && roomObj.players.every((p) => !!p.cardId);
}

function getMyCardId() {
  const me = room?.players?.find((p) => p.id === selfId);
  return me?.cardId || null;
}

function leaveRoom() {
  if (!room) return;
  socket.emit("room:leave", { roomId: room.id });
  room = null;
  selfId = null;
  marked = new Set();
  viewHome();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ========= Socket Events ========= */

socket.on("deck:list", (d) => {
  deck = d || [];
});

socket.on("rooms:list", (list) => {
  rooms = list || [];
  renderRoomsList();
});

socket.on("toast", ({ type, message }) => toast(type, message));

socket.on("room:joined", ({ room: r, selfId: sid }) => {
  room = r;
  selfId = sid;
  marked = new Set(); // reset tick mỗi ván
  if (room.status === "waiting") viewLobby();
  else viewGame();
});

socket.on("lobby:update", (r) => {
  room = r;
  if (room.status === "waiting") viewLobby();
  else viewGame();
});

socket.on("game:update", (r) => {
  room = r;
  // update nhẹ UI nếu đang ở game
  if (!$("#ticketGrid")) {
    viewGame();
    return;
  }
  $("#currentNumber").textContent = room.currentNumber ?? "—";
  renderHistory();
  renderScoreboard();

  const me = room.players.find((p) => p.id === selfId);
  const myCard = deck.find((d) => d.id === me?.cardId);
  renderTicket(myCard, !!me?.eliminated);
});

socket.on("round:ended", ({ reason }) => {
  const winner = reason?.winnerName || null;
  toast("success", winner ? `✅ ${winner} đã KINH!` : "✅ Hết số, kết thúc ván!");
});

socket.on("kicked", ({ message }) => {
  toast("error", message || "Bạn đã bị kick.");
  room = null;
  selfId = null;
  marked = new Set();
  viewHome();
});

socket.on("chat:msg", (msg) => {
  appendChat(msg.from, msg.text);
});

/* ========= Start ========= */
viewHome();
