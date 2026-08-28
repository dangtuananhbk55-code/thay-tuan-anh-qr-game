
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// =====================================================
// LOGIC V5
// =====================================================
// Mỗi lần mở trang bình chọn = 1 lượt tham gia mới.
// Cùng một điện thoại vào lần 2/lần 3 vẫn được tính là lượt mới.
// Nếu lượt đó bấm CÓ -> giữ lại vĩnh viễn cho đến RESET.
// Nếu lượt đó chưa bấm CÓ và rời trang -> sau 30 giây mới loại khỏi mẫu số.

const sessions = new Map();
// sessionId -> {
//   socketId: string|null,
//   votedYes: boolean,
//   counted: boolean
// }

const leaveTimers = new Map();
let noAttempts = 0;

const LEAVE_GRACE_MS = 30000; // 30 giây

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
    noAttempts
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
  if (!s) return;

  // Đã bấm CÓ -> giữ lại vĩnh viễn đến RESET
  if (s.votedYes) return;

  const timer = setTimeout(() => {
    const current = sessions.get(sessionId);
    if (!current) return;

    // Chỉ loại nếu:
    // - chưa bấm CÓ
    // - không còn kết nối
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

app.get("/host", (req, res) => {
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

  // Mỗi lần mở trang sẽ gửi 1 sessionId MỚI.
  socket.on("joinSession", (sessionId) => {
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

  // KHÔNG chỉ làm game vui, không ghi nhận phiếu.
  socket.on("tryNo", () => {
    noAttempts += 1;
    broadcast();
  });

  socket.on("resetPoll", () => {
    for (const timer of leaveTimers.values()) {
      clearTimeout(timer);
    }

    leaveTimers.clear();
    sessions.clear();
    noAttempts = 0;

    io.emit("pollReset");
    broadcast();
  });

  socket.on("disconnect", () => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;

    const s = sessions.get(sessionId);
    if (!s) return;

    s.socketId = null;

    // Nếu đã bấm CÓ -> giữ nguyên.
    // Nếu chưa bấm CÓ -> bắt đầu đếm 30 giây.
    if (!s.votedYes) {
      scheduleRemovalIfUnvoted(sessionId);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`QR poll V5 running on port ${PORT}`);
});
