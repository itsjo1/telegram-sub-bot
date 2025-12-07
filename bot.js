const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const multer = require('multer');
const crypto = require('crypto');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');

// Load env
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const DB_PATH = process.env.DB_PATH || './data/bot.sqlite';
const PRODUCT_LINK = process.env.PRODUCT_LINK;
const VODAFONE_NUMBER = process.env.VODAFONE_NUMBER || '01009446202';

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
  lang: { type: DataTypes.STRING, defaultValue:'ar' }
});

const Subscription = sequelize.define('Subscription', {
  telegramId: DataTypes.STRING,
  username: DataTypes.STRING,
  planType: DataTypes.STRING, // group / live
  durationMonths: DataTypes.INTEGER,
  priceStars: DataTypes.INTEGER,
  priceEGP: DataTypes.INTEGER,
  paymentsSent: { type: DataTypes.INTEGER, defaultValue:0 },
  requiredPayments: DataTypes.INTEGER,
  proofPath: DataTypes.STRING,
  status: { type: DataTypes.STRING, defaultValue:'pending' }
});

(async ()=>{ await sequelize.sync(); })();

const bot = new Telegraf(BOT_TOKEN);

// Multer
const uploadDir = path.join(__dirname, 'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req,file,cb)=> cb(null, uploadDir),
  filename: (req,file,cb)=> cb(null, Date.now()+'-'+file.originalname)
});
const upload = multer({ storage });

// Helpers
function calcPayments(durationMonths){
  if(durationMonths === 1) return { times:2, starsPer:100, egpPer:150, usdPer:2 };
  if(durationMonths === 6) return { times:4, starsPer:100, egpPer:250, usdPer:4 };
  if(durationMonths === 12) return { times:7, starsPer:100, egpPer:350, usdPer:7 };
  return { times:1, starsPer:0, egpPer:0, usdPer:0 };
}

function formatPrice(price, method){
  if(method==='stars') return `💰 ${price} استار`;
  if(method==='vod') return `💰 ${price} جنيه مصري`;
  if(method==='usd') return `💰 ${price} دولار`;
}

async function checkStarsProof(filePath, requiredStars){
  try{
    const { data:{ text } } = await Tesseract.recognize(filePath,'eng+ara');
    const numbers = text.match(/\d+/g)?.map(Number) || [];
    const total = numbers.reduce((a,b)=>a+b,0);
    return total >= requiredStars;
  }catch(e){ return false; }
}

// Phrases
const PHRASES = {
  ar:{
    welcome:'أهلاً! اختر اللغة',
    main_menu:'اختر خدمة',
    subscribe:'اشتراك',
    support:'دعم',
    my_subs:'اشتراكاتي',
    choose_plan:'اختر نوع الاشتراك:',
    choose_duration:'اختر مدة الاشتراك:',
    choose_payment:'اختر طريقة الدفع:',
    attach_proof:'ارفق اسكرين التحويل الآن',
    proof_sent:'تم استلام الاسكرين وسيتم التفعيل خلال دقائق',
    proof_fail:'عدد الاستار المرسل غير كافي. حاول مرة أخرى',
    support_link:'من فضلك تواصل مع الدعم عبر هذا الرابط: https://t.me/remaigofvfkvro547gv',
    price_info:(method,price)=>`السعر: ${formatPrice(price, method)}`,
    payment_methods:'طرق الدفع:\n- ستارز\n- فودافون كاش'
  },
  en:{
    welcome:'Welcome! Choose language',
    main_menu:'Choose an option',
    subscribe:'Subscribe',
    support:'Support',
    my_subs:'My Subscriptions',
    choose_plan:'Choose subscription type:',
    choose_duration:'Choose duration:',
    choose_payment:'Choose payment method:',
    attach_proof:'Upload your payment proof',
    proof_sent:'Payment received and will be activated shortly',
    proof_fail:'Total Stars sent is not enough. Try again',
    support_link:'Please contact support here: https://t.me/remaigofvfkvro547gv',
    price_info:(method,price)=>`Price: ${formatPrice(price, method)}`,
    payment_methods:'Payment methods:\n- Stars\n- Vodafone Cash'
  }
};

// Start
bot.start(async ctx=>{
  const id = String(ctx.from.id);
  const [user] = await User.findOrCreate({ where:{ telegramId:id }, defaults:{ username:ctx.from.username || ctx.from.first_name } });
  return ctx.reply(PHRASES.ar.welcome, Markup.keyboard([['🇸🇦 العربية','🇬🇧 English']]).oneTime().resize());
});

