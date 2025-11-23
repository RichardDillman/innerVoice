#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

const BRIDGE_URL = process.env.TELEGRAM_BRIDGE_URL || 'http://localhost:3456';

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
          body: JSON.stringify({ message, priority }),
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

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🚀 Telegram MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
