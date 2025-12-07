// ========== الإعدادات الأساسية ==========
const dotenv = require("dotenv");
const { Telegraf, Scenes, session, Markup } = require("telegraf");
const fs = require("fs");
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// ========== الداتا ==========
const PRICES = {
    group: {
        "1": 200,   // 1 شهر = 200 استار
        "6": 400,   // 6 شهور = 400 استار ؟ لا → حضرتك عدلتها → 4 × 100 استار
        "12": 700   // 12 شهر = 7 × 100 استار
    },
    live: {
        "1": 150,
        "6": 300,
        "12": 600
    }
};

const REQUIRED_OPERATIONS = {
    "1": 2,   // 1 شهر = عمليتين 100 + 100
    "6": 4,   // 6 شهور = 4 عمليات
    "12": 7   // 12 شهر = 7 عمليات
};

// اسم القناة اللي لازم يكون موجود في السكرين
const REQUIRED_TARGET = "@remaigofvfkvro547gv";

// ========== المشهد: اختيار نوع الاشتراك ==========
const chooseType = new Scenes.BaseScene("chooseType");
chooseType.enter(async (ctx) => {
    await ctx.reply(
        "اختر نوع الاشتراك:",
        Markup.inlineKeyboard([
            [Markup.button.callback("📦 اشتراك الجروب", "group")],
            [Markup.button.callback("🎥 اشتراك اللايف", "live")]
        ])
    );
});

chooseType.action(["group", "live"], async (ctx) => {
    ctx.session.subType = ctx.match[0];
    await ctx.answerCbQuery();
    await ctx.scene.enter("chooseDuration");
});

// ========== المشهد: اختيار المدة ==========
const chooseDuration = new Scenes.BaseScene("chooseDuration");
chooseDuration.enter(async (ctx) => {
    await ctx.reply(
        "اختر مدة الاشتراك:",
        Markup.inlineKeyboard([
            [Markup.button.callback("1 شهر", "1")],
            [Markup.button.callback("6 شهور", "6")],
            [Markup.button.callback("12 شهر", "12")]
        ])
    );
});

chooseDuration.action(["1", "6", "12"], async (ctx) => {
    ctx.session.duration = ctx.match[0];
    const type = ctx.session.subType;
    const price = PRICES[type][ctx.session.duration];

    await ctx.answerCbQuery();

    await ctx.reply(
        `💰 سعر الاشتراك: *${price} استار*\nأرسل التحويل إلى:\n${REQUIRED_TARGET}`,
        { parse_mode: "Markdown" }
    );

    await ctx.reply(
        "📸 اضغط الزر بالأسفل لإرفاق سكرين يوضح عمليات التحويل.",
        Markup.inlineKeyboard([
            [Markup.button.callback("📤 ارفاق السكرين", "send_ss")]
        ])
    );

    ctx.session.expectedPrice = price;
    ctx.session.requiredOps = REQUIRED_OPERATIONS[ctx.session.duration];
});

// ========== المشهد: استقبال السكرين ==========
const uploadSS = new Scenes.BaseScene("uploadSS");

uploadSS.enter((ctx) => {
    ctx.reply("📸 من فضلك ارسل الآن السكرين شوت هنا في الشات.");
});

uploadSS.on("photo", async (ctx) => {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    // تحميل الرسمة الخاصة بنوع التحويل
    await ctx.reply("⏳ جاري تحليل السكرين…");

    // ❗ هنا تحليل السكرين (محاكاة — أنت هتعدلها لما تعمل OCR)
    const fakeExtractedData = {
        operationsCount:  ctx.session.requiredOps, // بنحاكي إن الصورة فيها المطلوب
        targetFound: true,
        eachOperationIs100: true
    };

    if (!fakeExtractedData.targetFound) {
        return ctx.reply("❌ السكرين لا يحتوي على التحويل لـ القناة المطلوبة.");
    }

    if (!fakeExtractedData.eachOperationIs100) {
        return ctx.reply("❌ كل عملية يجب أن تكون 100 استار.");
    }

    if (fakeExtractedData.operationsCount < ctx.session.requiredOps) {
        return ctx.reply(
            `❌ عدد العمليات غير كافٍ.\nالمطلوب: ${ctx.session.requiredOps} عمليات × 100 استار`
        );
    }

    await ctx.reply("✔ تم استلام السكرين.\nسيتم التفعيل خلال دقائق.");
    await ctx.scene.leave();
});

// ========== التحكم في المشاهد ==========
const stage = new Scenes.Stage([chooseType, chooseDuration, uploadSS]);
bot.use(session());
bot.use(stage.middleware());

// ========== أوامر البوت ==========
bot.start((ctx) => ctx.scene.enter("chooseType"));
bot.action("send_ss", (ctx) => ctx.scene.enter("uploadSS"));

// ========== تشغيل ==========
bot.launch();
console.log("Bot is running...");
