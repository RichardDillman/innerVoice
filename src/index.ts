import { Telegraf } from 'telegraf';
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const app = express();
const PORT = parseInt(process.env.PORT || '3456');
const HOST = process.env.HOST || 'localhost';
const ENABLED = process.env.ENABLED !== 'false';

let chatId: string | null = process.env.TELEGRAM_CHAT_ID || null;
const envPath = path.join(process.cwd(), '.env');

// Message queue for two-way communication
interface QueuedMessage {
  from: string;
  message: string;
  timestamp: Date;
  read: boolean;
}

const messageQueue: QueuedMessage[] = [];
const pendingQuestions = new Map<string, { resolve: (answer: string) => void; timeout: NodeJS.Timeout }>();

app.use(express.json());

// Save chat ID to .env file
async function saveChatId(id: string) {
  try {
    const envContent = await fs.readFile(envPath, 'utf-8');
    const updated = envContent.replace(
      /TELEGRAM_CHAT_ID=.*/,
      `TELEGRAM_CHAT_ID=${id}`
    );
    await fs.writeFile(envPath, updated);
    console.log(`✅ Chat ID saved: ${id}`);
  } catch (error) {
    console.error('Failed to save chat ID:', error);
  }
}

// Bot commands
bot.start(async (ctx) => {
  chatId = ctx.chat.id.toString();
  await saveChatId(chatId);
  await ctx.reply(
    '🤖 *Claude Telegram Bridge Active*\n\n' +
    'I will now forward notifications from Claude Code and other apps.\n\n' +
    '*Commands:*\n' +
    '/status - Check bridge status\n' +
    '/enable - Enable notifications\n' +
    '/disable - Disable notifications\n' +
    '/test - Send test notification',
    { parse_mode: 'Markdown' }
  );
});

bot.command('status', async (ctx) => {
  const status = ENABLED ? '✅ Enabled' : '⛔ Disabled';
  await ctx.reply(
    `*Bridge Status*\n\n` +
    `Status: ${status}\n` +
    `Chat ID: ${chatId}\n` +
    `HTTP Server: http://${HOST}:${PORT}`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    '*Claude Telegram Bridge - Commands*\n\n' +
    '*Bot Commands:*\n' +
    '`/start` - Initialize and connect\n' +
    '`/help` - Show this help message\n' +
    '`/status` - Check bridge status\n' +
    '`/test` - Send test notification\n\n' +
    '*How it works:*\n' +
    '• Send me any message - I forward it to Claude\n' +
    '• Claude processes it and replies back\n' +
    '• When Claude asks a question, your next message answers it\n\n' +
    '*Features:*\n' +
    '✅ Two-way communication\n' +
    '✅ Question/Answer flow\n' +
    '✅ Progress notifications\n' +
    '✅ Error alerts\n\n' +
    'More info: See README in bridge folder',
    { parse_mode: 'Markdown' }
  );
});

bot.command('test', async (ctx) => {
  await ctx.reply('✅ Test notification received! Bridge is working.');
});

// Listen for any text messages from user
bot.on('text', async (ctx) => {
  const message = ctx.message.text;
  const from = ctx.from.username || ctx.from.first_name;

  console.log(`\n📨 Message from ${from}: "${message}"\n`);

  // Check if this is an answer to a pending question
  const questionId = Array.from(pendingQuestions.keys())[0];
  if (questionId && pendingQuestions.has(questionId)) {
    const { resolve, timeout } = pendingQuestions.get(questionId)!;
    clearTimeout(timeout);
    pendingQuestions.delete(questionId);
    resolve(message);
    await ctx.reply('✅ Answer received!');
    return;
  }

  // Add to message queue for processing
  messageQueue.push({
    from,
    message,
    timestamp: new Date(),
    read: false
  });

  // Acknowledge receipt - Claude will respond when available
  await ctx.reply('💬 Message received - responding...');

  console.log('📥 Queued for Claude to process');
});

// HTTP endpoint for sending notifications
app.post('/notify', async (req, res) => {
  if (!ENABLED) {
    return res.status(503).json({ error: 'Bridge is disabled' });
  }

  if (!chatId) {
    return res.status(400).json({ 
      error: 'No chat ID set. Please message the bot first with /start' 
    });
  }

  const { message, priority = 'info', parseMode = 'Markdown' } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const emojiMap: Record<string, string> = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌',
      question: '❓'
    };
    const emoji = emojiMap[priority] || 'ℹ️';

    await bot.telegram.sendMessage(
      chatId,
      `${emoji} ${message}`,
      { parse_mode: parseMode as any }
    );

    res.json({ success: true, chatId });
  } catch (error: any) {
    console.error('Failed to send message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get unread messages
app.get('/messages', (req, res) => {
  const unread = messageQueue.filter(m => !m.read);
  res.json({ messages: unread, count: unread.length });
});

// Mark messages as read
app.post('/messages/read', (req, res) => {
  const { count } = req.body;
  const toMark = count || messageQueue.filter(m => !m.read).length;

  let marked = 0;
  for (const msg of messageQueue) {
    if (!msg.read && marked < toMark) {
      msg.read = true;
      marked++;
    }
  }

  res.json({ markedAsRead: marked });
});

// Send reply to user message
app.post('/reply', async (req, res) => {
  if (!chatId) {
    return res.status(400).json({ error: 'No chat ID set' });
  }

  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Ask a question and wait for answer
app.post('/ask', async (req, res) => {
  if (!chatId) {
    return res.status(400).json({ error: 'No chat ID set' });
  }

  const { question, timeout = 300000 } = req.body; // 5 min default timeout

  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    const questionId = Date.now().toString();

    // Send question to Telegram
    await bot.telegram.sendMessage(chatId, `❓ ${question}`, { parse_mode: 'Markdown' });

    // Wait for answer
    const answer = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingQuestions.delete(questionId);
        reject(new Error('Timeout waiting for answer'));
      }, timeout);

      pendingQuestions.set(questionId, { resolve, timeout: timer });
    });

    res.json({ answer });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'running',
    enabled: ENABLED,
    chatId: chatId ? 'set' : 'not set',
    unreadMessages: messageQueue.filter(m => !m.read).length,
    pendingQuestions: pendingQuestions.size
  });
});

// Start bot
bot.launch().then(() => {
  console.log('🤖 Telegram bot started');
  console.log('📱 Message your bot to get started');
});

// Start HTTP server
app.listen(PORT, HOST, () => {
  console.log(`🌐 HTTP server running on http://${HOST}:${PORT}`);
  console.log(`\n📋 Send notifications with:\n`);
  console.log(`curl -X POST http://${HOST}:${PORT}/notify \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"message": "Hello from Claude!", "priority": "info"}'`);
});

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});
