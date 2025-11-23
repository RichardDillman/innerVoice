# Telegram MCP Server - Usage Guide

## What You've Built

You now have a **standardized MCP (Model Context Protocol) server** that any Claude instance can use to communicate with you via Telegram!

## How It Works

### Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────┐
│  Claude Code    │◄────►│  MCP Server      │◄────►│  HTTP API   │
│  (any instance) │      │  (stdio protocol)│      │  (:3456)    │
└─────────────────┘      └──────────────────┘      └──────┬──────┘
                                                            │
                                                            ▼
                                                    ┌───────────────┐
                                                    │  Telegram Bot │
                                                    │  (Telegraf)   │
                                                    └───────┬───────┘
                                                            │
                                                            ▼
                                                    ┌───────────────┐
                                                    │   Your Phone  │
                                                    │   (Telegram)  │
                                                    └───────────────┘
```

### Two Components

1. **HTTP Bridge** (`pnpm dev`) - Always running service that communicates with Telegram
2. **MCP Server** (auto-started by Claude) - Translates Claude's tool calls to HTTP requests

## Installation Steps

### 1. Build the Project

```bash
cd claude-telegram-bridge
pnpm install
pnpm build
```

### 2. Start the Bridge Service

```bash
# Option 1: Development mode (foreground)
pnpm dev

# Option 2: Production mode (background daemon)
pnpm daemon

# Check daemon logs
pnpm logs

# Stop daemon
pnpm stop
```

### 3. Configure Your Claude Code MCP Settings

**Location:** `~/.config/claude-code/settings/mcp.json` (or Claude Desktop settings)

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

**Replace `/ABSOLUTE/PATH/TO/` with your actual installation path!**

To find your path:
```bash
cd claude-telegram-bridge
pwd
# Use the output + /dist/mcp-server.js
```

### 4. Initialize Your Telegram Bot

1. Open Telegram on your phone
2. Search for your bot (get username from BotFather)
3. Send `/start` to the bot
4. The bot will save your chat ID automatically

## Using the MCP Server

Once configured, Claude will have access to these tools automatically:

### Example 1: Simple Notification

**You say:**
> "When you finish installing the packages, send me a notification via Telegram"

**Claude will:**
```typescript
// Claude automatically uses:
telegram_notify({
  message: "✅ All packages installed successfully!",
  priority: "success"
})
```

**You receive in Telegram:**
> ✅ All packages installed successfully!

---

### Example 2: Ask for Approval

**You say:**
> "Run the database migration, but ask me for confirmation before applying it"

**Claude will:**
```typescript
// Step 1: Prepare migration
// ...

// Step 2: Ask for approval
const answer = await telegram_ask({
  question: "Database migration ready. Apply now? (yes/no)"
})

// Step 3: Proceed based on your answer
if (answer.toLowerCase() === 'yes') {
  // Apply migration
}
```

**You receive in Telegram:**
> ❓ Database migration ready. Apply now? (yes/no)

**You reply:**
> yes

**Claude receives your answer and continues**

---

### Example 3: Check for Messages

**You say:**
> "Check if I've sent you any messages via Telegram"

**Claude will:**
```typescript
// Claude uses:
telegram_get_messages({})

// Then reports back to you in the chat
```

---

### Example 4: Health Check

**You say:**
> "Is the Telegram bridge working?"

**Claude will:**
```typescript
// Claude uses:
telegram_check_health({})

// Returns status, unread messages, etc.
```

## Available Tools

| Tool | Purpose | Blocks? |
|------|---------|---------|
| `telegram_notify` | Send notification | No |
| `telegram_ask` | Ask question, wait for answer | Yes (5 min timeout) |
| `telegram_get_messages` | Get unread messages | No |
| `telegram_reply` | Reply to message | No |
| `telegram_check_health` | Check bridge status | No |

## Best Practices

### When Claude Should Use These Tools

1. **Long-running operations** - Notify when complete
2. **Critical decisions** - Ask for approval via `telegram_ask`
3. **Background tasks** - Update progress periodically
4. **Errors that need attention** - Send error notifications
5. **User input needed** - Ask questions when uncertain

### Example Workflow

```
User: "Scrape the ESO website and notify me when done"

Claude thinks:
  1. Start scraping
  2. Every 100 items → telegram_notify({ message: "Progress: 100 items scraped" })
  3. If error → telegram_notify({ message: "Error occurred", priority: "error" })
  4. When complete → telegram_notify({ message: "Scraping complete!", priority: "success" })
```

## Troubleshooting

### Bridge Not Running
```bash
curl http://localhost:3456/health
```

If no response:
```bash
pnpm dev  # Start the bridge
```

### MCP Server Not Found

Check the path in your MCP config:
```bash
cd claude-telegram-bridge
ls dist/mcp-server.js
```

Update the path in `mcp.json` if needed.

### Chat ID Not Set

Message your bot with `/start` in Telegram.

### Testing the Tools Manually

Test the HTTP API directly:
```bash
# Test notification
curl -X POST http://localhost:3456/notify \
  -H "Content-Type: application/json" \
  -d '{"message": "Test!", "priority": "info"}'

# Check health
curl http://localhost:3456/health
```

## Sharing with Other Claude Instances

Now that this is an MCP server, you can grant access to:
- Claude Code (CLI)
- Claude Desktop
- Other MCP-compatible clients

Just add the same configuration to their MCP settings!

## Environment Variables

```env
# .env file
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=auto_set_on_start
PORT=3456
HOST=localhost
ENABLED=true
TELEGRAM_BRIDGE_URL=http://localhost:3456  # For MCP server
```

## Security Notes

- The bridge runs on `localhost:3456` by default
- Only accessible from your machine
- Your Telegram bot token is in `.env` (keep it secret!)
- Chat ID is saved after you send `/start`

## Next Steps

1. Start the bridge: `pnpm dev`
2. Add to Claude Code MCP config
3. Restart Claude Code
4. Test: "Send me a test notification via Telegram"
5. Enjoy real-time communication with Claude!
