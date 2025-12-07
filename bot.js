//////////////////////  ▬▬▬ BOT CONFIG ▬▬▬  //////////////////////

import dotenv from "dotenv";
dotenv.config();
import { Telegraf, Markup } from "telegraf";

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";
const VODAFONE_NUMBER = process.env.VODAFONE_NUMBER || "";
const SUPPORT_LINK = "https://t.me/remaigofvfkvro547gv";
const STAR_USER = "@remaigofvfkvro547gv";

if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN missing");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

///////////////////////////////////////////////////////////////
// جلسات المستخدمين
///////////////////////////////////////////////////////////////

const sessions = {};
function getSession(id) {
    if (!sessions[id]) {
        sessions[id] = {
            step: "",
            type: "",
            duration: "",
            method: "",
            waitingForScreenshot: false,
            waitingForTransferCount: false
        };
    }
    return sessions[id];
}

///////////////////////////////////////////////////////////////
// قائمة الأسعار
///////////////////////////////////////////////////////////////

const prices = {
    group: {
        "1m": { stars: 200, dollar: 2, egp: 150, transfers: 2 },
        "6m": { stars: 400, dollar: 4, egp: 250, transfers: 4 },
        "12m": { stars: 700, dollar: 7, egp: 350, transfers: 7 }
    },
    live: {
        "1live": { stars: 2000, dollar: 20, egp: 700, transfers: 20 }
    }
};

///////////////////////////////////////////////////////////////
// واجهة البداية
///////////////////////////////////////////////////////////////

bot.start((ctx) => {
    const id = ctx.from.id;
    sessions[id] = {}; // reset

    ctx.reply(
        "مرحباً 👋\nاختر نوع الاشتراك:",
        Markup.keyboard([
            ["🔷 اشتراك الجروب", "🔴 اشتراك اللايف"],
            ["💬 الدعم", "🎁 العروض المتاحة"]
        ]).resize()
    );
});

///////////////////////////////////////////////////////////////
// الدعم
///////////////////////////////////////////////////////////////

bot.hears("💬 الدعم", (ctx) => {
    ctx.reply(
        `من فضلك تواصل مع الدعم عبر الجروب التالي:\n${SUPPORT_LINK}\nوسيتم الرد عليك في أسرع وقت.`
    );
});

///////////////////////////////////////////////////////////////
// العروض
///////////////////////////////////////////////////////////////

bot.hears("🎁 العروض المتاحة", (ctx) => {
    ctx.reply("حالياً لا توجد عروض متاحة.\nسيتم إضافة العروض قريباً.");
});

///////////////////////////////////////////////////////////////
// اشتراك الجروب
///////////////////////////////////////////////////////////////

bot.hears("🔷 اشتراك الجروب", (ctx) => {
    const s = getSession(ctx.from.id);
    s.type = "group";

    ctx.reply(
        "اختر مدة الاشتراك:",
        Markup.inlineKeyboard([
            [Markup.button.callback("1 شهر", "dur_1m")],
            [Markup.button.callback("6 شهور", "dur_6m")],
            [Markup.button.callback("12 شهر", "dur_12m")]
        ])
    );
});

///////////////////////////////////////////////////////////////
// اشتراك اللايف
///////////////////////////////////////////////////////////////

bot.hears("🔴 اشتراك اللايف", (ctx) => {
    const s = getSession(ctx.from.id);
    s.type = "live";

    ctx.reply(
        "اشتراك اللايف:\nاختر:",
        Markup.inlineKeyboard([
            [Markup.button.callback("لايف واحد", "dur_live")]
        ])
    );
});

///////////////////////////////////////////////////////////////
// اختيار المدة
///////////////////////////////////////////////////////////////

bot.action(/dur_(.+)/, async (ctx) => {
    const duration = ctx.match[1];
    const id = ctx.from.id;
    const s = getSession(id);

    s.duration = duration;

    await ctx.answerCbQuery();

    // اطلب طريقة الدفع
    ctx.reply(
        "اختر طريقة الدفع:",
        Markup.inlineKeyboard([
            [Markup.button.callback("💠 الدفع بالستارز", "pay_star")],
            [Markup.button.callback("💳 فودافون كاش", "pay_voda")]
        ])
    );
});

///////////////////////////////////////////////////////////////
// الدفع بالستارز
///////////////////////////////////////////////////////////////

bot.action("pay_star", async (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);

    s.method = "stars";

    const p = prices[s.type][s.duration];

    ctx.reply(
        `💰 السعر المطلوب:\n` +
        `⭐ ${p.stars} ستارز\n` +
        `💵 ${p.dollar} دولار\n\n` +
        `يرجى إرسال عدد التحويلات المطلوبة:\n` +
        `قم بالدخول إلى الجروب → ${STAR_USER}\n` +
        `واضغط على صندوق الهدايا ثم حول 100 ستار في كل عملية.\n` +
        `عدد العمليات المطلوبة: ${p.transfers}\n\n` +
        `بعد التحويل، قم بإرسال لقطة الشاشة.`,
    );

    s.waitingForScreenshot = true;

    await ctx.answerCbQuery();
});

///////////////////////////////////////////////////////////////
// الدفع فودافون كاش
///////////////////////////////////////////////////////////////

bot.action("pay_voda", async (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);

    s.method = "voda";

    const p = prices[s.type][s.duration];

    await ctx.answerCbQuery();

    ctx.reply(
        `💰 السعر المطلوب:\n` +
        `💵 ${p.egp} جنيه مصري\n\n` +
        `من فضلك قم بالتحويل على هذا الرقم:\n📱 ${VODAFONE_NUMBER}\n\n` +
        `بعد التحويل أرفق لقطة الشاشة هنا.`,
    );

    s.waitingForScreenshot = true;
});

///////////////////////////////////////////////////////////////
// استلام الاسكرين
///////////////////////////////////////////////////////////////

bot.on("photo", async (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);

    if (!s.waitingForScreenshot) return;

    s.waitingForScreenshot = false;
    s.waitingForTransferCount = true;

    ctx.reply(
        "تم استلام لقطة الشاشة.\n\n" +
        "من فضلك اكتب عدد مرات إرسال 100 ستار التي قمت بها."
    );
});

///////////////////////////////////////////////////////////////
// التحقق من عدد التحويلات
///////////////////////////////////////////////////////////////

bot.on("text", async (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);

    if (!s.waitingForTransferCount) return;

    const userCount = parseInt(ctx.message.text);
    if (isNaN(userCount)) {
        return ctx.reply("من فضلك اكتب رقم صحيح.");
    }

    const required = prices[s.type][s.duration].transfers;

    if (userCount !== required) {
        return ctx.reply(
            `❌ عدد التحويلات غير مطابق.\n` +
            `المطلوب: ${required} مرات × 100 ستار.\n` +
            `اللي انت كتبته: ${userCount}\n\n` +
            `لو سمحت تأكد من عدد عمليات إرسال 100 ستار.`
        );
    }

    s.waitingForTransferCount = false;

    ctx.reply("✔ تم التحقق من التحويل.\nسيتم التفعيل خلال دقائق.");
});

///////////////////////////////////////////////////////////////
// تشغيل البوت
///////////////////////////////////////////////////////////////

bot.launch();
console.log("Bot started");
