# Complete Beginner's Guide

**Never used an MCP server before? Start here!**

## What Is This?

This lets **Claude send you messages on Telegram** (the messaging app on your phone). Claude can:
- Send you notifications when tasks finish
- Ask you questions and wait for your answer
- Check messages you send to it

Think of it like giving Claude a phone number to text you.

## What You Need

Before starting, make sure you have:

- [ ] **Telegram app** installed on your phone ([Get it here](https://telegram.org/))
- [ ] **Claude Code** or **Claude Desktop** installed
- [ ] **Basic terminal/command line** knowledge (how to run commands)
- [ ] **10 minutes** of setup time

## Step-by-Step Setup

### Part 1: Create a Telegram Bot (5 minutes)

A "bot" is like a robot contact in Telegram that your computer can control.

1. **Open Telegram** on your phone or computer

2. **Search for** `@BotFather` (this is Telegram's official bot-making bot)

3. **Start a chat** with BotFather and send this message:
   ```
   /newbot
   ```

4. **BotFather will ask you questions:**

   Question: "Alright, a new bot. How are we going to call it?"
   → Answer: `My Claude Assistant` (or any name you want)

   Question: "Good. Now let's choose a username"
   → Answer: `my_claude_bot_123` (must end in `bot` and be unique)

5. **BotFather gives you a token** - It looks like this:
   ```
   123456789:ABCdefGHIjklMNOpqrsTUVwxyz-1234567890
   ```

   **IMPORTANT:** Copy this token! You'll need it in a minute.
   Keep it secret - anyone with this token can control your bot!

6. **Find your bot** in Telegram search and open a chat with it
   (It won't respond yet - that's normal!)

### Part 2: Install the Bridge (3 minutes)

Now we install the software that connects Claude to your Telegram bot.

1. **Download this project:**

   **Option A:** If you have git:
   ```bash
   git clone https://github.com/RichardDillman/claude-telegram-bridge.git
   cd claude-telegram-bridge
   ```

   **Option B:** No git?
   - Go to https://github.com/RichardDillman/claude-telegram-bridge
   - Click green "Code" button → "Download ZIP"
   - Unzip it
   - Open terminal in that folder

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

   Don't have `pnpm`? Install it first:
   ```bash
   npm install -g pnpm
   ```

   Don't have `npm`? [Install Node.js](https://nodejs.org/) (it includes npm)

3. **Set up your bot token:**
   ```bash
   cp .env.example .env
   ```

   Now edit `.env` file (use any text editor):
   - Replace `your_bot_token_here` with the token BotFather gave you
   - Save the file

4. **Build and start the bridge:**
   ```bash
   pnpm build
   pnpm dev
   ```

   You should see: `🤖 Telegram bot started`

   **Keep this terminal window open!** The bridge needs to stay running.

5. **Activate your bot:**
   - Go to Telegram
   - Find the chat with your bot
   - Send this message: `/start`
   - Bot should reply with "Claude Telegram Bridge Active"

   ✅ Your bridge is now working!

### Part 3: Connect Claude to the Bridge (2 minutes)

Now we tell Claude about your Telegram bridge.

1. **Find where your bridge is installed:**

   Open a NEW terminal window (keep the first one running!) and type:
   ```bash
   cd claude-telegram-bridge
   pwd
   ```

   Copy the output - it's your "bridge path"
   Example: `/Users/yourname/claude-telegram-bridge`

2. **Create or edit your MCP config file:**

   **For Claude Code (CLI):**

   Create a file at: `~/.config/claude-code/settings/mcp.json`

   Don't know how? Run this:
   ```bash
   mkdir -p ~/.config/claude-code/settings
   nano ~/.config/claude-code/settings/mcp.json
   ```

   **For Claude Desktop:**

   Already have settings → skip to next step

3. **Add this configuration:**

   Paste this (replace `/path/to/...` with your bridge path from step 1):

   ```json
   {
     "mcpServers": {
       "telegram": {
         "command": "node",
         "args": [
           "/path/to/claude-telegram-bridge/dist/mcp-server.js"
         ]
       }
     }
   }
   ```

   **Real example:**
   ```json
   {
     "mcpServers": {
       "telegram": {
         "command": "node",
         "args": [
           "/Users/john/claude-telegram-bridge/dist/mcp-server.js"
         ]
       }
     }
   }
   ```

   Save the file (Ctrl+O, Enter, Ctrl+X in nano)

4. **Restart Claude Code** or **Claude Desktop**

## Testing It Out

Now let's make sure everything works!

1. **Open Claude** (CLI or Desktop)

2. **Ask Claude to test it:**

   Type this to Claude:
   ```
   Send me a test notification via Telegram
   ```

3. **Check your phone** - You should get a Telegram message!

4. **If it worked:** 🎉 You're done! Claude can now message you.

5. **If it didn't work:** See troubleshooting below

## What Can Claude Do Now?

Tell Claude things like:

- "When you finish running the tests, send me a notification"
- "If there are any errors, ask me via Telegram what to do"
- "Check if I've sent you any messages on Telegram"

Claude will automatically use the Telegram tools when appropriate!

## Troubleshooting

### "Bridge not running" or "Connection refused"

**Problem:** The bridge stopped or never started

**Fix:**
```bash
cd claude-telegram-bridge
pnpm dev
```
Keep this terminal open!

**Want it to run in background?**
```bash
pnpm daemon  # Starts in background
pnpm logs    # View logs
pnpm stop    # Stop it
```

### "Tool not found" or "MCP server not found"

**Problem:** Path in config is wrong

**Fix:**
1. Find the correct path:
   ```bash
   cd claude-telegram-bridge
   pwd
   ls dist/mcp-server.js  # Should say "dist/mcp-server.js"
   ```

2. Update your MCP config with the correct path

3. Restart Claude

### "No Telegram messages"

**Problem:** Bot not initialized

**Fix:**
1. Open Telegram
2. Find your bot
3. Send: `/start`
4. Try again

### "Token is wrong" or "Unauthorized"

**Problem:** Bot token is incorrect

**Fix:**
1. Go back to BotFather in Telegram
2. Send: `/mybots`
3. Select your bot → "API Token"
4. Copy the new token
5. Update `.env` file
6. Restart bridge: `pnpm dev`

## Keeping It Running

**Every time you restart your computer:**

The bridge stops! You need to start it again:
```bash
cd claude-telegram-bridge
pnpm daemon  # Runs in background
```

Check if it's running:
```bash
curl http://localhost:3456/health
```

Should show: `{"status":"running"...}`

## Next Steps

- Read [README.md](README.md) for advanced features
- See [CONTRIBUTING.md](CONTRIBUTING.md) to customize the bridge
- Check [MCP Protocol docs](https://modelcontextprotocol.io/) to learn more about MCP

## Still Stuck?

1. Check the Issues: https://github.com/RichardDillman/claude-telegram-bridge/issues
2. Open a new issue with:
   - What step you're on
   - Error message (if any)
   - What you tried

We'll help you get it working!