// Language
bot.hears(['🇸🇦 العربية','العربية'], async ctx=>{
  const id = String(ctx.from.id);
  const user = await User.findOne({ where:{ telegramId:id } });
  if(user){ user.lang='ar'; await user.save(); }
  await ctx.reply(PHRASES.ar.main_menu, Markup.inlineKeyboard([
    [Markup.button.callback(PHRASES.ar.subscribe,'subscribe')],
    [Markup.button.callback(PHRASES.ar.support,'support')],
    [Markup.button.callback(PHRASES.ar.my_subs,'my_subs')]
  ]));
});

bot.hears(['🇬🇧 English','English'], async ctx=>{
  const id = String(ctx.from.id);
  const user = await User.findOne({ where:{ telegramId:id } });
  if(user){ user.lang='en'; await user.save(); }
  await ctx.reply(PHRASES.en.main_menu, Markup.inlineKeyboard([
    [Markup.button.callback(PHRASES.en.subscribe,'subscribe')],
    [Markup.button.callback(PHRASES.en.support,'support')],
    [Markup.button.callback(PHRASES.en.my_subs,'my_subs')]
  ]));
});

// Subscribe
bot.action('subscribe', async ctx=>{
  const id = String(ctx.from.id);
  const user = await User.findOne({ where:{ telegramId:id } });
  const lang = user.lang || 'ar';
  await ctx.editMessageText(PHRASES[lang].choose_plan, Markup.inlineKeyboard([
    [Markup.button.callback('اشتراك الجروب / Group','plan_group')],
    [Markup.button.callback('اشتراك الايف / Live','plan_live')]
  ]));
});

// Group subscription duration
bot.action('plan_group', async ctx=>{
  const id = String(ctx.from.id);
  const user = await User.findOne({ where:{ telegramId:id } });
  const lang = user.lang || 'ar';
  await ctx.editMessageText(PHRASES[lang].choose_duration, Markup.inlineKeyboard([
    [Markup.button.callback('1 شهر','duration_1')],
    [Markup.button.callback('6 شهور','duration_6')],
    [Markup.button.callback('12 شهر','duration_12')]
  ]));
});

// Payment selection
bot.action(/duration_(\d+)/, async ctx=>{
  const duration = parseInt(ctx.match[1]);
  const id = String(ctx.from.id);
  const user = await User.findOne({ where:{ telegramId:id } });
  const lang = user.lang || 'ar';
  const payments = calcPayments(duration);
  await ctx.editMessageText(PHRASES[lang].choose_payment, Markup.inlineKeyboard([
    [Markup.button.callback(`Stars ${formatPrice(payments.starsPer,'stars')}`,'pay_stars')],
    [Markup.button.callback(`Vodafone Cash ${formatPrice(payments.egpPer,'vod')}`,'pay_vod')]
  ]));
  await Subscription.create({
    telegramId:id, username:user.username,
    planType:'group', durationMonths:duration,
    priceStars:payments.starsPer*payments.times,
    priceEGP:payments.egpPer*payments.times,
    requiredPayments:payments.times
  });
});

// Payment proof for stars
bot.action('pay_stars', async ctx=>{
  const id = String(ctx.from.id);
  const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
  const user = await User.findOne({ where:{ telegramId:id } });
  const lang = user.lang || 'ar';
  await ctx.editMessageText(PHRASES[lang].attach_proof+'\n'+PHRASES[lang].payment_methods, Markup.inlineKeyboard([
    [Markup.button.callback('لقد أرسلت الاستار / I sent','proof_sent')]
  ]));
});

// Vodafone Cash
bot.action('pay_vod', async ctx=>{
  const id = String(ctx.from.id);
  const sub = await Subscription.findOne({ where:{ telegramId:id }, order:[['createdAt','DESC']] });
  const user = await User.findOne({ where:{ telegramId:id } });
  const lang = user.lang || 'ar';
  await ctx.editMessageText(`💰 ${sub.priceEGP} جنيه مصري\nحول على الرقم: ${VODAFONE_NUMBER}\n${PHRASES[lang].attach_proof}`, Markup.inlineKeyboard([
    [Markup.button.callback('لقد أرسلت الدفع / I sent','proof_sent')]
  ]));
});

// Support
bot.action('support', async ctx=>{
  const id = String(ctx.from.id);
  const user = await User.findOne({ where:{ telegramId:id } });
  const lang = user.lang || 'ar';
  await ctx.reply(PHRASES[lang].support_link);
});

// Launch
bot.launch();
console.log('Bot started');

process.once('SIGINT',()=>{ bot.stop('SIGINT'); process.exit(); });
process.once('SIGTERM',()=>{ bot.stop('SIGTERM'); process.exit(); });
