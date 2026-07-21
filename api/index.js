require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const db = require('./db');
const { MESSAGES: STATIC_MESSAGES } = require('./messages');

axios.defaults.timeout = 30000;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));


// Multer is lazy-loaded in the route that needs it
const BASE_DIR = path.join(__dirname, '..');
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8864741035:AAF5BMri8NIWEhJfwUq7DGmkiwQ86zB5o8o";
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-craftopia-token-key-12345!";
const SUPABASE_URL = (process.env.SUPABASE_URL || "https://pgnxsgysnvrgsbuecesc.supabase.co").replace(/\/$/, "");
const SUPABASE_KEY = (process.env.SUPABASE_KEY && process.env.SUPABASE_KEY !== "sb_publishable_GhwTyM1ilJr0M2VbusxDPQ_5wA9LycM" ? process.env.SUPABASE_KEY : "sb_publishable_i1qSlBg5OBbnLpSHuDN4UA_bH6bWAVQ");

const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
let BOT_USERNAME = null;
let COMMANDS_SET = false;
let DB_MESSAGES = {};
let simulatorLogs = [];

// Serve static files from public/ — works locally and on Vercel (via includeFiles in vercel.json)
app.use(express.static(path.join(BASE_DIR, 'public')));
app.use('/public', express.static(path.join(BASE_DIR, 'public')));

// Authentication Middleware
function requireAuth(req, res, next) {
    let token = null;
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith("Bearer ") && authHeader !== "Bearer null") {
        token = authHeader.split(" ")[1];
    } else if (req.headers.cookie) {
        const cookies = req.headers.cookie.split(';').reduce((acc, c) => {
            const [k, v] = c.trim().split('=');
            acc[k] = v;
            return acc;
        }, {});
        token = cookies['admin_token'];
    }

    if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: "Invalid token" });
    }
}

// Telegram Helpers
async function sendTelegramRequest(method, payload) {
    const url = `${TELEGRAM_API_URL}/${method}`;
    
    // Log simulated messages (skip answering callback queries to keep log clean)
    if (payload.chat_id && method !== "answerCallbackQuery") {
        simulatorLogs.push({
            chat_id: parseInt(payload.chat_id),
            method: method,
            payload: payload,
            timestamp: new Date().toISOString()
        });
        if (simulatorLogs.length > 200) simulatorLogs.shift();
    }
    
    try {
        const data = { ...payload };
        if (data.reply_markup && typeof data.reply_markup === 'object') {
            data.reply_markup = JSON.stringify(data.reply_markup);
        }
        const response = await axios.post(url, data);
        return response.data;
    } catch (e) {
        console.error(`Telegram API error (${method}):`, e.response ? e.response.data : e.message);
        return {
            ok: false,
            description: e.response ? JSON.stringify(e.response.data) : e.message
        };
    }
}

// Check and apply free access reward if user has 3 or more referrals
async function checkAndApplyReferralReward(referrerChatId) {
    if (!referrerChatId) return;
    
    try {
        const referrerReg = await db.getRegistration(referrerChatId);
        if (!referrerReg || referrerReg.status === "approved") {
            return; // Already approved or not registered
        }
        
        const referrals = await db.getReferrals(referrerChatId);
        const approvedReferrals = referrals.filter(r => r.status === "approved");
        
        if (approvedReferrals.length >= 3) {
            console.log(`[Referral Reward] User ${referrerChatId} has ${approvedReferrals.length} approved referrals. Auto-approving!`);
            
            const [lang] = getLangAndStep(referrerReg);
            const inviteLink = await generateApprovedInviteLinks(referrerReg.name, lang);
            await db.updateRegistrationStatus(referrerReg.id, "approved", inviteLink);
            
            const msg = getMsg(lang, "referral_reward_msg")
                .replace("{name}", referrerReg.name || getDefaultStudentName(lang))
                .replace("{link}", formatInviteLinksForUser(inviteLink, lang));
            
            await sendTelegramRequest("sendMessage", {
                chat_id: referrerChatId,
                text: msg,
                parse_mode: "Markdown",
                reply_markup: getMenuKeyboard(lang)
            });
        }
    } catch (e) {
        console.error("Error in checkAndApplyReferralReward:", e.message);
    }
}

async function getBotUsername() {
    if (BOT_USERNAME) return BOT_USERNAME;
    const res = await sendTelegramRequest("getMe", {});
    if (res && res.ok) {
        BOT_USERNAME = res.result.username;
        return BOT_USERNAME;
    }
    return "CraftopiaBot";
}

async function setupBotCommands() {
    if (COMMANDS_SET) return;
    const payload = {
        commands: [
            { command: "start", description: "Start the registration process 📝" },
            { command: "submit", description: "Submit a new receipt 📝" },
            { command: "refer", description: "Refer friends to get rewards 👥" },
            { command: "status", description: "Check your receipt review status 🔍" },
            { command: "language", description: "Change language / ቋንቋ ይቀይሩ 🌐" },
            { command: "help", description: "Get bot instructions and help ℹ️" }
        ]
    };
    const res = await sendTelegramRequest("setMyCommands", payload);
    if (res && res.ok) {
        COMMANDS_SET = true;
    }
}

// Auto-seed default languages and translations if DB tables exist but are empty
async function autoSeedDatabaseTranslations() {
    try {
        const key = SUPABASE_KEY;
        const url = SUPABASE_URL;
        const headers = {
            "apikey": key,
            "Authorization": `Bearer ${key}`,
            "Content-Type": "application/json"
        };
        
        const resLangs = await axios.get(`${url}/rest/v1/languages`, { headers });
        const dbLangs = resLangs.data;
        
        if (Array.isArray(dbLangs)) {
            const hasEn = dbLangs.some(l => l.code === 'en');
            const hasAm = dbLangs.some(l => l.code === 'am');
            const hasOm = dbLangs.some(l => l.code === 'om');
            const hasTi = dbLangs.some(l => l.code === 'ti');
            
            let seeded = false;
            if (!hasEn) {
                console.log("[DB SEED] Seeding English language...");
                await db.upsertLanguage("en", "English", true);
                seeded = true;
            }
            if (!hasAm) {
                console.log("[DB SEED] Seeding Amharic language...");
                await db.upsertLanguage("am", "አማርኛ", true);
                seeded = true;
            }
            if (!hasOm) {
                console.log("[DB SEED] Seeding Oromo language...");
                await db.upsertLanguage("om", "Afaan Oromoo", true);
                seeded = true;
            }
            if (!hasTi) {
                console.log("[DB SEED] Seeding Tigrinya language...");
                await db.upsertLanguage("ti", "ትግርኛ", true);
                seeded = true;
            }
            
            const resTrans = await axios.get(`${url}/rest/v1/translations`, { headers });
            const dbTrans = resTrans.data;
            if (Array.isArray(dbTrans) && dbTrans.length === 0) {
                console.log("[DB SEED] Seeding default translations...");
                const defaultTranslations = [];
                for (const [langCode, keys] of Object.entries(STATIC_MESSAGES)) {
                    for (const [key, val] of Object.entries(keys)) {
                        defaultTranslations.push({
                            lang_code: langCode,
                            key: key,
                            value: val
                        });
                    }
                }
                if (defaultTranslations.length > 0) {
                    await db.upsertTranslations(defaultTranslations);
                }
                seeded = true;
            }
            if (seeded) {
                console.log("[DB SEED] Seeding completed successfully.");
            }
        }
    } catch (e) {
        if (e.response && e.response.status === 404) {
            // expected if tables are not created yet
        } else {
            console.error("[DB SEED] Error seeding database translations:", e.message);
        }
    }
}

// Translations logic
async function loadDbTranslations() {
    try {
        await autoSeedDatabaseTranslations();
        const langs = await db.getActiveLanguages();
        const trans = await db.getAllTranslations();
        const newMessages = {};
        for (const l of langs) {
            newMessages[l.code] = {};
        }
        for (const t of trans) {
            const lc = t.lang_code;
            const k = t.key;
            const v = t.value;
            if (newMessages[lc]) {
                newMessages[lc][k] = v;
            }
        }
        if (Object.keys(newMessages).length > 0) {
            DB_MESSAGES = newMessages;
        }
    } catch (e) {
        console.error("Error loading translations from DB:", e.message);
    }
}

function getMsg(lang, key) {
    if (Object.keys(DB_MESSAGES).length === 0) {
        // Fallback loads async, but for instant response we reference static
    }
    if (DB_MESSAGES[lang] && DB_MESSAGES[lang][key]) {
        return DB_MESSAGES[lang][key];
    }
    if (STATIC_MESSAGES[lang] && STATIC_MESSAGES[lang][key]) {
        return STATIC_MESSAGES[lang][key];
    }
    if (STATIC_MESSAGES["en"] && STATIC_MESSAGES["en"][key]) {
        return STATIC_MESSAGES["en"][key];
    }
    return `[${key}]`;
}

// Dynamic messages accessor helper
const MESSAGES = {
    get: (lang) => {
        return {
            welcome_choose_lang: getMsg(lang, "welcome_choose_lang"),
            ask_name: getMsg(lang, "ask_name"),
            invalid_name: getMsg(lang, "invalid_name"),
            ask_phone: getMsg(lang, "ask_phone"),
            btn_share_contact: getMsg(lang, "btn_share_contact"),
            phone_saved: getMsg(lang, "phone_saved"),
            duplicate_phone: getMsg(lang, "duplicate_phone"),
            invalid_phone: getMsg(lang, "invalid_phone"),
            ask_payment_method: getMsg(lang, "ask_payment_method"),
            btn_telebirr: getMsg(lang, "btn_telebirr"),
            btn_cbe: getMsg(lang, "btn_cbe"),
            select_payment_method_first: getMsg(lang, "select_payment_method_first"),
            telebirr_payment_instructions: getMsg(lang, "telebirr_payment_instructions"),
            cbe_payment_instructions: getMsg(lang, "cbe_payment_instructions"),
            ask_receipt_number: getMsg(lang, "ask_receipt_number"),
            registration_submitted: getMsg(lang, "registration_submitted"),
            menu_submit_receipt: getMsg(lang, "menu_submit_receipt"),
            menu_check_status: getMsg(lang, "menu_check_status"),
            menu_refer_friend: getMsg(lang, "menu_refer_friend"),
            menu_change_language: getMsg(lang, "menu_change_language"),
            status_pending: getMsg(lang, "status_pending"),
            status_approved: getMsg(lang, "status_approved"),
            status_declined: getMsg(lang, "status_declined"),
            no_receipt_yet: getMsg(lang, "no_receipt_yet"),
            already_pending: getMsg(lang, "already_pending"),
            referral_message: getMsg(lang, "referral_message"),
            ready_new_receipt: getMsg(lang, "ready_new_receipt"),
            payment_saved: getMsg(lang, "payment_saved"),
            help_instructions: getMsg(lang, "help_instructions"),
            already_registered: getMsg(lang, "already_registered"),
            status_approved_msg: getMsg(lang, "status_approved_msg"),
            status_declined_msg: getMsg(lang, "status_declined_msg"),
            status_pending_msg: getMsg(lang, "status_pending_msg"),
            default_decline_reason: getMsg(lang, "default_decline_reason"),
            last_approved_msg: getMsg(lang, "last_approved_msg"),
            last_declined_msg: getMsg(lang, "last_declined_msg"),
            last_pending_msg: getMsg(lang, "last_pending_msg"),
            welcome_name_prefix: getMsg(lang, "welcome_name_prefix")
        };
    }
};

function isMenuCommand(text, key) {
    for (const keys of Object.values(DB_MESSAGES)) {
        if (keys[key] === text) return true;
    }
    for (const keys of Object.values(STATIC_MESSAGES)) {
        if (keys[key] === text) return true;
    }
    return false;
}

function getLangAndStep(reg) {
    if (!reg) return ["en", "start"];
    const step = reg.step || "en|start";
    if (step.includes("|")) {
        const parts = step.split("|");
        return [parts[0], parts[1]];
    }
    return ["en", step];
}

function getDefaultStudentName(lang) {
    if (lang === "am") return "ተማሪ";
    if (lang === "om" || lang === "or") return "Barataa";
    if (lang === "ti" || lang === "tg") return "ተመሃራይ";
    return "Student";
}

