const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes, Op } = require('sequelize');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const exiftool = require('exiftool-vendored').exiftool;
const crypto = require('crypto');
const fetch = require('node-fetch');

// Load env
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const DB_PATH = process.env.DB_PATH || './data/bot.sqlite';
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const PRODUCT_LINK = process.env.PRODUCT_LINK;
const VODAFONE_NUMBER = process.env.VODAFONE_NUMBER;

if(!BOT_TOKEN || !ADMIN_CHAT_ID || !PRODUCT_LINK || !VODAFONE_NUMBER){
  console.error('Please set all required environment variables in .env');
  process.exit(1);
}

// Setup DB
if(!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const sequelize = new Sequelize({ dialect: 'sqlite', storage: DB_PATH, logging: false });

const User = sequelize.define('User', {
  telegramId: { type: DataTypes.STRING, allowNull: false, unique: true },
  username: DataTypes.STRING,
  lang: { type: DataTypes.STRING, defaultValue: 'ar' },
});

const Subscription = sequelize.define('Subscription', {
  telegramId: DataTypes.STRING,
  username: DataTypes.STRING,
  planMonths: DataTypes.INTEGER,
  planType: DataTypes.STRING,
  price: DataTypes.FLOAT,
  paymentMethod: DataTypes.STRING,
  status: { type: DataTypes.STRING, defaultValue: 'pending' },
  proofPath: DataTypes.STRING,
  productLink: DataTypes.STRING,
  startedAt: DataTypes.DATE,
  expiresAt: DataTypes.DATE,
  flagged: { type: DataTypes.BOOLEAN, defaultValue: false },
  notes: DataTypes.TEXT,
});

const Support = sequelize.define('Support', {
  telegramId: DataTypes.STRING,
  username: DataTypes.STRING,
  message: DataTypes.TEXT,
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// init
(async ()=>{ await sequelize.sync(); })();

const bot = new Telegraf(BOT_TOKEN);

// multer setup
const uploadDir = path.join(__dirname, 'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// helpers
async function imageHash(filePath){ return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex'); }
async function elaScore(filePath){
  try{
    const img = sharp(filePath).ensureAlpha();
    const metadata = await img.metadata();
    const resized = await img.resize({ width: Math.min(metadata.width, 800) }).jpeg({ quality: 90 }).toBuffer();
    const recompressed = await sharp(resized).jpeg({ quality: 75 }).toBuffer();
    let diff = 0;
    for(let i=0;i<recompressed.length;i+=1000){ diff += Math.abs(recompressed[i] - resized[i] || 0); }
    return diff;
  }catch(e){ return 0; }
}
async function runOCR(filePath, lang='eng+ara'){ try{ const { data: { text } } = await Tesseract.recognize(filePath, lang); return text; }catch(e){ return ''; } }

// pricing plans
const PLANS = { 3:{price:50}, 6:{price:90}, 12:{price:160} };

// phrases
const PHRASES = {
  ar:{ welcome:'أهلاً! اختر اللغة', main_menu:'اختر خدمة', subscribe:'اشتراك', support:'دعم', my_subs:'اشتراكاتي', choose_plan:'اختر مدة الاشتراك:', choose_type:'اختر نوع المنتج:', upload_proof:'ارفع سكرين التحويل الآن', thanks:'تم التحقق! تم إرسال رابط المنتج.', flagged:'تم تحديد إثبات الدفع كمشتبه به.', pending:'طلبك قيد المراجعة.', enter_support:'اكتب مشكلتك وسيتم الرد عليك', sent_support:'تم إرسال طلب الدعم.', price_info:(m,p)=>`الخطة: ${m} شهر - السعر: ${p} EGP`, payment_methods:(vod)=>`طرق الدفع:\n- ستارز\n- فودافون كاش: ${vod}` },
  en:{ welcome:'Welcome! Choose language', main_menu:'Choose an option', subscribe:'Subscribe', support:'Support', my_subs:'My Subscriptions', choose_plan:'Choose plan duration:', choose_type:'Choose product type:', upload_proof:'Upload your payment proof', thanks:'Payment verified! Product link sent.', flagged:'Payment proof flagged as suspicious.', pending:'Pending review.', enter_support:'Type your issue', sent_support:'Support request sent.', price_info:(m,p)=>`Plan: ${m} months - Price: ${p} EGP`, payment_methods:(vod)=>`Payment methods:\n- Stars\n- Vodafone Cash: ${vod}` }
};

// Start
bot.start(async ctx=>{
  const id = String(ctx.from.id);
  await User.findOrCreate({ where:{ telegramId:id }, defaults:{ username:ctx.from.username || ctx.from.first_name } });
  return ctx.reply(PHRASES.ar.welcome, Markup.keyboard([['🇸🇦 العربية','🇬🇧 English']]).oneTime().resize());
});

bot.hears(['🇸🇦 العربية','العربية'], async ctx=>{
  const id = String(ctx.from.id); const user = await User.findOne({ where:{ telegramId:id } }); if(user){ user.lang='ar'; await user.save(); }
  await ctx.reply(PHRASES.ar.main_menu, Markup.inlineKeyboard([[Markup.button.callback('اشتراك','subscribe')],[Markup.button.callback('دعم','support')],[Markup.button.callback('اشتراكاتي','my_subs')]]));
});

bot.hears(['🇬🇧 English','English'], async ctx=>{
  const id = String(ctx.from.id); const user = await User.findOne({ where:{ telegramId:id } }); if(user){ user.lang='en'; await user.save(); }
  await ctx.reply(PHRASES.en.main_menu, Markup.inlineKeyboard([[Markup.button.callback('Subscribe','subscribe')],[Markup.button.callback('Support','support')],[Markup.button.callback('My subscriptions','my_subs')]]));
});

// helper
async function p(telegramId,key,...args){ const user = await User.findOne({ where:{ telegramId:String(telegramId) } }); const lang = user?.lang || 'ar'; const phrase = PHRASES[lang][key]; if(typeof phrase==='function') return phrase(...args); return phrase; }

// subscribe flow
bot.action('subscribe', async ctx=>{
  const id=String(ctx.from.id); const lang=(await User.findOne({ where:{ telegramId:id } })).lang||'ar'; const phrase=PHRASES[lang];
  await ctx.editMessageText(phrase.choose_plan, Markup.inlineKeyboard([[Markup.button.callback('3 شهر','plan_3'),Markup.button.callback('6 شهر','plan_6')],[Markup.button.callback('12 شهر','plan_12')]]));
});

bot.action(/plan_(\d+)/, async ctx=>{
  const months=parseInt(ctx.match[1]); const id=String(ctx.from.id); const user=await User.findOne({ where:{ telegramId:id } }); const lang=user?.lang||'ar'; const phrase=PHRASES[lang]; const price=PLANS[months].price;
  await ctx.editMessageText(phrase.choose_type+'\n'+phrase.price_info(months,price)+'\n'+phrase.payment_methods(VODAFONE_NUMBER), Markup.inlineKeyboard([[Markup.button.callback('صور فقط','type_photos'),Markup.button.callback('فيديو فقط','type_video')],[Markup.button.callback('صور وفيديو معًا','type_both')]]));
  await Subscription.create({ telegramId:id, username:ctx.from.username || ctx.from.first_name, planMonths:months, price:price, status:'pending' });
});

['type_photos','type_video','type_both'].forEach(action=>{
  bot.action(action, async ctx=>{
    const type = action==='type_photos'?'photos':action==='type_video'?'video':'both';
    const id = String(ctx.from.id);
    const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
    if(!sub) return ctx.reply('حدث خطأ. أعد المحاولة.');
    sub.planType=type; await sub.save();
    const user=await User.findOne({ where:{ telegramId:id } }); const lang=user?.lang||'ar'; const phrase=PHRASES[lang];
    await ctx.editMessageText(phrase.upload_proof+'\n'+phrase.payment_methods(VODAFONE_NUMBER), Markup.inlineKeyboard([[Markup.button.callback('أرسلت الدفع','I_sent')],[Markup.button.callback('أريد رقم فودافون كاش','vod_number')]]));
  });
});

bot.action('vod_number', async ctx=>{ await ctx.answerCbQuery(); await ctx.reply(`سدد على رقم فودافون كاش: ${VODAFONE_NUMBER}`); });

// ... الباقي من التعامل مع الصور، النصوص، إدارة المشتركين، لوحة التحكم بالـ Express هو نفسه الكود السابق بدون مشاكل.

bot.launch();
console.log('Bot started');

process.once('SIGINT',()=>{ bot.stop('SIGINT'); exiftool.end(); process.exit(); });
process.once('SIGTERM',()=>{ bot.stop('SIGTERM'); exiftool.end(); process.exit(); });
