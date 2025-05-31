const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const axios = require('axios');

const app = express();
app.use(express.json());

const STORAGE_DIR = './storage';
const SESSION_DIR = `${STORAGE_DIR}/session`;
const DB_PATH = `${STORAGE_DIR}/database.sqlite`;

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR);

// SQLite DB setup
const db = new sqlite3.Database(DB_PATH, err => {
  if (err) return console.error('❌ DB Error:', err);
  console.log('📦 SQLite DB connected');
  db.run(`CREATE TABLE IF NOT EXISTS users (
    number TEXT PRIMARY KEY,
    apiKey TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
});

const BUSINESS_NUMBER = '255776822641';
let client;

// Generate 8-character alphanumeric API key
function generateApiKey() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// Register business number in DB
function registerBusinessNumber() {
  db.run(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('centralNumber', ?)`,
    [BUSINESS_NUMBER],
    err => {
      if (!err) console.log(`✅ Registered business number: ${BUSINESS_NUMBER}`);
    }
  );
}

// Create or restart the WhatsApp client
function initializeClient() {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: { headless: true, args: ['--no-sandbox'] }
  });

  client.on('ready', async () => {
    console.log('✅ WhatsApp bot is ready');
    registerBusinessNumber();

    try {
      const code = await client.requestPairingCode(BUSINESS_NUMBER);
      console.log(`🔑 Pairing Code: ${code}`);
    } catch {
      console.log('✅ Already paired, no new pairing code needed.');
    }

    // Log current session files for manual backup
    const files = fs.readdirSync(SESSION_DIR, { withFileTypes: true });
    console.log('📁 Session files:\n' + files.map(f => `- ${f.name}`).join('\n'));
  });

  client.on('auth_failure', async msg => {
    console.error('❌ Authentication failed. Resetting session and restarting...');

    try {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      console.log('🗑️ Session directory deleted.');

      await client.destroy();
      console.log('♻️ Client destroyed. Re-initializing...');
      initializeClient();
      client.initialize();
    } catch (err) {
      console.error('❌ Error during session reset:', err);
    }
  });

  client.on('message', async msg => {
    const sender = msg.from.split('@')[0];
    const body = msg.body.trim().toLowerCase();

    if (sender === BUSINESS_NUMBER) return;

    // Register API key
    if (body.includes('allow me')) {
      const apiKey = generateApiKey();
      db.run(
        `INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)`,
        [sender, apiKey],
        async err => {
          if (!err) {
            await client.sendMessage(msg.from, `✅ You're activated!\n\nAPI Key: *${apiKey}*\nUse it at: https://trover.42web.io/devs.php`);
          }
        }
      );
      return;
    }

    // Recover API key
    if (body.includes('recover apikey')) {
      db.get(`SELECT apiKey FROM users WHERE number = ?`, [sender], async (err, row) => {
        if (row) {
          await client.sendMessage(msg.from, `🔑 Your API Key: *${row.apiKey}*`);
        } else {
          await client.sendMessage(msg.from, `❌ Not found. Please send *allow me* to register.`);
        }
      });
      return;
    }

    // AI fallback
    try {
      const ai = await axios.post('https://troverstarapiai.vercel.app/api/chat', {
        messages: [{ role: 'user', content: msg.body }],
        model: 'gpt-3.5-turbo'
      });
      const reply = ai.data?.response?.content || '🤖 No response.';
      await client.sendMessage(msg.from, reply);
    } catch {
      await client.sendMessage(msg.from, '🤖 AI service is unavailable.');
    }
  });

  client.initialize();
}

// HTTP API to send messages
app.post('/api/send', async (req, res) => {
  const { apikey, message, mediaUrl, caption } = req.body;

  if (!apikey || (!message && !mediaUrl)) {
    return res.status(400).send('Missing API key or message/media.');
  }

  db.get(`SELECT number FROM users WHERE apiKey = ?`, [apikey], async (err, row) => {
    if (!row) return res.status(401).send('Invalid API key');
    const chatId = `${row.number}@c.us`;

    try {
      if (mediaUrl) {
        const media = await MessageMedia.fromUrl(mediaUrl);
        await client.sendMessage(chatId, media, { caption });
      } else {
        await client.sendMessage(chatId, message);
      }
      res.send('✅ Message sent.');
    } catch {
      res.status(500).send('❌ Failed to send.');
    }
  });
});

// Start the app and initialize WhatsApp client
app.listen(3000, () => console.log('🚀 Server running at http://localhost:3000'));
initializeClient();