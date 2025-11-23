#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BRIDGE_URL = process.env.TELEGRAM_BRIDGE_URL || 'http://localhost:3456';
const BRIDGE_PORT = new URL(BRIDGE_URL).port || '3456';
const BRIDGE_HOST = new URL(BRIDGE_URL).hostname || 'localhost';

let bridgeProcess: ChildProcess | null = null;

// Session management
let currentSessionId: string | null = null;
let currentProjectName: string | null = null;
let currentProjectPath: string | null = null;

// Get or create session ID
function getSessionId(): string {
  if (!currentSessionId) {
    currentSessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  return currentSessionId;
}

// Get project name from current working directory
function getProjectInfo(): { name: string; path: string } {
  const cwd = process.cwd();
  const name = cwd.split('/').pop() || 'Unknown';
  return { name, path: cwd };
}

// Register this session with the bridge
async function registerSession(): Promise<void> {
  const sessionId = getSessionId();
  const { name, path } = getProjectInfo();

  currentProjectName = name;
  currentProjectPath = path;

  try {
    await fetch(`${BRIDGE_URL}/session/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        projectName: name,
        projectPath: path
      })
    });
    console.error(`✅ Session registered: ${name} [${sessionId.substring(0, 7)}]`);
  } catch (error) {
    console.error('⚠️  Failed to register session:', error);
  }
}

// Check if the bridge is running
async function isBridgeRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${BRIDGE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Start the Telegram bridge
async function startBridge(): Promise<void> {
  console.error('🚀 Starting Telegram bridge...');

  // Find the project root (one level up from dist or src)
  const projectRoot = join(__dirname, '..');
  const bridgeScript = join(projectRoot, 'dist', 'index.js');

  // Start the bridge process
  bridgeProcess = spawn('node', [bridgeScript], {
    env: {
      ...process.env,
      PORT: BRIDGE_PORT,
      HOST: BRIDGE_HOST,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Log bridge output
  if (bridgeProcess.stdout) {
    bridgeProcess.stdout.on('data', (data) => {
      console.error(`[Bridge] ${data.toString().trim()}`);
    });
  }

  if (bridgeProcess.stderr) {
    bridgeProcess.stderr.on('data', (data) => {
      console.error(`[Bridge] ${data.toString().trim()}`);
    });
  }

  bridgeProcess.on('error', (error) => {
    console.error('❌ Bridge process error:', error);
  });

  bridgeProcess.on('exit', (code) => {
    console.error(`⚠️  Bridge process exited with code ${code}`);
    bridgeProcess = null;
  });

  // Wait for the bridge to be ready
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (await isBridgeRunning()) {
      console.error('✅ Telegram bridge is ready');
      return;
    }
  }

  throw new Error('Bridge failed to start after 5 seconds');
}

// Ensure the bridge is running
async function ensureBridge(): Promise<void> {
  if (await isBridgeRunning()) {
    console.error('✅ Telegram bridge is already running');
    return;
  }

  await startBridge();
}

// Define the Telegram bridge tools
const TOOLS: Tool[] = [
  {
    name: 'telegram_notify',
    description: 'Send a notification to the user via Telegram. Use this to keep the user informed about progress, completion, warnings, or errors.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The notification message to send. Supports Markdown formatting.',
        },
        priority: {
          type: 'string',
          enum: ['info', 'success', 'warning', 'error', 'question'],
          description: 'Priority level: info (ℹ️ general), success (✅ completed), warning (⚠️ alert), error (❌ failure), question (❓ needs input)',
          default: 'info',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'telegram_ask',
    description: 'Ask the user a question via Telegram and wait for their answer. This blocks until the user responds. Use for decisions that require user input.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user. Supports Markdown formatting.',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 300000 = 5 minutes)',
          default: 300000,
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'telegram_get_messages',
    description: 'Retrieve unread messages from the user. Use this to check if the user has sent any messages.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'telegram_reply',
    description: 'Send a reply to a user message via Telegram. Use after getting messages to respond to the user.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The reply message. Supports Markdown formatting.',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'telegram_check_health',
    description: 'Check the health and status of the Telegram bridge. Returns connection status, unread message count, and pending questions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'telegram_toggle_afk',
    description: 'Toggle InnerVoice AFK mode - enables or disables Telegram notifications. Use this when going away from the system to enable notifications, or when back to disable them.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Create the MCP server
const server = new Server(
  {
    name: 'telegram-bridge',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'telegram_notify': {
        const { message, priority = 'info' } = args as { message: string; priority?: string };

        const response = await fetch(`${BRIDGE_URL}/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            priority,
            sessionId: getSessionId()
          }),
        });

        if (!response.ok) {
          const error: any = await response.json();
          throw new Error(error.error || 'Failed to send notification');
        }

        return {
          content: [
            {
              type: 'text',
              text: `✅ Notification sent successfully to Telegram (priority: ${priority})`,
            },
          ],
        };
      }

      case 'telegram_ask': {
        const { question, timeout = 300000 } = args as { question: string; timeout?: number };

        const response = await fetch(`${BRIDGE_URL}/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, timeout }),
        });

        if (!response.ok) {
          const error: any = await response.json();
          throw new Error(error.error || 'Failed to ask question');
        }

        const result: any = await response.json();
        return {
          content: [
            {
              type: 'text',
              text: `User's answer: ${result.answer}`,
            },
          ],
        };
      }

      case 'telegram_get_messages': {
        const response = await fetch(`${BRIDGE_URL}/messages`);

        if (!response.ok) {
          const error: any = await response.json();
          throw new Error(error.error || 'Failed to get messages');
        }

        const result: any = await response.json();
        const messages = result.messages.map((m: any) =>
          `[${m.timestamp}] ${m.from}: ${m.message}`
        ).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: result.count > 0
                ? `📬 ${result.count} unread message(s):\n\n${messages}`
                : '📭 No unread messages',
            },
          ],
        };
      }

      case 'telegram_reply': {
        const { message } = args as { message: string };

        const response = await fetch(`${BRIDGE_URL}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });

        if (!response.ok) {
          const error: any = await response.json();
          throw new Error(error.error || 'Failed to send reply');
        }

        return {
          content: [
            {
              type: 'text',
              text: '✅ Reply sent successfully to Telegram',
            },
          ],
        };
      }

      case 'telegram_check_health': {
        const response = await fetch(`${BRIDGE_URL}/health`);

        if (!response.ok) {
          throw new Error('Bridge is not responding');
        }

        const health: any = await response.json();
        const statusText = [
          `🏥 Telegram Bridge Health Check`,
          ``,
          `Status: ${health.status}`,
          `Enabled: ${health.enabled ? '✅' : '❌'}`,
          `Chat ID: ${health.chatId}`,
          `Unread Messages: ${health.unreadMessages}`,
          `Pending Questions: ${health.pendingQuestions}`,
        ].join('\n');

        return {
          content: [
            {
              type: 'text',
              text: statusText,
            },
          ],
        };
      }

      case 'telegram_toggle_afk': {
        const response = await fetch(`${BRIDGE_URL}/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error('Failed to toggle AFK mode');
        }

        const result: any = await response.json();
        const icon = result.enabled ? '🟢' : '🔴';
        const status = result.enabled ? 'ENABLED' : 'DISABLED';

        return {
          content: [
            {
              type: 'text',
              text: `${icon} InnerVoice AFK mode toggled: ${status}\n\n${result.message}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: `❌ Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Cleanup function
function cleanup() {
  console.error('\n👋 Shutting down MCP server...');
  if (bridgeProcess) {
    console.error('🛑 Stopping bridge process...');
    bridgeProcess.kill('SIGTERM');
    bridgeProcess = null;
  }
}

// Handle shutdown signals
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

// Start the server
async function main() {
  // Ensure the bridge is running before starting the MCP server
  await ensureBridge();

  // Register this Claude session
  await registerSession();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🚀 Telegram MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  cleanup();
  process.exit(1);
});
