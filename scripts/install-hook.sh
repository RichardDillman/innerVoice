#!/bin/bash
# Install the InnerVoice permission notification hook globally or per-project

set -e

HOOK_NAME="PermissionRequest.sh"
INNERVOICE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_HOOK="$INNERVOICE_DIR/hooks/$HOOK_NAME"

# Check for --global flag
if [ "$1" = "--global" ] || [ "$1" = "-g" ]; then
  TARGET_HOOK_DIR="$HOME/.claude/hooks"
  SCOPE="globally (all projects)"
  UNINSTALL_CMD="rm ~/.claude/hooks/$HOOK_NAME"
else
  # Get target project directory (default to current directory)
  TARGET_DIR="${1:-.}"
  TARGET_HOOK_DIR="$TARGET_DIR/.claude/hooks"
  SCOPE="in project: $TARGET_DIR"
  UNINSTALL_CMD="rm $TARGET_HOOK_DIR/$HOOK_NAME"
fi

echo "📦 Installing InnerVoice Permission Notification Hook"
echo ""
echo "Scope:  $SCOPE"
echo "Source: $SOURCE_HOOK"
echo "Target: $TARGET_HOOK_DIR/$HOOK_NAME"
echo ""

# Validate source hook exists
if [ ! -f "$SOURCE_HOOK" ]; then
  echo "❌ Error: Source hook not found at $SOURCE_HOOK"
  exit 1
fi

# Create target directory if needed
mkdir -p "$TARGET_HOOK_DIR"

# Copy the hook
cp "$SOURCE_HOOK" "$TARGET_HOOK_DIR/$HOOK_NAME"
chmod +x "$TARGET_HOOK_DIR/$HOOK_NAME"

echo "✅ Hook installed successfully!"
echo ""
echo "🔔 Now when you're in AFK mode, you'll get Telegram notifications"
echo "   whenever Claude requests permission for a tool."
echo ""
echo "To uninstall: $UNINSTALL_CMD"
