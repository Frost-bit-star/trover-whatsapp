const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const axios = require('axios');
const db = require('./db');

const app = express();
app.use(express.json());

const BUSINESS_REGISTRATION_CODE = '87654321';
let centralBusinessNumber = null;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox']
  }
});

function loadCentralNumber() {
  db.get(`SELECT value FROM settings WHERE key = 'centralNumber'`, [], (err, row) => {
    if (!err && row) {
      centralBusinessNumber = row.value;
      console.log(`✅ Loaded business number: ${centralBusinessNumber}`);
    }
  });
}

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

client.on('qr', qr => {
  console.log('📲 Scan this QR to link WhatsApp:\n', qr);
});

client.on('ready', () => {
  console.log('✅ WhatsApp bot is ready!');
  loadCentralNumber();
});

function generate8DigitCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

client.on('message', async msg => {
  const senderNumber = msg.from.split('@')[0];
  const text = msg.body.trim().toLowerCase();

  // Link business number
  if (!centralBusinessNumber && text === `link ${BUSINESS_REGISTRATION_CODE}`) {
    centralBusinessNumber = senderNumber;
    saveCentralNumber(senderNumber);
    return await client.sendMessage(msg.from, `✅ This number has been successfully linked as the business sender!`);
  }

  // Block usage if central number not linked
  if (!centralBusinessNumber) {
    return await client.sendMessage(msg.from, `🚫 Bot not activated. Send *link ${BUSINESS_REGISTRATION_CODE}* to activate.`);
  }

  // Only allow chat between users and business number
  if (msg.to !== `${centralBusinessNumber}@c.us` && senderNumber !== centralBusinessNumber) {
    return await client.sendMessage(msg.from, `🚫 You can only communicate with the business number.`);
  }

  // Handle "allow me"
  if (text.includes("allow me")) {
    const apiKey = generate8DigitCode();
    db.run(
      `INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)`,
      [senderNumber, apiKey],
      async err => {
        if (!err) {
          await client.sendMessage(msg.from,
            `✅ You're activated!\n\n🔑 API Key: *${apiKey}*\n\nUse it at:\nhttps://trover.42web.io/devs.php`
          );
        } else {
          console.error('DB Insert Error:', err);
        }
      }
    );
    return;
  }

  // Handle "recover apikey"
  if (text.includes("recover apikey")) {
    db.get(
      `SELECT apiKey FROM users WHERE number = ?`,
      [senderNumber],
      async (err, row) => {
        if (err) {
          console.error('DB Fetch Error:', err);
          return await client.sendMessage(msg.from, "❌ Error accessing your data.");
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

  // 🤖 Forward message to AI if not one of the above
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

client.initialize();
app.listen(3000, () => console.log('🚀 Server running on port 3000'));