#!/bin/bash

# Auto-create .env from .env.example if it doesn't exist
if [ ! -f .env ]; then
  echo "📝 Creating .env file from .env.example..."
  cp .env.example .env
  echo "✅ .env file created successfully!"
  echo ""
  echo "⚠️  IMPORTANT: Please edit .env and add your Telegram bot token:"
  echo "   1. Get token from @BotFather on Telegram"
  echo "   2. Update TELEGRAM_BOT_TOKEN in .env"
  echo ""
else
  echo "✅ .env file already exists"
fi
