
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// =====================================================
// LOGIC V8
// =====================================================
// - Mỗi lần mở trang người chơi = 1 lượt tham gia mới.
// - Điện thoại có game CÓ/KHÔNG độc lập.
// - HOST cộng tổng số lần bấm KHÔNG của tất cả điện thoại.
// - Người chưa bấm CÓ mà thoát: sau 5 giây bị loại khỏi mẫu số.
// - Người đã bấm CÓ: giữ kết quả đến khi phiên kết thúc/reset.
// - FINISH: khóa phiên hiện tại, không nhận người/vote mới.
// - Sau FINISH, lần kế tiếp mở/F5 /host sẽ tự reset về phiên mới = 0.

let sessions = new Map();
// sessionId -> {
//   socketId: string|null,
//   votedYes: boolean,
//   counted: boolean
// }

let leaveTimers = new Map();
let globalNoAttempts = 0;
let pollFinished = false;

const LEAVE_GRACE_MS = 5000;

function clearAllLeaveTimers() {
  for (const timer of leaveTimers.values()) {
    clearTimeout(timer);
  }
  leaveTimers.clear();
}

function resetState() {
  clearAllLeaveTimers();
  sessions = new Map();
  globalNoAttempts = 0;
  pollFinished = false;
}

function getState() {
  let participants = 0;
  let yesCount = 0;

  for (const s of sessions.values()) {
    if (s.counted) participants++;
    if (s.votedYes) yesCount++;
  }

  const noCount = 0;
  const yesPercent = participants > 0
    ? Math.round((yesCount / participants) * 100)
    : 0;

  return {
    participants,
    yesCount,
    noCount,
    yesPercent,
    globalNoAttempts,
    pollFinished
  };
}

function broadcast() {
  io.emit("state", getState());
}

function cancelLeaveTimer(sessionId) {
  const timer = leaveTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    leaveTimers.delete(sessionId);
  }
}

function scheduleRemovalIfUnvoted(sessionId) {
  cancelLeaveTimer(sessionId);

  const s = sessions.get(sessionId);
  if (!s || s.votedYes || pollFinished) return;

  const timer = setTimeout(() => {
    if (pollFinished) {
      leaveTimers.delete(sessionId);
      return;
    }

    const current = sessions.get(sessionId);
    if (!current) return;

    if (!current.votedYes && !current.socketId) {
      current.counted = false;
      broadcast();
    }

    leaveTimers.delete(sessionId);
  }, LEAVE_GRACE_MS);

  leaveTimers.set(sessionId, timer);
}

// =====================================================
// ROUTES
// =====================================================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ĐẶC BIỆT:
// Nếu phiên trước đã FINISH, lần kế tiếp F5/mở lại /host
// sẽ tự reset toàn bộ dữ liệu về 0 rồi bắt đầu phiên mới.
app.get("/host", (req, res) => {
  if (pollFinished) {
    resetState();
    io.emit("pollReset");
    broadcast();
  }

  res.sendFile(path.join(__dirname, "public", "host.html"));
});

app.get("/qr", async (req, res) => {
  try {
    const protocol =
      req.headers["x-forwarded-proto"] || req.protocol || "https";
    const host =
      req.headers["x-forwarded-host"] || req.get("host");

    const playerUrl = `${protocol}://${host}/`;

    const png = await QRCode.toBuffer(playerUrl, {
      width: 800,
      margin: 2,
      errorCorrectionLevel: "M"
    });

    res.setHeader("Cache-Control", "no-store");
    res.type("png").send(png);
  } catch (err) {
    console.error("QR ERROR:", err);
    res.status(500).send("Không tạo được QR");
  }
});

app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// SOCKET.IO
// =====================================================
io.on("connection", (socket) => {
  socket.emit("state", getState());

  socket.on("joinSession", (sessionId) => {
    if (pollFinished) {
      socket.emit("pollClosed");
      socket.emit("state", getState());
      return;
    }

    if (typeof sessionId !== "string" || sessionId.length < 8) return;

    cancelLeaveTimer(sessionId);

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        socketId: socket.id,
        votedYes: false,
        counted: true
      });
    } else {
      const s = sessions.get(sessionId);
      s.socketId = socket.id;
      s.counted = true;
    }

    socket.data.sessionId = sessionId;

    const s = sessions.get(sessionId);

    socket.emit("joined", {
      sessionId,
      alreadyVotedYes: s.votedYes
    });

    broadcast();
  });

  socket.on("voteYes", (sessionId) => {
    if (pollFinished) {
      socket.emit("pollClosed");
      return;
    }

    if (typeof sessionId !== "string" || sessionId.length < 8) return;

    cancelLeaveTimer(sessionId);

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        socketId: socket.id,
        votedYes: true,
        counted: true
      });
    } else {
      const s = sessions.get(sessionId);
      s.socketId = socket.id;
      s.votedYes = true;
      s.counted = true;
    }

    socket.data.sessionId = sessionId;
    socket.emit("voteAccepted", { choice: "yes" });
    broadcast();
  });

  socket.on("tryNo", () => {
    if (pollFinished) {
      socket.emit("pollClosed");
      return;
    }

    globalNoAttempts += 1;
    broadcast();
  });

  // FINISH:
  // Khóa toàn bộ phiên hiện tại nhưng GIỮ kết quả trên màn hình.
  socket.on("finishPoll", () => {
    if (pollFinished) return;

    pollFinished = true;
    clearAllLeaveTimers();

    io.emit("pollFinished", getState());
    broadcast();
  });

  // RESET thủ công nếu cần chơi lại ngay mà không phải F5.
  socket.on("resetPoll", () => {
    resetState();
    io.emit("pollReset");
    broadcast();
  });

  socket.on("disconnect", () => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;

    const s = sessions.get(sessionId);
    if (!s) return;

    s.socketId = null;

    if (!s.votedYes && !pollFinished) {
      scheduleRemovalIfUnvoted(sessionId);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`QR poll V9 running on port ${PORT}`);
});
