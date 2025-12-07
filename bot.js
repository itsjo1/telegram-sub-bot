/*  ================================
        Telegram Subscription Bot
        Full Version with JSON Database Tracking
        Vodafone Cash Number Updated
    ================================ */

const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// -------------------- Prices --------------------
const prices = {
    group: {
        "1": { stars: 200, egp: 70 },
        "6": { stars: 400, egp: 350 },
        "12": { stars: 1500, egp: 600 }
    },
    live: {
        stars: 2000,
        egp: 700,
        usd: 20
    }
};

const vodafoneNumber = "01009446202"; // الرقم الجديد
const supportLink = "https://t.me/remaigofvfkvro547gv";
const starsUser = "@remaigofvfkvro547gv";
const finalLink = "https://x.com/JDjdbhk82977";

// -------------------- JSON Database --------------------
const DB_FILE = "./db.json";

function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "{}");
        const data = fs.readFileSync(DB_FILE, "utf8");
        return JSON.parse(data);
    } catch (err) {
        console.error("Error reading DB:", err);
        return {};
    }
}

function writeDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function saveUser(userId, data) {
    const db = readDB();
    db[userId] = { ...(db[userId] || {}), ...data };
    writeDB(db);
}

function updateUserStatus(userId, status) {
    const db = readDB();
    if (!db[userId]) db[userId] = {};
    db[userId].status = status;
    db[userId].timestamp = new Date().toISOString();
    writeDB(db);
}

// -------------------- Sessions --------------------
let sessions = {};
function getSession(id) {
    if (!sessions[id]) sessions[id] = {};
    return sessions[id];
}

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
        Markup.inlineKeyboard([[Markup.button.url("فتح جروب الدعم", supportLink)]])
    );
});

// -------------------- Group Subscription --------------------
bot.action("group_sub", (ctx) => {
    const id = ctx.from.id;
    const session = getSession(id);
    session.type = "group";
    saveUser(id, { userId: id, username: ctx.from.username, type: "group" });

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
        saveUser(id, { duration: m });
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

    let amount = s.type === "group" ? prices.group[s.duration].stars : prices.live.stars;
    s.expectedAmount = amount;
    saveUser(id, { method: "stars", expectedAmount: amount, status: "awaiting_amount" });

    return ctx.editMessageText(
        `⭐ **الدفع عبر الاستارز**

السعر المطلوب: **${amount} ⭐**

من فضلك أولاً أرسل العدد الذي قمت بتحويله بالضبط، ثم سيتم طلب إرسال الاسكرين.`,
        Markup.inlineKeyboard([[Markup.button.callback("📤 أرسل العدد أولاً", "send_amount_stars")]])
    );
});

// -------------------- Pay with Vodafone Cash --------------------
bot.action("pay_voda", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);

    let egp = s.type === "group" ? prices.group[s.duration].egp : prices.live.egp;
    s.expectedAmount = egp;
    saveUser(id, { method: "vodafone", expectedAmount: egp, status: "awaiting_amount" });

    return ctx.editMessageText(
`💵 **الدفع عبر فودافون كاش**

السعر المطلوب: **${egp} جنيه مصري**

من فضلك أولاً أرسل المبلغ الذي قمت بتحويله بالضبط، ثم سيتم طلب إرسال الاسكرين.

رقم التحويل: 📱 ${vodafoneNumber}`,
        Markup.inlineKeyboard([
            [Markup.button.callback("📤 أرسل المبلغ أولاً", "send_amount_cash")]
        ])
    );
});

// -------------------- Await Amount for Stars --------------------
bot.action("send_amount_stars", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    s.waitingForAmount = "stars";
    return ctx.reply(`من فضلك أرسل عدد الاستارز الذي قمت بتحويله بالضبط:`);
});

// -------------------- Await Amount for Cash --------------------
bot.action("send_amount_cash", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    s.waitingForAmount = "cash";
    return ctx.reply(`من فضلك أرسل المبلغ الذي قمت بتحويله بالضبط بالـ EGP:`);
});

// -------------------- Handle Amount Input --------------------
bot.on("text", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    if (!s.waitingForAmount) return;

    const input = parseInt(ctx.message.text);
    if (isNaN(input)) return ctx.reply("الرجاء إدخال رقم صحيح.");

    if (s.waitingForAmount === "stars") {
        if (input !== s.expectedAmount) {
            updateUserStatus(id, "wrong_amount");
            return ctx.reply(`العدد الذي أرسلته غير مطابق. الرجاء إرسال العدد الصحيح: ${s.expectedAmount} ⭐`);
        }
    } else if (s.waitingForAmount === "cash") {
        if (input !== s.expectedAmount) {
            updateUserStatus(id, "wrong_amount");
            return ctx.reply(`المبلغ الذي أرسلته غير مطابق. الرجاء إرسال المبلغ الصحيح: ${s.expectedAmount} جنيه`);
        }
    }

    // تم التحقق من العدد أو المبلغ
    s.waitingForAmount = false;
    s.waitingForScreenshot = true;
    updateUserStatus(id, "awaiting_screenshot");
    saveUser(id, { sentAmount: input });

    return ctx.reply("✅ تم التحقق من العدد/المبلغ بنجاح، الآن من فضلك أرسل اسكرين عملية الدفع.");
});

// -------------------- Handle Screenshot --------------------
bot.on("photo", async (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);

    if (!s.waitingForScreenshot) return;

    s.waitingForScreenshot = false;
    updateUserStatus(id, "verified");
    saveUser(id, { screenshot: ctx.message.photo[0].file_id });

    await ctx.reply("جاري التحقق من الاسكرين… ⏳");
    await ctx.reply(`تم استلام الاسكرين وسيتم التفعيل خلال دقائق ✅\nتفضل الجروب الخاص: ${finalLink}\nشكرًا للاشتراك معنا!`);
});

// -------------------- Live Subscription --------------------
bot.action("live_sub", (ctx) => {
    const id = ctx.from.id;
    const s = getSession(id);
    s.type = "live";
    saveUser(id, { userId: id, username: ctx.from.username, type: "live" });

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
