const { Telegraf, Markup } = require('telegraf');
const { Sequelize, DataTypes } = require('sequelize');
const fs = require('fs');
const path = require('path');

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
  planType: DataTypes.STRING, // group / live
  planMonths: DataTypes.STRING,
  paymentMethod: DataTypes.STRING, // stars / vod
  priceStars: DataTypes.INTEGER,
  priceUSD: DataTypes.FLOAT,
  priceEGP: DataTypes.FLOAT,
  status: { type: DataTypes.STRING, defaultValue: 'pending' },
});

(async ()=>{ await sequelize.sync(); })();

const bot = new Telegraf(BOT_TOKEN);

// Plans
const PLANS = {
  1: { stars:200, usd:2, egp:150 },
  6: { stars:400, usd:4, egp:250 },
  12:{ stars:700, usd:7, egp:350 },
  live:{ stars:2000, usd:20, egp:700 }
};

// Phrases
const PHRASES = {
  ar:{
    welcome:'أهلاً! اختر اللغة',
    main_menu:'اختر خدمة',
    subscribe:'اشتراك',
    support:'دعم',
    choose_type:'اختر نوع الاشتراك:',
    choose_plan:'اختر مدة الاشتراك:',
    payment_method:'اختر طريقة الدفع:',
    stars:'ستارز',
    vodafone:'فودافون كاش',
    stars_info:(plan)=>`السعر بالستارز: ${plan.stars} ستارز أو ${plan.usd}$\nيرجى تحويل المبلغ عبر الجروب: https://t.me/remaigofvfkvro547gv\nيمكنك التحويل على دفعات 100 ستارز.`,
    vod_info:(plan)=>`السعر: ${plan.egp} جنيه مصري\nمن فضلك حول على هذا الرقم: ${VODAFONE_NUMBER}\nبعد التحويل، ارفع صورة الإيصال.`,
    support_msg:`من فضلك تواصل مع الدعم على هذا الرابط: https://t.me/remaigofvfkvro547gv\nاشرح مشكلتك وسيتم الرد عليك في أسرع وقت.`,
  },
  en:{
    welcome:'Welcome! Choose language',
    main_menu:'Choose an option',
    subscribe:'Subscribe',
    support:'Support',
    choose_type:'Choose subscription type:',
    choose_plan:'Choose plan duration:',
    payment_method:'Choose payment method:',
    stars:'Stars',
    vodafone:'Vodafone Cash',
    stars_info:(plan)=>`Price in Stars: ${plan.stars} Stars or ${plan.usd}$\nSend the Stars via: https://t.me/remaigofvfkvro547gv\nYou can send in 100 Stars batches.`,
    vod_info:(plan)=>`Price: ${plan.egp} EGP\nPlease transfer to this number: ${VODAFONE_NUMBER}\nAfter transfer, attach screenshot of payment.`,
    support_msg:`Please contact support here: https://t.me/remaigofvfkvro547gv\nExplain your issue and you will get a reply ASAP.`,
  }
};

// Start
bot.start(async ctx=>{
  const id = String(ctx.from.id);
  await User.findOrCreate({ where:{ telegramId:id }, defaults:{ username:ctx.from.username || ctx.from.first_name } });
  return ctx.reply(PHRASES.ar.welcome, Markup.keyboard([['🇸🇦 العربية','🇬🇧 English']]).oneTime().resize());
});

bot.hears(['🇸🇦 العربية','العربية'], async ctx=>{
  const id = String(ctx.from.id); const user = await User.findOne({ where:{ telegramId:id } }); if(user){ user.lang='ar'; await user.save(); }
  await ctx.reply(PHRASES.ar.main_menu, Markup.inlineKeyboard([
    [Markup.button.callback('اشتراك','subscribe')],
    [Markup.button.callback('دعم','support')]
  ]));
});

bot.hears(['🇬🇧 English','English'], async ctx=>{
  const id = String(ctx.from.id); const user = await User.findOne({ where:{ telegramId:id } }); if(user){ user.lang='en'; await user.save(); }
  await ctx.reply(PHRASES.en.main_menu, Markup.inlineKeyboard([
    [Markup.button.callback('Subscribe','subscribe')],
    [Markup.button.callback('Support','support')]
  ]));
});

// Subscribe
bot.action('subscribe', async ctx=>{
  const id = String(ctx.from.id);
  const user = await User.findOne({ where:{ telegramId:id } });
  const lang = user?.lang || 'ar';
  const phrase = PHRASES[lang];
  await ctx.editMessageText(phrase.choose_type, Markup.inlineKeyboard([
    [Markup.button.callback('اشتراك الجروب','type_group')],
    [Markup.button.callback('اشتراك الايف','type_live')]
  ]));
});

// Choose type
['type_group','type_live'].forEach(type=>{
  bot.action(type, async ctx=>{
    const id = String(ctx.from.id);
    const user = await User.findOne({ where:{ telegramId:id } });
    const lang = user?.lang || 'ar';
    const phrase = PHRASES[lang];
    await ctx.editMessageText(phrase.choose_plan, Markup.inlineKeyboard([
      [Markup.button.callback('1 شهر','plan_1')],
      [Markup.button.callback('6 شهر','plan_6')],
      [Markup.button.callback('12 شهر','plan_12')],
      ...(type==='type_live'? [Markup.button.callback('Live','plan_live')] : [])
    ]));
    // Save type
    const sub = await Subscription.create({ telegramId:id, username:ctx.from.username||ctx.from.first_name, planType:type==='type_live'?'live':'group', status:'pending' });
  });
});

// Choose plan
bot.action(/plan_(\d+|live)/, async ctx=>{
  const choice = ctx.match[1];
  const id = String(ctx.from.id);
  const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
  const user = await User.findOne({ where:{ telegramId:id } });
  const lang = user?.lang || 'ar';
  const phrase = PHRASES[lang];

  const plan = choice==='live'?PLANS.live:PLANS[parseInt(choice)];
  // Save plan
  sub.planMonths = choice==='live'? 'Live' : parseInt(choice);
  await sub.save();

  await ctx.editMessageText(phrase.payment_method, Markup.inlineKeyboard([
    [Markup.button.callback(phrase.stars,'pay_stars')],
    [Markup.button.callback(phrase.vodafone,'pay_vod')]
  ]));
});

// Payment actions
bot.action('pay_stars', async ctx=>{
  const id = String(ctx.from.id);
  const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
  const user = await User.findOne({ where:{ telegramId:id } });
  const lang = user?.lang || 'ar';
  const phrase = PHRASES[lang];
  await ctx.editMessageText(phrase.stars_info(PLANS[sub.planMonths==='Live'?'live':sub.planMonths]));
});

bot.action('pay_vod', async ctx=>{
  const id = String(ctx.from.id);
  const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
  const user = await User.findOne({ where:{ telegramId:id } });
  const lang = user?.lang || 'ar';
  const phrase = PHRASES[lang];
  await ctx.editMessageText(phrase.vod_info(PLANS[sub.planMonths==='Live'?'live':sub.planMonths]));
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

process.once('SIGINT',()=>{ bot.stop('SIGINT'); process.exit(); });
process.once('SIGTERM',()=>{ bot.stop('SIGTERM'); process.exit(); });
