require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const FormData = require('form-data');

const token = process.env.TELEGRAM_BOT_TOKEN;
const backendUrl = process.env.SHARETAB_BACKEND_URL || 'https://sharetab.gomdoli.dev';

const bot = new TelegramBot(token, { polling: true });

const userSessions = new Map();

const createKeyboard = (options) => ({
  reply_markup: {
    inline_keyboard: options.map(option => [{ text: option.text, callback_data: option.callback }])
  }
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome to ShareTab Bot! 🧾\n\nUse /split to start splitting a bill.');
});

bot.onText(/\/split/, async (msg) => {
  const chatId = msg.chat.id;
  
  userSessions.set(chatId, {
    step: 'input_method',
    data: {}
  });

  const keyboard = createKeyboard([
    { text: '✍️ Manual Entry', callback: 'manual' },
    { text: '📷 Upload Receipt Photo', callback: 'photo' }
  ]);

  bot.sendMessage(chatId, 'How would you like to enter the bill?', keyboard);
});

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const session = userSessions.get(chatId);

  if (!session) {
    bot.answerCallbackQuery(callbackQuery.id, 'Session expired. Please start again with /split');
    return;
  }

  bot.answerCallbackQuery(callbackQuery.id);

  switch (session.step) {
    case 'input_method':
      if (data === 'manual') {
        session.step = 'manual_amount';
        userSessions.set(chatId, session);
        bot.sendMessage(chatId, 'Please enter the total amount (e.g., 50.25):');
      } else if (data === 'photo') {
        session.step = 'photo_upload';
        userSessions.set(chatId, session);
        bot.sendMessage(chatId, 'Please upload a photo of your receipt:');
      }
      break;

    case 'split_method':
      if (data === 'equal') {
        await handleEqualSplit(chatId, session);
      } else if (data === 'itemized') {
        await handleItemizedSplit(chatId, session);
      }
      break;

    case 'confirm_items':
      if (data === 'confirm') {
        await askForParticipants(chatId, session);
      } else if (data === 'edit') {
        bot.sendMessage(chatId, 'Please manually enter the items in format:\nItem1 - $10.00\nItem2 - $15.50\n...');
        session.step = 'manual_items';
        userSessions.set(chatId, session);
      }
      break;

    default:
      if (data.startsWith('assign_')) {
        await handleItemAssignment(chatId, data, session);
      }
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions.get(chatId);

  if (!session) return;

  if (msg.photo && session.step === 'photo_upload') {
    await handlePhotoUpload(chatId, msg, session);
  } else if (msg.text && !msg.text.startsWith('/')) {
    await handleTextInput(chatId, msg.text, session);
  }
});

async function handlePhotoUpload(chatId, msg, session) {
  try {
    bot.sendMessage(chatId, 'Processing receipt... 📸');
    
    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    
    const response = await axios.get(fileUrl, { responseType: 'stream' });
    
    const formData = new FormData();
    // Determine file extension from Telegram file path or default to jpeg
    let fileExtension = file.file_path.split('.').pop() || 'jpg';
    // Convert jpg to jpeg for proper MIME type
    if (fileExtension === 'jpg') {
      fileExtension = 'jpeg';
    }
    const filename = `receipt.${fileExtension}`;
    
    formData.append('receipt', response.data, {
      filename: filename,
      contentType: `image/${fileExtension}`
    });
    
    const ocrResponse = await axios.post(`${backendUrl}/api/v1/receipts/process`, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    if (ocrResponse.data && ocrResponse.data.items) {
      session.data.items = ocrResponse.data.items;
      session.data.total = ocrResponse.data.total || ocrResponse.data.items.reduce((sum, item) => sum + parseFloat(item.price), 0);
      
      let itemsText = 'Items found:\n';
      ocrResponse.data.items.forEach((item, index) => {
        itemsText += `${index + 1}. ${item.name} - $${item.price.toFixed(2)}\n`;
      });
      itemsText += `\nTotal: $${session.data.total.toFixed(2)}`;

      const keyboard = createKeyboard([
        { text: '✅ Confirm', callback: 'confirm' },
        { text: '✏️ Edit', callback: 'edit' }
      ]);

      session.step = 'confirm_items';
      userSessions.set(chatId, session);
      
      bot.sendMessage(chatId, itemsText, keyboard);
    } else {
      bot.sendMessage(chatId, 'Could not process receipt. Please try manual entry.');
      session.step = 'manual_amount';
      userSessions.set(chatId, session);
      bot.sendMessage(chatId, 'Please enter the total amount:');
    }
  } catch (error) {
    console.error('OCR Error:', error);
    bot.sendMessage(chatId, 'Error processing receipt. Please try manual entry.');
    session.step = 'manual_amount';
    userSessions.set(chatId, session);
  }
}

async function handleTextInput(chatId, text, session) {
  switch (session.step) {
    case 'manual_amount':
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(chatId, 'Please enter a valid amount (e.g., 50.25):');
        return;
      }
      session.data.total = amount;
      await askForParticipants(chatId, session);
      break;

    case 'participants':
      const participants = text.split(',').map(p => p.trim()).filter(p => p);
      if (participants.length < 2) {
        bot.sendMessage(chatId, 'Please enter at least 2 participants, separated by commas:');
        return;
      }
      session.data.participants = participants;
      await askForSplitMethod(chatId, session);
      break;

    case 'manual_items':
      try {
        const items = text.split('\n').map(line => {
          const match = line.match(/(.+?)\s*-\s*\$?(\d+\.?\d*)/);
          if (match) {
            return { name: match[1].trim(), price: parseFloat(match[2]) };
          }
          return null;
        }).filter(item => item);

        if (items.length === 0) {
          bot.sendMessage(chatId, 'Please enter items in correct format:\nItem1 - $10.00\nItem2 - $15.50');
          return;
        }

        session.data.items = items;
        session.data.total = items.reduce((sum, item) => sum + item.price, 0);
        await askForParticipants(chatId, session);
      } catch (error) {
        bot.sendMessage(chatId, 'Please enter items in correct format:\nItem1 - $10.00\nItem2 - $15.50');
      }
      break;
  }
}

