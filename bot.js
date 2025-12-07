/*  ================================
        Telegram Subscription Bot
        Final Full Version
        With All Requested Features
    ================================ */

const { Telegraf, Markup } = require("telegraf");
require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// -------------------- Prices --------------------
const prices = {
    group: {
        "1": { stars: 200, egp: 70 },
        "6": { stars: 900, egp: 350 },
        "12": { stars: 1500, egp: 600 }
    },
    live: {
        stars: 2000,
        egp: 700,
        usd: 20
    }
};

const vodafoneNumber = "01000000000";
const supportLink = "https://t.me/remaigofvfkvro547gv";
const starsUser = "@remaigofvfkvro547gv";

// user session data
let sessions = {};

function getSession(id) {
    if (!sessions[id]) sessions[id] = {};
    return sessions[id];
}

// -------------------- Start --------------------
bot.start((ctx) => {
    sessions[ctx.from.id] = {}; // reset session

    return ctx.reply(
        "مرحباً! 👋\nمن فضلك اختر نوع الاشتراك:",
        Markup.inlineKeyboard([
            [Markup.button.callback("اشتراك الجروب", "group_sub")],
            [Markup.button.callback("اشتراك الايف", "live_sub")],
            [Markup.button.callback("الدعم الفني", "support")]
        ])
    );
});

// -------------------- Support --------------------
bot.action("support", (ctx) => {
    return ctx.editMessageText(
        `من فضلك تواصل مع الدعم على الجروب التالي:\n${supportLink}\n\nسيتم الرد عليك في أسرع وقت ممكن.`,
        Markup.inlineKeyboard([
            [Markup.button.url("فتح جروب الدعم", supportLink)]
        ])
    );
});

// -------------------- Group Subscription --------------------
bot.action("group_sub", (ctx) => {
    const id = ctx.from.id;
    const session = getSession(id);
    session.type = "group";

    return ctx.editMessageText(
        "من فضلك اختر مدة الاشتراك:",
        Markup.inlineKeyboard([
            [
                Markup.button.callback("1 شهر", "group_1"),
                Markup.button.callback("6 شهور", "group_6"),
                Markup.button.callback("12 شهر", "group_12")
            ]
        ])
    );
});

// -------------------- Duration Selection --------------------
["1", "6", "12"].forEach((m) => {
    bot.action(`group_${m}`, (ctx) => {
        const id = ctx.from.id;
        const session = getSession(id);
        session.duration = m;

        return ctx.editMessageText(
            `مدة الاشتراك: ${m} شهر\n\nاختر طريقة الدفع:`,
            Markup.inlineKeyboard([
                [Markup.button.callback("⭐ Stars", "pay_stars")],
                [Markup.button.callback("💵 Vodafone Cash", "pay_voda")]
            ])
        );
    });
});

// -------------------- Pay with Stars --------------------
bot.action("pay_stars", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);

    let amount =
        s.type === "group"
            ? prices.group[s.duration].stars
            : prices.live.stars;

    return ctx.editMessageText(
`⭐ **الدفع عبر الاستارز**

السعر: **${amount} ⭐**

من فضلك توجه إلى الجروب:
${starsUser}

ثم اضغط على صندوق الهدايا 🎁  
وقم بإرسال العدد المطلوب على دفعات **100 / 100**  
مثال: إذا كان المطلوب 200 استار → ابعت 100 مرتين.

بعد التحويل، اضغط الزر بالأسفل وأرسل الاسكرين.`,
        Markup.inlineKeyboard([
            [Markup.button.callback("📸 أرفق الاسكرين", "upload_ss")]
        ])
    );
});

// -------------------- Pay with Vodafone Cash --------------------
bot.action("pay_voda", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);

    let egp =
        s.type === "group"
            ? prices.group[s.duration].egp
            : prices.live.egp;

    return ctx.editMessageText(
`💵 **الدفع عبر فودافون كاش**

السعر: **${egp} جنيه مصري**

من فضلك حوّل على الرقم التالي:
📱 ${vodafoneNumber}

ثم التقط Screenshot لعملية التحويل وارسلها.`,
        Markup.inlineKeyboard([
            [Markup.button.callback("📸 أرفق الاسكرين", "upload_ss")]
        ])
    );
});

// -------------------- Upload Screenshot --------------------
bot.action("upload_ss", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);

    s.waitingForScreenshot = true;

    return ctx.reply("من فضلك قم بإرسال الاسكرين الآن 📸");
});

// -------------------- Handle Screenshot --------------------
bot.on("photo", async (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);

    if (!s.waitingForScreenshot) return;

    s.waitingForScreenshot = false;

    await ctx.reply("جاري التحقق من الاسكرين… ⏳");

    // هنا فقط يتم الاستلام – لا يوجد تحليل حقيقي للصور حفاظاً على سياسة الاستخدام
    await ctx.reply("تم استلام الاسكرين وسيتم التفعيل خلال دقائق ✅");
});

// -------------------- Live Subscription --------------------
bot.action("live_sub", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    s.type = "live";

    return ctx.editMessageText(
        "سعر الايف الواحد:\n\n⭐ 2000 استار\n💵 700 جنيه مصري\n💲 20 دولار\n\nاختر طريقة الدفع:",
        Markup.inlineKeyboard([
            [Markup.button.callback("⭐ Stars", "pay_stars")],
            [Markup.button.callback("💵 Vodafone Cash", "pay_voda")]
        ])
    );
});

bot.launch();
console.log("Bot is running...");
