const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// ====== الإعدادات ======
const BOT_TOKEN = process.env.BOT_TOKEN;
const FORCE_CHANNEL = "@SAYFINFO";
const FORCE_CHAT = "@SAYFINFO_CHAT";
const LOG_CHANNEL = "@SAYFINFO_CHAT"; 
const TARGET_PACKAGE_CODE = "GIFTWALKWIN6GDAY";

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const COMMON_HEADERS = {
  'User-Agent': "MobileApp/3.0.7",
  'Accept': "application/json",
  'Content-Type': "application/json",
  'accept-language': "fr",
  'Connection': "keep-alive"
};

// ====== نظام حفظ البيانات المحصن (JSON) ======
const DB_FILE = path.join(__dirname, 'djezzy_data.json');

function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialData = { users: {}, sessions: {} };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    const content = fs.readFileSync(DB_FILE, 'utf8');
    return content ? JSON.parse(content) : { users: {}, sessions: {} };
  } catch (e) {
    console.error("خطأ في قراءة الملف، سيتم إعادة تهيئته:", e.message);
    return { users: {}, sessions: {} };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("خطأ في حفظ الملف:", e.message);
  }
}

// حفظ أرقام المستخدم + التوكن الخاص بكل رقم
function addUserPhone(userId, phone, token = null) {
  if (!phone) return;
  const db = readDB();
  const uid = String(userId); 
  
  if (!db.users[uid] || !Array.isArray(db.users[uid])) {
    db.users[uid] = [];
  }
  
  const existing = db.users[uid].find(u => u && u.phone === phone);
  if (existing) {
    if (token) existing.token = token;
  } else {
    db.users[uid].push({ phone, token });
  }
  writeDB(db);
}

// جلب أرقام المستخدم
function getUserPhones(userId) {
  const db = readDB();
  const uid = String(userId);
  if (!db.users[uid] || !Array.isArray(db.users[uid])) return [];
  return db.users[uid].filter(u => u && u.phone);
}

// جلب توكن الرقم المحدد
function getPhoneToken(userId, phone) {
  const phones = getUserPhones(userId);
  const found = phones.find(p => p.phone === phone);
  return found ? found.token : null;
}

function setSession(chatId, step, sender = null) { 
  const db = readDB(); 
  db.sessions[String(chatId)] = { step, sender }; 
  writeDB(db); 
}

function getSession(chatId) { 
  const db = readDB(); 
  return db.sessions[String(chatId)] || null; 
}

function delSession(chatId) { 
  const db = readDB(); 
  delete db.sessions[String(chatId)]; 
  writeDB(db); 
}

// ====== أدوات مساعدة ======
function formatNum(phone) {
  phone = phone.trim();
  if (phone.startsWith('0')) return "213" + phone.slice(1);
  return phone;
}

function maskPhone(phone) {
  if (!phone) return "رقم غير معروف";
  if (phone.length > 8) return `${phone.slice(0, 5)}****${phone.slice(-2)}`;
  return phone;
}

function mentionUser(user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'مستخدم';
  return `[${name}](tg://user?id=${user.id})`;
}

// ====== الاشتراك الإجباري ======
async function checkSubscription(userId) {
  const channels = [FORCE_CHANNEL, FORCE_CHAT];
  for (const ch of channels) {
    try {
      const member = await bot.getChatMember(ch, userId);
      const ok = ['creator', 'administrator', 'member'].includes(member.status);
      if (!ok) return { ok: false, channel: ch };
    } catch (e) {
      console.error(`getChatMember error for ${ch}:`, e.message);
    }
  }
  return { ok: true };
}

