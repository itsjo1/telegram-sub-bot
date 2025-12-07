/*  ================================
        Telegram Subscription Bot
        Full Version with SQLite DB
        Stars Workflow + Offers 24h Auto
        Vodafone Cash Number: 01009446202
    ================================ */

const { Telegraf, Markup } = require("telegraf");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// -------------------- Prices --------------------
let prices = {
    group: { "1": { stars: 200, egp: 70 }, "6": { stars: 400, egp: 350 }, "12": { stars: 1500, egp: 600 } },
    live: { stars: 2000, egp: 700, usd: 20 }
};

const vodafoneNumber = "01009446202";
const supportLink = "https://t.me/remaigofvfkvro547gv";
const starsUser = "@remaigofvfkvro547gv";
const finalLink = "https://x.com/JDjdbhk82977";

// -------------------- Offer Configuration --------------------
let offerActive = true; // true = العرض شغال
const offerDurationMs = 24 * 60 * 60 * 1000; // 24 ساعة
const offerPrices = { stars: 100, egp: 100, usd: 1 };
const offerDuration = "6"; // 6 شهور فقط خلال العرض

// -------------------- SQLite Database --------------------
const DB_FILE = path.join(__dirname, "bot.db");
const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        userId INTEGER PRIMARY KEY,
        username TEXT,
        type TEXT,
        duration TEXT,
        method TEXT,
        expectedAmount INTEGER,
        sentAmount INTEGER,
        screenshot TEXT,
        status TEXT,
        isOffer INTEGER,
        timestamp TEXT
    )`);
});

// -------------------- DB Helper Functions --------------------
function saveUser(user) {
    db.run(`INSERT OR REPLACE INTO users (userId, username, type, duration, method, expectedAmount, sentAmount, screenshot, status, isOffer, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            user.userId, user.username || null, user.type || null, user.duration || null, user.method || null,
            user.expectedAmount || null, user.sentAmount || null, user.screenshot || null, user.status || null,
            user.isOffer ? 1 : 0, new Date().toISOString()
        ]);
}

function updateUserStatus(userId, status, extra = {}) {
    db.run(`UPDATE users SET status = ?, timestamp = ?, sentAmount = COALESCE(?, sentAmount), screenshot = COALESCE(?, screenshot) WHERE userId = ?`,
        [status, new Date().toISOString(), extra.sentAmount || null, extra.screenshot || null, userId]);
}

// -------------------- Sessions --------------------
let sessions = {};
function getSession(id) { if (!sessions[id]) sessions[id] = {}; return sessions[id]; }

// -------------------- Start --------------------
bot.start((ctx) => {
    sessions[ctx.from.id] = {};
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
        Markup.inlineKeyboard([[Markup.button.url("فتح جروب الدعم", supportLink)]]));
});

// -------------------- Group Subscription --------------------
bot.action("group_sub", (ctx) => {
    const id = ctx.from.id;
    const session = getSession(id);
    session.type = "group";
    saveUser({ userId: id, username: ctx.from.username, type: "group" });

    let buttons = [];
    if (offerActive) {
        buttons = [[Markup.button.callback("6 شهور (عرض خاص!)", "group_offer")]];
    } else {
        buttons = [
            [
                Markup.button.callback("1 شهر", "group_1"),
                Markup.button.callback("6 شهور", "group_6"),
                Markup.button.callback("12 شهر", "group_12")
            ]
        ];
    }

    return ctx.editMessageText(
        "من فضلك اختر مدة الاشتراك:",
        Markup.inlineKeyboard(buttons)
    );
});

