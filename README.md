# InnerVoice

**Your inner thoughts, delivered to Telegram**

*MCP Server for Two-Way Communication with Claude Code and any app*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This is a proper **Model Context Protocol (MCP) server** that enables any Claude instance to communicate with you via Telegram. Just grant Claude access to this MCP server, and it can send notifications, ask questions, and receive messages from you in real-time!

> **🆕 New to MCP servers?** Start with the [Beginner's Guide](BEGINNER-GUIDE.md) - zero experience required!
>
> **Free to use, share, and modify!** See [LICENSE](LICENSE) for details.

## Why This Exists

After trying email, SMS, and Google Chat integrations, Telegram emerged as the best solution for:
- ✅ **Standardized MCP Integration** - Works with any Claude instance automatically
- ✅ Instant two-way communication
- ✅ Free and reliable
- ✅ Works on all devices
- ✅ Simple setup
- ✅ No carrier dependencies

## Features

- 💬 **Two-Way Communication** - Send messages to Claude, get responses back
- ❓ **Question/Answer Flow** - Claude can ask you questions and wait for answers
- 📬 **Message Queue** - Messages queue up when Claude is busy, get answered ASAP
- 🔔 **Priority Notifications** - Different icons for info, success, warning, error, question
- 🌐 **HTTP API** - Easy integration from any app/project
- 🚀 **Background Service** - Runs independently, always available
- 🔧 **MCP Protocol** - Works as a standard MCP server in any Claude project

## How It Works

This is a **standard MCP server** that works like any other MCP tool. Once installed and configured:

1. **Bridge runs** as a background service (connects to Telegram)
2. **MCP server** is auto-started by Claude when needed
3. **Claude discovers** 5 tools automatically
4. **You communicate** via Telegram in real-time

## Quick Start

### 1. Create Your Telegram Bot

1. **Open Telegram** and search for `@BotFather`
2. **Send** `/newbot`
3. **Follow the prompts:**
   - Choose a name for your bot (e.g., "My Claude Bridge")
   - Choose a username (e.g., "my_claude_bridge_bot")
4. **Save your bot token** - BotFather will give you a token like:
   ```
   1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   ```
5. **Find your bot** in Telegram using the username you created

### 2. Install and Configure

```bash
# Clone or download this repo
cd innervoice

# Install dependencies
pnpm install

# The .env file is created automatically!
# Just edit it and add your bot token
# TELEGRAM_BOT_TOKEN=your_token_here
```

**Edit `.env`:**
```env
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=  # Leave empty - auto-set on first use
PORT=3456
HOST=localhost
ENABLED=true
```

### 3. Build and Start

```bash
# Build the project
pnpm build

# Start the bridge service
pnpm dev

# Or run as background daemon
pnpm daemon
```

### 4. Initialize Your Bot

1. Open Telegram and find your bot
2. Send `/start` to your bot
3. The bot will reply and save your chat ID automatically
4. Test with `/status` to verify it's working

### 5. Add MCP Server to Claude

> **✨ Auto-Start Feature:** The MCP server now automatically starts the Telegram bridge when needed - no need to run it separately!

#### Option A: Claude Code CLI (Recommended)

> **Note:** Using `claude mcp add` automatically adds the server **globally** (available in all projects). This is the recommended approach.

**For Mac and Linux:**
```bash
# Navigate to the innervoice directory
cd /path/to/innervoice

# Add the MCP server globally (available in all projects)
claude mcp add --transport stdio telegram \
  --env TELEGRAM_BRIDGE_URL=http://localhost:3456 \
  -- node "$(pwd)/dist/mcp-server.js"

# Verify it was added globally
claude mcp list
```

**For Windows (PowerShell):**
```powershell
# Navigate to the innervoice directory
cd C:\path\to\innervoice

# Add the MCP server globally
claude mcp add --transport stdio telegram `
  --env TELEGRAM_BRIDGE_URL=http://localhost:3456 `
  -- node "$((Get-Location).Path)\dist\mcp-server.js"

# Verify it was added
claude mcp list
```

**For Windows (Command Prompt):**
```cmd
# Navigate to the innervoice directory
cd C:\path\to\innervoice

# Add the MCP server globally
claude mcp add --transport stdio telegram --env TELEGRAM_BRIDGE_URL=http://localhost:3456 -- node "%CD%\dist\mcp-server.js"

# Verify it was added
claude mcp list
```

#### Option B: Manual Config File Setup

Add to your Claude Code MCP settings:

**Mac/Linux:** `~/.claude.json`
**Windows:** `%USERPROFILE%\.claude.json`

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/innervoice/dist/mcp-server.js"
      ],
      "env": {
        "TELEGRAM_BRIDGE_URL": "http://localhost:3456"
      }
    }
  }
}
```

**Find your absolute path:**

**Mac/Linux:**
```bash
cd innervoice && pwd
# Use output: <result>/dist/mcp-server.js
```

**Windows (PowerShell):**
```powershell
cd innervoice
(Get-Location).Path
# Use output: <result>\dist\mcp-server.js
```

**Windows (Command Prompt):**
```cmd
cd innervoice
cd
# Use output: <result>\dist\mcp-server.js
```

### 6. Available Tools

Once configured, Claude can automatically use:
- `telegram_notify` - Send notifications
- `telegram_ask` - Ask questions and wait for answers
- `telegram_get_messages` - Check for messages from you
- `telegram_reply` - Reply to your messages
- `telegram_check_health` - Check bridge status
- `telegram_toggle_afk` - Toggle AFK mode (enable/disable notifications)

**View detailed tool info:**
```bash
pnpm tools
# or
node scripts/list-tools.js
```

### 7. AFK Mode - Control Your Notifications

Use the `/afk` slash command to toggle notifications on/off:

```bash
# In Claude Code, just type:
/afk
```

This is perfect for:
- **Enabling** when you step away from your computer (get notified via Telegram)
- **Disabling** when you're actively working (no interruptions)

The toggle state is preserved while the bridge is running, and you'll get a Telegram message confirming each change.

### 8. Verify Global Setup

After adding the MCP server, verify it's available globally:

```bash
# Check that telegram appears in the list
claude mcp list

# Should show:
# ✓ telegram: Connected
```

**Troubleshooting:** If `telegram` only appears in one project but not others, it was added to a project-specific config instead of globally. To fix:

1. Open `~/.claude.json` in your editor
2. Find the `telegram` server config under `projects` → `your-project-path` → `mcpServers`
3. **Move it** to the root-level `mcpServers` section (same level as other global servers)
4. Remove the `telegram` entry from the project-specific section

**Example structure:**
```json
{
  "mcpServers": {
    "telegram": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/innervoice/dist/mcp-server.js"],
      "env": {"TELEGRAM_BRIDGE_URL": "http://localhost:3456"}
    }
  },
  "projects": {
    "/your/project/path": {
      "mcpServers": {}  // Should be empty or not contain telegram
    }
  }
}
```

### 9. Test It

Restart Claude Code, then tell Claude:

> "Send me a test notification via Telegram"

Claude will automatically discover and use the `telegram_notify` tool!

## MCP Tools Reference

Once configured, Claude can automatically use these tools:

### `telegram_notify`
Send a notification to you via Telegram.

**Parameters:**
- `message` (required): The notification text (supports Markdown)
- `priority` (optional): `info` | `success` | `warning` | `error` | `question`

**Example Claude Usage:**
> "I've completed the database migration. Let me notify you."
> *Claude uses: `telegram_notify({ message: "Database migration complete!", priority: "success" })`*

### `telegram_ask`
Ask you a question and wait for your answer (blocking).

**Parameters:**
- `question` (required): The question to ask (supports Markdown)
- `timeout` (optional): Milliseconds to wait (default: 300000 = 5 min)

**Example Claude Usage:**
> "Should I deploy to production? Let me ask you."
> *Claude uses: `telegram_ask({ question: "Deploy to production now?" })`*
> *Waits for your response via Telegram*

### `telegram_get_messages`
Check for unread messages from you.

**Example Claude Usage:**
> "Let me check if you've sent any messages."
> *Claude uses: `telegram_get_messages({})`*

### `telegram_reply`
Reply to your message via Telegram.

**Parameters:**
- `message` (required): Your reply (supports Markdown)

**Example Claude Usage:**
> "I'll respond to your question via Telegram."
> *Claude uses: `telegram_reply({ message: "The build succeeded!" })`*

### `telegram_check_health`
Check if the Telegram bridge is running and healthy.

**Example Claude Usage:**
> "Let me verify the Telegram bridge is working."
> *Claude uses: `telegram_check_health({})`*

### `telegram_toggle_afk`
Toggle AFK (Away From Keyboard) mode - enables or disables Telegram notifications.

**No parameters required**

**Example Claude Usage:**
> "Toggle AFK mode"
> *Claude uses: `telegram_toggle_afk({})`*

**When to use:**
- Enable when stepping away from your computer (get notifications)
- Disable when actively working (avoid interruptions)
- State is preserved while the bridge is running

## Git Setup (For Sharing)

If you want to push this to your own Git repository:

```bash
# Initialize git (if not already done)
git init

# Add all files (gitignore protects secrets)
git add .

# Commit
git commit -m "Initial commit: Telegram MCP server"

# Add your remote
git remote add origin https://github.com/yourusername/innervoice.git

# Push
git push -u origin main
```

**What's Safe to Share:**
- ✅ All source code
- ✅ `.env.example` (template)
- ✅ Documentation
- ✅ Configuration templates

**What's Protected (in .gitignore):**
- 🔒 `.env` (your bot token and secrets)
- 🔒 `node_modules/`
- 🔒 `dist/`

## For Others Cloning Your Repository

When someone clones your repo, they need to:

1. **Create their own Telegram bot** with @BotFather
2. **Copy the template:** `cp .env.example .env`
3. **Add their bot token** to `.env`
4. **Install and build:** `pnpm install && pnpm build`
5. **Follow the Quick Start guide** above

## Legacy HTTP API (For Direct Integration)

If you want to use the HTTP API directly (without MCP), you can:

```typescript
// Simple notification
await fetch('http://localhost:3456/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Scraping complete! Found 500 skills.',
    priority: 'success'
  })
});

// Question with markdown
await fetch('http://localhost:3456/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: '*Question:*\nContinue scraping sets?\n\nReply: yes/no',
    priority: 'question',
    parseMode: 'Markdown'
  })
});
```

## Priority Levels

- `info` - ℹ️ General information
- `success` - ✅ Task completed
- `warning` - ⚠️ Warning message
- `error` - ❌ Error occurred
- `question` - ❓ Needs your input

## Bot Commands

Type these in Telegram to control the bridge:

- `/start` - Initialize connection and save your chat ID
- `/help` - Show all available commands and how to use the bridge
- `/status` - Check bridge status (enabled, unread messages, pending questions)
- `/test` - Send a test notification to verify it's working

## How Two-Way Communication Works

### You → Claude
1. Send any message to the bot in Telegram
2. Bot acknowledges with "💬 Message received - responding..."
3. Claude checks messages and responds when available
4. You get the response in Telegram

### Claude → You (Notifications)
Claude sends you updates via the `/notify` API endpoint with different priorities

### Claude → You (Questions)
1. Claude sends a question via `/ask` API
2. You see "❓ [question]" in Telegram
3. Your next message is automatically treated as the answer
4. Claude receives your answer and continues

## Running as Background Service

```bash
# Build production version
pnpm build

# Start as daemon (requires pm2)
npm install -g pm2
pnpm daemon

# Check logs
pnpm logs

# Stop daemon
pnpm stop
```

## API Endpoints

### POST /notify
Send a notification to user

**Request:**
```json
{
  "message": "Your notification text",
  "priority": "info|success|warning|error|question",
  "parseMode": "Markdown|HTML"
}
```

**Response:**
```json
{
  "success": true,
  "chatId": "7684777367"
}
```

### GET /messages
Get unread messages from user

**Response:**
```json
{
  "messages": [
    {
      "from": "Richard",
      "message": "What's the status?",
      "timestamp": "2025-11-23T04:00:52.395Z",
      "read": false
    }
  ],
  "count": 1
}
```

### POST /messages/read
Mark messages as read

**Request:**
```json
{
  "count": 2  // optional, marks all if not provided
}
```

**Response:**
```json
{
  "markedAsRead": 2
}
```

### POST /reply
Send a reply to user's message

**Request:**
```json
{
  "message": "Here's my response to your question"
}
```

**Response:**
```json
{
  "success": true
}
```

### POST /ask
Ask user a question and wait for answer (blocking)

**Request:**
```json
{
  "question": "Should I continue scraping?",
  "timeout": 300000  // optional, 5 min default
}
```

**Response:**
```json
{
  "answer": "yes"
}
```

### GET /health
Check service health

**Response:**
```json
{
  "status": "running",
  "enabled": true,
  "chatId": "set",
  "unreadMessages": 0,
  "pendingQuestions": 0
}
```

### POST /toggle
Toggle notifications on/off (AFK mode)

**Response:**
```json
{
  "success": true,
  "enabled": true,
  "previousState": false,
  "message": "🟢 InnerVoice notifications ENABLED - You will receive messages"
}
```

### GET /status
Get current notification state

**Response:**
```json
{
  "enabled": true,
  "message": "Notifications are ON"
}
```

## Integration with ESO-MCP

Add this helper to your ESO-MCP project:

```typescript
// src/utils/notify.ts
export async function notify(message: string, priority = 'info') {
  try {
    await fetch('http://localhost:3456/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, priority })
    });
  } catch (error) {
    console.log('Telegram bridge not available');
  }
}
```

Then use anywhere:
```typescript
await notify('✅ Skills scraping complete!', 'success');
await notify('❌ Failed to scrape sets page', 'error');
```

## Environment Variables

```env
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_CHAT_ID=auto_detected
PORT=3456
HOST=localhost
ENABLED=true
```

## Development

Want to contribute or modify the bridge? See [CONTRIBUTING.md](CONTRIBUTING.md) for local development setup.

## License

MIT License - see [LICENSE](LICENSE) for details

## Contact

- **Issues:** https://github.com/RichardDillman/innervoice/issues
- **Email:** rdillman@gmail.com
