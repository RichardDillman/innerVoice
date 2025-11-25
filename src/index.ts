import { Telegraf } from 'telegraf';
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import {
  enqueueTask,
  getPendingTasks,
  markTaskDelivered,
  getQueueSummary,
  cleanupOldTasks
} from './queue-manager.js';
import {
  spawnClaude,
  killClaude,
  listSpawnedProcesses,
  isClaudeRunning
} from './claude-spawner.js';
import {
  registerProject,
  unregisterProject,
  findProject,
  loadProjects,
  validateProjectPath
} from './project-registry.js';

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

// Track the last session that sent a message (for auto-routing replies)
let lastMessageSession: string | null = null;

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
    '*Session Management:*\n' +
    '`/sessions` - List active Claude sessions\n' +
    '`/queue` - View queued messages\n\n' +
    '*Project Management:*\n' +
    '`/projects` - List registered projects\n' +
    '`/register` ProjectName /path [--auto-spawn]\n' +
    '`/unregister` ProjectName\n' +
    '`/spawn` ProjectName [prompt]\n' +
    '`/spawned` - List spawned processes\n' +
    '`/kill` ProjectName\n\n' +
    '*Bot Control:*\n' +
    '`/status` - Check bridge status\n' +
    '`/test` - Send test notification\n\n' +
    '*How it works:*\n' +
    '• Send any message - forwards to active Claude\n' +
    '• Target specific project: `ProjectName: message`\n' +
    '• Messages show context: 📁 ProjectName [#abc1234]\n' +
    '• Register projects for remote spawning\n' +
    '• Messages queue when projects are offline\n\n' +
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
    `*Active Claude Sessions* (${sessions.length})\n\n${sessionList}\n\n_To send message to specific project: ProjectName: your message_`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('queue', async (ctx) => {
  try {
    const summary = await getQueueSummary();

    if (summary.length === 0) {
      await ctx.reply('📭 No queued messages');
      return;
    }

    const queueList = summary.map((s, i) => {
      return `${i + 1}. *${s.projectName}*\n   📥 ${s.pending} pending (${s.total} total)`;
    }).join('\n\n');

    await ctx.reply(
      `*Queued Messages* (${summary.length} projects)\n\n${queueList}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('projects', async (ctx) => {
  try {
    const projects = await loadProjects();

    if (projects.length === 0) {
      await ctx.reply('📭 No registered projects\n\nRegister with: `/register ProjectName /path/to/project`', { parse_mode: 'Markdown' });
      return;
    }

    const projectList = projects.map((p, i) => {
      const autoSpawnEmoji = p.autoSpawn ? '🔄' : '⏸️';
      const lastAccessed = new Date(p.lastAccessed).toLocaleDateString();
      const running = isClaudeRunning(p.name) ? '🟢' : '⚪';
      return `${i + 1}. ${running} *${p.name}* ${autoSpawnEmoji}\n   📍 ${p.path}\n   🕐 Last: ${lastAccessed}`;
    }).join('\n\n');

    await ctx.reply(
      `*Registered Projects* (${projects.length})\n\n${projectList}\n\n🟢 Running  ⚪ Offline  🔄 Auto-spawn  ⏸️ Manual`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('register', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);

  if (args.length < 2) {
    await ctx.reply(
      '📝 *Register a Project*\n\n' +
      'Usage: `/register ProjectName /path/to/project [--auto-spawn]`\n\n' +
      'Example: `/register MyApp ~/code/myapp --auto-spawn`\n\n' +
      'Options:\n' +
      '• `--auto-spawn`: Auto-start Claude when messages arrive',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const projectName = args[0];
  const projectPath = args[1].replace('~', process.env.HOME || '~');
  const autoSpawn = args.includes('--auto-spawn');

  try {
    // Validate path exists
    const isValid = await validateProjectPath(projectPath);
    if (!isValid) {
      await ctx.reply(`❌ Path does not exist or is not a directory: ${projectPath}`);
      return;
    }

    await registerProject(projectName, projectPath, { autoSpawn });
    await ctx.reply(
      `✅ Project registered successfully!\n\n` +
      `📁 *${projectName}*\n` +
      `📍 ${projectPath}\n` +
      `${autoSpawn ? '🔄 Auto-spawn enabled' : '⏸️ Manual spawn only'}\n\n` +
      `Spawn with: \`/spawn ${projectName}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    await ctx.reply(`❌ Registration failed: ${error.message}`);
  }
});

bot.command('unregister', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);

  if (args.length === 0) {
    await ctx.reply('Usage: `/unregister ProjectName`', { parse_mode: 'Markdown' });
    return;
  }

  const projectName = args[0];

  try {
    const success = await unregisterProject(projectName);
    if (success) {
      await ctx.reply(`✅ Project *${projectName}* unregistered`, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(`❌ Project *${projectName}* not found`, { parse_mode: 'Markdown' });
    }
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('spawn', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);

  if (args.length === 0) {
    await ctx.reply(
      '🚀 *Spawn Claude in a Project*\n\n' +
      'Usage: `/spawn ProjectName [prompt]`\n\n' +
      'Example:\n' +
      '`/spawn MyApp`\n' +
      '`/spawn MyApp "Fix the login bug"`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const projectName = args[0];
  const initialPrompt = args.slice(1).join(' ') || undefined;

  try {
    await ctx.reply(`⏳ Starting Claude in *${projectName}*...`, { parse_mode: 'Markdown' });

    // Create callback to send Claude output to Telegram
    const outputCallback = async (data: string, isError: boolean) => {
      console.log(`[CALLBACK] Received output for ${projectName}: ${data.substring(0, 100)}...`);

      if (!chatId) {
        console.error('[CALLBACK] No chatId available, cannot send to Telegram');
        return;
      }

      try {
        const emoji = isError ? '❌' : '🤖';
        console.log(`[CALLBACK] Sending to Telegram chatId: ${chatId}`);
        await bot.telegram.sendMessage(
          chatId,
          `📁 *${projectName}*\n${emoji} ${data}`,
          { parse_mode: 'Markdown' }
        );
        console.log(`[CALLBACK] Successfully sent to Telegram`);
      } catch (error) {
        console.error('[CALLBACK] Failed to send Claude output to Telegram:', error);
      }
    };

    console.log(`[SPAWN] Creating callback for ${projectName}, chatId: ${chatId}`);
    const result = await spawnClaude(projectName, initialPrompt, outputCallback);

    if (result.success) {
      await ctx.reply(
        `${result.message}\n\n` +
        `PID: ${result.pid}\n\n` +
        `You can now send messages to it: \`${projectName}: your message\``,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(`❌ ${result.message}`);
    }
  } catch (error: any) {
    await ctx.reply(`❌ Spawn failed: ${error.message}`);
  }
});

