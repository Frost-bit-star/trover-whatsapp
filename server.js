const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
app.use(express.json());

const BUSINESS_REGISTRATION_CODE = '87654321';
let centralBusinessNumber = null;
let latestQR = null;

// ✅ Use persistent session directory (Render-compatible)
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: '/data/session' // Ensure this is persistent on Render
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox']
  }
});

// Load central number from DB if already saved
function loadCentralNumber() {
  db.get(`SELECT value FROM settings WHERE key = 'centralNumber'`, [], (err, row) => {
    if (!err && row) {
      centralBusinessNumber = row.value;
      console.log(`✅ Loaded business number: ${centralBusinessNumber}`);
    }
  });
}

// Save central number to DB
function saveCentralNumber(number) {
  db.run(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('centralNumber', ?)`,
    [number],
    (err) => {
      if (err) console.error('DB Save Error:', err);
      else console.log(`✅ Business number saved: ${number}`);
    }
  );
}

// Show QR code in logs and store latest QR
client.on('qr', qr => {
  latestQR = qr;
  console.log('📲 Scan this QR to link WhatsApp:');
  console.log(qr);
});

client.on('ready', () => {
  console.log('✅ WhatsApp bot is ready!');
  loadCentralNumber();
});

// Generate 8-digit API key
function generate8DigitCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

// Message listener
client.on('message', async msg => {
  const senderNumber = msg.from.split('@')[0];
  const text = msg.body.trim().toLowerCase();

  // Link business number
  if (!centralBusinessNumber && text === `link ${BUSINESS_REGISTRATION_CODE}`) {
    centralBusinessNumber = senderNumber;
    saveCentralNumber(senderNumber);
    return await client.sendMessage(msg.from, `✅ This number has been successfully linked as the business sender!`);
  }

  if (!centralBusinessNumber) {
    return await client.sendMessage(msg.from, `🚫 Bot not activated. Send *link ${BUSINESS_REGISTRATION_CODE}* to activate.`);
  }

  if (msg.to !== `${centralBusinessNumber}@c.us` && senderNumber !== centralBusinessNumber) {
    return await client.sendMessage(msg.from, `🚫 You can only communicate with the business number.`);
  }

  // Allow registration
  if (text.includes("allow me")) {
    const apiKey = generate8DigitCode();
    db.run(
      `INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)`,
      [senderNumber, apiKey],
      async err => {
        if (!err) {
          await client.sendMessage(msg.from,
            `✅ You're activated!\n\n🔑 API Key: *${apiKey}*\n\nUse it at:\nhttps://yourdomain.com/api/send`
          );
        } else {
          console.error('DB Insert Error:', err);
        }
      }
    );
  }

  // Recover API key
  else if (text.includes("recover apikey")) {
    db.get(
      `SELECT apiKey FROM users WHERE number = ?`,
      [senderNumber],
      async (err, row) => {
        if (err) {
          console.error('DB Fetch Error:', err);
          return await client.sendMessage(msg.from, "❌ Error accessing your data.");
        }

        if (row) {
          await client.sendMessage(msg.from,
            `🔐 Your existing API Key: *${row.apiKey}*`
          );
        } else {
          await client.sendMessage(msg.from,
            `⚠️ No API key found. Send *allow me* to get one.`
          );
        }
      }
    );
  }
});

// REST API to send messages from business number
app.post('/api/send', async (req, res) => {
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

// 🖼 Serve the QR Code as a web page
app.get('/qr', async (req, res) => {
  if (!latestQR) return res.status(404).send("QR code not generated yet");
  try {
    const dataUrl = await QRCode.toDataURL(latestQR);
    res.send(`
      <html>
        <head><title>Scan WhatsApp QR</title></head>
        <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;">
          <h2>📲 Scan to Link WhatsApp</h2>
          <img src="${dataUrl}" />
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send("Error generating QR code");
  }
});

client.initialize();
app.listen(3000, () => console.log('🚀 Server running on port 3000'));