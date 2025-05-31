require('dotenv').config();
const { Client, MessageMedia } = require('whatsapp-web.js');
const { Client: PgClient } = require('pg');
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const db = new PgClient({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

// Utility: Generate random 8-digit code for API keys
function generate8DigitCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

async function initializeDatabase() {
  await db.connect();

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      registered_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      business_number TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  console.log('🛠️ Database initialized.');
}

class SupabaseAuth {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.sessionData = null;
  }

  async setup() {
    try {
      const { data, error } = await supabase
        .from('whatsapp_sessions')
        .select('session_data')
        .eq('session_id', this.sessionId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Supabase session load error:', error);
        throw error;
      }

      this.sessionData = data?.session_data || null;
      console.log(this.sessionData
        ? '✅ Loaded WhatsApp session from Supabase'
        : 'ℹ️ No WhatsApp session found in Supabase, starting fresh');
    } catch (err) {
      console.error('Error loading session from Supabase:', err);
      this.sessionData = null;
    }
  }

  async beforeAuth() {
    // No action needed before auth for now
  }

  async saveAuthToken(token) {
    this.sessionData = token;
    try {
      const { error } = await supabase.from('whatsapp_sessions').upsert({
        session_id: this.sessionId,
        session_data: this.sessionData,
        updated_at: new Date().toISOString()
      });

      if (error) {
        console.error('Supabase session save error:', error);
        throw error;
      }
      console.log('✅ Saved WhatsApp session to Supabase');
    } catch (err) {
      console.error('Failed to save session to Supabase:', err);
      throw err;
    }
  }

  async getAuthToken() {
    return this.sessionData;
  }

  async clearAuth() {
    try {
      const { error } = await supabase
        .from('whatsapp_sessions')
        .delete()
        .eq('session_id', this.sessionId);

      if (error) {
        console.error('Supabase session clear error:', error);
        throw error;
      }
      this.sessionData = null;
      console.log('✅ Cleared WhatsApp session from Supabase');
    } catch (err) {
      console.error('Failed to clear session in Supabase:', err);
      throw err;
    }
  }
}

async function main() {
  await initializeDatabase();

  const app = express();
  app.use(express.json());

  const businessNumber = process.env.BUSINESS_NUMBER;
  const sessionId = process.env.WHATSAPP_SESSION_ID;

  const client = new Client({
    authStrategy: new SupabaseAuth(sessionId),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox']
    }
  });

  async function registerBusinessNumber() {
    try {
      await db.query(`
        INSERT INTO settings (key, value) VALUES ('centralNumber', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [businessNumber]);

      await db.query(`
        INSERT INTO sessions (session_id, business_number, timestamp)
        VALUES ($1, $2, NOW())
        ON CONFLICT (session_id) DO UPDATE SET business_number = EXCLUDED.business_number, timestamp = NOW()
      `, [sessionId, businessNumber]);

      console.log(`✅ Business number registered: ${businessNumber}`);
    } catch (err) {
      console.error('Failed to register business number:', err);
    }
  }

  client.on('ready', () => {
    console.log('✅ WhatsApp bot is ready and online!');
    registerBusinessNumber();
  });

  client.on('authenticated', () => {
    console.log('🔐 Authenticated with WhatsApp');
  });

  client.on('auth_failure', msg => {
    console.error('❌ Authentication failed:', msg);
  });

  client.on('disconnected', reason => {
    console.warn('⚠️ WhatsApp disconnected:', reason);
  });

  client.on('message', async msg => {
    try {
      const senderNumber = msg.from.split('@')[0];
      const text = msg.body.trim().toLowerCase();

      if (!businessNumber) {
        return client.sendMessage(msg.from, `🚫 Bot is not activated.`);
      }

      // Only allow messaging the business number
      if (msg.to !== `${businessNumber}@c.us` && senderNumber !== businessNumber) {
        return client.sendMessage(msg.from, `🚫 You can only communicate with the business number.`);
      }

      if (text.includes("allow me")) {
        const apiKey = generate8DigitCode();

        await db.query(`
          INSERT INTO users (id, api_key, registered_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (id) DO UPDATE SET api_key = EXCLUDED.api_key, registered_at = NOW()
        `, [senderNumber, apiKey]);

        await client.sendMessage(msg.from,
          `✅ You're activated!\n\n🔑 API Key: *${apiKey}*\n\nUse it at:\nhttps://trover.42web.io/devs.php`
        );
        console.log(`✅ New user registered: ${senderNumber}`);
        return;
      }

      if (text.includes("recover apikey")) {
        const result = await db.query('SELECT api_key FROM users WHERE id = $1', [senderNumber]);
        if (result.rows.length > 0) {
          const apiKey = result.rows[0].api_key;
          await client.sendMessage(msg.from, `🔐 Your saved API Key is:\n*${apiKey}*`);
          console.log(`✅ API key recovered for ${senderNumber}`);
        } else {
          await client.sendMessage(msg.from, `⚠️ No API key found. Send *allow me* to register.`);
          console.log(`❌ No API key found for ${senderNumber}`);
        }
        return;
      }

      // Fallback: AI-powered reply
      try {
        const aiResponse = await axios.post(
          process.env.AI_API_URL,
          {
            messages: [{ role: "user", content: msg.body }],
            model: process.env.AI_MODEL
          },
          { headers: { "Content-Type": "application/json" } }
        );

        const aiReply = aiResponse.data?.response?.content || "🤖 Sorry, I couldn't understand that.";
        await client.sendMessage(msg.from, aiReply);
      } catch (error) {
        console.error("AI Request Failed:", error.message);
        await client.sendMessage(msg.from, "❌ AI service unavailable. Try again later.");
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  app.post('/api/send', async (req, res) => {
    const { apikey, message, mediaUrl, caption } = req.body;

    if (!apikey || (!message && !mediaUrl)) {
      return res.status(400).send("Missing API key or message/mediaUrl");
    }

    try {
      const result = await db.query('SELECT id FROM users WHERE api_key = $1 LIMIT 1', [apikey]);
      if (result.rows.length === 0) {
        return res.status(401).send("Invalid API key");
      }

      const number = result.rows[0].id;
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

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });

  client.initialize();
}

main().catch(console.error);