async function generateApprovedInviteLinks(regName, lang = "en") {
    let settings;
    try {
        settings = await db.getPaymentSettings();
    } catch (e) {
        console.error("Error getting payment settings in generateApprovedInviteLinks:", e.message);
        settings = {};
    }

    const channelId = settings.telegram_channel_id || TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_ID || "-1003789578749";
    const durationDays = parseInt(settings.access_duration_days) || 30;
    const expireDate = Math.floor(Date.now() / 1000) + Math.max(1, durationDays) * 24 * 3600;

    // Generate main channel invite link dynamically
    const inviteRes1 = await sendTelegramRequest("createChatInviteLink", {
        chat_id: channelId,
        member_limit: 1,
        name: `Main Link for ${regName || getDefaultStudentName(lang)}`
    });

    let inviteLink1 = "";
    if (inviteRes1 && inviteRes1.ok) {
        inviteLink1 = inviteRes1.result.invite_link;
    } else {
        console.error("Failed to generate main invite link:", inviteRes1 ? inviteRes1.description : "Unknown error");
    }
    let links = [];
    if (inviteLink1) links.push(inviteLink1);

    return links.length > 0 ? links.join(" ") : "Error: Failed to generate links";
}

function formatInviteLinksForUser(inviteLinkStr, lang) {
    if (!inviteLinkStr) return "";
    const links = inviteLinkStr.trim().split(/\s+/);
    if (lang === "am") {
        return `ዋናው ቻናል፡ ${links[0]}`;
    } else if (lang === "om" || lang === "or") {
        return `Chaanaalii Guddaa: ${links[0]}`;
    } else if (lang === "ti" || lang === "tg") {
        return `ቀንዲ ቻነል፡ ${links[0]}`;
    }
    return `Main Channel: ${links[0]}`;
}


function buildStep(lang, step) {
    return `${lang}|${step}`;
}

function getMenuKeyboard(lang = "en") {
    return {
        keyboard: [
            [{ text: getMsg(lang, "menu_submit_receipt") }],
            [{ text: getMsg(lang, "menu_refer_friend") }, { text: getMsg(lang, "menu_check_status") }],
            [{ text: getMsg(lang, "menu_change_language") }]
        ],
        resize_keyboard: true
    };
}

async function getLanguageKeyboard() {
    let langs = [];
    try {
        langs = await db.getActiveLanguages();
    } catch (e) {
        // ignore
    }
    if (langs.length === 0) {
        return {
            inline_keyboard: [
                [{ text: "🇬🇧 English", callback_data: "lang:en" }, { text: "🇪🇹 አማርኛ", callback_data: "lang:am" }]
            ]
        };
    }
    const flags = {
        "en": "🇬🇧",
        "am": "🇪🇹",
        "om": "🇪🇹",
        "or": "🇪🇹",
        "ti": "🇪🇹",
        "tg": "🇪🇹",
    };
    const buttons = langs.map(l => {
        const flag = flags[l.code] || "🌐";
        return { text: `${flag} ${l.name}`, callback_data: `lang:${l.code}` };
    });
    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
        inlineKeyboard.push(buttons.slice(i, i + 2));
    }
    return { inline_keyboard: inlineKeyboard };
}

function generateVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function parseIsoDatetime(isoStr) {
    if (!isoStr) return null;
    return new Date(isoStr);
}

// Generate PDF Certificate Helper
async function generateCertificatePdf(name, regDate, finishDate) {
    const fs = require('fs');
    const path = require('path');
    const settings = await db.getPaymentSettings();

    let templatePath = path.join(__dirname, 'IMG_6757.html');
    if (!fs.existsSync(templatePath)) {
        templatePath = path.join(process.cwd(), 'api', 'IMG_6757.html');
    }
    if (!fs.existsSync(templatePath)) {
        templatePath = path.join(process.cwd(), 'IMG_6757.html');
    }
    let html = fs.readFileSync(templatePath, 'utf8');

    const programAm  = settings.cert_program_am  || "እደጥበብ";
    const programEn  = settings.cert_program_en  || "Hand Craft & Art";
    const durationAm = settings.cert_duration_am || "4";
    const durationEn = settings.cert_duration_en || "4";
    const signatureBase64 = settings.signature_base64 || "";

    let logoPath = path.join(__dirname, 'IMG_0892.PNG');
    if (!fs.existsSync(logoPath)) {
        logoPath = path.join(process.cwd(), 'api', 'IMG_0892.PNG');
    }
    if (!fs.existsSync(logoPath)) {
        logoPath = path.join(process.cwd(), 'IMG_0892.PNG');
    }
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
        logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath, 'base64');
    }
    html = html.replace('C:\\Users\\Administrator\\Desktop\\Projects\\craftopia\\IMG_0892.PNG', logoBase64);

    const printStyles = `
        <style>
            @media print {
                @page { size: A4 landscape; margin: 0; }
                html, body { width: 297mm !important; height: 210mm !important; margin: 0 !important; padding: 0 !important; background-color: #ffffff !important; display: block !important; overflow: hidden !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .certificate-canvas { width: 297mm !important; height: 210mm !important; position: absolute !important; top: 0 !important; left: 0 !important; margin: 0 !important; padding: 30px 40px !important; box-sizing: border-box !important; border: none !important; box-shadow: none !important; background-color: #ffffff !important; page-break-inside: avoid !important; }
                .fill-blank-line, .dotted-blank-line { vertical-align: baseline !important; height: auto !important; text-align: center !important; font-weight: bold !important; display: inline-block !important; }
                .date-container-left, .date-container-right { display: inline-flex !important; align-items: baseline !important; }
            }
        </style>
    `;
    html = html.replace('</head>', printStyles + '</head>');

    html = html.replace('<div class="fill-blank-line" style="width: 88%; margin-left: 10px;"></div>', `<div class="fill-blank-line" style="width: 88%; margin-left: 10px; text-align: center; font-weight: bold; font-size: 16px;">${name}</div>`);
    html = html.replace('<div class="fill-blank-line" style="width: 90%; margin-left: 10px;"></div>', `<div class="fill-blank-line" style="width: 90%; margin-left: 10px; text-align: center; font-weight: bold; font-size: 16px;">${name}</div>`);
    html = html.replace('<div class="dotted-blank-line" style="width: 95px;"></div>', `<div class="dotted-blank-line" style="width: 95px; text-align: center; font-weight: bold;">${durationAm}</div>`);
    html = html.replace('<div class="dotted-blank-line" style="width: 185px;"></div>', `<div class="dotted-blank-line" style="width: 185px; text-align: center; font-weight: bold;">${programAm}</div>`);
    html = html.replace('PROGRAM IN<div class="dotted-blank-line" style="width: 200px;"></div> AT CRAFTOPIA.', `PROGRAM IN <div class="dotted-blank-line" style="width: 200px; text-align: center; font-weight: bold;">${programEn}</div> AT CRAFTOPIA.`);
    html = html.replace('THE TRAINING WAS CONDUCTED FOR<div class="dotted-blank-line" style="width: 95px;"></div>WEEK.', `THE TRAINING WAS CONDUCTED FOR <div class="dotted-blank-line" style="width: 95px; text-align: center; font-weight: bold;">${durationEn}</div> WEEK.`);
    html = html.replace('ቀን <div class="dotted-blank-line" style="width: 165px;"></div> ዓ.ም', `ቀን <div class="dotted-blank-line" style="width: 165px; text-align: center; font-weight: bold;">${finishDate}</div> ዓ.ም`);
    html = html.replace('DATE: <div class="fill-blank-line" style="width: 150px;"></div>', `DATE: <div class="fill-blank-line" style="width: 150px; text-align: center; font-weight: bold;">${finishDate}</div>`);
    if (signatureBase64) {
        html = html.replace('SIGNED: <div class="fill-blank-line" style="width: 190px;"></div>', `SIGNED: <div class="fill-blank-line" style="width: 190px; position: relative; text-align: center; height: 35px !important; vertical-align: bottom !important;"><img src="${signatureBase64}" style="max-height: 40px; position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%);"></div>`);
    }

    try {
        const FormData = require('form-data');
        const axios = require('axios');
        
        const form = new FormData();
        form.append('files', Buffer.from(html, 'utf-8'), { filename: 'index.html', contentType: 'text/html' });
        // Set paper size to A4 Landscape
        form.append('paperWidth', '11.69');
        form.append('paperHeight', '8.27');
        form.append('marginTop', '0');
        form.append('marginBottom', '0');
        form.append('marginLeft', '0');
        form.append('marginRight', '0');
        form.append('printBackground', 'true');
        
        const res = await axios.post('https://demo.gotenberg.dev/forms/chromium/convert/html', form, {
            headers: form.getHeaders(),
            responseType: 'arraybuffer',
            timeout: 15000
        });
        
        return res.data;
    } catch (err) {
        console.error("Gotenberg PDF API error:", err.message);
        throw err;
    }
}


// Send Next Quiz Helper
async function sendNextQuizQuestion(chatId) {
    const prog = await db.getUserQuizProgress(chatId);
    if (!prog) return;
        
    const day = prog.current_day || 1;
    const qIndex = prog.current_question_index || 0;
    
    const questions = await db.getQuestionsByDay(day);
    if (questions.length === 0) {
        const maxDay = await db.getMaxQuizDay();
        if (day > maxDay && maxDay > 0) {
            const msg = "🎉 **Congratulations! You have completed all courses!** 🎉\n\nClick below to get your Certificate!";
            const kb = {
                inline_keyboard: [
                    [{ text: "Get Certificate 📜", callback_data: "get_certificate" }]
                ]
            };
            await sendTelegramRequest("sendMessage", { chat_id: chatId, text: msg, parse_mode: "Markdown", reply_markup: kb });
        }
        return;
    }
        
    if (qIndex >= questions.length) {
        // Day Completed
        const maxDay = await db.getMaxQuizDay();
        
        if (day >= maxDay) {
            await db.upsertUserQuizProgress(chatId, { is_completed: true, last_completed_at: new Date().toISOString() });
            
            const reg = await db.getRegistration(chatId);
            const name = reg ? (reg.name || "Student") : "Student";
            const [lang] = getLangAndStep(reg);
            
            let pdfBytes = null;
            try {
                const regDateStr = reg ? (reg.created_at || "") : "";
                let regDate = "Unknown";
                if (regDateStr) {
                    try { regDate = regDateStr.split("T")[0]; } catch (e) {}
                }
                const finishDate = new Date().toISOString().split("T")[0];
                pdfBytes = await generateCertificatePdf(name, regDate, finishDate);
            } catch (pdfErr) {
                console.error("Error generating completion certificate PDF:", pdfErr.message);
                await sendTelegramRequest("sendMessage", { chat_id: chatId, text: "DEBUG PDF Error: " + pdfErr.message });
            }
            
            const caption = getMsg(lang, "course_completed_msg").replace("{name}", name);
            
            if (pdfBytes) {
                const FormData = require('form-data');
                const form = new FormData();
                form.append('chat_id', String(chatId));
                form.append('caption', caption);
                form.append('parse_mode', 'Markdown');
                form.append('document', pdfBytes, {
                    filename: 'Certificate.pdf',
                    contentType: 'application/pdf'
                });
                
                try {
                    await axios.post(`${TELEGRAM_API_URL}/sendDocument`, form, { headers: form.getHeaders() });
                    return;
                } catch (sendErr) {
                    console.error("Error sending auto-generated certificate document:", sendErr.message);
                }
            }
            
            const kb = {
                inline_keyboard: [
                    [{ text: "Get Certificate 📜", callback_data: "get_certificate" }]
                ]
            };
            await sendTelegramRequest("sendMessage", { chat_id: chatId, text: caption, parse_mode: "Markdown", reply_markup: kb });
        } else {
            await db.upsertUserQuizProgress(chatId, { last_completed_at: new Date().toISOString() });
            
            const reg = await db.getRegistration(chatId);
            const [lang] = getLangAndStep(reg);
            
            const msg = getMsg(lang, "day_completed_msg").replace("{day}", String(day));
                
            await sendTelegramRequest("sendMessage", { chat_id: chatId, text: msg, parse_mode: "Markdown" });
        }
        return;
    }
        
    const q = questions[qIndex];
    const options = q.options || [];
    const kb = { inline_keyboard: [] };
    options.forEach((opt, i) => {
        kb.inline_keyboard.push([{ text: String(opt), callback_data: `ans:${q.id}:${i}` }]);
    });
        
    const reg = await db.getRegistration(chatId);
    const [lang] = getLangAndStep(reg);

    let msg = `🎓 **Day ${day} - Question ${qIndex + 1}/${questions.length}**\n\n`;
    if (qIndex === 0) {
        if (lang === "am") {
            msg += "⚠️ *እባክዎ እነዚህን ጥያቄዎች ከመመለስዎ በፊት ትምህርቱን መመልከትዎን ያረጋግጡ!*\n\n";
        } else if (lang === "om" || lang === "or") {
            msg += "⚠️ *Maaloo gaaffilee kana deebisuun dura koorsicha daawwachuu keessan mirkaneeffadhaa!*\n\n";
        } else if (lang === "ti" || lang === "tg") {
            msg += "⚠️ *በጃኹም ነዞም ሕቶታት እዚኦም ቅድሚ ምምላስኩም ነቲ ኮርስ ምርኣይኩም ኣረጋግጹ!*\n\n";
        } else {
            msg += "⚠️ *Please make sure you have viewed the course before answering these questions!*\n\n";
        }
    }
    msg += `${q.question_text}`;
    await sendTelegramRequest("sendMessage", { chat_id: chatId, text: msg, parse_mode: "Markdown", reply_markup: kb });
}

