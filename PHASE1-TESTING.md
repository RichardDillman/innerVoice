# Phase 1 Testing Guide

## What Was Built

✅ Multi-project session tracking with project context display

### Features
- Auto-generate unique session IDs for each Claude instance
- Track project name and path from working directory
- Show project context in all Telegram messages: `📁 ProjectName [#shortId]`
- `/sessions` command to list all active Claude instances
- Auto-expire inactive sessions after 30 minutes

## How to Test

### 1. Restart Claude Code
**Important:** You need to restart Claude Code to load the new MCP server code.

```bash
# Exit your current Claude Code sessions
# Then restart in your project
cd /path/to/your/project
claude
```

### 2. Test Project Context
Send a notification and you should see the project name:

```
📁 ESO-MCP [#1a2b3c4]
ℹ️ Your message here
```

### 3. Test Multi-Project Sessions
1. Open Claude in **ESO-MCP** project
2. Open another terminal and start Claude in **innervoice** project
3. In Telegram, type `/sessions`
4. You should see both projects listed:

```
Active Claude Sessions (2)

1. 🟢 ESO-MCP [#1a2b3c4]
   Last active: 0m ago

2. 🟢 innervoice [#5d6e7f8]
   Last active: 2m ago
```

### 4. Test Session Auto-Expire
Wait 30 minutes of inactivity, then run `/sessions` again.
Inactive sessions should be removed automatically.

## Known Issues

- You must restart Claude Code for changes to take effect
- Old MCP server processes won't pick up new code automatically

## Next: Phase 2

Message queue system for offline/inactive projects coming next!
