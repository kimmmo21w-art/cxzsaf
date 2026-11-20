const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

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

// ====== نظام حفظ البيانات (JSON) ======
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
  } catch (e) { return { users: {}, sessions: {} }; }
}

function writeDB(data) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); } catch (e) {}
}

// حفظ رقم وتوكن المستخدم
function addUserPhone(userId, phone, token = null) {
  if (!phone) return;
  const db = readDB();
  const uid = String(userId); 
  if (!db.users[uid] || !Array.isArray(db.users[uid])) db.users[uid] = [];
  
  const existing = db.users[uid].find(u => u && u.phone === phone);
  if (existing) {
    if (token) existing.token = token;
  } else {
    db.users[uid].push({ phone, token });
  }
  writeDB(db);
}

function getUserPhones(userId) {
  const db = readDB();
  const uid = String(userId);
  if (!db.users[uid] || !Array.isArray(db.users[uid])) return [];
  return db.users[uid].filter(u => u && u.phone);
}

function getPhoneToken(userId, phone) {
  const phones = getUserPhones(userId);
  const found = phones.find(p => p.phone === phone);
  return found ? found.token : null;
}

function setSession(chatId, step, sender = null) { 
  const db = readDB(); db.sessions[String(chatId)] = { step, sender }; writeDB(db); 
}
function getSession(chatId) { 
  const db = readDB(); return db.sessions[String(chatId)] || null; 
}
function delSession(chatId) { 
  const db = readDB(); delete db.sessions[String(chatId)]; writeDB(db); 
}

// ====== أدوات مساعدة ======
function formatNum(phone) {
  phone = phone.trim();
  if (phone.startsWith('0')) return "213" + phone.slice(1);
  return phone;
}
function maskPhone(phone) {
  if (!phone) return "غير معروف";
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
    } catch (e) {}
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
    parse_mode: 'Markdown', reply_markup: keyboard
  });
}

// ====== Djezzy API ======
async function requestOtp(msisdn) {
  const url = "https://apim.djezzy.dz/mobile-api/oauth2/registration";
  const params = { msisdn, client_id: "87pIExRhxBb3_wGsA5eSEfyATloa", scope: "smsotp" };
  const payload = { "consent-agreement": [{ "marketing-notifications": false }], "is-consent": true };
  // زيادة وقت الانتظار لضمان نجاح الاتصال
  return axios.post(url, payload, { params, headers: COMMON_HEADERS, timeout: 30000 });
}

async function executeSmartParallel(msisdn, token) {
  const url = `https://apim.djezzy.dz/mobile-api/api/v1/services/walk/activate-reward/${msisdn}`;
  const headers = { ...COMMON_HEADERS, authorization: token, 'accept-language': "fr" };
  let successCount = 0;
  // 3 محاولات سريعة
  for (let i = 0; i < 3; i++) {
    try {
      const res = await axios.post(url, { packageCode: TARGET_PACKAGE_CODE }, { headers, timeout: 20000 });
      if ([200, 201].includes(res.status)) successCount++;
    } catch (error) {}
  }
  return { successCount };
}

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

  // إشعار القناة
  try {
    await bot.sendMessage(LOG_CHANNEL, `🌟 *تفعيل ناجح!*\n👤 ${mention}\n📞 \`${masked}\`\n🤖 @${me.username}`, { parse_mode: 'Markdown' });
  } catch (e) {}
}

// ====== معالج الأزرار (فقط للاشتراك الإجباري) ======
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  if (data === 'check_sub') {
    const sub = await checkSubscription(userId);
    if (sub.ok) {
      await bot.answerCallbackQuery(query.id, { text: "✅ تم التحقق!" });
      await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      bot.sendMessage(chatId, "🚀 *مرحباً بك!*\n\nأرسل رقم هاتف جيزي الخاص بك (مثال: 0550123456) لتفعيل الهدية:", { parse_mode: 'Markdown' });
    } else {
      await bot.answerCallbackQuery(query.id, { text: `❌ يجب الاشتراك أولاً في ${sub.channel}`, show_alert: true });
    }
  }
});

