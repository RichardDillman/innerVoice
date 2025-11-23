# Installation Guide

Quick reference for setting up the Claude Telegram Bridge MCP server.

## Prerequisites

- Node.js 18+ installed
- pnpm installed (`npm install -g pnpm`)
- Telegram account

## Step-by-Step Setup

### 1. Get Your Telegram Bot Token

1. Open Telegram and search for `@BotFather`
2. Send: `/newbot`
3. Name your bot (e.g., "My Claude Bridge")
4. Choose username (e.g., "my_claude_bridge_bot")
5. **Save the token** BotFather gives you

### 2. Install the Bridge

```bash
# Clone/download this repo
cd claude-telegram-bridge

# Install dependencies
pnpm install

# Create environment file
cp .env.example .env

# Edit .env and add your bot token
# TELEGRAM_BOT_TOKEN=paste_your_token_here
```

### 3. Build and Start

```bash
# Build
pnpm build

# Start (choose one)
pnpm dev          # Foreground
pnpm daemon       # Background (requires pm2)
```

### 4. Initialize Bot

1. Open Telegram
2. Find your bot
3. Send: `/start`
4. Bot saves your chat ID automatically

### 5. Configure Claude MCP

Edit `~/.config/claude-code/settings/mcp.json`:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/claude-telegram-bridge/dist/mcp-server.js"
      ],
      "env": {
        "TELEGRAM_BRIDGE_URL": "http://localhost:3456"
      }
    }
  }
}
```

Find your path with: `cd claude-telegram-bridge && pwd`

### 6. Test

Restart Claude Code and say:

> "Send me a test notification via Telegram"

You should receive a message in Telegram!

## Troubleshooting

**Bridge not running?**
```bash
curl http://localhost:3456/health
```

**MCP server not found?**
- Check the absolute path in your MCP config
- Make sure you ran `pnpm build`

**No Telegram messages?**
- Did you send `/start` to your bot?
- Check bridge logs: `pnpm logs` (if using daemon)

## Next Steps

See [README.md](README.md) for full documentation and usage examples.
