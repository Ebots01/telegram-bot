// index.js
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors());

// === CONFIGURATION ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const PORT = process.env.PORT || 3000;

// Render's temporary filesystem
const UPLOAD_DIR = path.join("/tmp", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// === IN-MEMORY STORAGE (Replaces MongoDB) ===
// This stores our active PINs and filenames. Wiped when server restarts.
const activeFiles = new Map(); 
let activityLog = [];

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// === HELPERS ===
function generatePin() {
  let pin;
  do {
    pin = Math.floor(1000 + Math.random() * 9000).toString();
  } while (activeFiles.has(pin)); // Ensure no duplicate PINs
  return pin;
}

function log(msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ${msg}`);
  activityLog.unshift(`[${time}] ${msg}`);
  if (activityLog.length > 50) activityLog.pop();
}

async function handleTelegramFile(msg) {
  const chatId = msg.chat.id;
  const fileId = msg.document ? msg.document.file_id : msg.photo[msg.photo.length - 1].file_id;
  const originalName = msg.document ? msg.document.file_name : `photo_${Date.now()}.jpg`;
  
  try {
    log(`⏳ Downloading ${originalName} from Telegram...`);
    const fileUrl = await bot.getFileLink(fileId);
    
    // Download from Telegram
    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Generate PIN and save file
    const pin = generatePin();
    const ext = path.extname(originalName) || ".jpg";
    const newFileName = `${pin}${ext}`;
    const filePath = path.join(UPLOAD_DIR, newFileName);

    fs.writeFileSync(filePath, buffer);
    
    // Save to our In-Memory Map
    activeFiles.set(pin, {
      filename: newFileName,
      original_name: originalName,
      time: new Date()
    });

    log(`✅ Saved: ${newFileName} for PIN ${pin}`);
    await bot.sendMessage(chatId, `✅ Received!\nYour PIN: *${pin}*\n\n_Note: This PIN will expire if the server goes to sleep._`, { parse_mode: 'Markdown' });
  } catch (err) {
    log(`❌ Download Error: ${err.message}`);
    await bot.sendMessage(chatId, "❌ Failed to save file. Try again.");
  }
}

// === TELEGRAM WEBHOOK ===
app.post("/telegram-webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.on('message', (msg) => {
  if (msg.document || msg.photo) {
    handleTelegramFile(msg);
  } else if (msg.text === "/start") {
    bot.sendMessage(msg.chat.id, "👋 Send me a document or photo to get a PIN for the kiosk!");
  }
});

// === FLUTTER APP APIs ===

// 1. Polling Endpoint: Returns list of active files
app.get("/api/files", (req, res) => {
  const files = Array.from(activeFiles.entries()).map(([pin, data]) => ({
    pin: pin,
    fileName: data.filename
  }));
  res.json(files);
});

// 2. Serve the actual files so Flutter can download them
app.use("/files", express.static(UPLOAD_DIR));

// 3. Verify PIN (Flutter app calls this to check if a PIN exists)
app.post("/verify-pin", (req, res) => {
  const { pin } = req.body;

  if (activeFiles.has(pin)) {
    const fileData = activeFiles.get(pin);
    // Send back the URL where Flutter can download the file
    return res.json({ 
      success: true, 
      fileUrl: `/files/${fileData.filename}`,
      filename: fileData.filename
    });
  } else {
    return res.json({ success: false, message: "Invalid or Expired PIN" });
  }
});

// 4. Burn PIN (Flutter app calls this AFTER printing to delete the file)
app.delete("/api/burn/:pin", (req, res) => {
  const { pin } = req.params;

  if (activeFiles.has(pin)) {
    const fileData = activeFiles.get(pin);
    const filePath = path.join(UPLOAD_DIR, fileData.filename);
    
    // Delete the physical file from the /tmp folder
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Remove the PIN from memory
    activeFiles.delete(pin);
    
    log(`🔥 Burned PIN: ${pin}. File deleted.`);
    res.json({ success: true, message: "File securely deleted" });
  } else {
    res.status(404).json({ error: "PIN not found" });
  }
});

// === STATUS DASHBOARD ===
app.get("/", (req, res) => {
  const currentFiles = Array.from(activeFiles.entries()).map(([pin, data]) => 
    `<li><strong>PIN ${pin}:</strong> ${data.original_name}</li>`
  ).join("");

  res.send(`
    <html>
      <head><title>Kiosk Monitor</title><meta http-equiv="refresh" content="10"></head>
      <body style="font-family:sans-serif; padding:20px; background:#f4f4f9;">
        <h1>🤖 Telegram Kiosk Server (In-Memory)</h1>
        
        <div style="background:white; padding:15px; border-radius:8px; margin-bottom:20px;">
          <h2>📂 Active PINs (${activeFiles.size})</h2>
          <ul>${currentFiles || "No active PINs."}</ul>
        </div>

        <div style="background:white; padding:15px; border-radius:8px;">
          <h2>📝 Live Logs</h2>
          <div style="font-family:monospace; font-size: 14px;">${activityLog.join("<br>")}</div>
        </div>
      </body>
    </html>
  `);
});

// Start Server
app.listen(PORT, () => {
  log(`🚀 Server running on port ${PORT}`);
});
