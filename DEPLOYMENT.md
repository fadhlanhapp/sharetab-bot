# Deployment Guide

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` file:
   ```bash
   cp .env.example .env
   # Edit .env with your bot token
   ```

3. Run locally:
   ```bash
   npm start
   # or for development
   npm run dev
   ```

## VM Deployment

### Prerequisites on VM
- Node.js (v16+)
- npm
- PM2 (process manager)

### Quick Deployment

**One-command deployment on VM:**
```bash
curl -fsSL https://raw.githubusercontent.com/fadhlanhapp/sharetab-bot/main/deploy.sh | bash
```

**Or clone and run:**
```bash
git clone https://github.com/fadhlanhapp/sharetab-bot
cd sharetab-bot
chmod +x deploy.sh
./deploy.sh
```

### Environment Setup on VM

1. **Create .env file:**
   ```bash
   cd /opt/sharetab-bot
   nano .env
   ```
   
   Add:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   SHARETAB_BACKEND_URL=https://sharetab.gomdoli.dev
   ```

2. **Install PM2 globally:**
   ```bash
   sudo npm install -g pm2
   ```

### Process Management

1. **Start bot:**
   ```bash
   cd /opt/sharetab-bot
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup  # Enable auto-start on boot
   ```

2. **Common PM2 commands:**
   ```bash
   pm2 status           # Check status
   pm2 logs sharetab-bot # View logs
   pm2 restart sharetab-bot # Restart
   pm2 stop sharetab-bot    # Stop
   pm2 delete sharetab-bot  # Remove
   ```

### System Service (Alternative)

Create systemd service:

```bash
sudo nano /etc/systemd/system/sharetab-bot.service
```

```ini
[Unit]
Description=ShareTab Telegram Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/sharetab-bot
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable sharetab-bot
sudo systemctl start sharetab-bot
sudo systemctl status sharetab-bot
```

### Monitoring

1. **Check bot status:**
   ```bash
   pm2 status
   ```

2. **View logs:**
   ```bash
   pm2 logs sharetab-bot --lines 100
   ```

3. **Monitor resources:**
   ```bash
   pm2 monit
   ```

### Updates

**Quick update:**
```bash
cd /opt/sharetab-bot
./update.sh
```

**Or manually:**
```bash
cd /opt/sharetab-bot
pm2 stop sharetab-bot
git pull origin main
npm install --production
pm2 start sharetab-bot
```

### Troubleshooting

1. **Bot not responding:**
   - Check PM2 status: `pm2 status`
   - Check logs: `pm2 logs sharetab-bot`
   - Verify .env file exists and has correct token

2. **Backend connection issues:**
   - Test backend: `curl https://sharetab.gomdoli.dev/health`
   - Check SHARETAB_BACKEND_URL in .env

3. **Memory issues:**
   - Monitor: `pm2 monit`
   - Restart: `pm2 restart sharetab-bot`

### Security

1. **Firewall (if needed):**
   ```bash
   sudo ufw allow ssh
   sudo ufw allow 80
   sudo ufw allow 443
   sudo ufw enable
   ```

2. **Environment variables:**
   - Keep .env file secure (chmod 600)
   - Never commit .env to git