async function askForParticipants(chatId, session) {
  session.step = 'participants';
  userSessions.set(chatId, session);
  bot.sendMessage(chatId, 'Please enter participant names separated by commas (e.g., John, Jane, Bob):');
}

async function askForSplitMethod(chatId, session) {
  const keyboard = createKeyboard([
    { text: '🟰 Equal Split', callback: 'equal' },
    { text: '📋 By Items', callback: 'itemized' }
  ]);

  session.step = 'split_method';
  userSessions.set(chatId, session);
  bot.sendMessage(chatId, 'How would you like to split the bill?', keyboard);
}

async function handleEqualSplit(chatId, session) {
  try {
    const payload = {
      total: session.data.total,
      participants: session.data.participants,
      splitType: 'equal'
    };

    const response = await axios.post(`${backendUrl}/api/v1/expenses/calculateSingleBill`, payload);
    
    if (response.data && response.data.splits) {
      let resultText = '💰 Equal Split Result:\n\n';
      response.data.splits.forEach(split => {
        resultText += `${split.participant}: $${split.amount.toFixed(2)}\n`;
      });
      resultText += `\nTotal: $${session.data.total.toFixed(2)}`;
      
      bot.sendMessage(chatId, resultText);
      userSessions.delete(chatId);
    } else {
      throw new Error('Invalid response from backend');
    }
  } catch (error) {
    console.error('Calculate Error:', error);
    bot.sendMessage(chatId, 'Error calculating split. Please try again.');
    userSessions.delete(chatId);
  }
}

async function handleItemizedSplit(chatId, session) {
  if (!session.data.items || session.data.items.length === 0) {
    bot.sendMessage(chatId, 'No items available for itemized split. Please use equal split.');
    return;
  }

  session.step = 'item_assignment';
  session.data.assignments = {};
  session.data.currentItemIndex = 0;
  userSessions.set(chatId, session);

  await showItemAssignment(chatId, session);
}

async function showItemAssignment(chatId, session) {
  const currentItem = session.data.items[session.data.currentItemIndex];
  if (!currentItem) {
    await calculateItemizedSplit(chatId, session);
    return;
  }

  const keyboard = createKeyboard([
    ...session.data.participants.map(p => ({ text: p, callback: `assign_${p}` })),
    { text: '👥 Shared by All', callback: 'assign_shared' },
    { text: '⏭️ Skip Item', callback: 'assign_skip' }
  ]);

  bot.sendMessage(chatId, 
    `Who ordered: ${currentItem.name} ($${currentItem.price.toFixed(2)})?`, 
    keyboard
  );
}

async function handleItemAssignment(chatId, data, session) {
  const currentItem = session.data.items[session.data.currentItemIndex];
  const assignee = data.replace('assign_', '');

  if (!session.data.assignments[session.data.currentItemIndex]) {
    session.data.assignments[session.data.currentItemIndex] = [];
  }

  if (assignee === 'shared') {
    session.data.assignments[session.data.currentItemIndex] = [...session.data.participants];
  } else if (assignee === 'skip') {
    session.data.assignments[session.data.currentItemIndex] = [];
  } else {
    session.data.assignments[session.data.currentItemIndex] = [assignee];
  }

  session.data.currentItemIndex++;
  userSessions.set(chatId, session);

  await showItemAssignment(chatId, session);
}

async function calculateItemizedSplit(chatId, session) {
  try {
    const itemsWithAssignments = session.data.items.map((item, index) => ({
      ...item,
      assignedTo: session.data.assignments[index] || []
    }));

    const payload = {
      total: session.data.total,
      participants: session.data.participants,
      items: itemsWithAssignments,
      splitType: 'itemized'
    };

    const response = await axios.post(`${backendUrl}/api/v1/expenses/calculateSingleBill`, payload);
    
    if (response.data && response.data.splits) {
      let resultText = '📋 Itemized Split Result:\n\n';
      
      response.data.splits.forEach(split => {
        resultText += `${split.participant}: $${split.amount.toFixed(2)}\n`;
      });
      
      resultText += `\nTotal: $${session.data.total.toFixed(2)}`;
      
      bot.sendMessage(chatId, resultText);
      userSessions.delete(chatId);
    } else {
      throw new Error('Invalid response from backend');
    }
  } catch (error) {
    console.error('Calculate Error:', error);
    bot.sendMessage(chatId, 'Error calculating itemized split. Please try again.');
    userSessions.delete(chatId);
  }
}

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('ShareTab Bot is running...');