async function runDbMigration() {
    let DB_URL = process.env.DATABASE_URL;
    if (!DB_URL) {
        const supabaseUrl = SUPABASE_URL;
        const dbPassword = process.env.DB_PASSWORD || "Dl1gdEE4ekuJK1EO";
        const host = supabaseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
        DB_URL = `postgresql://postgres:${dbPassword}@db.${host}:6543/postgres`;
    }
    const { Client } = require('pg');
    const client = new Client({ 
        connectionString: DB_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        console.log("[Migration] Running auto-migrations on database...");
        await client.connect();
        
        await client.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS referral_paid BOOLEAN DEFAULT false;");
        await client.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS receipt_image_url TEXT;");
        await client.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;");
        
        await client.query("ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_link_code TEXT;");
        await client.query("ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_link_expires_at TIMESTAMP WITH TIME ZONE;");
        
        await client.query("INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true) ON CONFLICT (id) DO NOTHING;");
        
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies WHERE policyname = 'Allow public upload' AND tablename = 'objects' AND schemaname = 'storage'
                ) THEN
                    CREATE POLICY "Allow public upload" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'receipts');
                END IF;
                
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read' AND tablename = 'objects' AND schemaname = 'storage'
                ) THEN
                    CREATE POLICY "Allow public read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'receipts');
                END IF;
            END
            $$;
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS languages (
                code TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
            );
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS translations (
                lang_code TEXT NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (lang_code, key)
            );
        `);
        
        await client.query("INSERT INTO languages (code, name) VALUES ('en', 'English') ON CONFLICT (code) DO NOTHING;");
        await client.query("INSERT INTO languages (code, name) VALUES ('am', 'አማርኛ') ON CONFLICT (code) DO NOTHING;");
        
        console.log("[Migration] Auto-migrations completed successfully.");
    } catch (e) {
        console.error("[Migration] Error running database auto-migrations:", e.message);
    } finally {
        try {
            await client.end();
        } catch (_) {}
    }
}

// Initial Startup Hook Setup
async function runStartups() {
    try {
        if (!process.env.VERCEL) {
            await runDbMigration();
            await setupBotCommands();
        }
        await loadDbTranslations();
    } catch (e) {
        console.error("Error running startups:", e.message);
    }
}
runStartups().catch((e) => console.error('[runStartups fatal]', e.message));


// --- API ENDPOINTS ---

// Login Step 1
app.post('/api/login/step1', async (req, res) => {
    console.log(`[API] POST /api/login/step1 called with username: ${req.body ? req.body.username : 'undefined'}`);
    try {
        const { username, password } = req.body;
        
        const adminRec = await db.getAdmin(username);
        if (!adminRec || adminRec.password !== password) {
            return res.status(401).json({ message: "Invalid username or password" });
        }
            
        let chatId = adminRec.telegram_chat_id;
        if (!chatId && ADMIN_CHAT_ID) {
            chatId = ADMIN_CHAT_ID;
            await db.linkAdminChat(username, chatId);
        }
        if (!chatId) {
            return res.status(400).json({
                error: "no_chat_linked",
                message: "Your Telegram account is not linked yet. Please open the bot on Telegram and type: /Auth <username> <password> to link your account."
            });
        }
            
        const code = generateVerificationCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        
        await db.setAdminVerificationCode(username, code, expiresAt);
        
        const fs = require('fs');
        try {
            fs.writeFileSync(path.join(__dirname, 'last_verification_code.txt'), code, 'utf8');
        } catch (fsErr) {
            console.error("Failed to write verification code to file:", fsErr.message);
        }
        
        console.log(`\n========================================\n[AUTH] Admin Verification Code for ${username}: ${code}\n========================================\n`);
        
        const botMsg = (
            `🔒 **Admin Dashboard Verification Code**\n\n` +
            `Someone is attempting to log in to the admin panel.\n` +
            `Your verification code is: \`${code}\`\n\n` +
            `*Note: This code expires in 10 minutes. If this wasn't you, please change your password immediately.*`
        );
        sendTelegramRequest("sendMessage", {
            chat_id: chatId,
            text: botMsg,
            parse_mode: "Markdown"
        }).then(telegramRes => {
            if (!telegramRes || !telegramRes.ok) {
                console.warn(`[WARNING] Failed to send verification code via Telegram. Code is: ${code}`);
            }
        }).catch(err => {
            console.error("Error sending Telegram code:", err.message);
        });

        return res.json({ success: true, message: "Verification code sent to your Telegram chat." });
    } catch (handlerErr) {
        console.error("Crash in login step 1:", handlerErr);
        return res.status(500).json({
            error: "internal_server_error",
            message: handlerErr.message,
            stack: handlerErr.stack
        });
    }
});

// Login Step 2
app.post('/api/login/step2', async (req, res) => {
    const { username, password, code } = req.body;
    
    const adminRec = await db.getAdmin(username);
    if (!adminRec || adminRec.password !== password) {
        return res.status(401).json({ message: "Invalid username or password" });
    }
        
    const savedCode = adminRec.verification_code;
    const expiryStr = adminRec.code_expires_at;
    
    if (!savedCode || !expiryStr) {
        return res.status(400).json({ message: "No login session initiated. Please request a code first." });
    }
        
    const expiryDt = parseIsoDatetime(expiryStr);
    const nowDt = new Date();
    
    if (savedCode === code && expiryDt && expiryDt > nowDt) {
        await db.setAdminVerificationCode(username, null, null);
        const token = jwt.sign({ user: username }, JWT_SECRET, { expiresIn: '30d' });
        
        res.cookie('admin_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production' || process.env.VERCEL,
            sameSite: 'strict',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });
        
        return res.json({ token });
    }
        
    return res.status(401).json({ message: "Invalid or expired verification code." });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('admin_token');
    return res.json({ success: true });
});

// Request verification code for internal settings/passwords
app.post('/api/request-code', requireAuth, async (req, res) => {
    const username = req.user.user;
    const adminRec = await db.getAdmin(username);
    if (!adminRec) {
        return res.status(404).json({ message: "Admin profile not found" });
    }
        
    let chatId = adminRec.telegram_chat_id;
    if (!chatId && ADMIN_CHAT_ID) {
        chatId = ADMIN_CHAT_ID;
        await db.linkAdminChat(username, chatId);
    }
    if (!chatId) {
        return res.status(400).json({ message: "No linked Telegram chat found." });
    }
        
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    
    await db.setAdminVerificationCode(username, code, expiresAt);
    
    console.log(`\n========================================\n[AUTH] Security Verification Code for ${username}: ${code}\n========================================\n`);
    
    const botMsg = (
        `🔒 **Security Verification Code**\n\n` +
        `You requested a verification code to authorize password modifications.\n` +
        `Your verification code is: \`${code}\`\n\n` +
        `*Note: This code expires in 10 minutes.*`
    );
    const telegramRes = await sendTelegramRequest("sendMessage", {
        chat_id: chatId,
        text: botMsg,
        parse_mode: "Markdown"
    });
    
    if (!telegramRes || !telegramRes.ok) {
        console.warn(`[WARNING] Failed to send verification code via Telegram. Code is: ${code}`);
        return res.json({ success: true, message: "Verification code generated. (Check server console/logs for code)" });
    }
    
    return res.json({ success: true, message: "Verification code sent to your Telegram." });
});

// Change Password
app.post('/api/change-password', requireAuth, async (req, res) => {
    const { new_password, code } = req.body;
    if (!new_password || !code) {
        return res.status(400).json({ message: "Missing new password or verification code." });
    }
        
    const username = req.user.user;
    const adminRec = await db.getAdmin(username);
    if (!adminRec) {
        return res.status(404).json({ message: "Admin profile not found" });
    }
        
    const savedCode = adminRec.verification_code;
    const expiryStr = adminRec.code_expires_at;
    
    if (!savedCode || !expiryStr) {
        return res.status(400).json({ message: "No active verification code requested." });
    }
        
    const expiryDt = parseIsoDatetime(expiryStr);
    const nowDt = new Date();
    
    if (savedCode === code && expiryDt && expiryDt > nowDt) {
        await db.setAdminVerificationCode(username, null, null);
        await db.updateAdminPassword(username, new_password);
        return res.json({ success: true, message: "Password updated successfully!" });
    }
        
    return res.status(400).json({ message: "Invalid or expired verification code." });
});

// Registrations paginated
app.get('/api/registrations', requireAuth, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status || "all";
    const search = req.query.search || null;
    
    const [regs, total] = await db.getRegistrationsPaginated(page, limit, status, search);
    return res.json({
        data: regs,
        total,
        page,
        limit
    });
});

// Referral stats
app.get('/api/referrers', requireAuth, async (req, res) => {
    const summary = await db.getUsersReferralSummary();
    return res.json(summary);
});

// Channel Broadcast with Multer (Modified to broadcast to all registered bot users)
const getUploadMiddleware = () => {
    const multer = require('multer');
    return multer({ storage: multer.memoryStorage() }).single('file');
};