bot.command('kill', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);

  if (args.length === 0) {
    await ctx.reply('Usage: `/kill ProjectName`', { parse_mode: 'Markdown' });
    return;
  }

  const projectName = args[0];

  try {
    const result = killClaude(projectName);

    if (result.success) {
      await ctx.reply(`🛑 ${result.message}`);
    } else {
      await ctx.reply(`❌ ${result.message}`);
    }
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('spawned', async (ctx) => {
  try {
    const spawned = listSpawnedProcesses();

    if (spawned.length === 0) {
      await ctx.reply('📭 No spawned Claude processes');
      return;
    }

    const spawnedList = spawned.map((s, i) => {
      const prompt = s.initialPrompt ? `\n   💬 "${s.initialPrompt.substring(0, 50)}${s.initialPrompt.length > 50 ? '...' : ''}"` : '';
      return `${i + 1}. *${s.projectName}*\n   🆔 PID: ${s.pid}\n   ⏱️  Running: ${s.runningMinutes}m${prompt}`;
    }).join('\n\n');

    await ctx.reply(
      `*Spawned Claude Processes* (${spawned.length})\n\n${spawnedList}\n\n_Kill with: /kill ProjectName_`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
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

  // Check if message is targeted to a specific project: "ProjectName: message"
  const projectMatch = message.match(/^([a-zA-Z0-9-_]+):\s*(.+)/);
  if (projectMatch) {
    const [, targetProject, actualMessage] = projectMatch;

    // Check if project has an active session
    const activeSession = Array.from(activeSessions.values())
      .find(s => s.projectName.toLowerCase() === targetProject.toLowerCase());

    // Check if Claude is actually running (not just session registered)
    const claudeActuallyRunning = isClaudeRunning(targetProject);

    if (activeSession && claudeActuallyRunning) {
      // Add to message queue with session ID
      messageQueue.push({
        from,
        message: actualMessage,
        timestamp: new Date(),
        read: false,
        sessionId: activeSession.id
      });
      await ctx.reply(`💬 Message sent to active session: *${activeSession.projectName}*`, { parse_mode: 'Markdown' });
    } else {
      // Clean up stale session if Claude exited
      if (activeSession && !claudeActuallyRunning) {
        console.log(`[CLEANUP] Removing stale session for ${activeSession.projectName} (Claude not running)`);
        activeSessions.delete(activeSession.id);
      }
      // No active session - check if project is registered and should auto-spawn
      try {
        const project = await findProject(targetProject);

        if (project && project.autoSpawn) {
          // Auto-spawn Claude for this project
          await ctx.reply(`⏳ Auto-spawning Claude for *${project.name}*...`, { parse_mode: 'Markdown' });

          // Create callback to send Claude output to Telegram
          const outputCallback = async (data: string, isError: boolean) => {
            console.log(`[AUTO-SPAWN CALLBACK] Received output for ${project.name}: ${data.substring(0, 100)}...`);

            if (!chatId) {
              console.error('[AUTO-SPAWN CALLBACK] No chatId available, cannot send to Telegram');
              return;
            }

            try {
              const emoji = isError ? '❌' : '🤖';
              console.log(`[AUTO-SPAWN CALLBACK] Sending to Telegram chatId: ${chatId}`);
              await bot.telegram.sendMessage(
                chatId,
                `📁 *${project.name}*\n${emoji} ${data}`,
                { parse_mode: 'Markdown' }
              );
              console.log(`[AUTO-SPAWN CALLBACK] Successfully sent to Telegram`);
            } catch (error) {
              console.error('[AUTO-SPAWN CALLBACK] Failed to send Claude output to Telegram:', error);
            }
          };

          console.log(`[AUTO-SPAWN] Creating callback for ${project.name}, chatId: ${chatId}`);
          const result = await spawnClaude(project.name, actualMessage, outputCallback);

          if (result.success) {
            await ctx.reply(
              `✅ Claude started for *${project.name}*\n\n` +
              `PID: ${result.pid}\n` +
              `💬 Your message was passed as the initial prompt.`,
              { parse_mode: 'Markdown' }
            );
          } else {
            // Spawn failed - queue the message instead
            await enqueueTask({
              projectName: targetProject,
              projectPath: project.path,
              message: actualMessage,
              from,
              priority: 'normal',
              timestamp: new Date()
            });
            await ctx.reply(`❌ Auto-spawn failed: ${result.message}\n\n📥 Message queued instead.`, { parse_mode: 'Markdown' });
          }
        } else if (project) {
          // Project exists but auto-spawn disabled - just queue
          await enqueueTask({
            projectName: targetProject,
            projectPath: project.path,
            message: actualMessage,
            from,
            priority: 'normal',
            timestamp: new Date()
          });
          await ctx.reply(
            `📥 Message queued for *${project.name}* (offline)\n\n` +
            `Auto-spawn is disabled. Start manually with: \`/spawn ${project.name}\``,
            { parse_mode: 'Markdown' }
          );
        } else {
          // Project not registered
          await enqueueTask({
            projectName: targetProject,
            projectPath: '/unknown',
            message: actualMessage,
            from,
            priority: 'normal',
            timestamp: new Date()
          });
          await ctx.reply(
            `📥 Message queued for *${targetProject}* (not registered)\n\n` +
            `Register with: \`/register ${targetProject} /path/to/project --auto-spawn\``,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (error: any) {
        await ctx.reply(`❌ Failed to process message: ${error.message}`);
      }
    }
    return;
  }

  // No project specified - check if we should auto-route to last session
  if (lastMessageSession && activeSessions.has(lastMessageSession)) {
    const session = activeSessions.get(lastMessageSession)!;
    messageQueue.push({
      from,
      message,
      timestamp: new Date(),
      read: false,
      sessionId: lastMessageSession
    });
    await ctx.reply(`💬 Auto-routed to: 📁 *${session.projectName}* [#${lastMessageSession.substring(0, 7)}]`, { parse_mode: 'Markdown' });
    console.log(`📥 Auto-routed to ${session.projectName}`);
  } else {
    // No recent session - add to general message queue
    messageQueue.push({
      from,
      message,
      timestamp: new Date(),
      read: false
    });
    await ctx.reply('💬 Message received - responding...');
    console.log('📥 Queued for Claude to process');
  }
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

// Queue management endpoints
app.post('/queue/add', async (req, res) => {
  const { projectName, projectPath, message, from, priority = 'normal' } = req.body;

  if (!projectName || !message || !from) {
    return res.status(400).json({ error: 'projectName, message, and from are required' });
  }

  try {
    const task = await enqueueTask({
      projectName,
      projectPath: projectPath || '/unknown',
      message,
      from,
      priority,
      timestamp: new Date()
    });

    res.json({ success: true, taskId: task.id, task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/queue/:projectName', async (req, res) => {
  const { projectName } = req.params;

  try {
    const tasks = await getPendingTasks(projectName);
    res.json({ projectName, tasks, count: tasks.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/queue/:projectName/mark-delivered', async (req, res) => {
  const { projectName } = req.params;
  const { taskId } = req.body;

  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  try {
    await markTaskDelivered(projectName, taskId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/queue/summary', async (req, res) => {
  try {
    const summary = await getQueueSummary();
    res.json({ summary, totalProjects: summary.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
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
        // Track this as the last session that sent a message
        lastMessageSession = sessionId;
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

// Project registry endpoints
app.get('/projects', async (req, res) => {
  try {
    const projects = await loadProjects();
    res.json({ projects, count: projects.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/projects/register', async (req, res) => {
  const { name, path: projectPath, autoSpawn, description, tags } = req.body;

  if (!name || !projectPath) {
    return res.status(400).json({ error: 'name and path are required' });
  }

  try {
    const isValid = await validateProjectPath(projectPath);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid path or not a directory' });
    }

    const project = await registerProject(name, projectPath, { autoSpawn, description, tags });
    res.json({ success: true, project });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/projects/:name', async (req, res) => {
  const { name } = req.params;

  try {
    const success = await unregisterProject(name);
    if (success) {
      res.json({ success: true, message: `Project ${name} unregistered` });
    } else {
      res.status(404).json({ error: 'Project not found' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/projects/:name', async (req, res) => {
  const { name } = req.params;

  try {
    const project = await findProject(name);
    if (project) {
      res.json({ project });
    } else {
      res.status(404).json({ error: 'Project not found' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Claude spawner endpoints
app.post('/spawn', async (req, res) => {
  const { projectName, initialPrompt } = req.body;

  if (!projectName) {
    return res.status(400).json({ error: 'projectName is required' });
  }

  try {
    // Create callback to send Claude output to Telegram
    const outputCallback = chatId ? async (data: string, isError: boolean) => {
      console.log(`[HTTP CALLBACK] Received output for ${projectName}: ${data.substring(0, 100)}...`);

      try {
        const emoji = isError ? '❌' : '🤖';
        console.log(`[HTTP CALLBACK] Sending to Telegram chatId: ${chatId}`);
        await bot.telegram.sendMessage(
          chatId!,
          `📁 *${projectName}*\n${emoji} ${data}`,
          { parse_mode: 'Markdown' }
        );
        console.log(`[HTTP CALLBACK] Successfully sent to Telegram`);
      } catch (error) {
        console.error('[HTTP CALLBACK] Failed to send Claude output to Telegram:', error);
      }
    } : undefined;

    console.log(`[HTTP /spawn] Creating callback for ${projectName}, chatId: ${chatId}, hasCallback: ${!!outputCallback}`);
    const result = await spawnClaude(projectName, initialPrompt, outputCallback);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/kill/:projectName', (req, res) => {
  const { projectName } = req.params;

  try {
    const result = killClaude(projectName);
    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/spawned', (req, res) => {
  try {
    const spawned = listSpawnedProcesses();
    res.json({ processes: spawned, count: spawned.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/spawned/:projectName', (req, res) => {
  const { projectName } = req.params;

  try {
    const running = isClaudeRunning(projectName);
    if (running) {
      const spawned = listSpawnedProcesses().find(p => p.projectName === projectName);
      res.json({ running: true, process: spawned });
    } else {
      res.json({ running: false });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
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
