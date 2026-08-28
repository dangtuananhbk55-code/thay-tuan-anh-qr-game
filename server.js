
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let state = { yesCount: 0, noClicks: 0 };

function broadcast() {
  io.emit("state", state);
}

// Trang người chơi
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Màn hình máy chiếu
app.get("/host", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "host.html"));
});

// QR luôn trỏ về trang người chơi công khai
app.get("/qr", async (req, res) => {
  try {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const playerUrl = `${protocol}://${host}/`;

    const png = await QRCode.toBuffer(playerUrl, {
      width: 700,
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

io.on("connection", (socket) => {
  socket.emit("state", state);

  socket.on("yes", () => {
    state.yesCount += 1;
    broadcast();
  });

  socket.on("no", () => {
    state.noClicks += 1;
    broadcast();
  });

  socket.on("reset", () => {
    state = { yesCount: 0, noClicks: 0 };
    broadcast();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
