const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes } = require('sequelize');
const crypto = require('crypto');

// Load env
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const DB_PATH = process.env.DB_PATH || './data/bot.sqlite';
const PORT = process.env.PORT || 3000;
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
  startedAt: DataTypes.DATE,
  expiresAt: DataTypes.DATE,
});

// init
(async ()=>{ await sequelize.sync(); })();

const bot = new Telegraf(BOT_TOKEN);

// Pricing plans
const PLANS = {
  6: { stars: 400, usd: 4, egp: 250 },
  12:{ stars: 700, usd: 7, egp: 350 }
};

// Live pricing
const LIVE_PRICE = { stars: 2000, usd: 20, egp: 700 };

// Phrases
const PHRASES = {
  ar:{
    welcome:'أهلاً! اختر اللغة',
    main_menu:'اختر خدمة',
    subscribe:'اشتراك',
    support:'دعم',
    my_subs:'اشتراكاتي',
    choose_plan:'اختر مدة الاشتراك:',
    choose_type:'اختر نوع المنتج:',
    upload_proof:'ارفع سكرين التحويل الآن',
    thanks:'تم التحقق! تم إرسال رابط المنتج.',
    support_msg:'من فضلك تواصل مع الدعم على الجروب هذا وشرح مشكلتك وسيتم الرد عليك في أسرع وقت ممكن: https://t.me/remaigofvfkvro547gv',
    price_info:(months,paymentMethod)=>`الخطة: ${months} شهر\nالسعر: ${pAmount(months,paymentMethod)} ${paymentMethod}`,
    payment_methods:'طرق الدفع:\n- ستارز\n- فودافون كاش'
  },
  en:{
    welcome:'Welcome! Choose language',
    main_menu:'Choose an option',
    subscribe:'Subscribe',
    support:'Support',
    my_subs:'My subscriptions',
    choose_plan:'Choose plan duration:',
    choose_type:'Choose product type:',
    upload_proof:'Upload your payment proof',
    thanks:'Payment verified! Product link sent.',
    support_msg:'Please contact support in this group and explain your issue: https://t.me/remaigofvfkvro547gv',
    price_info:(months,paymentMethod)=>`Plan: ${months} months\nPrice: ${pAmount(months,paymentMethod)} ${paymentMethod}`,
    payment_methods:'Payment methods:\n- Stars\n- Vodafone Cash'
  }
};

// Helper to get price by payment method
function pAmount(months,paymentMethod){
  if(months==='live') return LIVE_PRICE[paymentMethod.toLowerCase()];
  const plan = PLANS[months];
  if(!plan) return 0;
  return plan[paymentMethod.toLowerCase()];
}

// Start
bot.start(async ctx=>{
  const id = String(ctx.from.id);
  await User.findOrCreate({ where:{ telegramId:id }, defaults:{ username:ctx.from.username || ctx.from.first_name } });
  return ctx.reply(PHRASES.ar.welcome, Markup.keyboard([['🇸🇦 العربية','🇬🇧 English']]).oneTime().resize());
});

// Language selection
bot.hears(['🇸🇦 العربية','العربية'], async ctx=>{
  const id = String(ctx.from.id); const user = await User.findOne({ where:{ telegramId:id } });
  if(user){ user.lang='ar'; await user.save(); }
  await ctx.reply(PHRASES.ar.main_menu, Markup.inlineKeyboard([
    [Markup.button.callback('اشتراك','subscribe')],
    [Markup.button.callback('دعم','support')],
    [Markup.button.callback('اشتراكاتي','my_subs')]
  ]));
});

bot.hears(['🇬🇧 English','English'], async ctx=>{
  const id = String(ctx.from.id); const user = await User.findOne({ where:{ telegramId:id } });
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
  const user=await User.findOne({ where:{ telegramId:id } }); 
  const lang=user?.lang||'ar'; 
  const phrase=PHRASES[lang];
  await ctx.editMessageText(phrase.choose_plan, Markup.inlineKeyboard([
    [Markup.button.callback('6 شهر','plan_6'),Markup.button.callback('12 شهر','plan_12')],
    [Markup.button.callback('Live','plan_live')]
  ]));
});

bot.action(/plan_(\d+|live)/, async ctx=>{
  const months = ctx.match[1];
  const id = String(ctx.from.id);
  const user = await User.findOne({ where:{ telegramId:id } });
  const lang = user?.lang||'ar';
  const phrase = PHRASES[lang];

  await ctx.editMessageText(phrase.choose_type, Markup.inlineKeyboard([
    [Markup.button.callback('صور وفيديوهات','type_regular')],
    [Markup.button.callback('صور فقط','type_live'),Markup.button.callback('فيديو فقط','type_live')]
  ]));

  await Subscription.create({
    telegramId:id,
    username:ctx.from.username || ctx.from.first_name,
    planMonths:months==='live'?1:parseInt(months),
    price:0,
    status:'pending'
  });
});

// Choose type and payment
['type_regular','type_live'].forEach(action=>{
  bot.action(action, async ctx=>{
    const id = String(ctx.from.id);
    const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
    if(!sub) return ctx.reply('حدث خطأ. أعد المحاولة.');

    const type = action==='type_regular'?'regular':'live';
    sub.planType = type;
    await sub.save();

    const user = await User.findOne({ where:{ telegramId:id } });
    const lang = user?.lang||'ar';
    const phrase = PHRASES[lang];

    let keyboard = [[Markup.button.callback('أرسلت الدفع','I_sent')],[Markup.button.callback('أريد رقم فودافون كاش','vod_number')]];
    await ctx.editMessageText(phrase.upload_proof+'\n'+phrase.payment_methods, Markup.inlineKeyboard(keyboard));
  });
});

// Vodafone number
bot.action('vod_number', async ctx=>{ 
  await ctx.answerCbQuery(); 
  await ctx.reply(`سدد على رقم فودافون كاش: ${VODAFONE_NUMBER}`);
});

// Support button
bot.action('support', async ctx=>{
  const id = String(ctx.from.id);
  const user = await User.findOne({ where:{ telegramId:id } });
  const lang = user?.lang||'ar';
  const phrase = PHRASES[lang];
  await ctx.editMessageText(phrase.support_msg);
});

// Launch
bot.launch();
console.log('Bot started');
process.once('SIGINT',()=>bot.stop('SIGINT'));
process.once('SIGTERM',()=>bot.stop('SIGTERM'));
