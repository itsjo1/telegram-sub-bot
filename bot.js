const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes } = require('sequelize');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const exiftool = require('exiftool-vendored').exiftool;
const crypto = require('crypto');

// Load env
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const DB_PATH = process.env.DB_PATH || './data/bot.sqlite';
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
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
  priceUSD: DataTypes.FLOAT,
  priceEGP: DataTypes.FLOAT,
  paymentMethod: DataTypes.STRING,
  status: { type: DataTypes.STRING, defaultValue: 'pending' },
  proofSent: { type: DataTypes.BOOLEAN, defaultValue: false },
});

(async ()=>{ await sequelize.sync(); })();

const bot = new Telegraf(BOT_TOKEN);

// helpers
async function p(telegramId,key,...args){ 
  const user = await User.findOne({ where:{ telegramId:String(telegramId) } }); 
  const lang = user?.lang || 'ar'; 
  const phrase = PHRASES[lang][key]; 
  if(typeof phrase==='function') return phrase(...args); 
  return phrase; 
}

// Pricing plans
const PLANS = {
  1:{stars:100, usd:2, egp:150},
  6:{stars:400, usd:4, egp:250},
  12:{stars:700, usd:7, egp:350},
  live:{stars:2000, usd:20, egp:700} // live per session
};

// Phrases
const PHRASES = {
  ar:{
    welcome:'أهلاً! اختر اللغة', 
    main_menu:'اختر خدمة', 
    subscribe:'اشتراك', 
    support:'دعم', 
    my_subs:'اشتراكاتي', 
    choose_plan:'اختر مدة الاشتراك:', 
    choose_payment:'اختر طريقة الدفع:', 
    attach_screenshot:'يرجى إرفاق اسكرين التحويل', 
    sent_screenshot:'لقد أرسلت الاسكرين!', 
    join_group:'اشتراك الجروب', 
    join_live:'اشتراك الايف', 
    stars:'ستارز 💰', 
    vodafone:'فودافون كاش 💰', 
    support_msg:'من فضلك تواصل مع الدعم على هذا الجروب @remaigofvfkvro547gv وسيتم الرد عليك في أسرع وقت ممكن',
    price_info:(plan)=>`السعر: ${plan.stars} ستارز 💰 | ${plan.usd}$ 💰 | ${plan.egp}ج 💰`
  },
  en:{
    welcome:'Welcome! Choose language', 
    main_menu:'Choose an option', 
    subscribe:'Subscribe', 
    support:'Support', 
    my_subs:'My subscriptions', 
    choose_plan:'Choose subscription duration:', 
    choose_payment:'Choose payment method:', 
    attach_screenshot:'Please attach payment screenshot', 
    sent_screenshot:'Screenshot sent!', 
    join_group:'Group Subscription', 
    join_live:'Live Subscription', 
    stars:'Stars 💰', 
    vodafone:'Vodafone Cash 💰', 
    support_msg:'Please contact support via this group @remaigofvfkvro547gv and explain your issue. You will be answered ASAP.',
    price_info:(plan)=>`Price: ${plan.stars} Stars 💰 | ${plan.usd}$ 💰 | ${plan.egp} EGP 💰`
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

// Subscribe flow
bot.action('subscribe', async ctx=>{
  const id=String(ctx.from.id); 
  const user = await User.findOne({ where:{ telegramId:id } }); 
  const lang = user?.lang || 'ar'; 
  const phrase = PHRASES[lang];
  await ctx.editMessageText(phrase.choose_plan, Markup.inlineKeyboard([
    [Markup.button.callback('1 شهر','plan_1')],
    [Markup.button.callback('6 شهر','plan_6')],
    [Markup.button.callback('12 شهر','plan_12')],
    [Markup.button.callback('Live','plan_live')]
  ]));
});

// Select plan
bot.action(/plan_(.+)/, async ctx=>{
  const planKey = ctx.match[1];
  const id = String(ctx.from.id); 
  const user = await User.findOne({ where:{ telegramId:id } }); 
  const lang = user?.lang || 'ar'; 
  const phrase = PHRASES[lang];
  const plan = PLANS[planKey];
  if(!plan) return ctx.reply('خطأ.');
  
  await ctx.editMessageText(phrase.choose_payment, Markup.inlineKeyboard([
    [Markup.button.callback(phrase.stars,'pay_stars_'+planKey)],
    [Markup.button.callback(phrase.vodafone,'pay_vod_'+planKey)]
  ]));

  await Subscription.create({
    telegramId:id,
    username:ctx.from.username || ctx.from.first_name,
    planMonths: planKey==='live'?0:parseInt(planKey),
    priceStars: plan.stars,
    priceUSD: plan.usd,
    priceEGP: plan.egp,
    status:'pending'
  });
});

// Payment method
bot.action(/pay_stars_(.+)/, async ctx=>{
  const planKey = ctx.match[1]; 
  const id = String(ctx.from.id); 
  const user = await User.findOne({ where:{ telegramId:id } }); 
  const lang = user?.lang || 'ar'; 
  const phrase = PHRASES[lang];
  const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
  if(!sub) return ctx.reply('خطأ.');
  sub.paymentMethod='Stars'; await sub.save();
  await ctx.editMessageText(`${phrase.price_info(sub)}\n\nيرجى الانضمام إلى الجروب @remaigofvfkvro547gv\nثم اضغط على صندوق الهدايا لإرسال الاستارز.` , Markup.inlineKeyboard([[Markup.button.callback('أرسلت الاسكرين','sent_screenshot')]]));
});

bot.action(/pay_vod_(.+)/, async ctx=>{
  const planKey = ctx.match[1]; 
  const id = String(ctx.from.id); 
  const user = await User.findOne({ where:{ telegramId:id } }); 
  const lang = user?.lang || 'ar'; 
  const phrase = PHRASES[lang];
  const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
  if(!sub) return ctx.reply('خطأ.');
  sub.paymentMethod='Vodafone'; await sub.save();
  await ctx.editMessageText(`${phrase.price_info(sub)}\n\nمن فضلك حول المبلغ على رقم ${VODAFONE_NUMBER} وأرفق اسكرين التحويل`, Markup.inlineKeyboard([[Markup.button.callback('أرسلت الاسكرين','sent_screenshot')]]));
});

// Screenshot confirmation
bot.action('sent_screenshot', async ctx=>{
  const id = String(ctx.from.id);
  const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
  if(!sub) return ctx.reply('خطأ.');
  sub.proofSent=true; await sub.save();
  const user = await User.findOne({ where:{ telegramId:id } }); 
  const lang = user?.lang || 'ar'; 
  const phrase = PHRASES[lang];
  await ctx.editMessageText(phrase.sent_screenshot);
});

// Support
bot.action('support', async ctx=>{
  const id = String(ctx.from.id);
  const user = await User.findOne({ where:{ telegramId:id } }); 
  const lang = user?.lang || 'ar'; 
  const phrase = PHRASES[lang];
  await ctx.editMessageText(phrase.support_msg);
});

bot.launch();
console.log('Bot started');

process.once('SIGINT',()=>{ bot.stop('SIGINT'); exiftool.end(); process.exit(); });
process.once('SIGTERM',()=>{ bot.stop('SIGTERM'); exiftool.end(); process.exit(); });
