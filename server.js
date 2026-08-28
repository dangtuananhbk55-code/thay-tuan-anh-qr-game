
const express = require("express");
const http = require("http");
const os = require("os");
const { Server } = require("socket.io");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let state = { yesCount: 0, noClicks: 0 };

function broadcast() {
  io.emit("state", state);
}

function getLocalIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

app.get("/info", (req, res) => {
  const ip = getLocalIPv4();
  const port = process.env.PORT || 3000;
  res.json({
    playerUrl: `http://${ip}:${port}/`,
    hostUrl: `http://${ip}:${port}/host`
  });
});

app.get("/qr", async (req, res) => {
  try {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.get("host");
    const playerUrl = `${protocol}://${host}/`;
    const png = await QRCode.toBuffer(playerUrl, { width: 600, margin: 2 });
    res.type("png").send(png);
  } catch (err) {
    res.status(500).send("QR error");
  }
});

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
  const ip = getLocalIPv4();
  console.log("");
  console.log("==============================================");
  console.log("  MINI-GAME QR - THAY TUAN ANH");
  console.log("==============================================");
  console.log(`Trang người chơi : http://${ip}:${PORT}/`);
  console.log(`Màn hình máy chiếu: http://${ip}:${PORT}/host`);
  console.log("==============================================");
  console.log("Máy chiếu và điện thoại phải cùng Wi-Fi.");
  console.log("");
});