async function sendForceSubscribe(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: "📢 اشترك في القناة", url: `https://t.me/${FORCE_CHANNEL.replace('@', '')}` }],
      [{ text: "💬 اشترك في الشات", url: `https://t.me/${FORCE_CHAT.replace('@', '')}` }],
      [{ text: "✅ تحقق من الاشتراك", callback_data: "check_sub" }]
    ]
  };
  await bot.sendMessage(chatId, "🔒 *الاشتراك الإجباري*\n\nيجب الاشتراك في القناتين أدناه لاستخدام البوت:", {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// ====== Djezzy API ======
async function requestOtp(msisdn) {
  const url = "https://apim.djezzy.dz/mobile-api/oauth2/registration";
  const params = { msisdn, client_id: "87pIExRhxBb3_wGsA5eSEfyATloa", scope: "smsotp" };
  const payload = { "consent-agreement": [{ "marketing-notifications": false }], "is-consent": true };
  return axios.post(url, payload, { params, headers: COMMON_HEADERS, timeout: 20000 });
}

async function executeSmartParallel(msisdn, token) {
  const url = `https://apim.djezzy.dz/mobile-api/api/v1/services/walk/activate-reward/${msisdn}`;
  const headers = { ...COMMON_HEADERS, authorization: token, 'accept-language': "fr" };
  const attempts = [1, 2, 3];
  let successCount = 0;

  for (let i of attempts) {
    try {
      const res = await axios.post(url, { packageCode: TARGET_PACKAGE_CODE }, { headers, timeout: 25000 });
      if (res.status === 200 || res.status === 201) successCount++;
    } catch (error) {
      // نكمل المحاولات
    }
  }
  return { successCount };
}

// دالة عرض الهدية + إرسال إشعار للقناة
async function showGift(chatId, messageId, user, senderNo, successCount) {
  const masked = maskPhone(senderNo);
  const mention = mentionUser(user);
  const me = await bot.getMe();
  
  const giftMessage = 
    `🎉 *مبارك! تم تفعيل هديتك بنجاح* 🎉\n` +
    `╔════════════════════════╗\n` +
    `║  🎁 *صندوق الهدايا مفتوح!* 🎁  ║\n` +
    `╚════════════════════════╝\n\n` +
    `👤 *المستفيد:* ${mention}\n` +
    `📞 *الرقم:* \`${masked}\`\n` +
    `🎁 *الهدية:* \`6GB انترنت + دقائق\`\n` +
    `✅ *الحالة:* \`تم التفعيل بنجاح (${successCount} مرة)\`\n\n` +
    `✨ _استمتع بالإنترنت يا بطل!_ ✨\n` +
    `🤖 البوت: @${me.username}`;

  if (messageId) {
    await bot.editMessageText(giftMessage, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' })
      .catch(() => { bot.sendMessage(chatId, giftMessage, { parse_mode: 'Markdown' }); });
  } else {
    await bot.sendMessage(chatId, giftMessage, { parse_mode: 'Markdown' });
  }

  const channelLogMessage = 
    `🌟 *عملية تفعيل ناجحة جديدة!* 🌟\n\n` +
    `👤 *المستخدم:* ${mention}\n` +
    `📞 *الرقم:* \`${masked}\`\n` +
    `🎁 *الهدية:* \`6GB انترنت\`\n` +
    `🔥 _تم التفعيل بواسطة البوت، جرب حظك الآن!_ 🔥\n\n` +
    `🤖 @${me.username}`;

  try {
    await bot.sendMessage(LOG_CHANNEL, channelLogMessage, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error("فشل إرسال الإشعار للقناة:", e.message);
  }
}

// دالة عرض قائمة الأرقام كأزرار
async function showNumbersMenu(chatId, userId, textPrefix = "") {
  const phones = getUserPhones(userId);
  
  if (phones.length === 0) {
    setSession(chatId, 'SENDER');
    return bot.sendMessage(chatId, "🚀 *مرحباً بك!*\nليس لديك أرقام محفوظة.\nأرسل رقم هاتف جيزي الخاص بك لإضافته:", { parse_mode: 'Markdown' });
  }

  const keyboard = [];
  phones.forEach((p) => {
    keyboard.push([{ text: `📱 الرقم: ${maskPhone(p.phone)}`, callback_data: `select_${p.phone}` }]);
  });
  keyboard.push([{ text: "➕ إضافة رقم جديد", callback_data: "add_new_number" }]);

  const msg = textPrefix || `👋 أهلاً بك يا بطل!\n\n📋 *اختر أحد أرقامك المحفوظة لتتفعيل الهدية:*`;
  
  await bot.sendMessage(chatId, msg, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ====== الأوامر ======
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const sub = await checkSubscription(userId);
  if (!sub.ok) return sendForceSubscribe(chatId);

  await showNumbersMenu(chatId, userId, `👋 *أهلاً بك يا ${msg.from.first_name}!*\n\n📋 إليك أرقامك المحفوظة:`);
});

// عرض الأرقام المحفوظة (المعرف + الأرقام)
bot.onText(/^\/myid/, async (msg) => {
  const userId = msg.from.id;
  const phones = getUserPhones(userId);
  if (phones.length === 0) {
    return bot.sendMessage(msg.chat.id, "📭 ليس لديك أي أرقام محفوظة حالياً.");
  }
  let text = `🆔 *معرفك:* \`${userId}\`\n📋 *أرقامك المحفوظة (${phones.length}):*\n\n`;
  phones.forEach((p, i) => {
    text += `${i + 1}️⃣ \`${maskPhone(p.phone)}\`\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot.onText(/^\/forgetme/, async (msg) => {
  const db = readDB();
  delete db.users[String(msg.from.id)];
  writeDB(db);
  delSession(msg.chat.id);
  bot.sendMessage(msg.chat.id, "🗑️ تم حذف جميع أرقامك المحفوظة بنجاح.");
});

// ====== معالج الأزرار ======
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  const sub = await checkSubscription(userId);
  if (!sub.ok) {
    return bot.answerCallbackQuery(query.id, { text: `❌ يجب الاشتراك أولاً في ${sub.channel}`, show_alert: true });
  }

  if (data === 'check_sub') {
    await bot.answerCallbackQuery(query.id, { text: "✅ تم التحقق!" });
    await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
    return showNumbersMenu(chatId, userId);
  }

  if (data === 'add_new_number') {
    await bot.answerCallbackQuery(query.id);
    setSession(chatId, 'SENDER');
    return bot.sendMessage(chatId, "📞 أرسل رقم هاتف جيزي الجديد لإضافته:", { reply_markup: { force_reply: true } });
  }

  if (data.startsWith('select_')) {
    const phone = data.replace('select_', '');
    const token = getPhoneToken(userId, phone);

    await bot.answerCallbackQuery(query.id, { text: "⏳ جاري المعالجة..." });
    await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});

    // ⭐ هنا الفرق: إذا كان لدينا توكن محفوظ، نقوم بالتفعيل المباشر فوراً
    if (token) {
      const statusMsg = await bot.sendMessage(chatId, "⚡ *جاري التفعيل المباشر...*", { parse_mode: 'Markdown' });
      const { successCount } = await executeSmartParallel(phone, `Bearer ${token}`);

      if (successCount > 0) {
        return showGift(chatId, statusMsg.message_id, query.from, phone, successCount);
      } else {
        return bot.editMessageText("⚠️ *خوادم جيزي مشغولة حالياً أو انتهت صلاحية الجلسة.*\nيرجى المحاولة لاحقاً.", { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' });
      }
    } else {
      // إذا كان الرقم جديداً وليس لديه توكن (أول مرة فقط)، نطلب كود OTP
      try {
        const res = await requestOtp(phone);
        if ([200, 201].includes(res.status)) {
          setSession(chatId, 'OTP', phone);
          return bot.sendMessage(chatId, `📩 *لأول مرة فقط:* تم إرسال كود OTP إلى الرقم \`${maskPhone(phone)}\`، أرسله هنا ليتم حفظ الجلسة وتفعيل الهدية:`, { parse_mode: 'Markdown' });
        }
      } catch (e) {
        bot.sendMessage(chatId, "❌ حدث خطأ في إرسال الكود. حاول لاحقاً.");
      }
    }
  }
});

// ====== استقبال الرسائل ======
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const session = getSession(chatId);
  if (!session) return;

  const sub = await checkSubscription(msg.from.id);
  if (!sub.ok) {
    delSession(chatId);
    return sendForceSubscribe(chatId);
  }

  if (session.step === 'SENDER') {
    const phone = formatNum(msg.text);
    
    if (phone.length < 10) {
       return bot.sendMessage(chatId, "❌ الرقم غير صحيح، يرجى إرسال رقم هاتف صالح:");
    }

    try {
      const res = await requestOtp(phone);
      if ([200, 201].includes(res.status)) {
        addUserPhone(msg.from.id, phone);
        setSession(chatId, 'OTP', phone);
        bot.sendMessage(chatId, "📩 وصلك كود OTP في رسالة، أرسله هنا:");
      } else {
        bot.sendMessage(chatId, "❌ فشل إرسال الكود. تأكد من الرقم.");
        delSession(chatId);
      }
    } catch (e) {
      bot.sendMessage(chatId, "❌ حدث خطأ في الاتصال بالسيرفر. حاول لاحقاً.");
      delSession(chatId);
    }
    return;
  }

  if (session.step === 'OTP') {
    const otp = msg.text;
    const senderNo = session.sender;
    const user = msg.from;

    const payload = new URLSearchParams({
      otp,
      mobileNumber: senderNo,
      scope: "djezzyAppV2",
      client_id: "87pIExRhxBb3_wGsA5eSEfyATloa",
      client_secret: "uf82p68Bgisp8Yg1Uz8Pf6_v1XYa",
      grant_type: "mobile"
    });

    let tokenRes;
    try {
      tokenRes = await axios.post("https://apim.djezzy.dz/mobile-api/oauth2/token", payload.toString(), {
        headers: { ...COMMON_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 20000
      });
    } catch (e) {
      bot.sendMessage(chatId, "❌ الكود غير صحيح أو انتهت صلاحيته.");
      delSession(chatId);
      return showNumbersMenu(chatId, user.id, "🔄 حاول مرة أخرى:");
    }

    if (tokenRes.status !== 200) {
      bot.sendMessage(chatId, "❌ الكود غير صحيح.");
      delSession(chatId);
      return showNumbersMenu(chatId, user.id, "🔄 حاول مرة أخرى:");
    }

    // ⭐ هنا نقوم بحفظ التوكن، لكي نستخدمه في المرات القادمة للتفعيل المباشر
    const accessToken = tokenRes.data.access_token;
    addUserPhone(msg.from.id, senderNo, accessToken); 

    const statusMsg = await bot.sendMessage(chatId, "⚡ *جاري تفعيل الهدية، انتظر لحظات...*", { parse_mode: 'Markdown' });

    const { successCount } = await executeSmartParallel(senderNo, `Bearer ${accessToken}`);

    if (successCount > 0) {
      await showGift(chatId, statusMsg.message_id, user, senderNo, successCount);
    } else {
      await bot.editMessageText("⚠️ *خوادم جيزي مشغولة حالياً.*\nحاول لاحقاً.", { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' });
    }

    delSession(chatId);
  }
});

bot.on('polling_error', (err) => console.error('Polling Error:', err.message));

console.log("✅ البوت يعمل بنجاح...");