app.post('/api/broadcast', requireAuth, getUploadMiddleware(), async (req, res) => {
    const text = req.body.text || "";
    
    // Fetch all registrations to extract unique chat IDs
    let chatIds = [];
    try {
        const [regs] = await db.getRegistrationsPaginated(1, 10000);
        chatIds = [...new Set(regs.map(r => r.chat_id).filter(id => id))];
    } catch (dbErr) {
        console.error("Failed to fetch registrations for broadcast:", dbErr.message);
        return res.status(500).json({ message: `Database error: ${dbErr.message}` });
    }

    if (chatIds.length === 0) {
        return res.status(400).json({ message: "No registered bot users found to broadcast to." });
    }

    let successCount = 0;
    let failCount = 0;

    if (req.file) {
        const filename = req.file.originalname.toLowerCase();
        const mimetype = req.file.mimetype;
        const isVideo = filename.endsWith(".mp4") || filename.endsWith(".mov") || filename.endsWith(".avi") || filename.endsWith(".mkv") || filename.endsWith(".gif") || mimetype.includes("video");
        
        const FormData = require('form-data');
        let fileId = null;
        let successfulFirstChatId = null;
        
        // Upload the file to Telegram using the first valid chatId to get a file_id
        for (const chatId of chatIds) {
            const form = new FormData();
            form.append('chat_id', chatId);
            // Use safe ascii filename to prevent parsing issues
            const safeFileName = "upload" + (isVideo ? ".mp4" : ".jpg");
            form.append(isVideo ? 'video' : 'photo', req.file.buffer, { filename: safeFileName, contentType: req.file.mimetype });
            if (text) form.append('caption', text);
            form.append('parse_mode', 'Markdown');
            
            try {
                const method = isVideo ? 'sendVideo' : 'sendPhoto';
                const res = await axios.post(`${TELEGRAM_API_URL}/${method}`, form, {
                    headers: form.getHeaders()
                });
                if (res.data && res.data.ok) {
                    successCount++;
                    const msg = res.data.result;
                    if (isVideo && msg.video) {
                        fileId = msg.video.file_id;
                    } else if (!isVideo && msg.photo && msg.photo.length > 0) {
                        fileId = msg.photo[msg.photo.length - 1].file_id;
                    }
                    successfulFirstChatId = chatId;
                    break; // Upload succeeded! We have the file_id!
                }
            } catch (uploadErr) {
                console.warn(`Failed to upload media to user ${chatId}. Reason:`, uploadErr.response ? JSON.stringify(uploadErr.response.data) : uploadErr.message);
                failCount++;
            }
        }
        
        if (!fileId) {
            return res.status(500).json({ message: "Failed to upload media to Telegram. Check if users have blocked the bot." });
        }
        
        // Broadcast using the file_id for the rest of the users
        const remainingChatIds = chatIds.filter(id => id !== successfulFirstChatId);
        if (remainingChatIds.length > 0) {
            
            // Process in chunks to avoid Vercel timeouts and rate limits
            const chunkSize = 30;
            for (let i = 0; i < remainingChatIds.length; i += chunkSize) {
                const chunk = remainingChatIds.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (chatId) => {
                    const method = isVideo ? 'sendVideo' : 'sendPhoto';
                    const payload = {
                        chat_id: chatId,
                        caption: text,
                        parse_mode: 'Markdown',
                        [isVideo ? 'video' : 'photo']: fileId
                    };
                    try {
                        const resJson = await sendTelegramRequest(method, payload);
                        if (resJson && resJson.ok) {
                            successCount++;
                        } else {
                            failCount++;
                        }
                    } catch (e) {
                        console.error(`Failed to send broadcast media to ${chatId}:`, e.message);
                        failCount++;
                    }
                }));
            }
        }
    } else {
        if (!text) {
            return res.status(400).json({ message: "Message text is empty." });
        }
            
        for (const chatId of chatIds) {
            const data = {
                chat_id: chatId,
                text: text,
                parse_mode: "Markdown"
            };
            const resJson = await sendTelegramRequest("sendMessage", data);
            if (resJson && resJson.ok) {
                successCount++;
            } else {
                failCount++;
            }
        }
    }

    if (simulatorLogs.length > 200) simulatorLogs.splice(0, simulatorLogs.length - 200);

    return res.json({ success: true, sent: successCount, failed: failCount });
});

// Decline Registration
app.post('/api/decline', requireAuth, async (req, res) => {
    const { id, reason } = req.body;
    const finalReason = reason || "Details do not match our records.";
    
    if (!id) {
        return res.status(400).json({ message: "Missing ID" });
    }
        
    const reg = await db.getRegistrationById(id);
    if (!reg) {
        return res.status(404).json({ message: "Registration not found" });
    }
        
    await db.updateRegistrationStatus(id, "declined", null, finalReason);
    
    const [lang] = getLangAndStep(reg);
    let translatedReason = finalReason;
    if (lang === "am") {
        if (finalReason === "Fake Receipt") translatedReason = "ሐሰተኛ ደረሰኝ";
        else if (finalReason === "Duplicate") translatedReason = "የተደገመ ደረሰኝ";
        else if (finalReason === "Invalid Details") translatedReason = "የተሳሳተ መረጃ";
    } else if (lang === "om" || lang === "or") {
        if (finalReason === "Fake Receipt") translatedReason = "Nagahee Kijibaa";
        else if (finalReason === "Duplicate") translatedReason = "Nagahee Dachaa";
        else if (finalReason === "Invalid Details") translatedReason = "Odeeffannoo Dogoggoraa";
    } else if (lang === "ti" || lang === "tg") {
        if (finalReason === "Fake Receipt") translatedReason = "ሓሶት ደረሰኝ";
        else if (finalReason === "Duplicate") translatedReason = "ዝተደገመ ደረሰኝ";
        else if (finalReason === "Invalid Details") translatedReason = "ዘይተረጋገጸ ሓበሬታ";
    }
    
    const msg = getMsg(lang, "receipt_declined_msg")
        .replace("{name}", reg.name)
        .replace("{receipt}", reg.receipt_number)
        .replace("{reason}", translatedReason);
    
    await sendTelegramRequest("sendMessage", {
        chat_id: reg.chat_id,
        text: msg,
        parse_mode: "Markdown",
        reply_markup: getMenuKeyboard(lang)
    });
    
    return res.json({ success: true });
});

// Admin settings GET/POST
app.get('/api/admin/settings', requireAuth, async (req, res) => {
    const settings = await db.getPaymentSettings();
    return res.json(settings);
});

app.post('/api/admin/settings', requireAuth, async (req, res) => {
    const success = await db.updatePaymentSettings(req.body);
    if (success) {
        return res.json({ success: true });
    }
    return res.status(500).json({ error: "Failed to update settings" });
});

// Admin upload endpoint for bot simulator image uploads
app.post('/api/admin/upload', requireAuth, getUploadMiddleware(), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: "No file uploaded." });
    }
    const fileName = `sim_${Date.now()}_${req.file.originalname.toLowerCase().replace(/[^a-z0-9.]/g, "_")}`;
    const storageUrl = `${SUPABASE_URL}/storage/v1/object/receipts/${fileName}`;
    try {
        const uploadRes = await axios.post(storageUrl, req.file.buffer, {
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`,
                "Content-Type": req.file.mimetype
            }
        });
        if (uploadRes.status === 200 || uploadRes.status === 201) {
            const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/receipts/${fileName}`;
            return res.json({ success: true, url: publicUrl });
        }
        return res.status(400).json({ message: "Failed to upload file to storage" });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

// Admin endpoint to generate a Telegram linkage code
app.post('/api/admin/generate-link-code', requireAuth, async (req, res) => {
    const username = req.user.user;
    const code = "LINK-" + Math.floor(100000 + Math.random() * 900000);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes expiry
    
    const success = await db.setAdminVerificationCode(username, code, expiresAt);
    if (success) {
        return res.json({ success: true, code: code });
    }
    return res.status(500).json({ error: "Failed to generate link code" });
});

app.get('/api/admin/force-schema-reload', async (req, res) => {
    let DB_URL = process.env.DATABASE_URL;
    if (!DB_URL) {
        const supabaseUrl = process.env.SUPABASE_URL || "https://pgnxsgysnvrgsbuecesc.supabase.co";
        const dbPassword = process.env.DB_PASSWORD || "Dl1gdEE4ekuJK1EO";
        const host = supabaseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
        DB_URL = `postgresql://postgres:${dbPassword}@db.${host}:6543/postgres`;
    }
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    try {
        await client.connect();
        await client.query("NOTIFY pgrst, 'reload schema';");
        await client.end();
        res.send("Schema reloaded");
    } catch (e) {
        res.status(500).send(e.message);
    }
});


// Approve Registration
app.post('/api/approve', requireAuth, async (req, res) => {
    const { id } = req.body;
    if (!id) {
        return res.status(400).json({ message: "Missing ID" });
    }
        
    const reg = await db.getRegistrationById(id);
    if (!reg) {
        return res.status(404).json({ message: "Registration not found" });
    }
        
    try {
        const [lang] = getLangAndStep(reg);
        const inviteLink = await generateApprovedInviteLinks(reg.name, lang);
        await db.updateRegistrationStatus(id, "approved", inviteLink);
        
        // Trigger referral reward check
        if (reg.referred_by_chat_id) {
            await checkAndApplyReferralReward(reg.referred_by_chat_id);
        }
        
        const msg = getMsg(lang, "receipt_approved_msg")
            .replace("{name}", reg.name)
            .replace("{receipt}", reg.receipt_number)
            .replace("{link}", formatInviteLinksForUser(inviteLink, lang));
        await sendTelegramRequest("sendMessage", {
            chat_id: reg.chat_id,
            text: msg,
            parse_mode: "Markdown",
            reply_markup: getMenuKeyboard(lang)
        });
        
        // Trigger Day 1 quiz immediately upon approval
        try {
            const prog = await db.getUserQuizProgress(reg.chat_id);
            if (!prog) {
                await db.upsertUserQuizProgress(reg.chat_id, { joined_channel: true, current_day: 1, current_question_index: 0 });
            }
            await sendNextQuizQuestion(reg.chat_id);
        } catch (err) {
            console.error("Error triggering day 1 quiz on approve:", err.message);
        }
        
        return res.json({ success: true, invite_link: inviteLink });
    } catch (err) {
        console.error("Error in /api/approve:", err.message);
        return res.status(500).json({ message: `Failed to approve registration: ${err.message}` });
    }

});

// Quiz Management API
app.get('/api/questions', requireAuth, async (req, res) => {
    const questions = await db.getAllQuestions();
    return res.json(questions);
});

app.post('/api/questions', requireAuth, async (req, res) => {
    const { day_number, question_text, options, correct_option_index } = req.body;
    if (!day_number || !question_text || !options || correct_option_index === undefined) {
        return res.status(400).json({ message: "Missing fields" });
    }
    const success = await db.addQuestion(day_number, question_text, options, correct_option_index);
    if (success) {
        return res.status(201).json({ success: true });
    }
    return res.status(500).json({ message: "Failed to add question" });
});

app.delete('/api/questions/:id', requireAuth, async (req, res) => {
    const success = await db.deleteQuestion(req.params.id);
    if (success) {
        return res.json({ success: true });
    }
    return res.status(500).json({ message: "Failed to delete question" });
});

app.post('/api/admin/send_quiz', requireAuth, async (req, res) => {
    const [regs] = await db.getRegistrationsPaginated(1, 1000, "approved");
    for (const r of regs) {
        const chatId = r.chat_id;
        const prog = await db.getUserQuizProgress(chatId);
        if (prog && !prog.is_completed) {
            await sendNextQuizQuestion(chatId);
        }
    }
    return res.json({ success: true });
});

// Languages API
app.get('/api/languages', requireAuth, async (req, res) => {
    const langs = await db.getAllLanguages();
    return res.json(langs);
});

app.post('/api/languages', requireAuth, async (req, res) => {
    console.log(`[API] POST /api/languages called with body:`, req.body);
    const { code, name, is_active } = req.body;
    if (!code || !name) {
        return res.status(400).json({ message: "Code and name are required" });
    }
    const success = await db.upsertLanguage(code, name, is_active);
    if (success) {
        try {
            const existingTrans = await db.getAllTranslations();
            const hasTranslations = existingTrans.some(t => t.lang_code === code);
            if (!hasTranslations) {
                const defaultKeys = Object.keys(STATIC_MESSAGES.en || {});
                const initialTranslations = defaultKeys.map(k => ({
                    lang_code: code,
                    key: k,
                    value: (STATIC_MESSAGES.en && STATIC_MESSAGES.en[k]) ? STATIC_MESSAGES.en[k] : ""
                }));
                if (initialTranslations.length > 0) {
                    await db.upsertTranslations(initialTranslations);
                }
            }
        } catch (transErr) {
            console.error("Error initializing translations for new language:", transErr.message);
        }
        await loadDbTranslations();
        return res.json({ success: true });
    }
    return res.status(500).json({ message: "Failed to save language" });
});

app.delete('/api/languages/:code', requireAuth, async (req, res) => {
    const success = await db.deleteLanguage(req.params.code);
    if (success) {
        await loadDbTranslations();
        return res.json({ success: true });
    }
    return res.status(500).json({ message: "Failed to delete language" });
});

// Translations API
app.get('/api/translations', requireAuth, async (req, res) => {
    const trans = await db.getAllTranslations();
    return res.json(trans);
});

app.post('/api/translations', requireAuth, async (req, res) => {
    const { translations } = req.body;
    const success = await db.upsertTranslations(translations);
    if (success) {
        await loadDbTranslations();
        return res.json({ success: true });
    }
    return res.status(500).json({ message: "Failed to save translations" });
});

// Schema migration runner
app.all('/api/admin/migrate', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== "super-secret-craftopia-token-key-12345!") {
        return res.status(401).json({ error: "Unauthorized" });
    }
        
    let DB_URL = process.env.DATABASE_URL;
    if (!DB_URL) {
        const supabaseUrl = SUPABASE_URL;
        const dbPassword = process.env.DB_PASSWORD || "Dl1gdEE4ekuJK1EO";
        const host = supabaseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
        DB_URL = `postgresql://postgres:${dbPassword}@db.${host}:6543/postgres`;
    }
    const { Client } = require('pg');
    const client = new Client({ 
        connectionString: DB_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        await client.connect();
        
        await client.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS referral_paid BOOLEAN DEFAULT false;");
        await client.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS receipt_image_url TEXT;");
        await client.query("ALTER TABLE registrations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;");
        
        await client.query("INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true) ON CONFLICT (id) DO NOTHING;");
        
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies WHERE policyname = 'Allow public upload' AND tablename = 'objects' AND schemaname = 'storage'
                ) THEN
                    CREATE POLICY "Allow public upload" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'receipts');
                END IF;
                
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read' AND tablename = 'objects' AND schemaname = 'storage'
                ) THEN
                    CREATE POLICY "Allow public read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'receipts');
                END IF;
            END
            $$;
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS languages (
                code TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
            );
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS translations (
                lang_code TEXT NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (lang_code, key)
            );
        `);
        
        await client.query("INSERT INTO languages (code, name) VALUES ('en', 'English') ON CONFLICT (code) DO NOTHING;");
        await client.query("INSERT INTO languages (code, name) VALUES ('am', 'አማርኛ') ON CONFLICT (code) DO NOTHING;");
        
        for (const [langCode, keys] of Object.entries(STATIC_MESSAGES)) {
            for (const [key, val] of Object.entries(keys)) {
                await client.query(`
                    INSERT INTO translations (lang_code, key, value)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (lang_code, key) DO UPDATE SET value = EXCLUDED.value;
                `, [langCode, key, val]);
            }
        }
        
        await loadDbTranslations();
        
        return res.json({ success: true, message: "Migration completed successfully!" });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    } finally {
        await client.end();
    }
});

// Cron Job for Daily Quiz Sender
app.all('/api/cron/send_daily_quiz', async (req, res) => {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }
        
    const [regs] = await db.getRegistrationsPaginated(1, 1000, "approved");
    
    // Process in chunks to avoid Vercel 10s timeout while respecting Telegram rate limits
    const chunkSize = 30;
    for (let i = 0; i < regs.length; i += chunkSize) {
        const chunk = regs.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (r) => {
            const chatId = r.chat_id;
            try {
                const prog = await db.getUserQuizProgress(chatId);
                if (prog && !prog.is_completed) {
                    const day = prog.current_day || 1;
                    const qIndex = prog.current_question_index || 0;
                    const qs = await db.getQuestionsByDay(day);
                    
                    if (qIndex >= qs.length && qs.length > 0) {
                        const lastCompleted = prog.last_completed_at;
                        if (lastCompleted) {
                            const lastDt = parseIsoDatetime(lastCompleted);
                            const now = new Date();
                            if (lastDt && lastDt.toDateString() !== now.toDateString()) {
                                await db.upsertUserQuizProgress(chatId, { current_day: day + 1, current_question_index: 0 });
                                await sendNextQuizQuestion(chatId);
                            }
                        }
                    } else {
                        await sendNextQuizQuestion(chatId);
                    }
                }
            } catch (err) {
                console.error(`Error processing quiz for ${chatId}:`, err.message);
            }
        }));
    }
    
    return res.json({ success: true });
});

// Database Webhook Receiver
app.post('/api/webhook/db-trigger', async (req, res) => {
    const payload = req.body || {};
    const table = payload.table;
    const eventType = payload.type;
    
    if (table === "registrations" && ["INSERT", "UPDATE"].includes(eventType)) {
        const record = payload.record || {};
        const oldRecord = payload.old_record || {};
        
        const isCompleted = record.step === "completed" && record.status === "pending";
        const wasCompleted = oldRecord ? oldRecord.step === "completed" : false;
        
        if (isCompleted && !wasCompleted) {
            const regId = record.id;
            const name = record.name;
            const phone = record.phone;
            const receipt = record.receipt_number;
            
            let adminChat = null;
            const adminRec = await db.getAdmin(ADMIN_USERNAME);
            if (adminRec) {
                adminChat = adminRec.telegram_chat_id;
            }
            
            if (!adminChat) {
                adminChat = ADMIN_CHAT_ID || process.env.ADMIN_CHAT_ID;
            }
            
            if (adminChat) {
                const adminPayload = {
                    chat_id: adminChat,
                    text: `🔔 **New Receipt Submitted via Webhook!**\n\n👤 **Name**: ${name}\n📞 **Phone**: ${phone}\n🧾 **Receipt**: \`${receipt}\``,
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "Approve ✅", callback_data: `approve:${regId}` },
                                { text: "Decline ❌", callback_data: `decline:${regId}` }
                            ]
                        ]
                    }
                };
                await sendTelegramRequest("sendMessage", adminPayload);
            }
        }
    }
    return res.send("OK");
});

