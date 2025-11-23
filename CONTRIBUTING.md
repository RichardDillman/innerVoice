# Contributing to Claude Telegram Bridge

Thanks for your interest in contributing! This guide covers local development setup.

## Development Setup

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Telegram account
- Git

### Clone and Install

```bash
git clone https://github.com/RichardDillman/claude-telegram-bridge.git
cd claude-telegram-bridge
pnpm install
```

### Environment Setup

1. **Create a Telegram Bot:**
   - Open Telegram, search for `@BotFather`
   - Send `/newbot` and follow prompts
   - Save your bot token

2. **Configure Environment:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   ```env
   TELEGRAM_BOT_TOKEN=your_token_here
   TELEGRAM_CHAT_ID=  # Leave empty
   PORT=3456
   HOST=localhost
   ENABLED=true
   ```

3. **Initialize Bot:**
   - Find your bot in Telegram
   - Send `/start`
   - Bot saves your chat ID automatically

### Development Workflow

```bash
# Build TypeScript
pnpm build

# Run in development mode (auto-reload)
pnpm dev

# Run MCP server directly (for testing)
pnpm mcp

# View available tools
pnpm tools

# Get MCP config for testing
pnpm config
```

### Project Structure

```
claude-telegram-bridge/
├── src/
│   ├── index.ts          # HTTP bridge & Telegram bot
│   └── mcp-server.ts     # MCP protocol implementation
├── scripts/
│   ├── get-mcp-config.sh # Generate MCP config
│   └── list-tools.js     # List available tools
├── dist/                 # Built JavaScript (gitignored)
├── .env                  # Your secrets (gitignored)
├── .env.example          # Environment template
├── package.json          # Dependencies & scripts
└── tsconfig.json         # TypeScript config
```

### Architecture

**Two Components:**

1. **HTTP Bridge** (`src/index.ts`)
   - Runs as standalone service
   - Communicates with Telegram Bot API
   - Provides REST endpoints for notifications
   - Manages message queue and bot commands

2. **MCP Server** (`src/mcp-server.ts`)
   - Implements MCP protocol via stdio
   - Started by Claude when needed
   - Translates MCP tool calls → HTTP requests
   - Connects to bridge on `localhost:3456`

**Flow:**
```
Claude → MCP Server → HTTP Bridge → Telegram Bot → Your Phone
        (stdio)       (HTTP)         (Bot API)
```

### Testing Locally

#### Test HTTP Bridge

```bash
# Start bridge
pnpm dev

# In another terminal, test endpoints
curl http://localhost:3456/health

curl -X POST http://localhost:3456/notify \
  -H "Content-Type: application/json" \
  -d '{"message": "Test!", "priority": "success"}'
```

#### Test MCP Server

Create a test MCP config:
```bash
mkdir -p test-project/.claude
pnpm config > test-project/.claude/mcp.json
```

Start Claude in `test-project/` and try:
> "Send me a test notification via Telegram"

### Making Changes

#### Adding a New MCP Tool

1. **Define tool in `src/mcp-server.ts`:**
   ```typescript
   const TOOLS: Tool[] = [
     // ... existing tools
     {
       name: 'telegram_new_feature',
       description: 'Description of new feature',
       inputSchema: {
         type: 'object',
         properties: {
           param: { type: 'string', description: 'Parameter description' }
         },
         required: ['param']
       }
     }
   ];
   ```

2. **Implement handler:**
   ```typescript
   case 'telegram_new_feature': {
     const { param } = args as { param: string };
     // Implementation
     return {
       content: [{ type: 'text', text: 'Result' }]
     };
   }
   ```

3. **Add to `scripts/list-tools.js`** for documentation

4. **Test it:**
   ```bash
   pnpm build
   # Test with Claude or via MCP protocol
   ```

#### Adding HTTP Endpoints

Edit `src/index.ts`:
```typescript
app.post('/new-endpoint', async (req, res) => {
  // Implementation
});
```

### Code Style

- Use TypeScript strict mode
- Follow existing patterns
- Add JSDoc comments for public APIs
- Keep functions focused and small

### Commit Guidelines

Use conventional commits:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation only
- `refactor:` - Code changes that neither fix bugs nor add features
- `test:` - Adding tests
- `chore:` - Maintenance tasks

Example:
```bash
git commit -m "feat: add support for inline keyboards in notifications"
```

### Running in Production

```bash
# Build
pnpm build

# Start as daemon (requires pm2)
pnpm daemon

# Check logs
pnpm logs

# Stop
pnpm stop
```

### Debugging

**Enable verbose logging:**
```typescript
// In src/index.ts
console.log('Debug:', message);
```

**Check bridge status:**
```bash
curl http://localhost:3456/health
```

**View bot logs:**
```bash
pnpm logs  # If using daemon
# or check console if using pnpm dev
```

### Common Issues

**"Bridge not responding"**
- Is it running? `curl http://localhost:3456/health`
- Check port 3456 isn't in use: `lsof -i :3456`

**"MCP server not found"**
- Did you run `pnpm build`?
- Is the path in MCP config correct?

**"Chat ID not set"**
- Send `/start` to your bot in Telegram
- Check `.env` - should have `TELEGRAM_CHAT_ID=123456789`

## Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Test thoroughly
5. Commit with conventional commits
6. Push and create a PR

## Questions?

Open an issue on GitHub or reach out via rdillman@gmail.com

## License

MIT - see [LICENSE](LICENSE)
