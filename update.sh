#!/bin/bash

# ShareTab Bot Update Script
# Run this script to update the bot to latest version

APP_NAME="sharetab-bot"
APP_PATH="/opt/$APP_NAME"

echo "🔄 Updating ShareTab Bot..."

# Check if app directory exists
if [ ! -d "$APP_PATH" ]; then
    echo "❌ Bot not found at $APP_PATH"
    echo "Run deploy.sh first to install the bot"
    exit 1
fi

cd $APP_PATH

# Check if git repository exists
if [ ! -d ".git" ]; then
    echo "❌ Not a git repository. Please redeploy using deploy.sh"
    exit 1
fi

# Stop the bot
echo "⏹️ Stopping bot..."
pm2 stop $APP_NAME 2>/dev/null || true

# Pull latest changes
echo "📥 Pulling latest changes..."
sudo git pull origin main

# Install/update dependencies
echo "📦 Installing dependencies..."
sudo npm install --production

# Set proper permissions
sudo chown -R $USER:$USER $APP_PATH

# Start the bot
echo "🚀 Starting bot..."
pm2 start $APP_NAME 2>/dev/null || pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

echo ""
echo "✅ ShareTab Bot updated successfully!"
echo ""
echo "📋 Check status:"
echo "   pm2 status"
echo "   pm2 logs $APP_NAME"