async function kickUserFromChannel(chatId) {
    const secondGroupId = "-5037460334";
    try {
        const settings = await db.getPaymentSettings();
        const channelId = settings.telegram_channel_id || TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_ID;
        
        // Kick from main channel
        if (channelId && String(channelId).trim()) {
            console.log(`[Expiration] Kicking user ${chatId} from main channel ${channelId}...`);
            await sendTelegramRequest("banChatMember", {
                chat_id: channelId,
                user_id: chatId
            });
            await sendTelegramRequest("unbanChatMember", {
                chat_id: channelId,
                user_id: chatId,
                only_if_banned: true
            });
        }
        
    } catch (e) {
        console.error("Error kicking user from channel/group:", e.message);
    }
}


// Telegram Bot Update Webhook (Full Bot Logic)
app.post('/api/bot', async (req, res) => {
    try {
        if (Object.keys(DB_MESSAGES).length === 0) {
            await loadDbTranslations();
        }
    } catch (e) {
        console.error("Error loading translations in bot webhook:", e.message);
    }
        
    const update = req.body || {};
    
    if (update.chat_member) {
        const chatMember = update.chat_member;
        const newStatus = chatMember.new_chat_member ? chatMember.new_chat_member.status : null;
        if (["member", "administrator", "creator"].includes(newStatus)) {
            const userId = chatMember.from ? chatMember.from.id : null;
            if (userId) {
                const prog = await db.getUserQuizProgress(userId);
                if (!prog) {
                    await db.upsertUserQuizProgress(userId, { joined_channel: true, current_day: 1, current_question_index: 0 });
                    await sendNextQuizQuestion(userId);
                }
            }
        }
        return res.send("OK");
    }

    // Process callback query (inline button interaction)
    if (update.callback_query) {
        const callbackQuery = update.callback_query;
        const callbackData = callbackQuery.data || "";
        const callbackQueryId = callbackQuery.id;
        const adminChatId = callbackQuery.message.chat.id;
        const adminMessageId = callbackQuery.message.message_id;
        
        if (callbackData.startsWith("lang:")) {
            const lang = callbackData.split(":")[1];
            const chatId = callbackQuery.message.chat.id;
            
            await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId });
            await sendTelegramRequest("editMessageReplyMarkup", {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                reply_markup: { inline_keyboard: [] }
            });
            
            const reg = await db.getRegistration(chatId);
            if (!reg) {
                await db.upsertRegistration(chatId, {
                    step: buildStep(lang, "awaiting_name"),
                    status: "started",
                    name: "",
                    phone: "",
                    receipt_number: ""
                });
                await sendTelegramRequest("sendMessage", {
                    chat_id: chatId,
                    text: getMsg(lang, "ask_name"),
                    parse_mode: "Markdown",
                    reply_markup: getMenuKeyboard(lang)
                });
            } else {
                const status = reg.status;
                const [, currentStep] = getLangAndStep(reg);
                
                await db.upsertRegistration(chatId, { step: buildStep(lang, currentStep) });
                
                if (status === "declined") {
                    await db.upsertRegistration(chatId, { step: buildStep(lang, "awaiting_name"), status: "started" });
                    await sendTelegramRequest("sendMessage", {
                        chat_id: chatId,
                        text: getMsg(lang, "ask_name"),
                        parse_mode: "Markdown",
                        reply_markup: getMenuKeyboard(lang)
                    });
                } else if (currentStep.includes("completed") || ["approved", "pending"].includes(status)) {
                    await sendTelegramRequest("sendMessage", {
                        chat_id: chatId,
                        text: getMsg(lang, "already_registered"),
                        reply_markup: getMenuKeyboard(lang)
                    });
                } else if (currentStep === "start") {
                    await db.upsertRegistration(chatId, { step: buildStep(lang, "awaiting_name") });
                    await sendTelegramRequest("sendMessage", {
                        chat_id: chatId,
                        text: getMsg(lang, "ask_name"),
                        parse_mode: "Markdown",
                        reply_markup: getMenuKeyboard(lang)
                    });
                } else {
                    if (currentStep === "awaiting_name") {
                        await sendTelegramRequest("sendMessage", {
                            chat_id: chatId,
                            text: getMsg(lang, "ask_name"),
                            parse_mode: "Markdown",
                            reply_markup: getMenuKeyboard(lang)
                        });
                    } else if (currentStep === "awaiting_phone") {
                        const keyboard = {
                            keyboard: [[{
                                text: getMsg(lang, "btn_share_contact"),
                                request_contact: true
                            }]],
                            one_time_keyboard: true,
                            resize_keyboard: true
                        };
                        await sendTelegramRequest("sendMessage", {
                            chat_id: chatId,
                            text: getMsg(lang, "ask_phone"),
                            parse_mode: "Markdown",
                            reply_markup: keyboard
                        });
                    } else if (currentStep === "awaiting_payment_method") {
                        const msg = getMsg(lang, "ask_payment_method");
                        const kb = {
                            inline_keyboard: [
                                [{ text: getMsg(lang, "btn_telebirr"), callback_data: "pay_telebirr" }, { text: getMsg(lang, "btn_cbe"), callback_data: "pay_cbe" }]
                            ]
                        };
                        await sendTelegramRequest("sendMessage", {
                            chat_id: chatId,
                            text: msg,
                            reply_markup: kb
                        });
                    } else if (currentStep.startsWith("awaiting_receipt")) {
                        const settings = await db.getPaymentSettings();
                        const amount = settings.amount || "500";
                        let msg;
                        if (currentStep.includes("telebirr")) {
                            const accName = settings.telebirr_name || "Craftopia School";
                            const accNum = settings.telebirr_number || "0911223344";
                            msg = getMsg(lang, "telebirr_payment_instructions").replace("{amount}", amount).replace("{acc_name}", accName).replace("{acc_num}", accNum);
                        } else {
                            const accName = settings.cbe_name || "Craftopia Hand Craft";
                            const accNum = settings.cbe_number || "1000123456789";
                            msg = getMsg(lang, "cbe_payment_instructions").replace("{amount}", amount).replace("{acc_name}", accName).replace("{acc_num}", accNum);
                        }
                        await sendTelegramRequest("sendMessage", {
                            chat_id: chatId,
                            text: msg,
                            parse_mode: "Markdown"
                        });
                    } else {
                        let successMsg = "Language updated successfully!";
                        if (lang === "am") successMsg = "ቋንቋው በተሳካ ሁኔታ ተቀይሯል!";
                        else if (lang === "om" || lang === "or") successMsg = "Afaan keessan sirriitti jijjiirameera!";
                        else if (lang === "ti" || lang === "tg") successMsg = "ቋንቋኹም ብዓወት ተቐይሩ ኣሎ!";
                        await sendTelegramRequest("sendMessage", {
                            chat_id: chatId,
                            text: successMsg,
                            reply_markup: getMenuKeyboard(lang)
                        });
                    }
                }
            }
            return res.send("OK");
        }

        if (callbackData.startsWith("approve:") || callbackData.startsWith("decline:")) {
            const [action, regId] = callbackData.split(":");
            const reg = await db.getRegistrationById(regId);
            if (!reg) {
                await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: "Registration not found." });
                return res.send("OK");
            }
                
            if (reg.status !== "pending") {
                await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: `Already processed: ${reg.status}` });
                return res.send("OK");
            }
                
            if (action === "approve") {
                try {
                    const [lang] = getLangAndStep(reg);
                    const inviteLink = await generateApprovedInviteLinks(reg.name, lang);
                    await db.updateRegistrationStatus(regId, "approved", inviteLink);
                    
                    // Trigger referral reward check
                    if (reg.referred_by_chat_id) {
                        await checkAndApplyReferralReward(reg.referred_by_chat_id);
                    }
                    
                    const msg = getMsg(lang, "receipt_approved_msg")
                        .replace("{name}", reg.name)
                        .replace("{receipt}", reg.receipt_number)
                        .replace("{link}", formatInviteLinksForUser(inviteLink, lang));
                    await sendTelegramRequest("sendMessage", {
                        chat_id: reg.chat_id,
                        text: msg,
                        parse_mode: "Markdown",
                        reply_markup: getMenuKeyboard(lang)
                    });
                    
                    // Trigger Day 1 quiz immediately upon approval
                    try {
                        const prog = await db.getUserQuizProgress(reg.chat_id);
                        if (!prog) {
                            await db.upsertUserQuizProgress(reg.chat_id, { joined_channel: true, current_day: 1, current_question_index: 0 });
                            await sendNextQuizQuestion(reg.chat_id);
                        }
                    } catch (err) {
                        console.error("Error triggering day 1 quiz on inline approve:", err.message);
                    }
                    
                    const links = inviteLink.trim().split(/\s+/);
                    const newText = `Approved ✅\n\nName: ${reg.name}\nPhone: ${reg.phone}\nReceipt: ${reg.receipt_number}\nMain Channel: ${links[0] || "-"}`;
                    const isPhoto = callbackQuery.message && callbackQuery.message.photo;
                    const editMethod = isPhoto ? "editMessageCaption" : "editMessageText";
                    const payload = {
                        chat_id: adminChatId,
                        message_id: adminMessageId,
                        reply_markup: { inline_keyboard: [] }
                    };
                    if (isPhoto) payload.caption = newText;
                    else payload.text = newText;
                    
                    await sendTelegramRequest(editMethod, payload);
                    await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: "Approved successfully!" });
                } catch (err) {
                    console.error("Error during callback approve:", err.message);
                    await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: `Failed: ${err.message}` });
                }
            } else if (action === "decline") {
                const reasonKb = {
                    inline_keyboard: [
                        [{ text: "Fake Receipt", callback_data: `dreason:${regId}:Fake Receipt` }],
                        [{ text: "Duplicate", callback_data: `dreason:${regId}:Duplicate` }],
                        [{ text: "Invalid Details", callback_data: `dreason:${regId}:Invalid Details` }],
                        [{ text: "Cancel", callback_data: `cancel_decline:${regId}` }]
                    ]
                };
                await sendTelegramRequest("editMessageReplyMarkup", {
                    chat_id: adminChatId,
                    message_id: adminMessageId,
                    reply_markup: reasonKb
                });
                await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId });
            }
        } else if (callbackData.startsWith("cancel_decline:")) {
            const regId = callbackData.split(":")[1];
            const originalKb = {
                inline_keyboard: [
                    [
                        { text: "Approve ✅", callback_data: `approve:${regId}` },
                        { text: "Decline ❌", callback_data: `decline:${regId}` }
                    ]
                ]
            };
            await sendTelegramRequest("editMessageReplyMarkup", {
                chat_id: adminChatId,
                message_id: adminMessageId,
                reply_markup: originalKb
            });
            await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId });
        } else if (callbackData.startsWith("dreason:")) {
            const [, regId, reason] = callbackData.split(":");
            const reg = await db.getRegistrationById(regId);
            if (!reg || reg.status !== "pending") {
                await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: "Registration not pending or not found." });
                return res.send("OK");
            }
                
            await db.updateRegistrationStatus(regId, "declined", null, reason);
            
            const [lang] = getLangAndStep(reg);
            let translatedReason = reason;
            if (lang === "am") {
                if (reason === "Fake Receipt") translatedReason = "ሐሰተኛ ደረሰኝ";
                else if (reason === "Duplicate") translatedReason = "የተደገመ ደረሰኝ";
                else if (reason === "Invalid Details") translatedReason = "የተሳሳተ መረጃ";
            } else if (lang === "om" || lang === "or") {
                if (reason === "Fake Receipt") translatedReason = "Nagahee Kijibaa";
                else if (reason === "Duplicate") translatedReason = "Nagahee Dachaa";
                else if (reason === "Invalid Details") translatedReason = "Odeeffannoo Dogoggoraa";
            } else if (reason && (lang === "ti" || lang === "tg")) {
                if (reason === "Fake Receipt") translatedReason = "ሓሶት ደረሰኝ";
                else if (reason === "Duplicate") translatedReason = "ዝተደገመ ደረሰኝ";
                else if (reason === "Invalid Details") translatedReason = "ዘይተረጋገጸ ሓበሬታ";
            }
            
            const msg = getMsg(lang, "receipt_declined_msg")
                .replace("{name}", reg.name)
                .replace("{receipt}", reg.receipt_number)
                .replace("{reason}", translatedReason);
            await sendTelegramRequest("sendMessage", {
                chat_id: reg.chat_id,
                text: msg,
                parse_mode: "Markdown",
                reply_markup: getMenuKeyboard(lang)
            });
            
            const newText = `Declined ❌\n\nName: ${reg.name}\nPhone: ${reg.phone}\nReceipt: ${reg.receipt_number}\nReason: ${reason}`;
            const isPhoto = callbackQuery.message && callbackQuery.message.photo;
            const editMethod = isPhoto ? "editMessageCaption" : "editMessageText";
            const payload = {
                chat_id: adminChatId,
                message_id: adminMessageId,
                reply_markup: { inline_keyboard: [] }
            };
            if (isPhoto) payload.caption = newText;
            else payload.text = newText;
            
            await sendTelegramRequest(editMethod, payload);
            await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: "Declined successfully." });
        } else if (callbackData.startsWith("ans:")) {
            const [, qId, optIdxStr] = callbackData.split(":");
            const optIdx = parseInt(optIdxStr);
            const chatId = callbackQuery.message.chat.id;
            
            const prog = await db.getUserQuizProgress(chatId);
            if (!prog) {
                await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: "Session expired." });
                return res.send("OK");
            }
                
            const day = prog.current_day || 1;
            const qIndex = prog.current_question_index || 0;
            const questions = await db.getQuestionsByDay(day);
            
            if (qIndex >= questions.length || questions[qIndex].id !== qId) {
                await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: "Question expired or already answered." });
                return res.send("OK");
            }
                
            const q = questions[qIndex];
            const isCorrect = (optIdx === q.correct_option_index);
            
            if (isCorrect) {
                await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: "Correct! \u2705", show_alert: true });
                await db.upsertUserQuizProgress(chatId, { current_question_index: qIndex + 1 });
                
                await sendTelegramRequest("editMessageReplyMarkup", {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id,
                    reply_markup: { inline_keyboard: [] }
                });
                
                await sendNextQuizQuestion(chatId);
            } else {
                await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: "Incorrect! Try again ❌", show_alert: true });
            }
        } else if (callbackData.startsWith("start_day:")) {
            const targetDay = parseInt(callbackData.split(":")[1]);
            const chatId = callbackQuery.message.chat.id;
            
            const prog = await db.getUserQuizProgress(chatId);
            if (!prog) return res.send("OK");
                
            const lastCompleted = prog.last_completed_at;
            if (lastCompleted) {
                const lastDt = parseIsoDatetime(lastCompleted);
                if (lastDt) {
                    const now = new Date();
                    if (lastDt.toDateString() === now.toDateString()) {
                        await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: `Please wait until tomorrow to start the next day!`, show_alert: true });
                        return res.send("OK");
                    }
                }
            }
            
            await db.upsertUserQuizProgress(chatId, { current_day: targetDay, current_question_index: 0 });
            await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId });
            
            await sendTelegramRequest("editMessageReplyMarkup", {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                reply_markup: { inline_keyboard: [] }
            });
            await sendNextQuizQuestion(chatId);
        } else if (["pay_telebirr", "pay_cbe"].includes(callbackData)) {
            const chatId = callbackQuery.message.chat.id;
            await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId });
            
            let reg = await db.getRegistration(chatId);
            const [lang, currentStep] = getLangAndStep(reg);
            
            await sendTelegramRequest("editMessageReplyMarkup", {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                reply_markup: { inline_keyboard: [] }
            });
            
            reg = await db.getRegistration(chatId);
            if (reg && reg.step.includes("awaiting_payment_method")) {
                const settings = await db.getPaymentSettings();
                const amount = settings.amount || "500";
                
                let msg;
                if (callbackData === "pay_telebirr") {
                    const accName = settings.telebirr_name || "Craftopia School";
                    const accNum = settings.telebirr_number || "0911223344";
                    msg = getMsg(lang, "telebirr_payment_instructions").replace("{amount}", amount).replace("{acc_name}", accName).replace("{acc_num}", accNum);
                    await db.upsertRegistration(chatId, { step: buildStep(lang, "awaiting_receipt_telebirr") });
                } else {
                    const accName = settings.cbe_name || "Craftopia Hand Craft";
                    const accNum = settings.cbe_number || "1000123456789";
                    msg = getMsg(lang, "cbe_payment_instructions").replace("{amount}", amount).replace("{acc_name}", accName).replace("{acc_num}", accNum);
                    await db.upsertRegistration(chatId, { step: buildStep(lang, "awaiting_receipt_cbe") });
                }
                
                await sendTelegramRequest("sendMessage", {
                    chat_id: chatId,
                    text: msg,
                    parse_mode: "Markdown"
                });
            }
        } else if (callbackData === "get_certificate") {
            const chatId = callbackQuery.message.chat.id;
            await sendTelegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: "Generating certificate, please wait..." });
            
            await sendTelegramRequest("editMessageReplyMarkup", {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                reply_markup: { inline_keyboard: [] }
            });
            
            const reg = await db.getRegistration(chatId);
            const name = reg ? (reg.name || "Student") : "Student";
            const regDateStr = reg ? (reg.created_at || "") : "";
            
            let regDate = "Unknown";
            if (regDateStr) {
                try { regDate = regDateStr.split("T")[0]; } catch (e) { /* ignore */ }
            }
            const finishDate = new Date().toISOString().split("T")[0];
            
            const [lang] = getLangAndStep(reg);
            const caption = getMsg(lang, "course_completed_msg").replace("{name}", name);
            
            try {
                const pdfBytes = await generateCertificatePdf(name, regDate, finishDate);
                
                const FormData = require('form-data');
                const form = new FormData();
                form.append('chat_id', chatId);
                form.append('caption', caption);
                form.append('parse_mode', 'Markdown');
                form.append('document', pdfBytes, {
                    filename: 'Certificate.pdf',
                    contentType: 'application/pdf'
                });
                
                const url = `${TELEGRAM_API_URL}/sendDocument`;
                await axios.post(url, form, { headers: form.getHeaders() });
            } catch (e) {
                console.error("Error generating/sending PDF:", e.message);
                await sendTelegramRequest("sendMessage", {
                    chat_id: chatId,
                    text: `Sorry, there was an error generating your certificate. Error details: ${e.message}\nPlease try again later.`,
                    reply_markup: { inline_keyboard: [[{ text: "Try Again 🔄", callback_data: "get_certificate" }]] }
                });
            }
        }
        return res.send("OK");
    }

    if (!update.message) return res.send("OK");

    const message = update.message;
    
    // Ignore messages from groups or channels (bot is only used to generate links)
    if (message.chat && message.chat.type !== "private") {
        return res.send("OK");
    }
    const chatId = message.chat.id;
    const text = (message.text || "").trim();
    const contact = message.contact;

    // Admin linkage authentication interceptor
    if (text.toLowerCase().startsWith("/auth")) {
        const parts = text.split(/\s+/);
        if (parts.length >= 3 && parts.length <= 4) {
            const authUser = parts[1];
            const authPass = parts[2];
            
            const adminRec = await db.getAdmin(authUser);
            if (adminRec && adminRec.password === authPass) {
                if (parts.length === 3) {
                    // Direct linkage without link-code (for initial bootstrap/setup)
                    await db.linkAdminChat(authUser, chatId);
                    
                    await sendTelegramRequest("sendMessage", {
                        chat_id: chatId,
                        text: (
                            `✅ **Authentication & Linkage Successful!**\n\n` +
                            `Your Telegram account (Chat ID: \`${chatId}\`) has been linked to the admin account **${authUser}**.\n\n` +
                            `You will now receive login verification codes and webhook notifications here.`
                        ),
                        parse_mode: "Markdown"
                    });
                    return res.send("OK");
                } else {
                    // With link code
                    const authCode = parts[3].trim().toUpperCase();
                    const savedCode = adminRec.verification_code ? adminRec.verification_code.trim().toUpperCase() : null;
                    const expiryStr = adminRec.code_expires_at;
                    
                    if (savedCode && savedCode === authCode) {
                        const now = new Date();
                        const expiry = expiryStr ? new Date(expiryStr) : null;
                        if (!expiry || now <= expiry) {
                            // Success! Link chat
                            await db.linkAdminChat(authUser, chatId);
                            await db.setAdminVerificationCode(authUser, null, null);
                            
                            await sendTelegramRequest("sendMessage", {
                                chat_id: chatId,
                                text: (
                                    `✅ **Authentication & Linkage Successful!**\n\n` +
                                    `Your Telegram account (Chat ID: \`${chatId}\`) has been linked to the admin account **${authUser}**.\n\n` +
                                    `You will now receive login verification codes and webhook notifications here.`
                                ),
                                parse_mode: "Markdown"
                            });
                            return res.send("OK");
                        } else {
                            await sendTelegramRequest("sendMessage", {
                                chat_id: chatId,
                                text: `❌ **Authentication Failed**: The verification code has expired. Please generate a new one from the admin panel.`
                            });
                            return res.send("OK");
                        }
                    } else {
                        await sendTelegramRequest("sendMessage", {
                            chat_id: chatId,
                            text: `❌ **Authentication Failed**: Invalid verification code. (Expected: '${savedCode}', Got: '${authCode}')`
                        });
                        return res.send("OK");
                    }
                }
            } else {
                await sendTelegramRequest("sendMessage", {
                    chat_id: chatId,
                    text: `❌ **Authentication Failed**: Invalid username or password.`
                });
                return res.send("OK");
            }
        } else {
            await sendTelegramRequest("sendMessage", {
                chat_id: chatId,
                text: `ℹ️ **Usage**: Send \`/auth <username> <password>\` or \`/auth <username> <password> <link-code>\` to link your admin account.`
            });
            return res.send("OK");
        }
    }

    const reg = await db.getRegistration(chatId);
    if (reg && reg.status === "approved" && reg.expires_at) {
        const now = new Date();
        const expiry = new Date(reg.expires_at);
        if (now > expiry) {
            console.log(`[Expiration Trigger] User ${chatId} has expired. Expiry: ${reg.expires_at}`);
            await db.updateRegistrationStatus(reg.id, "expired");
            await kickUserFromChannel(chatId);
            const [lang] = getLangAndStep(reg);
            const msg = getMsg(lang, "access_expired_msg");
            await sendTelegramRequest("sendMessage", { chat_id: chatId, text: msg });
            return res.send("OK");
        }
    }
    const [lang, currentStep] = getLangAndStep(reg);

    // Common menu commands
    if (isMenuCommand(text, "menu_change_language") || text === "/language") {
        const msg = getMsg(lang, "welcome_choose_lang");
        await sendTelegramRequest("sendMessage", {
            chat_id: chatId,
            text: msg,
            reply_markup: await getLanguageKeyboard()
        });
        return res.send("OK");
    }

    if (isMenuCommand(text, "menu_refer_friend") || text === "/refer") {
        const botUser = await getBotUsername();
        const refLink = `https://t.me/${botUser}?start=ref_${chatId}`;
        const msg = getMsg(lang, "referral_message").replace("{ref_link}", refLink);
        await sendTelegramRequest("sendMessage", {
            chat_id: chatId,
            text: msg,
            parse_mode: "Markdown",
            reply_markup: getMenuKeyboard(lang)
        });
        return res.send("OK");
    }

    if (isMenuCommand(text, "menu_check_status") || text === "/status") {
        if (!reg || ((!reg.step || !reg.step.includes("completed")) && !["approved", "pending", "declined"].includes(reg.status))) {
            await sendTelegramRequest("sendMessage", {
                chat_id: chatId,
                text: getMsg(lang, "no_receipt_yet"),
                reply_markup: getMenuKeyboard(lang)
            });
            return res.send("OK");
        }
            
        const status = reg.status || "pending";
        const receipt = reg.receipt_number || "Unknown";
        let msg;
        if (status === "approved") {
            const link = formatInviteLinksForUser(reg.invite_link, lang);
            msg = getMsg(lang, "status_approved_msg").replace("{receipt}", receipt).replace("{link}", link);
        } else if (status === "declined") {
            const reason = reg.rejection_reason || getMsg(lang, "default_decline_reason");
            msg = getMsg(lang, "status_declined_msg").replace("{receipt}", receipt).replace("{reason}", reason);
        } else {
            msg = getMsg(lang, "status_pending_msg").replace("{receipt}", receipt);
        }
            
        await sendTelegramRequest("sendMessage", {
            chat_id: chatId,
            text: msg,
            parse_mode: "Markdown",
            reply_markup: getMenuKeyboard(lang)
        });
        return res.send("OK");
    }

    if (text === "/help") {
        const msg = getMsg(lang, "help_instructions");
        await sendTelegramRequest("sendMessage", {
            chat_id: chatId,
            text: msg,
            parse_mode: "Markdown",
            reply_markup: getMenuKeyboard(lang)
        });
        return res.send("OK");
    }

    // Step 2: Start / Referral / Submit Receipt trigger
    if (text.startsWith("/start") || isMenuCommand(text, "menu_submit_receipt") || text === "/submit") {
        if (reg) {
            const status = reg.status;
            if (isMenuCommand(text, "menu_submit_receipt") || text === "/submit") {
                if (["approved", "declined"].includes(status)) {
                    await db.upsertRegistration(chatId, {
                        name: reg.name,
                        phone: reg.phone,
                        step: buildStep(lang, "awaiting_payment_method"),
                        status: "started"
                    });
                    
                    const msg = getMsg(lang, "ready_new_receipt");
                    const kb = {
                        inline_keyboard: [
                            [{ text: getMsg(lang, "btn_telebirr"), callback_data: "pay_telebirr" }, { text: getMsg(lang, "btn_cbe"), callback_data: "pay_cbe" }]
                        ]
                    };
                    await sendTelegramRequest("sendMessage", {
                        chat_id: chatId,
                        text: msg,
                        reply_markup: kb
                    });
                    return res.send("OK");
                } else if (status === "pending") {
                    await sendTelegramRequest("sendMessage", {
                        chat_id: chatId,
                        text: getMsg(lang, "already_pending")
                    });
                    return res.send("OK");
                }
            } else if (text.startsWith("/start")) {
                if ((reg.step && reg.step.includes("completed")) || ["approved", "pending"].includes(status)) {
                    await sendTelegramRequest("sendMessage", {
                        chat_id: chatId,
                        text: getMsg(lang, "already_registered"),
                        reply_markup: getMenuKeyboard(lang)
                    });
                    return res.send("OK");
                }
            }
        }

        // Referral extraction
        let referredBy = null;
        const parts = text.split(" ");
        if (parts.length > 1 && parts[1].startsWith("ref_")) {
            try {
                const inviterId = parseInt(parts[1].replace("ref_", ""));
                if (inviterId !== chatId) {
                    referredBy = inviterId;
                }
            } catch (e) {
                // ignore
            }
        }
                
        await db.upsertRegistration(chatId, {
            step: "start",
            status: "started",
            name: "",
            phone: "",
            receipt_number: "",
            referred_by_chat_id: referredBy
        });
        
        const msg = getMsg("en", "welcome_choose_lang");
        await sendTelegramRequest("sendMessage", {
            chat_id: chatId,
            text: msg,
            reply_markup: await getLanguageKeyboard()
        });
        return res.send("OK");
    }

    if (!reg) {
        await sendTelegramRequest("sendMessage", {
            chat_id: chatId,
            text: getMsg(lang, "no_receipt_yet")
        });
        return res.send("OK");
    }

    // Step progression state machine
    if (currentStep === "awaiting_name") {
        if (!text) {
            await sendTelegramRequest("sendMessage", {
                chat_id: chatId,
                text: getMsg(lang, "invalid_name")
            });
            return res.send("OK");
        }
            
        await db.upsertRegistration(chatId, { name: text, step: buildStep(lang, "awaiting_phone") });
        const keyboard = {
            keyboard: [[{
                text: getMsg(lang, "btn_share_contact"),
                request_contact: true
            }]],
            one_time_keyboard: true,
            resize_keyboard: true
        };
        const welcomePrefix = getMsg(lang, "welcome_name_prefix").replace("{name}", text);
        await sendTelegramRequest("sendMessage", {
            chat_id: chatId,
            text: welcomePrefix + getMsg(lang, "ask_phone"),
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
        return res.send("OK");
    }

    if (currentStep === "awaiting_phone") {
        let phone = null;
        if (contact) {
            phone = contact.phone_number;
        } else if (text) {
            phone = text;
        }
            
        if (!phone) {
            await sendTelegramRequest("sendMessage", {
                chat_id: chatId,
                text: getMsg(lang, "invalid_phone")
            });
            return res.send("OK");
        }
            
        const existing = await db.getRegistrationByPhone(phone);
        if (existing && existing.chat_id !== chatId) {
            await sendTelegramRequest("sendMessage", {
                chat_id: chatId,
                text: getMsg(lang, "duplicate_phone")
            });
            return res.send("OK");
        }
            
        await db.upsertRegistration(chatId, { phone: phone, step: buildStep(lang, "awaiting_payment_method") });
        
        const msg = `${getMsg(lang, "phone_saved")}\n\n${getMsg(lang, "ask_payment_method")}`;
        const kb = {
            inline_keyboard: [
                [{ text: getMsg(lang, "btn_telebirr"), callback_data: "pay_telebirr" }, { text: getMsg(lang, "btn_cbe"), callback_data: "pay_cbe" }]
            ]
        };
        await sendTelegramRequest("sendMessage", {
            chat_id: chatId,
            text: msg,
            reply_markup: kb
        });
        return res.send("OK");
    }

    if (currentStep === "awaiting_payment_method") {
        await sendTelegramRequest("sendMessage", {
            chat_id: chatId,
            text: getMsg(lang, "select_payment_method_first")
        });
        return res.send("OK");
    }

    if (currentStep && currentStep.startsWith("awaiting_receipt")) {
        const photo = message.photo;
        const caption = (message.caption || "").trim();
        
        let receiptNum = text;
        let receiptImg = null;
        
        if (photo || message.photo_url) {
            if (message.photo_url) {
                receiptImg = message.photo_url;
                receiptNum = caption || `Sim_REC_${Math.floor(Date.now() / 1000)}`;
            } else {
                const largestPhoto = photo[photo.length - 1];
                const fileId = largestPhoto.file_id;
                
                try {
                    const fileInfo = await sendTelegramRequest("getFile", { file_id: fileId });
                    if (fileInfo && fileInfo.ok && fileInfo.result && fileInfo.result.file_path) {
                        const filePath = fileInfo.result.file_path;
                        const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
                        
                        const imgRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
                        const fileBytes = Buffer.from(imgRes.data, 'binary');
                        const fileName = `${chatId}_${Math.floor(Date.now() / 1000)}.jpg`;
                        const storageUrl = `${SUPABASE_URL}/storage/v1/object/receipts/${fileName}`;
                        
                        const uploadRes = await axios.post(storageUrl, fileBytes, {
                            headers: {
                                "apikey": SUPABASE_KEY,
                                "Authorization": `Bearer ${SUPABASE_KEY}`,
                                "Content-Type": "image/jpeg"
                            }
                        });
                        
                        if (uploadRes.status === 200 || uploadRes.status === 201) {
                            receiptImg = `${SUPABASE_URL}/storage/v1/object/public/receipts/${fileName}`;
                            receiptNum = caption || `Img_${Math.floor(Date.now() / 1000)}`;
                        } else {
                            console.error("Supabase storage upload failed:", uploadRes.data);
                        }
                    } else {
                        throw new Error("Telegram file_path not available offline");
                    }
                } catch (e) {
                    console.error("Error processing image upload, using offline fallback:", e.message);
                    receiptImg = fileId;
                    receiptNum = caption || `Img_REC_${Math.floor(Math.random() * 900000) + 100000}`;
                }
            }
            
            if (!receiptImg) {
                const errMsg = getMsg(lang, "err_failed_upload");
                await sendTelegramRequest("sendMessage", {
                    chat_id: chatId,
                    text: errMsg
                });
                return res.send("OK");
            }
        }

        if (!photo && !message.photo_url) {
            const errMsg = getMsg(lang, "err_upload_receipt_only");
            await sendTelegramRequest("sendMessage", {
                chat_id: chatId,
                text: errMsg
            });
            return res.send("OK");
        }

            
        const paymentMethod = currentStep.includes("telebirr") ? "Telebirr" : (currentStep.includes("cbe") ? "CBE" : "Unknown");
        await db.upsertRegistration(chatId, {
            receipt_number: receiptNum,
            receipt_image_url: receiptImg,
            payment_method: paymentMethod,
            step: buildStep(lang, "completed"),
            status: "pending"
        });
        
        // Trigger referral reward check
        const currentReg = await db.getRegistration(chatId);
        if (currentReg && currentReg.referred_by_chat_id) {
            await checkAndApplyReferralReward(currentReg.referred_by_chat_id);
        }
        
        const msg = getMsg(lang, "registration_submitted");
        await sendTelegramRequest("sendMessage", {
            chat_id: chatId,
            text: msg,
            parse_mode: "Markdown",
            reply_markup: getMenuKeyboard(lang)
        });
        
        // Notify Admin
        let adminChat = null;
        const adminRec = await db.getAdmin(ADMIN_USERNAME);
        if (adminRec) {
            adminChat = adminRec.telegram_chat_id;
        }
        if (!adminChat) {
            adminChat = ADMIN_CHAT_ID || process.env.ADMIN_CHAT_ID;
        }
            
        if (adminChat) {
            const updatedReg = await db.getRegistration(chatId);
            const regId = updatedReg.id;
            const payMethod = updatedReg.payment_method || "Unknown";
            const recNum = updatedReg.receipt_number || "-";
            const imgUrl = updatedReg.receipt_image_url;
            
            const captionText = `🔔 **New Receipt Submitted!**\n\n👤 **Name**: ${updatedReg.name}\n📞 **Phone**: ${updatedReg.phone}\n💳 **Payment**: ${payMethod}\n🧾 **Receipt**: \`${recNum}\``;
            
            const adminKb = {
                inline_keyboard: [
                    [
                        { text: "Approve ✅", callback_data: `approve:${regId}` },
                        { text: "Decline ❌", callback_data: `decline:${regId}` }
                    ]
                ]
            };
            
            if (imgUrl) {
                await sendTelegramRequest("sendPhoto", {
                    chat_id: adminChat,
                    photo: imgUrl,
                    caption: captionText,
                    parse_mode: "Markdown",
                    reply_markup: adminKb
                });
            } else {
                await sendTelegramRequest("sendMessage", {
                    chat_id: adminChat,
                    text: captionText,
                    parse_mode: "Markdown",
                    reply_markup: adminKb
                });
            }
        }
        return res.send("OK");
    }

    // Default step fallbacks
    const status = reg.status;
    let msg;
    if (status === "approved") {
        const link = formatInviteLinksForUser(reg.invite_link, lang);
        msg = getMsg(lang, "last_approved_msg").replace("{link}", link);
    } else if (status === "declined") {
        msg = getMsg(lang, "last_declined_msg");
    } else {
        msg = getMsg(lang, "last_pending_msg");
    }
        
    await sendTelegramRequest("sendMessage", {
        chat_id: chatId,
        text: msg,
        reply_markup: getMenuKeyboard(lang)
    });
    
    return res.send("OK");
});

