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
        bot.sendMessage(chatId, 'Please enter the total amount (e.g., 50000):');
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
        bot.sendMessage(chatId, 'Please manually enter the items in format:\nItem1 - Rp 10000\nItem2 - Rp 15500\n...');
        session.step = 'manual_items';
        userSessions.set(chatId, session);
      }
      break;

    default:
      if (data.startsWith('toggle_') || ['select_all', 'clear_all', 'next_item', 'skip_item'].includes(data)) {
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
      // Ensure items have all required fields
      session.data.items = ocrResponse.data.items.map(item => ({
        name: item.name,
        price: item.price,
        quantity: item.quantity || 1,
        discount: item.discount || 0
      }));
      session.data.total = ocrResponse.data.total || ocrResponse.data.items.reduce((sum, item) => sum + parseFloat(item.price), 0);
      session.data.subtotal = ocrResponse.data.subtotal || 0;
      session.data.tax = ocrResponse.data.tax || 0;
      session.data.service = ocrResponse.data.service || 0;
      session.data.discount = ocrResponse.data.discount || 0;
      
      let itemsText = '🧾 Receipt Details:\n\n';
      itemsText += `🏪 Merchant: ${ocrResponse.data.merchant || 'N/A'}\n`;
      itemsText += `📅 Date: ${ocrResponse.data.date || 'N/A'}\n\n`;
      
      itemsText += '📋 Items:\n';
      ocrResponse.data.items.forEach((item, index) => {
        const quantity = item.quantity && item.quantity > 1 ? ` (${item.quantity}x)` : '';
        itemsText += `${index + 1}. ${item.name}${quantity} - Rp ${item.price.toLocaleString()}\n`;
      });
      
      itemsText += '\n💰 Summary:\n';
      if (session.data.subtotal > 0) itemsText += `Subtotal: Rp ${session.data.subtotal.toLocaleString()}\n`;
      if (session.data.tax > 0) itemsText += `Tax: Rp ${session.data.tax.toLocaleString()}\n`;
      if (session.data.service > 0) itemsText += `Service: Rp ${session.data.service.toLocaleString()}\n`;
      if (session.data.discount > 0) itemsText += `Discount: -Rp ${session.data.discount.toLocaleString()}\n`;
      itemsText += `\n🎯 Total: Rp ${session.data.total.toLocaleString()}`;

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
      bot.sendMessage(chatId, 'Please enter the total amount (e.g., 50000):');
    }
  } catch (error) {
    console.error('OCR Error:', error);
    bot.sendMessage(chatId, 'Error processing receipt. Please try manual entry.');
    session.step = 'manual_amount';
    userSessions.set(chatId, session);
    bot.sendMessage(chatId, 'Please enter the total amount (e.g., 50000):');
  }
}

