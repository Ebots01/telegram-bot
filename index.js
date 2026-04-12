// backend/index.js

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// === CONFIG ===
const TOKEN = "";  // Replace with real BotFather token
const PORT = 3000;
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// In-memory "DB" (replace with MongoDB/MySQL later if needed)
let pinToFileMap = {};

// === TELEGRAM BOT ===
const bot = new TelegramBot(TOKEN, { polling: true });

// Generate random 4-digit PIN
function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Save file helper
async function saveFile(fileId, originalName, chatId) {
  try {
    const file = await bot.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;

    const pin = generatePin();
    const ext = path.extname(originalName) || "";
    const newFileName = `${pin}${ext}`;
    const filePath = path.join(uploadDir, newFileName);

    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    pinToFileMap[pin] = newFileName;

    bot.sendMessage(chatId, `✅ File saved!\nYour PIN is: *${pin}*`, { parse_mode: "Markdown" });
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Error saving file");
  }
}

// Handle documents (PDF, Word, etc.)
bot.on("document", async (msg) => {
  const chatId = msg.chat.id;
  await saveFile(msg.document.file_id, msg.document.file_name, chatId);
});

// Handle photos (JPG, PNG, etc.)
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const photos = msg.photo;

  // Get highest resolution photo
  const photo = photos[photos.length - 1];

  // Use .jpg as default extension
  await saveFile(photo.file_id, `photo_${Date.now()}.jpg`, chatId);
});

// === EXPRESS BACKEND ===
const app = express();
app.use(bodyParser.json());

// Verify PIN API
app.post("/verify-pin", (req, res) => {
  const { pin } = req.body;

  if (pinToFileMap[pin]) {
    const filename = pinToFileMap[pin];
    const fileUrl = `/files/${filename}`;
    console.log(`PIN verified: ${pin} -> ${filename}`);

    return res.json({ success: true, fileUrl });
  } else {
    return res.json({ success: false, message: "Invalid PIN" });
  }
});

// Serve uploaded files
app.use("/files", express.static(uploadDir));

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
