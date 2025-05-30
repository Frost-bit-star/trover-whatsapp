const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const axios = require('axios');
const db = require('./db');
const qrcodeTerminal = require('qrcode-terminal');

const app = express();
app.use(express.json());

// Hardcoded Tanzanian business number in international format (without +)
const HARDCODED_BUSINESS_NUMBER = '255776822641';
let centralBusinessNumber = HARDCODED_BUSINESS_NUMBER;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox']
  }
});

// Register the hardcoded number in the database
function registerHardcodedNumber() {
  db.run(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('centralNumber', ?)`,
    [centralBusinessNumber],
    (err) => {
      if (err) console.error('DB Save Error:', err);
      else console.log(`Business number registered: ${centralBusinessNumber}`);
    }
  );
}

// Show QR for first-time login
client.on('qr', qr => {
  console.log('Scan this QR code to link WhatsApp:\n');
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('WhatsApp bot is ready!');
  registerHardcodedNumber();
  generateAndStorePairingCode();
});

// Generate and store pairing code
function generateAndStorePairingCode() {
  client.requestPairingCode(centralBusinessNumber).then((code) => {
    console.log('Pairing code:', code);
    // Store the pairing code in the database if needed
  }).catch((err) => {
    console.error('Error generating pairing code:', err);
  });
}

function generate8DigitCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

client.on('message', async msg => {
  const senderNumber = msg.from.split('@')[0];
  const text = msg.body.trim().toLowerCase();

  if (!centralBusinessNumber) {
    return await client.sendMessage(msg.from, `Bot is not activated.`);
  }

  // Only allow communication with the business number
  if (msg.to !== `${centralBusinessNumber}@c.us` && senderNumber !== centralBusinessNumber) {
    return await client.sendMessage(msg.from, `You can only communicate with the business number.`);
  }

  // Handle activation
  if (text.includes("allow me")) {
    const apiKey = generate8DigitCode();
    db.run(
      `INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)`,
      [senderNumber, apiKey],
      async err => {
        if (!err) {
          await client.sendMessage(msg.from,
            `You're activated!\n\nAPI Key: *${apiKey}*\n\nUse it at:\nhttps://trover.42web.io/devs.php`
          );
        } else {
          console.error('DB Insert Error:', err);
        }
      }
    );
    return;
  }

  // Handle API key recovery
  if (text.includes("recover apikey")) {
    db.get(
      `SELECT apiKey FROM users WHERE number = ?`,
      [senderNumber],
      async (err, row) => {
        if (err) {
          console.error('DB Fetch Error:', err);
          return await client.sendMessage(msg.from, "Error accessing your data.");
        }

        if (row) {
          await client.sendMessage(msg.from, `Your existing API Key: *${row.apiKey}*`);
        } else {
          await client.sendMessage(msg.from, `No API key found. Send *allow me* to get one.`);
        }
      }
    );
    return;
  }

  // AI fallback
  try {
    const aiResponse = await axios.post(
      'https://troverstarapiai.vercel.app/api/chat',
      {
        messages: [{ role: "user", content: msg.body }],
        model: "gpt-3.5-turbo"
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const aiReply = aiResponse.data?.response?.content || "Sorry, I couldn't understand that.";
    await client.sendMessage(msg.from, aiReply);
  } catch (error) {
    console.error("AI Request Failed:", error.message);
    await client.sendMessage(msg.from, "AI service unavailable. Try again later.");
  }
});

// REST API for sending messages
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

      res.send("Message sent from business number");
    } catch (e) {
      console.error('Send Error:', e);
      res.status(500).send("Failed to send message");
    }
  });
});

client.initialize();
app.listen(3000, () => console.log('Server running on port 3000'));
