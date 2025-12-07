const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes } = require('sequelize');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
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
  priceUSD: DataTypes.FLOAT,
  priceStars: DataTypes.FLOAT,
  priceEGP: DataTypes.FLOAT,
  paymentMethod: DataTypes.STRING,
  status: { type: DataTypes.STRING, defaultValue: 'pending' },
  proofPath: DataTypes.STRING,
  productLink: DataTypes.STRING,
  startedAt: DataTypes.DATE,
  expiresAt: DataTypes.DATE,
  flagged: { type: DataTypes.BOOLEAN, defaultValue: false },
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
async function runOCR(filePath, lang='eng+ara'){ 
  try{ const { data: { text } } = await Tesseract.recognize(filePath, lang); return text; } 
  catch(e){ return ''; } 
}

// pricing plans
const PLANS = {
  6: { priceUSD: 2, priceStars: 200, priceEGP: 150 },
  12: { priceUSD: 7, priceStars: 700, priceEGP: 350 }
};

// phrases
const PHRASES = {
  ar:{ 
    welcome:'أهلاً! اختر اللغة', main_menu:'اختر خدمة', subscribe:'اشتراك', support:'دعم', my_subs:'اشتراكاتي',
    choose_plan:'اختر مدة الاشتراك:', choose_type:'اختر نوع المنتج:', upload_proof:'ارفع سكرين التحويل الآن',
    thanks:'تم التحقق! تم إرسال رابط المنتج.', flagged:'تم تحديد إثبات الدفع كمشتبه به.',
    pending:'طلبك قيد المراجعة.', enter_support:'اكتب مشكلتك وسيتم الرد عليك', sent_support:'تم إرسال طلب الدعم.',
    price_info:(m,pStars,pEGP,pUSD)=>`الخطة: ${m} شهر - السعر: ${pStars} Stars / ${pEGP} EGP / ${pUSD}$`,
    payment_methods:(vod)=>`طرق الدفع:\n- Stars\n- فودافون كاش: ${vod}`
  },
  en:{ 
    welcome:'Welcome! Choose language', main_menu:'Choose an option', subscribe:'Subscribe', support:'Support', my_subs:'My Subscriptions',
    choose_plan:'Choose plan duration:', choose_type:'Choose product type:', upload_proof:'Upload your payment proof',
    thanks:'Payment verified! Product link sent.', flagged:'Payment proof flagged as suspicious.', pending:'Pending review.',
    enter_support:'Type your issue', sent_support:'Support request sent.',
    price_info:(m,pStars,pEGP,pUSD)=>`Plan: ${m} months - Price: ${pStars} Stars / ${pEGP} EGP / ${pUSD}$`,
    payment_methods:(vod)=>`Payment methods:\n- Stars\n- Vodafone Cash: ${vod}`
  }
};

// Start
bot.start(async ctx=>{
  const id = String(ctx.from.id);
  await User.findOrCreate({ where:{ telegramId:id }, defaults:{ username:ctx.from.username || ctx.from.first_name } });
  return ctx.reply(PHRASES.ar.welcome, Markup.keyboard([['🇸🇦 العربية','🇬🇧 English']]).oneTime().resize());
});

bot.hears(['🇸🇦 العربية','العربية'], async ctx=>{
  const id = String(ctx.from.id); 
  const user = await User.findOne({ where:{ telegramId:id } }); 
  if(user){ user.lang='ar'; await user.save(); }
  await ctx.reply(PHRASES.ar.main_menu, Markup.inlineKeyboard([
    [Markup.button.callback('اشتراك','subscribe')],
    [Markup.button.callback('دعم','support')],
    [Markup.button.callback('اشتراكاتي','my_subs')]
  ]));
});

bot.hears(['🇬🇧 English','English'], async ctx=>{
  const id = String(ctx.from.id); 
  const user = await User.findOne({ where:{ telegramId:id } }); 
  if(user){ user.lang='en'; await user.save(); }
  await ctx.reply(PHRASES.en.main_menu, Markup.inlineKeyboard([
    [Markup.button.callback('Subscribe','subscribe')],
    [Markup.button.callback('Support','support')],
    [Markup.button.callback('My subscriptions','my_subs')]
  ]));
});

