#!/bin/bash

# ShareTab Bot Deployment Script
# Run this script directly on your VM

REPO_URL="https://github.com/fadhlanhapp/sharetab-bot"
APP_NAME="sharetab-bot"
APP_PATH="/home/techops/sharetab-bot"

echo "🚀 Deploying ShareTab Bot from GitHub"

# Install Node.js if not installed
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install git if not installed
if ! command -v git &> /dev/null; then
    echo "📦 Installing Git..."
    sudo apt-get update
    sudo apt-get install -y git
fi

# Install PM2 globally if not installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
fi

# Stop existing process
echo "⏹️ Stopping existing bot..."
pm2 stop $APP_NAME 2>/dev/null || true
pm2 delete $APP_NAME 2>/dev/null || true

# Create app directory
mkdir -p $APP_PATH
cd $APP_PATH

# Clone or pull latest code
if [ -d ".git" ]; then
    echo "🔄 Updating existing repository..."
    git pull origin main
else
    echo "📥 Cloning repository..."
    git clone $REPO_URL .
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️ Creating .env file..."
    cp .env.example .env
    echo "❗ Please edit .env file with your bot token:"
    echo "   nano .env"
    echo ""
    read -p "Press Enter after editing .env file..."
fi

# Start with PM2
echo "🚀 Starting bot with PM2..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo ""
echo "✅ ShareTab Bot deployed successfully!"
echo ""
echo "📋 Useful commands:"
echo "   pm2 status           - Check status"
echo "   pm2 logs $APP_NAME   - View logs"  
echo "   pm2 restart $APP_NAME - Restart bot"
echo "   pm2 stop $APP_NAME    - Stop bot"
echo ""
echo "🔧 To update bot later:"
echo "   cd $APP_PATH && git pull && npm install && pm2 restart $APP_NAME"