// ====== الأوامر ======
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const sub = await checkSubscription(userId);
  if (!sub.ok) return sendForceSubscribe(chatId);

  // مسح أي جلسة سابقة والبدء بطلب الرقم
  delSession(chatId);
  bot.sendMessage(chatId, "👋 *أهلاً بك يا بطل!*\n\nأرسل رقم هاتف جيزي الخاص بك الآن (مثال: 0550123456) لتفعيل هديتك:", { parse_mode: 'Markdown' });
});

// ====== استقبال الرسائل (الأرقام والأكواد) ======
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();

  const sub = await checkSubscription(userId);
  if (!sub.ok) return sendForceSubscribe(chatId);

  // 1. إذا أرسل المستخدم رقماً (يبدأ بـ 0 أو 213 وطوله منطقي)
  if (/^(0|213)\d{8,10}$/.test(text)) {
    const phone = formatNum(text);
    const token = getPhoneToken(userId, phone); // هل الرقم محفوظ مسبقاً؟

    if (token) {
      // الرقم محفوظ ولديه توكن -> تفعيل مباشر وسريع
      const statusMsg = await bot.sendMessage(chatId, "⚡ *جاري التفعيل المباشر...*", { parse_mode: 'Markdown' });
      const { successCount } = await executeSmartParallel(phone, token);
      
      if (successCount > 0) {
        return showGift(chatId, statusMsg.message_id, msg.from, phone, successCount);
      } else {
        return bot.editMessageText("⚠️ *انتهت صلاحية الجلسة.*\nسيتم إرسال كود جديد لرقمك...", { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }).then(() => {
           // نطلب كود لأن التوكن منتهي
           requestOtp(phone).then(() => {
             setSession(chatId, 'OTP', phone);
             bot.sendMessage(chatId, "📩 أرسل كود OTP الذي وصلك الآن:");
           }).catch(() => bot.sendMessage(chatId, "❌ فشل إرسال الكود، حاول لاحقاً."));
        });
      }
    } else {
      // رقم جديد -> طلب كود فوراً
      try {
        const res = await requestOtp(phone);
        if ([200, 201].includes(res.status)) {
          setSession(chatId, 'OTP', phone);
          bot.sendMessage(chatId, "📩 وصلك كود OTP في رسالة، أرسله هنا لتفعيل الهدية:");
        } else {
          bot.sendMessage(chatId, "❌ فشل إرسال الكود. تأكد من الرقم.");
        }
      } catch (e) {
        bot.sendMessage(chatId, "❌ خوادم جيزي مشغولة، يرجى المحاولة بعد قليل.");
      }
    }
    return;
  }

  // 2. إذا كان المستخدم في مرحلة إدخال الكود (OTP)
  const session = getSession(chatId);
  if (session && session.step === 'OTP') {
    const otp = text;
    const senderNo = session.sender;

    const payload = new URLSearchParams({
      otp, mobileNumber: senderNo, scope: "djezzyAppV2", client_id: "87pIExRhxBb3_wGsA5eSEfyATloa",
      client_secret: "uf82p68Bgisp8Yg1Uz8Pf6_v1XYa", grant_type: "mobile"
    });

    try {
      const tokenRes = await axios.post("https://apim.djezzy.dz/mobile-api/oauth2/token", payload.toString(), {
        headers: { ...COMMON_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000
      });
      
      if (tokenRes.status !== 200) throw new Error();

      const accessToken = "Bearer " + tokenRes.data.access_token;
      addUserPhone(userId, senderNo, accessToken); // حفظ الرقم والتوكن
      
      const statusMsg = await bot.sendMessage(chatId, "⚡ *جاري تفعيل الهدية...*", { parse_mode: 'Markdown' });
      const { successCount } = await executeSmartParallel(senderNo, accessToken);

      if (successCount > 0) {
        await showGift(chatId, statusMsg.message_id, msg.from, senderNo, successCount);
      } else {
        await bot.editMessageText("⚠️ *خوادم جيزي مشغولة.* يرجى المحاولة لاحقاً.", { chat_id: chatId, message_id: statusMsg.message_id });
      }

    } catch (e) {
      bot.sendMessage(chatId, "❌ الكود غير صحيح أو انتهت صلاحيته. أرسل الرقم من جديد.");
    }
    delSession(chatId);
  }
});

bot.on('polling_error', (err) => console.error('Polling Error:', err.message));
console.log("✅ البوت يعمل بنجاح...");
