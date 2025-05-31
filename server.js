const { Client, LegacySessionAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite DB
const dbPath = path.join(__dirname, 'botdata.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("❌ Failed to connect to database", err);
  else console.log("✅ SQLite database connected");
});

// Create tables if not exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE,
    apiKey TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
});

// Hardcoded Tanzanian business number
const HARDCODED_BUSINESS_NUMBER = '255776822641';
let centralBusinessNumber = HARDCODED_BUSINESS_NUMBER;

// Hardcoded session object for LegacySessionAuth
const session = {
  WABrowserId: "\"weghqRwmd1gKtw==\"",
  WASecretBundle: {
    encKey: "6Z3PLN+H1xN5gz5+d6vWrgLMsZvBi4fjRP93iwFv/70=",
    macKey: "CvJ9Xv4nyvO9INt9+h3ojvNT8G8G0P2HGLhKRoUMY2I="
  },
  WAToken1: "\"cHQ2i3mhvCkCChGP/yFa9ZKsyYjH1EGfc4p1apRy1uw=\"",
  WAToken2: "\"1@+rZzFSKuKZ7yM3z3ZUBUL+NWKvyaPoULj8K0zOfvg+axbg==\""
};

// WhatsApp client using LegacySessionAuth
const client = new Client({
  authStrategy: new LegacySessionAuth({ session }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox']
  }
});

function registerHardcodedNumber() {
  db.run(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('centralNumber', ?)`,
    [centralBusinessNumber],
    (err) => {
      if (err) console.error('❌ DB Save Error:', err);
      else console.log(`✅ Business number registered: ${centralBusinessNumber}`);
    }
  );
}

client.initialize();

client.on('ready', () => {
  console.log('✅ WhatsApp bot is ready and online!');
  registerHardcodedNumber();
});

client.on('authenticated', () => {
  console.log('🔐 Authenticated with WhatsApp');
});

client.on('auth_failure', msg => {
  console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', reason => {
  console.log('⚠️ WhatsApp disconnected:', reason);
});

client.on('message', async msg => {
  const senderNumber = msg.from.split('@')[0];
  const text = msg.body.trim().toLowerCase();

  if (!centralBusinessNumber) {
    await client.sendMessage(msg.from, `🚫 Bot is not activated.`);
    return;
  }

  if (msg.to !== `${centralBusinessNumber}@c.us` && senderNumber !== centralBusinessNumber) {
    await client.sendMessage(msg.from, `🚫 You can only communicate with the business number.`);
    return;
  }

  if (text.includes("allow me")) {
    const apiKey = generate8DigitCode();
    db.run(
      `INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)`,
      [senderNumber, apiKey],
      async err => {
        if (err) {
          console.error('DB Insert Error:', err);
          return;
        }
        await client.sendMessage(msg.from,
          `✅ You're activated!\n\n🔑 API Key: *${apiKey}*\n\nUse it at:\nhttps://trover.42web.io/devs.php`
        );
      }
    );
    return;
  }

  if (text.includes("recover apikey")) {
    db.get(
      `SELECT apiKey FROM users WHERE number = ?`,
      [senderNumber],
      async (err, row) => {
        if (err) {
          console.error('DB Fetch Error:', err);
          await client.sendMessage(msg.from, "❌ Error accessing your data.");
          return;
        }

        if (row) {
          await client.sendMessage(msg.from, `🔐 Your existing API Key: *${row.apiKey}*`);
        } else {
          await client.sendMessage(msg.from, `⚠️ No API key found. Send *allow me* to get one.`);
        }
      }
    );
    return;
  }

  // Fallback AI response
  try {
    const aiResponse = await axios.post(
      'https://troverstarapiai.vercel.app/api/chat',
      {
        messages: [{ role: "user", content: msg.body }],
        model: "gpt-3.5-turbo"
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const aiReply = aiResponse.data?.response?.content || "🤖 Sorry, I couldn't understand that.";
    await client.sendMessage(msg.from, aiReply);
  } catch (error) {
    console.error("AI Request Failed:", error.message);
    await client.sendMessage(msg.from, "❌ AI service unavailable. Try again later.");
  }
});

// REST API endpoint to send messages
app.post('/api/send', (req, res) => {
  const { apikey, message, mediaUrl, caption } = req.body;

  if (!centralBusinessNumber) {
    return res.status(500).send("Bot is not linked to a business number.");
  }

  if (!apikey || (!message && !mediaUrl)) {
    return res.status(400).send("Missing API key or message/mediaUrl");
  }

  db.get(`SELECT number FROM users WHERE apiKey = ?`, [apikey], async (err, row) => {
    if (err) {
      console.error('DB Select Error:', err);
      return res.status(500).send("Database error");
    }

    if (!row) {
      return res.status(401).send("Invalid API key");
    }

    const chatId = `${row.number}@c.us`;

    try {
      if (mediaUrl) {
        const media = await MessageMedia.fromUrl(mediaUrl);
        await client.sendMessage(chatId, media, { caption });
      } else {
        await client.sendMessage(chatId, message);
      }

      res.send("✅ Message sent from business number");
    } catch (e) {
      console.error('Send Error:', e);
      res.status(500).send("❌ Failed to send message");
    }
  });
});

app.listen(3000, () => {
  console.log('🚀 Server running on port 3000');
});

function generate8DigitCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}