// -------------------- Offer Button --------------------
bot.action("group_offer", (ctx) => {
    const id = ctx.from.id;
    const session = getSession(id);
    session.duration = offerDuration;
    session.isOffer = true;
    saveUser({ userId: id, duration: offerDuration, isOffer: true });

    return ctx.editMessageText(
        `🔥 عرض خاص لمدة 24 ساعة 🔥\nمدة الاشتراك: 6 شهور\nالسعر:\n⭐ ${offerPrices.stars} ⭐\n💵 ${offerPrices.egp} جنيه\n💲 ${offerPrices.usd} دولار\n\nاختر طريقة الدفع:`,
        Markup.inlineKeyboard([
            [Markup.button.callback("⭐ Stars", "pay_stars_offer")],
            [Markup.button.callback("💵 Vodafone Cash", "pay_voda_offer")]
        ])
    );
});

// -------------------- Duration Selection Normal --------------------
["1", "6", "12"].forEach((m) => {
    bot.action(`group_${m}`, (ctx) => {
        const id = ctx.from.id;
        const session = getSession(id);
        session.duration = m;
        saveUser({ userId: id, duration: m });
        return ctx.editMessageText(
            `مدة الاشتراك: ${m} شهر\n\nاختر طريقة الدفع:`,
            Markup.inlineKeyboard([
                [Markup.button.callback("⭐ Stars", "pay_stars")],
                [Markup.button.callback("💵 Vodafone Cash", "pay_voda")]
            ])
        );
    });
});

// -------------------- Stars Payment Normal --------------------
bot.action("pay_stars", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    let amount = s.type === "group" ? prices.group[s.duration].stars : prices.live.stars;
    s.expectedAmount = amount;
    saveUser({ userId: id, method: "stars", expectedAmount: amount, status: "awaiting_click" });

    return ctx.editMessageText(
        `⭐ **الدفع عبر الاستارز**

الرجاء تحويل الاستارز على الجروب: ${starsUser}  
لو مش عارف كيف، ادخل الجروب، ستجد صندوق هدايا أسفل اليمين أو اليسار، اضغط عليه وأرسل الهدية، ثم خذ اسكرين.

⚠️ **مهم:** لا ترسل كل الاستارز في جيفت واحد، بل أرسل 100 ⭐ في كل مرة على دفعات حتى يكتمل المجموع المطلوب (${amount} ⭐).

بعد ذلك اضغط على الزر بالأسفل عند الانتهاء من التحويل.`,
        Markup.inlineKeyboard([[Markup.button.callback("✅ تم التحويل أولاً", "click_done")]]));
});

// -------------------- Stars Payment Offer --------------------
bot.action("pay_stars_offer", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    s.expectedAmount = offerPrices.stars;
    s.isOffer = true;
    saveUser({ userId: id, method: "stars", expectedAmount: offerPrices.stars, isOffer: true, status: "awaiting_click" });

    return ctx.editMessageText(
        `⭐ **عرض خاص - الدفع عبر الاستارز**\n\nالرجاء تحويل الاستارز على الجروب: ${starsUser}\n⚠️ أرسل 100 ⭐ في كل مرة على دفعات حتى تكتمل الـ ${offerPrices.stars} ⭐.\n\nبعد ذلك اضغط على الزر بالأسفل عند الانتهاء من التحويل.`,
        Markup.inlineKeyboard([[Markup.button.callback("✅ تم التحويل أولاً", "click_done")]]));
});

// -------------------- Click Done for Stars --------------------
bot.action("click_done", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    s.waitingForAmount = "stars";
    updateUserStatus(id, "awaiting_amount");
    return ctx.reply(`الآن من فضلك أرسل عدد الاستارز الذي قمت بتحويله بالضبط:`);
});

// -------------------- Vodafone Cash Payment Normal --------------------
bot.action("pay_voda", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    let egp = s.type === "group" ? prices.group[s.duration].egp : prices.live.egp;
    s.expectedAmount = egp;
    saveUser({ userId: id, method: "vodafone", expectedAmount: egp, status: "awaiting_amount" });

    return ctx.editMessageText(
`💵 **الدفع عبر فودافون كاش**

السعر المطلوب: **${egp} جنيه مصري**

من فضلك أولاً أرسل المبلغ الذي قمت بتحويله بالضبط، ثم سيتم طلب إرسال الاسكرين.

رقم التحويل: 📱 ${vodafoneNumber}`,
        Markup.inlineKeyboard([[Markup.button.callback("📤 أرسل المبلغ أولاً", "send_amount_cash")]]));
});

