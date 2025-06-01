const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  generatePairingCode,
} = require('@whiskeysockets/baileys');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const STORAGE_DIR = './storage';
const SESSION_DIR = `${STORAGE_DIR}/session`;
const DB_PATH = `${STORAGE_DIR}/database.sqlite`;
const BUSINESS_NUMBER = '255776822641@s.whatsapp.net';
const PAIRING_FILE = path.join(STORAGE_DIR, 'pairing_code.txt');

if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR);
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

const db = new sqlite3.Database(DB_PATH, err => {
  if (err) return console.error('❌ DB Error:', err);
  console.log('📦 SQLite DB connected');
  db.run(`CREATE TABLE IF NOT EXISTS users (number TEXT PRIMARY KEY, apiKey TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
});

function generateApiKey() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function registerBusinessNumber() {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('centralNumber', ?)`, [BUSINESS_NUMBER]);
}

let sock;

async function startBot() {
  try {
    if (sock) {
      sock.ev.removeAllListeners();
      await sock.logout().catch(() => {});
      sock.end();
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
    });

    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, isNewLogin } = update;

      if (connection === 'open') {
        console.log('✅ WhatsApp bot is ready');
        registerBusinessNumber();
        if (fs.existsSync(PAIRING_FILE)) fs.unlinkSync(PAIRING_FILE); // remove old pairing code
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log('🔌 Disconnected:', lastDisconnect?.error);
        const shouldReconnect = statusCode !== 401;
        if (shouldReconnect) {
          console.log('♻️ Reconnecting...');
          await startBot();
        }
      }

      if (isNewLogin) {
        try {
          const code = await generatePairingCode(sock, 'Trover Bot');
          fs.writeFileSync(PAIRING_FILE, code);
          console.log(`🔑 Pairing Code: ${code}`);
          console.log('👉 Open WhatsApp > Linked Devices > Link Device > Enter Code');
        } catch (err) {
          console.error('❌ Failed to generate pairing code:', err);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
      const msg = messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const senderJid = msg.key.remoteJid;
      const sender = senderJid.split('@')[0];
      const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

      if (senderJid === BUSINESS_NUMBER) return;

      if (body.toLowerCase().includes('allow me')) {
        const apiKey = generateApiKey();
        db.run(`INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)`, [sender, apiKey], async err => {
          if (!err) {
            await sock.sendMessage(senderJid, {
              text: `✅ You're activated!\n\nAPI Key: *${apiKey}*\nUse it at: https://trover.42web.io/devs.php`,
            });
          }
        });
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

const app = express();
app.use(express.json());

let sockPromise = startBot();

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

app.use('/admin', express.static('./admin'));

app.get('/admin/creds', (req, res) => {
  const credsPath = path.join(SESSION_DIR, 'creds.json');
  if (fs.existsSync(credsPath)) {
    const creds = fs.readFileSync(credsPath, 'utf-8');
    try {
      res.json(JSON.parse(creds));
    } catch {
      res.status(500).send('❌ Invalid creds.json');
    }
  } else {
    res.status(404).send('❌ creds.json not found');
  }
});

// 🔐 Pairing code route
app.get('/pairing-code', (req, res) => {
  if (fs.existsSync(PAIRING_FILE)) {
    res.send(fs.readFileSync(PAIRING_FILE, 'utf-8'));
  } else {
    res.send('❌ Pairing code not yet generated.');
  }
});

app.listen(3000, () => {
  console.log('🚀 Server running at http://localhost:3000');
});

process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});