// Setup Telegram Bot Webhook URL dynamically based on the current host domain
app.get('/api/bot/setup', async (req, res) => {
    try {
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const webhookUrl = `${protocol}://${host}/api/bot`;
        
        console.log(`Setting Telegram webhook to: ${webhookUrl}`);
        const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`, {
            url: webhookUrl,
            allowed_updates: ["message", "callback_query", "chat_member"]
        });
        
        return res.json({
            success: true,
            message: "Telegram webhook set up successfully!",
            webhook_url: webhookUrl,
            telegram_response: response.data
        });
    } catch (err) {
        console.error("Failed to set up Telegram webhook:", err.message);
        return res.status(500).json({
            success: false,
            error: err.message,
            telegram_token_redacted: TELEGRAM_TOKEN.substring(0, 6) + "..."
        });
    }
});

// Catch-all route to serve the SPA frontend correctly or return status
app.get('/*path', (req, res) => {
    // If not matching static resources, return index.html for browser routes
    const ext = path.extname(req.path);
    if (!ext) {
        return res.sendFile(path.join(BASE_DIR, 'index.html'));
    }
    return res.status(404).send("Not Found");
});

async function startLongPolling(port) {
    console.log("[Telegram Bot] Starting local long polling loop...");
    
    // Attempt to delete webhook so Telegram allows getUpdates polling
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteWebhook`, { drop_pending_updates: true });
        console.log("[Telegram Bot] Webhook deleted successfully. Ready for local updates.");
    } catch (e) {
        console.log("[Telegram Bot] Warning: could not delete webhook (offline or invalid token).");
    }
    
    let offset = 0;
    while (true) {
        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`;
            const response = await axios.post(url, {
                offset: offset,
                timeout: 30,
                allowed_updates: ["message", "callback_query", "chat_member"]
            });
            
            if (response.data && response.data.ok) {
                const updates = response.data.result;
                for (const update of updates) {
                    offset = update.update_id + 1;
                    
                    // Post the update to the local Express server webhook endpoint
                    try {
                        await axios.post(`http://localhost:${port}/api/bot`, update);
                    } catch (err) {
                        console.error("[Telegram Bot] Error forwarding update locally:", err.message);
                    }
                }
            }
        } catch (e) {
            // Log error and sleep 5s before retrying to prevent hot loops
            console.error("[Telegram Bot] Long polling error:", e.message);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running locally on http://localhost:${PORT}`);
        if (process.env.RUN_BOT_LOCALLY === "true") {
            startLongPolling(PORT);
        } else {
            console.log("[Telegram Bot] Local long polling is disabled. Running in Supabase Edge Function only mode.");
        }
    });
}

