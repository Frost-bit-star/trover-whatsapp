const { Client, MessageMedia } = require('whatsapp-web.js');
const { FirebaseStore } = require('whatsapp-web.js-firebase-auth');
const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const serviceAccount = require('./whatsapp-bot-92217-firebase-adminsdk-fbsvc-093a5ba4fd.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const store = new FirebaseStore(db, {
  collectionPath: 'wweb-sessions',
  sessionId: 'trover-bot-session'
});

const app = express();
app.use(express.json());

const HARDCODED_BUSINESS_NUMBER = '255776822641'; // ← Set your number
let centralBusinessNumber = HARDCODED_BUSINESS_NUMBER;

const client = new Client({
  authStrategy: store,
  puppeteer: {
    headless: true,
    args: ['--no-sandbox']
  }
});

// 🔐 Register business number and session
async function registerHardcodedNumber() {
  await db.collection('settings').doc('centralNumber').set({
    value: centralBusinessNumber
  });

  await db.collection('sessions').doc('trover-bot-session').set({
    businessNumber: centralBusinessNumber,
    sessionId: 'trover-bot-session',
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log(`✅ Business number registered: ${centralBusinessNumber}`);
}

// Initialize WhatsApp
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

// 📩 Message handler
client.on('message', async msg => {
  const senderNumber = msg.from.split('@')[0];
  const text = msg.body.trim().toLowerCase();

  if (!centralBusinessNumber) {
    return await client.sendMessage(msg.from, `🚫 Bot is not activated.`);
  }

  if (msg.to !== `${centralBusinessNumber}@c.us` && senderNumber !== centralBusinessNumber) {
    return await client.sendMessage(msg.from, `🚫 You can only communicate with the business number.`);
  }

  if (text.includes("allow me")) {
    const apiKey = generate8DigitCode();

    const userData = {
      apiKey,
      registeredAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('users').doc(senderNumber).set(userData);
    await db.collection('registered_users').doc(senderNumber).set(userData);

    await client.sendMessage(msg.from,
      `✅ You're activated!\n\n🔑 API Key: *${apiKey}*\n\nUse it at:\nhttps://trover.42web.io/devs.php`
    );
    console.log(`✅ New user registered: ${senderNumber}`);
    return;
  }

  if (text.includes("recover apikey")) {
    const usersDoc = await db.collection('users').doc(senderNumber).get();

    if (usersDoc.exists) {
      const apiKey = usersDoc.data().apiKey;
      await client.sendMessage(msg.from, `🔐 Your saved API Key is:\n*${apiKey}*`);
      console.log(`✅ API key recovered for ${senderNumber}`);
    } else {
      const fallbackDoc = await db.collection('registered_users').doc(senderNumber).get();
      if (fallbackDoc.exists) {
        const apiKey = fallbackDoc.data().apiKey;
        await client.sendMessage(msg.from, `🔐 Your saved API Key is:\n*${apiKey}*`);
        console.log(`✅ API key recovered from fallback for ${senderNumber}`);
      } else {
        await client.sendMessage(msg.from, `⚠️ No API key found. Send *allow me* to register.`);
        console.log(`❌ No API key found for ${senderNumber}`);
      }
    }
    return;
  }

  // Fallback to AI
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

// 🛰️ API to send messages
app.post('/api/send', async (req, res) => {
  const { apikey, message, mediaUrl, caption } = req.body;

  if (!apikey || (!message && !mediaUrl)) {
    return res.status(400).send("Missing API key or message/mediaUrl");
  }

  try {
    const userQuery = await db.collection('users').where('apiKey', '==', apikey).limit(1).get();

    if (userQuery.empty) {
      return res.status(401).send("Invalid API key");
    }

    const userDoc = userQuery.docs[0];
    const number = userDoc.id;
    const chatId = `${number}@c.us`;

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

// 📡 API endpoint for "sell ping"
app.post('/api/sell-ping', async (req, res) => {
  const { storeName, customerNumber } = req.body;

  if (!storeName || !customerNumber) {
    return res.status(400).send("Missing storeName or customerNumber");
  }

  const message = `🔔 Ping from ${storeName}: A customer is trying to connect. Call or message them at ${customerNumber}.`;

  try {
    await client.sendMessage(`${centralBusinessNumber}@c.us`, message);
    res.send("✅ Ping sent to business number");
  } catch (e) {
    console.error('Ping Error:', e);
    res.status(500).send("❌ Failed to send ping");
  }
});

// 🔌 Ping endpoint (for uptime cron)
app.get('/ping', (req, res) => {
  res.send('✅ Bot is running!');
});

app.listen(3000, () => {
  console.log('🚀 Server running on port 3000');
});

// 🔢 Utility: Generate 8-digit API key
function generate8DigitCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}