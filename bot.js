const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes } = require('sequelize');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const crypto = require('crypto');

// Load env
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const DB_PATH = process.env.DB_PATH || './data/bot.sqlite';
const PORT = process.env.PORT || 3000;
const VODAFONE_NUMBER = process.env.VODAFONE_NUMBER;

if(!BOT_TOKEN || !ADMIN_CHAT_ID || !VODAFONE_NUMBER){
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
  priceStars: DataTypes.INTEGER,
  priceEGP: DataTypes.FLOAT,
  priceUSD: DataTypes.FLOAT,
  paymentMethod: DataTypes.STRING,
  status: { type: DataTypes.STRING, defaultValue: 'pending' },
  proofPath: DataTypes.STRING,
  startedAt: DataTypes.DATE,
  expiresAt: DataTypes.DATE,
  flagged: { type: DataTypes.BOOLEAN, defaultValue: false },
});

// Init DB
(async ()=>{ await sequelize.sync(); })();

const bot = new Telegraf(BOT_TOKEN);

// Multer setup for proofs
const uploadDir = path.join(__dirname, 'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Helper functions
function calcPrices(plan){
  // Prices: [Stars, EGP, USD]
  switch(plan){
    case 1: return { stars:100, egp:150, usd:2 };
    case 6: return { stars:400, egp:250, usd:4 };
    case 12: return { stars:700, egp:350, usd:7 };
    default: return { stars:0, egp:0, usd:0 };
  }
}

// Phrases
const PHRASES = {
  ar:{
    welcome:'أهلاً! اختر اللغة', main_menu:'اختر خدمة', subscribe:'اشتراك', support:'دعم',
    my_subs:'اشتراكاتي', choose_plan:'اختر مدة الاشتراك:', choose_payment:'اختر طريقة الدفع:',
    upload_proof:'أرفق اسكرين التحويل الآن', stars_info:(plan)=>`💰 ${plan.stars} ستارز`, egp_info:(plan)=>`💰 ${plan.egp} جنيه`, usd_info:(plan)=>`💰 ${plan.usd}$`,
    vodafone_info:(num)=>`من فضلك حول المبلغ على رقم فودافون كاش: ${num} ثم أرفق اسكرين التحويل`,
    stars_group_info:'حول المبلغ للجروب: @remaigofvfkvro547gv ثم أرفق اسكرين التحويل',
    sent_proof:'تم إرسال الاسكرين وسيتم التحقق منه', support_link:'من فضلك تواصل مع الدعم عبر هذا الجروب: https://t.me/remaigofvfkvro547gv',
  },
  en:{
    welcome:'Welcome! Choose language', main_menu:'Choose an option', subscribe:'Subscribe', support:'Support',
    my_subs:'My subscriptions', choose_plan:'Choose plan duration:', choose_payment:'Choose payment method:',
    upload_proof:'Attach your payment proof', stars_info:(plan)=>`💰 ${plan.stars} Stars`, egp_info:(plan)=>`💰 ${plan.egp} EGP`, usd_info:(plan)=>`💰 ${plan.usd}$`,
    vodafone_info:(num)=>`Please send the money to Vodafone Cash number: ${num} and attach proof`,
    stars_group_info:'Send Stars to the group: @remaigofvfkvro547gv and attach proof',
    sent_proof:'Proof sent! Verification in progress', support_link:'Please contact support via this group: https://t.me/remaigofvfkvro547gv',
  }
};

// Start
bot.start(async ctx=>{
  const id = String(ctx.from.id);
  await User.findOrCreate({ where:{ telegramId:id }, defaults:{ username:ctx.from.username || ctx.from.first_name } });
  return ctx.reply(PHRASES.ar.welcome, Markup.keyboard([['🇸🇦 العربية','🇬🇧 English']]).oneTime().resize());
});

// Language selection
bot.hears(['🇸🇦 العربية','العربية'], async ctx=>{
  const id = String(ctx.from.id); const user = await User.findOne({ where:{ telegramId:id } }); if(user){ user.lang='ar'; await user.save(); }
  await ctx.reply(PHRASES.ar.main_menu, Markup.inlineKeyboard([[Markup.button.callback('اشتراك','subscribe')],[Markup.button.callback('دعم','support')]]));
});

bot.hears(['🇬🇧 English','English'], async ctx=>{
  const id = String(ctx.from.id); const user = await User.findOne({ where:{ telegramId:id } }); if(user){ user.lang='en'; await user.save(); }
  await ctx.reply(PHRASES.en.main_menu, Markup.inlineKeyboard([[Markup.button.callback('Subscribe','subscribe')],[Markup.button.callback('Support','support')]]));
});

// Subscribe flow
bot.action('subscribe', async ctx=>{
  const id = String(ctx.from.id); const user = await User.findOne({ where:{ telegramId:id } }); const lang=user?.lang||'ar'; const phrase=PHRASES[lang];
  await ctx.editMessageText(phrase.choose_plan, Markup.inlineKeyboard([
    [Markup.button.callback('1 شهر','plan_1')],
    [Markup.button.callback('6 شهر','plan_6')],
    [Markup.button.callback('12 شهر','plan_12')],
    [Markup.button.callback('اشتراك الجروب','group_sub')],
    [Markup.button.callback('اشتراك الايف','live_sub')]
  ]));
});

bot.action(/plan_(\d+)/, async ctx=>{
  const months=parseInt(ctx.match[1]); const id=String(ctx.from.id); const user=await User.findOne({ where:{ telegramId:id } }); const lang=user?.lang||'ar'; const phrase=PHRASES[lang];
  const prices=calcPrices(months);

  // Save subscription placeholder
  await Subscription.create({ telegramId:id, username:ctx.from.username || ctx.from.first_name, planMonths:months, priceStars:prices.stars, priceEGP:prices.egp, priceUSD:prices.usd, status:'pending' });

  // Ask payment method
  await ctx.editMessageText(
    `${phrase.choose_payment}\n${phrase.stars_info(prices)} | ${phrase.usd_info(prices)} | ${phrase.egp_info(prices)}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Stars','pay_stars'), Markup.button.callback('Vodafone Cash','pay_vodafone')]
    ])
  );
});

// Stars payment
bot.action('pay_stars', async ctx=>{
  const id=String(ctx.from.id); const user=await User.findOne({ where:{ telegramId:id } }); const lang=user?.lang||'ar'; const phrase=PHRASES[lang];
  await ctx.editMessageText(phrase.stars_group_info, Markup.inlineKeyboard([
    [Markup.button.callback('أرسلت الاسكرين','sent_proof')]
  ]));
});

// Vodafone payment
bot.action('pay_vodafone', async ctx=>{
  const id=String(ctx.from.id); const user=await User.findOne({ where:{ telegramId:id } }); const lang=user?.lang||'ar'; const phrase=PHRASES[lang];
  await ctx.editMessageText(phrase.vodafone_info(VODAFONE_NUMBER), Markup.inlineKeyboard([
    [Markup.button.callback('أرسلت الاسكرين','sent_proof')]
  ]));
});

// Proof sent
bot.action('sent_proof', async ctx=>{
  await ctx.reply('👍 '+PHRASES.ar.sent_proof);
});

// Support button
bot.action('support', async ctx=>{
  const id=String(ctx.from.id); const user=await User.findOne({ where:{ telegramId:id } }); const lang=user?.lang||'ar'; const phrase=PHRASES[lang];
  await ctx.editMessageText(phrase.support_link);
});

bot.launch();
console.log('Bot started');

process.once('SIGINT',()=>{ bot.stop('SIGINT'); process.exit(); });
process.once('SIGTERM',()=>{ bot.stop('SIGTERM'); process.exit(); });
