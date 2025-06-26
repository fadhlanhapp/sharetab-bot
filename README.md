# ShareTab Telegram Bot

A Telegram bot for splitting bills using the ShareTab backend.

## Features

- **Manual Entry**: Enter total amount and participants manually
- **Receipt OCR**: Upload receipt photos for automatic item extraction
- **Equal Split**: Split bills equally among participants
- **Itemized Split**: Assign specific items to participants
- **No Storage**: Results are displayed without saving to database

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment configuration:
   ```bash
   cp .env.example .env
   ```

3. Configure your environment variables in `.env`:
   - `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from @BotFather
   - `SHARETAB_BACKEND_URL`: URL of your ShareTab backend (default: https://sharetab.gomdoli.dev)

4. Start the bot:
   ```bash
   npm start
   ```

   For development:
   ```bash
   npm run dev
   ```

## Usage

1. Start a chat with your bot
2. Send `/start` to see welcome message
3. Send `/split` to begin splitting a bill
4. Follow the interactive prompts:
   - Choose manual entry or photo upload
   - Enter participants
   - Select equal or itemized split
   - For itemized: assign items to participants
   - View final breakdown

## Bot Flow

```
/split
├── Input Method:
│   ├── Manual Entry → Total Amount → Participants
│   └── Photo Upload → Confirm/Edit Items → Participants
├── Split Method:
│   ├── Equal Split → Calculate & Display
│   └── Itemized Split → Assign Items → Calculate & Display
```

## Commands

- `/start` - Welcome message
- `/split` - Start bill splitting process

## Backend Integration

The bot integrates with ShareTab backend endpoints:
- `POST /receipts/process` - OCR receipt processing
- `POST /expenses/calculateSingleBill` - Bill calculation

## Requirements

- Node.js
- ShareTab backend running
- Telegram Bot Token