// Prevent unhandled rejections from crashing the serverless function
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err);
});

// Health check / diagnostic route
app.get('/health', (req, res) => {
    res.json({ status: 'ok', env: process.env.VERCEL ? 'vercel' : 'local', node: process.version });
});

// Fallback HTML routes — safe sendFile with error callback
app.get('/admin', (req, res) => {
    const p = path.join(BASE_DIR, 'public', 'dashboard.html');
    res.sendFile(p, (err) => {
        if (err && !res.headersSent) res.status(404).send('Dashboard not found');
    });
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

// TEMPORARY WEBHOOK FIXER
app.get('/api/admin/set-webhook', async (req, res) => {
    res.json({ success: true, env: process.env });
});

app.get('/api/certificate', async (req, res) => {
    const chatId = req.query.id;
    if (!chatId) return res.status(400).send("Missing ID");
    
    const db = require('./db');
    const reg = await db.getRegistration(chatId);
    if (!reg) return res.status(404).send("Registration not found");
    
    const name = reg.name || "Student";
    const finishDate = new Date().toISOString().split("T")[0];
    
    const fs = require('fs');
    const path = require('path');
    const settings = await db.getPaymentSettings();

    const templatePath = path.join(__dirname, 'IMG_6757.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    const programAm  = settings.cert_program_am  || "እደጥበብ";
    const programEn  = settings.cert_program_en  || "Hand Craft & Art";
    const durationAm = settings.cert_duration_am || "4";
    const durationEn = settings.cert_duration_en || "4";
    const signatureBase64 = settings.signature_base64 || "";

    const logoPath = path.join(__dirname, 'IMG_0892.PNG');
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
        logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath, 'base64');
    }
    html = html.replace('C:\\Users\\Administrator\\Desktop\\Projects\\craftopia\\IMG_0892.PNG', logoBase64);

    html = html.replace(
        '<div class="fill-blank-line" style="width: 88%; margin-left: 10px;"></div>',
        `<div class="fill-blank-line" style="width: 88%; margin-left: 10px; text-align: center; font-weight: bold; font-size: 16px;">${name}</div>`
    );
    html = html.replace(
        '<div class="fill-blank-line" style="width: 90%; margin-left: 10px;"></div>',
        `<div class="fill-blank-line" style="width: 90%; margin-left: 10px; text-align: center; font-weight: bold; font-size: 16px;">${name}</div>`
    );
    html = html.replace(
        '<div class="dotted-blank-line" style="width: 95px;"></div>',
        `<div class="dotted-blank-line" style="width: 95px; text-align: center; font-weight: bold;">${durationAm}</div>`
    );
    html = html.replace(
        '<div class="dotted-blank-line" style="width: 185px;"></div>',
        `<div class="dotted-blank-line" style="width: 185px; text-align: center; font-weight: bold;">${programAm}</div>`
    );
    html = html.replace(
        'PROGRAM IN<div class="dotted-blank-line" style="width: 200px;"></div> AT CRAFTOPIA.',
        `PROGRAM IN <div class="dotted-blank-line" style="width: 200px; text-align: center; font-weight: bold;">${programEn}</div> AT CRAFTOPIA.`
    );
    html = html.replace(
        'THE TRAINING WAS CONDUCTED FOR<div class="dotted-blank-line" style="width: 95px;"></div>WEEK.',
        `THE TRAINING WAS CONDUCTED FOR <div class="dotted-blank-line" style="width: 95px; text-align: center; font-weight: bold;">${durationEn}</div> WEEK.`
    );
    html = html.replace(
        'ቀን <div class="dotted-blank-line" style="width: 165px;"></div> ዓ.ም',
        `ቀን <div class="dotted-blank-line" style="width: 165px; text-align: center; font-weight: bold;">${finishDate}</div> ዓ.ም`
    );
    html = html.replace(
        'DATE: <div class="fill-blank-line" style="width: 150px;"></div>',
        `DATE: <div class="fill-blank-line" style="width: 150px; text-align: center; font-weight: bold;">${finishDate}</div>`
    );
    if (signatureBase64) {
        html = html.replace(
            'SIGNED: <div class="fill-blank-line" style="width: 190px;"></div>',
            `SIGNED: <div class="fill-blank-line" style="width: 190px; position: relative; text-align: center; height: 35px !important; vertical-align: bottom !important;"><img src="${signatureBase64}" style="max-height: 40px; position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%);"></div>`
        );
    }

    const script = `
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
    <script>
        function downloadPdf() {
            const element = document.querySelector('.certificate-canvas');
            const opt = {
                margin: 0,
                filename: 'Craftopia_Certificate_${name.replace(/\\s+/g, '_')}.pdf',
                image: { type: 'jpeg', quality: 1 },
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
            };
            html2pdf().set(opt).from(element).save();
        }
    </script>
    <div style="text-align: center; margin-top: 20px; padding-bottom: 20px;">
        <button onclick="downloadPdf()" style="padding: 12px 24px; background: #0088cc; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; font-family: sans-serif; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">Download PDF Certificate 📥</button>
    </div>
    </body>`;
    
    html = html.replace('</body>', script);
    res.send(html);
});

app.get('*', (req, res) => {
    const p = path.join(BASE_DIR, 'public', 'index.html');
    res.sendFile(p, (err) => {
        if (err && !res.headersSent) {
            console.error('[sendFile error]', err.message, 'path:', p);
            res.status(404).send('index.html not found. BASE_DIR=' + BASE_DIR);
        }
    });
});
module.exports = app;