async function handleTextInput(chatId, text, session) {
  switch (session.step) {
    case 'manual_amount':
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(chatId, 'Please enter a valid amount (e.g., 50000):');
        return;
      }
      session.data.total = amount;
      session.data.subtotal = amount;
      session.data.tax = 0;
      session.data.service = 0;
      session.data.discount = 0;
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
          const match = line.match(/(.+?)\s*-\s*Rp?\s*(\d+\.?\d*)/);
          if (match) {
            return { 
              name: match[1].trim(), 
              price: parseFloat(match[2]),
              quantity: 1,
              discount: 0
            };
          }
          return null;
        }).filter(item => item);

        if (items.length === 0) {
          bot.sendMessage(chatId, 'Please enter items in correct format:\nItem1 - Rp 10000\nItem2 - Rp 15500');
          return;
        }

        session.data.items = items;
        session.data.total = items.reduce((sum, item) => sum + item.price, 0);
        session.data.subtotal = session.data.total;
        session.data.tax = 0;
        session.data.service = 0;
        session.data.discount = 0;
        await askForParticipants(chatId, session);
      } catch (error) {
        bot.sendMessage(chatId, 'Please enter items in correct format:\nItem1 - Rp 10000\nItem2 - Rp 15500');
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
    // For equal split, create a single item with all participants
    const payload = {
      items: [{
        description: "Shared Bill",
        unitPrice: session.data.subtotal || session.data.total,
        quantity: 1,
        itemDiscount: 0,
        paidBy: session.data.participants[0], // First participant pays
        consumers: session.data.participants
      }],
      tax: session.data.tax || 0,
      serviceCharge: session.data.service || 0,
      totalDiscount: session.data.discount || 0
    };

    const response = await axios.post(`${backendUrl}/api/v1/expenses/calculateSingleBill`, payload);
    
    if (response.data && response.data.perPersonCharges) {
      let resultText = '💰 Equal Split Result:\n\n';
      
      Object.entries(response.data.perPersonCharges).forEach(([participant, amount]) => {
        resultText += `👤 *${participant}*\n`;
        resultText += `   📦 Items: Shared Bill\n`;
        
        // Show breakdown if available
        if (response.data.perPersonBreakdown && response.data.perPersonBreakdown[participant]) {
          const breakdown = response.data.perPersonBreakdown[participant];
          resultText += `   💵 Subtotal: Rp ${breakdown.subtotal.toLocaleString()}\n`;
          if (breakdown.tax > 0) resultText += `   🏛️ Tax: Rp ${breakdown.tax.toLocaleString()}\n`;
          if (breakdown.serviceCharge > 0) resultText += `   🛎️ Service: Rp ${breakdown.serviceCharge.toLocaleString()}\n`;
          if (breakdown.discount > 0) resultText += `   🎫 Discount: -Rp ${breakdown.discount.toLocaleString()}\n`;
        }
        
        resultText += `   🎯 *Total: Rp ${amount.toLocaleString()}*\n\n`;
      });
      
      resultText += `💸 *Grand Total: Rp ${response.data.amount.toLocaleString()}*`;
      
      bot.sendMessage(chatId, resultText, { parse_mode: 'Markdown' });
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
  session.data.currentItemAssignees = []; // Track selected people for current item
  userSessions.set(chatId, session);

  await showItemAssignment(chatId, session);
}

async function showItemAssignment(chatId, session) {
  const currentItem = session.data.items[session.data.currentItemIndex];
  if (!currentItem) {
    await calculateItemizedSplit(chatId, session);
    return;
  }

  const currentAssignees = session.data.currentItemAssignees || [];
  
  // Create participant buttons with checkmarks for selected
  const participantButtons = session.data.participants.map(p => {
    const isSelected = currentAssignees.includes(p);
    return { 
      text: isSelected ? `✅ ${p}` : `⬜ ${p}`, 
      callback: `toggle_${p}` 
    };
  });

  const actionButtons = [
    { text: '👥 Select All', callback: 'select_all' },
    { text: '❌ Clear All', callback: 'clear_all' },
    { text: '⏭️ Next Item', callback: 'next_item' },
    { text: '⏹️ Skip Item', callback: 'skip_item' }
  ];

  const keyboard = createKeyboard([
    ...participantButtons,
    ...actionButtons
  ]);

  const quantity = currentItem.quantity && currentItem.quantity > 1 ? ` (${currentItem.quantity}x)` : '';
  let messageText = `Who ordered: ${currentItem.name}${quantity} (Rp ${currentItem.price.toLocaleString()})\n\n`;
  if (currentAssignees.length > 0) {
    messageText += `Selected: ${currentAssignees.join(', ')}\n`;
    messageText += `Each pays: Rp ${(currentItem.price / currentAssignees.length).toLocaleString()}\n\n`;
  }
  messageText += `Select participants and press "Next Item" to continue.`;

  bot.sendMessage(chatId, messageText, keyboard);
}

async function handleItemAssignment(chatId, data, session) {
  const currentAssignees = session.data.currentItemAssignees || [];

  if (data.startsWith('toggle_')) {
    // Toggle participant selection
    const participant = data.replace('toggle_', '');
    const index = currentAssignees.indexOf(participant);
    
    if (index === -1) {
      currentAssignees.push(participant);
    } else {
      currentAssignees.splice(index, 1);
    }
    
    session.data.currentItemAssignees = currentAssignees;
    userSessions.set(chatId, session);
    
    // Update the same message with new selection
    await showItemAssignment(chatId, session);
    
  } else if (data === 'select_all') {
    session.data.currentItemAssignees = [...session.data.participants];
    userSessions.set(chatId, session);
    await showItemAssignment(chatId, session);
    
  } else if (data === 'clear_all') {
    session.data.currentItemAssignees = [];
    userSessions.set(chatId, session);
    await showItemAssignment(chatId, session);
    
  } else if (data === 'next_item') {
    // Save current assignments and move to next item
    session.data.assignments[session.data.currentItemIndex] = [...(session.data.currentItemAssignees || [])];
    session.data.currentItemIndex++;
    session.data.currentItemAssignees = []; // Reset for next item
    userSessions.set(chatId, session);
    await showItemAssignment(chatId, session);
    
  } else if (data === 'skip_item') {
    // Skip current item (assign to nobody)
    session.data.assignments[session.data.currentItemIndex] = [];
    session.data.currentItemIndex++;
    session.data.currentItemAssignees = []; // Reset for next item
    userSessions.set(chatId, session);
    await showItemAssignment(chatId, session);
  }
}

async function calculateItemizedSplit(chatId, session) {
  try {
    // Convert bot items to backend format
    const backendItems = session.data.items.map((item, index) => {
      const assignedTo = session.data.assignments[index] || [];
      if (assignedTo.length === 0) return null; // Skip unassigned items
      
      return {
        description: item.name,
        unitPrice: item.price,
        quantity: item.quantity || 1,
        itemDiscount: item.discount || 0,
        paidBy: assignedTo[0], // First person pays for the item
        consumers: assignedTo
      };
    }).filter(item => item !== null); // Remove null items

    const payload = {
      items: backendItems,
      tax: session.data.tax || 0,
      serviceCharge: session.data.service || 0,
      totalDiscount: session.data.discount || 0
    };

    const response = await axios.post(`${backendUrl}/api/v1/expenses/calculateSingleBill`, payload);
    
    if (response.data && response.data.perPersonCharges) {
      let resultText = '📋 Itemized Split Result:\n\n';
      
      Object.entries(response.data.perPersonCharges).forEach(([participant, amount]) => {
        resultText += `👤 *${participant}*\n`;
        
        // Show items this person ordered
        const personItems = [];
        session.data.items.forEach((item, index) => {
          const assignedTo = session.data.assignments[index] || [];
          if (assignedTo.includes(participant)) {
            const quantity = item.quantity && item.quantity > 1 ? ` (${item.quantity}x)` : '';
            const shareCount = assignedTo.length;
            const itemCost = item.price / shareCount;
            personItems.push(`${item.name}${quantity} - Rp ${itemCost.toLocaleString()}`);
          }
        });
        
        if (personItems.length > 0) {
          resultText += `   📦 Items:\n`;
          personItems.forEach(item => {
            resultText += `      • ${item}\n`;
          });
        } else {
          resultText += `   📦 Items: None\n`;
        }
        
        // Show breakdown if available
        if (response.data.perPersonBreakdown && response.data.perPersonBreakdown[participant]) {
          const breakdown = response.data.perPersonBreakdown[participant];
          resultText += `   💵 Subtotal: Rp ${breakdown.subtotal.toLocaleString()}\n`;
          if (breakdown.tax > 0) resultText += `   🏛️ Tax: Rp ${breakdown.tax.toLocaleString()}\n`;
          if (breakdown.serviceCharge > 0) resultText += `   🛎️ Service: Rp ${breakdown.serviceCharge.toLocaleString()}\n`;
          if (breakdown.discount > 0) resultText += `   🎫 Discount: -Rp ${breakdown.discount.toLocaleString()}\n`;
        }
        
        resultText += `   🎯 *Total: Rp ${amount.toLocaleString()}*\n\n`;
      });
      
      resultText += `💸 *Grand Total: Rp ${response.data.amount.toLocaleString()}*`;
      
      bot.sendMessage(chatId, resultText, { parse_mode: 'Markdown' });
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