// -------------------- Vodafone Cash Payment Offer --------------------
bot.action("pay_voda_offer", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    s.expectedAmount = offerPrices.egp;
    s.isOffer = true;
    saveUser({ userId: id, method: "vodafone", expectedAmount: offerPrices.egp, isOffer: true, status: "awaiting_amount" });

    return ctx.editMessageText(
`💵 **عرض خاص - الدفع عبر فودافون كاش**

السعر المطلوب: **${offerPrices.egp} جنيه مصري**

من فضلك أولاً أرسل المبلغ الذي قمت بتحويله بالضبط، ثم سيتم طلب إرسال الاسكرين.

رقم التحويل: 📱 ${vodafoneNumber}`,
        Markup.inlineKeyboard([[Markup.button.callback("📤 أرسل المبلغ أولاً", "send_amount_cash")]]));
});

// -------------------- Await Amount Input --------------------
bot.action("send_amount_cash", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    s.waitingForAmount = "cash";
    return ctx.reply(`من فضلك أرسل المبلغ الذي قمت بتحويله بالضبط بالـ EGP:`);
});

// -------------------- Handle Amount Text --------------------
bot.on("text", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    if (!s.waitingForAmount) return;

    const input = parseInt(ctx.message.text);
    if (isNaN(input)) return ctx.reply("الرجاء إدخال رقم صحيح.");

    let expected = s.isOffer ? (s.method === "stars" ? offerPrices.stars : offerPrices.egp) : s.expectedAmount;

    if (input !== expected) {
        updateUserStatus(id, "wrong_amount", { sentAmount: input });
        return ctx.reply(`المبلغ/عدد الذي أرسلته غير مطابق. الرجاء إرسال العدد الصحيح: ${expected}`);
    }

    s.waitingForAmount = false;
    s.waitingForScreenshot = true;
    updateUserStatus(id, "awaiting_screenshot", { sentAmount: input });

    return ctx.reply("✅ تم التحقق من العدد/المبلغ بنجاح، الآن من فضلك أرسل اسكرين عملية الدفع.");
});

// -------------------- Handle Screenshot --------------------
bot.on("photo", async (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);

    if (!s.waitingForScreenshot) return;

    s.waitingForScreenshot = false;
    updateUserStatus(id, "verified", { screenshot: ctx.message.photo[0].file_id });

    await ctx.reply("جاري التحقق من الاسكرين… ⏳");
    await ctx.reply(`تم استلام الاسكرين وسيتم التفعيل خلال دقائق ✅\nتفضل الجروب الخاص: ${finalLink}\nشكرًا للاشتراك معنا!`);
});

// -------------------- Live Subscription --------------------
bot.action("live_sub", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    s.type = "live";
    saveUser({ userId: id, username: ctx.from.username, type: "live" });

    return ctx.editMessageText(
        "سعر الايف الواحد:\n\n⭐ 2000 استار\n💵 700 جنيه مصري\n💲 20 دولار\n\nاختر طريقة الدفع:",
        Markup.inlineKeyboard([
            [Markup.button.callback("⭐ Stars", "pay_stars")],
            [Markup.button.callback("💵 Vodafone Cash", "pay_voda")]
        ])
    );
});

// -------------------- Auto-End Offer After 24h --------------------
if (offerActive) {
    setTimeout(() => {
        offerActive = false;
        console.log("عرض الاشتراك انتهى، الأسعار عادت للطبيعي.");
    }, offerDurationMs);
}

bot.launch();
console.log("Bot is running...");
