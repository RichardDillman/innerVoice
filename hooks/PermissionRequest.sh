#!/bin/bash
# Hook that fires when Claude needs permission
# Sends a Telegram notification if AFK mode is enabled

# Get the hook input
INPUT=$(cat)

# Extract tool name and description
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
DESCRIPTION=$(echo "$INPUT" | jq -r '.description // "N/A"')

# Send notification via InnerVoice bridge
curl -s -X POST http://localhost:3456/notify \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"⏸️ *Claude needs permission*\n\n**Tool:** \`$TOOL_NAME\`\n**Action:** $DESCRIPTION\n\nCheck your terminal to approve or deny.\",
    \"priority\": \"warning\"
  }" > /dev/null 2>&1

# Return empty response (don't block the permission request)
echo "{}"
