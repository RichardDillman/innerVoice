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
let ENABLED = process.env.ENABLED !== 'false'; // Now mutable for runtime toggling

let chatId: string | null = process.env.TELEGRAM_CHAT_ID || null;
const envPath = path.join(process.cwd(), '.env');

// Session tracking for multi-project support
interface ClaudeSession {
  id: string;
  projectName: string;
  projectPath: string;
  startTime: Date;
  lastActivity: Date;
  status: 'active' | 'idle';
}

const activeSessions = new Map<string, ClaudeSession>();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes of inactivity

// Message queue for two-way communication
interface QueuedMessage {
  from: string;
  message: string;
  timestamp: Date;
  read: boolean;
  sessionId?: string; // Target session for this message
}

const messageQueue: QueuedMessage[] = [];
const pendingQuestions = new Map<string, {
  resolve: (answer: string) => void;
  timeout: NodeJS.Timeout;
  sessionId?: string;
}>();

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.lastActivity.getTime() > SESSION_TIMEOUT) {
      console.log(`🧹 Removing expired session: ${sessionId} (${session.projectName})`);
      activeSessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

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
    '`/sessions` - List active Claude sessions\n' +
    '`/test` - Send test notification\n\n' +
    '*How it works:*\n' +
    '• Send me any message - I forward it to Claude\n' +
    '• Claude processes it and replies back\n' +
    '• When Claude asks a question, your next message answers it\n' +
    '• Messages show project context: 📁 ProjectName [#abc1234]\n\n' +
    '*Features:*\n' +
    '✅ Multi-project session tracking\n' +
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

bot.command('sessions', async (ctx) => {
  const sessions = Array.from(activeSessions.values());

  if (sessions.length === 0) {
    await ctx.reply('📭 No active Claude sessions');
    return;
  }

  const sessionList = sessions.map((s, i) => {
    const shortId = s.id.substring(0, 7);
    const idleMinutes = Math.floor((Date.now() - s.lastActivity.getTime()) / 60000);
    const statusEmoji = s.status === 'active' ? '🟢' : '🟡';
    return `${i + 1}. ${statusEmoji} *${s.projectName}* [#${shortId}]\n   Last active: ${idleMinutes}m ago`;
  }).join('\n\n');

  await ctx.reply(
    `*Active Claude Sessions* (${sessions.length})\n\n${sessionList}\n\n_Reply with #sessionId to send a message to a specific session_`,
    { parse_mode: 'Markdown' }
  );
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

// Register or update a Claude session
app.post('/session/register', (req, res) => {
  const { sessionId, projectName, projectPath } = req.body;

  if (!sessionId || !projectName || !projectPath) {
    return res.status(400).json({ error: 'sessionId, projectName, and projectPath are required' });
  }

  const now = new Date();
  const existing = activeSessions.get(sessionId);

  if (existing) {
    // Update existing session
    existing.lastActivity = now;
    existing.status = 'active';
  } else {
    // Create new session
    activeSessions.set(sessionId, {
      id: sessionId,
      projectName,
      projectPath,
      startTime: now,
      lastActivity: now,
      status: 'active'
    });
    console.log(`📝 Registered new session: ${sessionId} (${projectName})`);
  }

  res.json({ success: true, sessionId, projectName });
});

// Update session activity
app.post('/session/heartbeat', (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const session = activeSessions.get(sessionId);
  if (session) {
    session.lastActivity = new Date();
    session.status = 'active';
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// List active sessions
app.get('/sessions', (req, res) => {
  const sessions = Array.from(activeSessions.values()).map(s => ({
    id: s.id,
    projectName: s.projectName,
    projectPath: s.projectPath,
    startTime: s.startTime,
    lastActivity: s.lastActivity,
    status: s.status,
    idleMinutes: Math.floor((Date.now() - s.lastActivity.getTime()) / 60000)
  }));

  res.json({ sessions, count: sessions.length });
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

  const { message, priority = 'info', parseMode = 'Markdown', sessionId } = req.body;

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

    // Add project context if session ID provided
    let projectContext = '';
    if (sessionId) {
      const session = activeSessions.get(sessionId);
      if (session) {
        session.lastActivity = new Date();
        const shortId = sessionId.substring(0, 7);
        projectContext = `📁 *${session.projectName}* [#${shortId}]\n`;
      }
    }

    await bot.telegram.sendMessage(
      chatId,
      `${projectContext}${emoji} ${message}`,
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

// Toggle enabled state
app.post('/toggle', async (req, res) => {
  const previousState = ENABLED;
  ENABLED = !ENABLED;

  const statusMessage = ENABLED
    ? '🟢 InnerVoice notifications ENABLED - You will receive messages'
    : '🔴 InnerVoice notifications DISABLED - Messages paused';

  // Notify via Telegram if chat ID is set
  if (chatId) {
    try {
      await bot.telegram.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Failed to send toggle notification:', error);
    }
  }

  res.json({
    success: true,
    enabled: ENABLED,
    previousState,
    message: statusMessage
  });
});

// Get current enabled state
app.get('/status', (req, res) => {
  res.json({
    enabled: ENABLED,
    message: ENABLED ? 'Notifications are ON' : 'Notifications are OFF (AFK mode)'
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