// subscribe flow
bot.action('subscribe', async ctx=>{
  const id=String(ctx.from.id); 
  const user = await User.findOne({ where:{ telegramId:id } }); 
  const lang=user?.lang||'ar'; 
  const phrase=PHRASES[lang];

  await ctx.editMessageText(phrase.choose_plan, Markup.inlineKeyboard([
    [Markup.button.callback('6 شهر','plan_6')],
    [Markup.button.callback('12 شهر','plan_12')]
  ]));
});

bot.action(/plan_(\d+)/, async ctx=>{
  const months=parseInt(ctx.match[1]); 
  if(!PLANS[months]) return ctx.reply('الخطة غير موجودة');
  const id=String(ctx.from.id); 
  const user=await User.findOne({ where:{ telegramId:id } }); 
  const lang=user?.lang||'ar'; 
  const phrase=PHRASES[lang]; 
  const plan = PLANS[months];

  await ctx.editMessageText(
    phrase.choose_type + '\n' + phrase.price_info(months,plan.priceStars,plan.priceEGP,plan.priceUSD) +
    '\n' + phrase.payment_methods(VODAFONE_NUMBER),
    Markup.inlineKeyboard([
      [Markup.button.callback('Stars','pay_stars'), Markup.button.callback('Vodafone Cash','pay_vod')],
      [Markup.button.callback('صور فقط','type_photos'), Markup.button.callback('فيديو فقط','type_video')]
    ])
  );

  await Subscription.create({
    telegramId:id,
    username:ctx.from.username || ctx.from.first_name,
    planMonths:months,
    priceUSD:plan.priceUSD,
    priceStars:plan.priceStars,
    priceEGP:plan.priceEGP,
    status:'pending'
  });
});

// Payment method selection
bot.action('pay_stars', async ctx=>{
  const id = String(ctx.from.id);
  const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
  sub.paymentMethod = 'Stars';
  await sub.save();
  await ctx.answerCbQuery();
  await ctx.reply('اختر نوع المنتج وارفع صورة التحويل');
});

bot.action('pay_vod', async ctx=>{
  const id = String(ctx.from.id);
  const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
  sub.paymentMethod = 'Vodafone';
  await sub.save();
  await ctx.answerCbQuery();
  await ctx.reply(`سدد على رقم فودافون كاش: ${VODAFONE_NUMBER}`);
});

// Product type selection
['type_photos','type_video'].forEach(action=>{
  bot.action(action, async ctx=>{
    const type = action==='type_photos'?'photos':'video';
    const id = String(ctx.from.id);
    const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
    if(!sub) return ctx.reply('حدث خطأ. أعد المحاولة.');
    sub.planType=type; await sub.save();
    const user=await User.findOne({ where:{ telegramId:id } }); const lang=user?.lang||'ar'; const phrase=PHRASES[lang];
    await ctx.editMessageText(phrase.upload_proof + '\n' + phrase.payment_methods(VODAFONE_NUMBER));
  });
});

// OCR Validation
async function validateScreenshot(filePath){
  const text = await runOCR(filePath);
  if(!text.includes('REMA™VIP Solutions 💢')){
    return false; 
  }
  return true;
}

bot.on('photo', async ctx=>{
  const id = String(ctx.from.id);
  const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
  if(!sub) return ctx.reply('حدث خطأ.');

  const photo = ctx.message.photo.pop();
  const fileId = photo.file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const filePath = path.join(uploadDir, `${Date.now()}.jpg`);
  const res = await fetch(fileLink);
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(buffer));

  const valid = await validateScreenshot(filePath);
  if(!valid){
    sub.flagged = true;
    await sub.save();
    return ctx.reply('التحويل يبدو أنه لم يتم على القناة الصحيحة!');
  }

  sub.proofPath = filePath;
  await sub.save();
  ctx.reply('تم التحقق من الدفع! سيتم إرسال رابط المنتج قريباً.');
});

bot.launch();
console.log('Bot started');
