require('dotenv').config();
const axios = require('axios');
const { MESSAGES: STATIC_MESSAGES } = require('./messages');


const SUPABASE_URL = (process.env.SUPABASE_URL && !process.env.SUPABASE_URL.includes("gmvzwakcouuwvbapjtso") ? process.env.SUPABASE_URL : "https://pgnxsgysnvrgsbuecesc.supabase.co").replace(/\/$/, "");
const SUPABASE_KEY = (process.env.SUPABASE_KEY && process.env.SUPABASE_KEY !== "sb_publishable_GhwTyM1ilJr0M2VbusxDPQ_5wA9LycM" ? process.env.SUPABASE_KEY : "sb_publishable_i1qSlBg5OBbnLpSHuDN4UA_bH6bWAVQ");

axios.defaults.timeout = 30000;


function getHeaders(preferRepresentation = false) {
    const headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json"
    };
    if (preferRepresentation) {
        headers["Prefer"] = "return=representation";
    }
    return headers;
}

// Memory cache fallback for offline testing
const OFFLINE_DB = {
    registrations: {
        "111222": {
            id: "reg-1",
            chat_id: 111222,
            name: "Melaku Ayalew",
            phone: "+251911000111",
            receipt_number: "TX-100293",
            receipt_image_url: "https://picsum.photos/id/101/800/600",
            status: "approved",
            step: "completed",
            invite_link: "https://t.me/joinchat/mock_invite_melaku",
            created_at: new Date(Date.now() - 3600000 * 24 * 5).toISOString() // 5 days ago
        },
        "333444": {
            id: "reg-2",
            chat_id: 333444,
            name: "Hana Kebede",
            phone: "+251922334455",
            receipt_number: "TX-992019",
            receipt_image_url: "https://picsum.photos/id/102/800/600",
            status: "pending",
            step: "completed",
            created_at: new Date(Date.now() - 3600000 * 2).toISOString() // 2 hours ago
        },
        "555666": {
            id: "reg-3",
            chat_id: 555666,
            name: "Dawit Wolde",
            phone: "+251933556677",
            receipt_number: "TX-883012",
            receipt_image_url: "https://picsum.photos/id/103/800/600",
            status: "declined",
            step: "completed",
            rejection_reason: "Duplicate receipt number",
            created_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString() // 2 days ago
        }
    },
    progress: {},
    languages: [
        { code: "en", name: "English", is_active: true },
        { code: "am", name: "አማርኛ", is_active: true }
    ],
    translations: [],
    questions: [
        {
            id: "q-1",
            day_number: 1,
            question_text: "What is the capital city of Ethiopia?",
            options: ["Addis Ababa", "Gondar", "Mekelle", "Bahir Dar"],
            correct_option_index: 0,
            created_at: new Date().toISOString()
        },
        {
            id: "q-2",
            day_number: 1,
            question_text: "Which of the following is a traditional Ethiopian craft?",
            options: ["Pottery", "Origami", "Glass blowing", "Calligraphy"],
            correct_option_index: 0,
            created_at: new Date().toISOString()
        },
        {
            id: "q-3",
            day_number: 2,
            question_text: "What is the primary material used in Ethiopian handwoven basketry (Sefed)?",
            options: ["Palm leaves / Grass", "Plastic wires", "Metal threads", "Leather strips"],
            correct_option_index: 0,
            created_at: new Date().toISOString()
        }
    ]
};

// Initialize offline translations from static messages
try {
    for (const [langCode, keys] of Object.entries(STATIC_MESSAGES || {})) {
        for (const [key, val] of Object.entries(keys || {})) {
            OFFLINE_DB.translations.push({
                lang_code: langCode,
                key: key,
                value: val
            });
        }
    }
} catch (e) {
    console.error("Error populating offline translations:", e.message);
}

// --- User/Registration Operations ---

async function getRegistration(chatId) {
    const url = `${SUPABASE_URL}/rest/v1/registrations?chat_id=eq.${chatId}&order=created_at.desc&limit=1`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data.length > 0 ? response.data[0] : null;
    } catch (e) {
        console.error("Error getting registration:", e.message);
        return OFFLINE_DB.registrations[chatId] || null;
    }
}

async function getRegistrationByPhone(phone) {
    const encodedPhone = encodeURIComponent(phone);
    const url = `${SUPABASE_URL}/rest/v1/registrations?phone=eq.${encodedPhone}&order=created_at.desc&limit=1`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data.length > 0 ? response.data[0] : null;
    } catch (e) {
        console.error("Error getting registration by phone:", e.message);
        return Object.values(OFFLINE_DB.registrations).find(r => r.phone === phone) || null;
    }
}

async function getLastCompletedRegistration(chatId) {
    const url = `${SUPABASE_URL}/rest/v1/registrations?chat_id=eq.${chatId}&step=eq.completed&order=created_at.desc&limit=1`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data.length > 0 ? response.data[0] : null;
    } catch (e) {
        console.error("Error getting last completed registration:", e.message);
        const userRegs = Object.values(OFFLINE_DB.registrations).filter(r => r.chat_id === chatId && r.step && r.step.includes("completed"));
        return userRegs.length > 0 ? userRegs[userRegs.length - 1] : null;
    }
}

async function getRegistrationById(regId) {
    const url = `${SUPABASE_URL}/rest/v1/registrations?id=eq.${regId}`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data.length > 0 ? response.data[0] : null;
    } catch (e) {
        console.error("Error getting registration by id:", e.message);
        return Object.values(OFFLINE_DB.registrations).find(r => r.id === regId) || null;
    }
}

async function upsertRegistration(chatId, data) {
    const latest = await getRegistration(chatId);
    
    const stepVal = latest && latest.step ? latest.step : "";
    if (latest && !stepVal.includes("completed")) {
        const regId = latest.id;
        const url = `${SUPABASE_URL}/rest/v1/registrations?id=eq.${regId}`;
        try {
            const response = await axios.patch(url, data, { headers: getHeaders() });
            return [200, 204].includes(response.status);
        } catch (e) {
            console.error("Error updating active registration:", e.message);
            if (!OFFLINE_DB.registrations[chatId]) {
                OFFLINE_DB.registrations[chatId] = {
                    id: (latest && latest.id) || Math.random().toString(36).substring(2, 15),
                    chat_id: chatId,
                    status: (latest && latest.status) || "pending",
                    step: (latest && latest.step) || "start",
                    created_at: (latest && latest.created_at) || new Date().toISOString()
                };
            }
            Object.assign(OFFLINE_DB.registrations[chatId], data);
            return true;
        }
    } else {
        const url = `${SUPABASE_URL}/rest/v1/registrations`;
        let referredBy = latest ? latest.referred_by_chat_id : null;
        
        const payload = { chat_id: chatId, ...data };
        if (referredBy && !("referred_by_chat_id" in payload)) {
            payload.referred_by_chat_id = referredBy;
        }
        
        try {
            const response = await axios.post(url, payload, { headers: getHeaders() });
            return [200, 201, 204].includes(response.status);
        } catch (e) {
            console.error("Error inserting new registration:", e.message);
            const id = Math.random().toString(36).substring(2, 15);
            OFFLINE_DB.registrations[chatId] = {
                id,
                chat_id: chatId,
                status: "pending",
                step: "start",
                created_at: new Date().toISOString(),
                ...payload
            };
            return true;
        }
    }
}

async function getRegistrationsPaginated(page = 1, limit = 10, status = null, search = null) {
    const url = `${SUPABASE_URL}/rest/v1/registrations?order=created_at.desc`;
    let regs = [];
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        regs = response.data;
    } catch (e) {
        console.error("Error fetching registrations:", e.message);
        regs = Object.values(OFFLINE_DB.registrations);
    }

    const chatToName = {};
    const referralsCounts = {};

    for (const r of regs) {
        const cId = r.chat_id;
        const name = r.name;
        const refBy = r.referred_by_chat_id;
        
        if (cId && name) {
            if (!(cId in chatToName) || r.step === "completed") {
                chatToName[cId] = name;
            }
        }
                
        if (refBy) {
            referralsCounts[refBy] = (referralsCounts[refBy] || 0) + 1;
        }
    }

    const filteredRegs = [];
    for (const r of regs) {
        const cId = r.chat_id;
        const refBy = r.referred_by_chat_id;
        
        r.referral_count = referralsCounts[cId] || 0;
        r.referred_by_name = refBy ? (chatToName[refBy] || null) : null;

        if (status && status !== "all" && r.status !== status) {
            continue;
        }

        // Filter out incomplete registrations (e.g., users who clicked /start but haven't entered name/phone)
        if (!r.step || !r.step.includes("completed")) {
            continue;
        }

        if (search) {
            const q = search.toLowerCase();
            const nameVal = (r.name || "").toLowerCase();
            const phoneVal = (r.phone || "").toLowerCase();
            const receiptVal = (r.receipt_number || "").toLowerCase();
            const chatVal = String(r.chat_id || "");
            
            if (!nameVal.includes(q) && !phoneVal.includes(q) && !receiptVal.includes(q) && !chatVal.includes(q)) {
                continue;
            }
        }

        filteredRegs.push(r);
    }

    const total = filteredRegs.length;
    const startIdx = (page - 1) * limit;
    const endIdx = startIdx + limit;
    const pageData = filteredRegs.slice(startIdx, endIdx);

    return [pageData, total];
}

async function getUsersReferralSummary() {
    const url = `${SUPABASE_URL}/rest/v1/registrations?order=created_at.desc`;
    let regs = [];
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        regs = response.data;
    } catch (e) {
        console.error("Error fetching registrations:", e.message);
        regs = Object.values(OFFLINE_DB.registrations);
    }

    const users = {};

    for (const r of regs) {
        const chatId = r.chat_id;
        const name = r.name;
        const phone = r.phone;
        const step = r.step;
        
        if (!chatId) continue;

        if (!(chatId in users)) {
            users[chatId] = {
                chat_id: chatId,
                name: name ? name : "-",
                phone: phone ? phone : "-",
                total_referred: 0,
                approved_referred: 0,
                paid_referred: 0
            };
        } else {
            if (step === "completed" || (users[chatId].name === "-" && name)) {
                users[chatId].name = name;
            }
            if (step === "completed" || (users[chatId].phone === "-" && phone)) {
                users[chatId].phone = phone;
            }
        }
    }

    for (const r of regs) {
        const refBy = r.referred_by_chat_id;
        const status = r.status;
        const paid = r.referral_paid || false;
        
        if (refBy && refBy in users) {
            users[refBy].total_referred += 1;
            if (status === "approved") {
                users[refBy].approved_referred += 1;
                if (paid) {
                    users[refBy].paid_referred += 1;
                }
            }
        }
    }

    const referringUsers = Object.values(users).filter(u => u.total_referred > 0);
    return referringUsers.sort((a, b) => b.total_referred - a.total_referred);
}

async function updateRegistrationStatus(regId, status, inviteLink = null, rejectionReason = null, expiresAt = null) {
    const url = `${SUPABASE_URL}/rest/v1/registrations?id=eq.${regId}`;
    const data = { status: status };
    if (inviteLink) data.invite_link = inviteLink;
    if (rejectionReason) data.rejection_reason = rejectionReason;
    
    if (expiresAt) {
        data.expires_at = expiresAt;
    } else if (status === "approved") {
        try {
            const settings = await getPaymentSettings();
            const durationDays = parseInt(settings.access_duration_days) || 30;
            data.expires_at = new Date(Date.now() + durationDays * 24 * 3600 * 1000).toISOString();
        } catch (err) {
            console.error("Error setting expires_at:", err.message);
        }
    }
        
    try {
        const response = await axios.patch(url, data, { headers: getHeaders(true) });
        if ([200, 201].includes(response.status)) {
            return response.data.length > 0 ? response.data[0] : null;
        }
    } catch (e) {
        if (data.expires_at && e.response && e.response.status === 400) {
            console.warn("Column expires_at might be missing, retrying without it...");
            delete data.expires_at;
            try {
                const retryResponse = await axios.patch(url, data, { headers: getHeaders(true) });
                if ([200, 201].includes(retryResponse.status)) {
                    return retryResponse.data.length > 0 ? retryResponse.data[0] : null;
                }
            } catch (retryErr) {
                console.error("Error updating without expires_at:", retryErr.message);
            }
        }
        console.error("Error updating registration status:", e.message);
        const matched = Object.values(OFFLINE_DB.registrations).find(r => r.id === regId);
        if (matched) {
            Object.assign(matched, data);
            return matched;
        }
        return null;
    }
}

// --- Admin Operations ---

// Memory cache fallback for offline testing
const OFFLINE_ADMINS = {};

async function getAdmin(username) {
    const url = `${SUPABASE_URL}/rest/v1/admins?username=eq.${username}`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data.length > 0 ? response.data[0] : null;
    } catch (e) {
        console.error("Error getting admin:", e.message);
        // Fallback for offline testing
        if (!OFFLINE_ADMINS[username]) {
            OFFLINE_ADMINS[username] = {
                username: username,
                password: "admin123", // default fallback password
                telegram_chat_id: "123456789", // Mock ID
                verification_code: null,
                code_expires_at: null
            };
        }
        return OFFLINE_ADMINS[username];
    }
}

async function linkAdminChat(username, chatId) {
    const url = `${SUPABASE_URL}/rest/v1/admins?username=eq.${username}`;
    try {
        const response = await axios.patch(url, { telegram_chat_id: chatId }, { headers: getHeaders() });
        return [200, 204].includes(response.status);
    } catch (e) {
        console.error("Error linking admin chat:", e.message);
        if (OFFLINE_ADMINS[username]) {
            OFFLINE_ADMINS[username].telegram_chat_id = chatId;
            return true;
        }
        return false;
    }
}

async function setAdminVerificationCode(username, code, expiresAtIso) {
    const url = `${SUPABASE_URL}/rest/v1/admins?username=eq.${username}`;
    const data = {
        verification_code: code,
        code_expires_at: expiresAtIso
    };
    try {
        const response = await axios.patch(url, data, { headers: getHeaders() });
        return [200, 204].includes(response.status);
    } catch (e) {
        console.error("Error setting admin verification code:", e.message);
        if (!OFFLINE_ADMINS[username]) {
            OFFLINE_ADMINS[username] = {
                username: username,
                password: "admin123",
                telegram_chat_id: "123456789",
                verification_code: null,
                code_expires_at: null
            };
        }
        OFFLINE_ADMINS[username].verification_code = code;
        OFFLINE_ADMINS[username].code_expires_at = expiresAtIso;
        console.log(`[Offline Testing Mode] Verification code generated for '${username}': ${code}`);
        return true;
    }
}

async function updateAdminPassword(username, newPassword) {
    const url = `${SUPABASE_URL}/rest/v1/admins?username=eq.${username}`;
    try {
        const response = await axios.patch(url, { password: newPassword }, { headers: getHeaders() });
        return [200, 204].includes(response.status);
    } catch (e) {
        console.error("Error updating admin password:", e.message);
        if (OFFLINE_ADMINS[username]) {
            OFFLINE_ADMINS[username].password = newPassword;
            return true;
        }
        return false;
    }
}

async function setAdminTelegramLinkCode(username, code, expiresAtIso) {
    const url = `${SUPABASE_URL}/rest/v1/admins?username=eq.${username}`;
    const data = {
        telegram_link_code: code,
        telegram_link_expires_at: expiresAtIso
    };
    try {
        const response = await axios.patch(url, data, { headers: getHeaders() });
        return [200, 204].includes(response.status);
    } catch (e) {
        console.error("Error setting admin telegram link code:", e.message);
        if (!OFFLINE_ADMINS[username]) {
            OFFLINE_ADMINS[username] = {
                username: username,
                password: "admin123",
                telegram_chat_id: "123456789",
                verification_code: null,
                code_expires_at: null,
                telegram_link_code: null,
                telegram_link_expires_at: null
            };
        }
        OFFLINE_ADMINS[username].telegram_link_code = code;
        OFFLINE_ADMINS[username].telegram_link_expires_at = expiresAtIso;
        return true;
    }
}

async function getAdminByLinkCode(code) {
    const url = `${SUPABASE_URL}/rest/v1/admins?telegram_link_code=eq.${code}`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data.length > 0 ? response.data[0] : null;
    } catch (e) {
        console.error("Error getting admin by link code:", e.message);
        // Fallback for offline testing
        for (const username in OFFLINE_ADMINS) {
            if (OFFLINE_ADMINS[username].telegram_link_code === code) {
                return OFFLINE_ADMINS[username];
            }
        }
        return null;
    }
}

async function getPaymentSettings() {
    const admin = await getAdmin("payment_settings");
    if (admin && admin.verification_code) {
        try {
            return JSON.parse(admin.verification_code);
        } catch (e) {
            // ignore JSON parse error
        }
    }
    return {
        amount: "500",
        telegram_channel_id: "-1004429840481",
        access_duration_days: "30",
        telebirr_name: "Craftopia School",
        telebirr_number: "0911223344",
        cbe_name: "Craftopia Hand Craft",
        cbe_number: "1000123456789",
        cert_program_en: "Hand Craft & Art",
        cert_program_am: "የእጅ ሥራና ጥበብ ስልጠና",
        cert_duration_en: "4 Weeks",
        cert_duration_am: "4 ሳምንት",
        signature_base64: null
    };
}

async function updatePaymentSettings(settingsDict) {
    const admin = await getAdmin("payment_settings");
    let url = `${SUPABASE_URL}/rest/v1/admins`;
    const data = {
        username: "payment_settings",
        verification_code: JSON.stringify(settingsDict)
    };
    try {
        let response;
        if (admin) {
            url = `${url}?username=eq.payment_settings`;
            response = await axios.patch(url, data, { headers: getHeaders() });
        } else {
            data.password = "dummy";
            response = await axios.post(url, data, { headers: getHeaders() });
        }
        return [200, 201, 204].includes(response.status);
    } catch (e) {
        console.error("Error updating payment settings:", e.message);
        // Fallback for offline/local simulation
        if (!OFFLINE_ADMINS["payment_settings"]) {
            OFFLINE_ADMINS["payment_settings"] = {
                username: "payment_settings",
                password: "dummy",
                telegram_chat_id: null,
                verification_code: null,
                code_expires_at: null
            };
        }
        OFFLINE_ADMINS["payment_settings"].verification_code = JSON.stringify(settingsDict);
        return true;
    }
}

// --- Quiz Operations ---

async function getQuestionsByDay(dayNumber) {
    const url = `${SUPABASE_URL}/rest/v1/questions?day_number=eq.${dayNumber}&order=created_at.asc`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data;
    } catch (e) {
        console.error("Error getting questions by day:", e.message);
        return [];
    }
}

async function getAllQuestions() {
    const url = `${SUPABASE_URL}/rest/v1/questions?order=day_number.asc,created_at.asc`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data;
    } catch (e) {
        console.error("Error getting all questions:", e.message);
        return OFFLINE_DB.questions;
    }
}

async function addQuestion(dayNumber, questionText, options, correctIndex) {
    const url = `${SUPABASE_URL}/rest/v1/questions`;
    const data = {
        day_number: dayNumber,
        question_text: questionText,
        options: options,
        correct_option_index: correctIndex
    };
    try {
        const response = await axios.post(url, data, { headers: getHeaders() });
        return [200, 201, 204].includes(response.status);
    } catch (e) {
        console.error("Error adding question:", e.message);
        const newQ = {
            id: Math.random().toString(36).substring(2, 15),
            day_number: parseInt(dayNumber),
            question_text: questionText,
            options: options,
            correct_option_index: parseInt(correctIndex),
            created_at: new Date().toISOString()
        };
        OFFLINE_DB.questions.push(newQ);
        return true;
    }
}

async function deleteQuestion(questionId) {
    const url = `${SUPABASE_URL}/rest/v1/questions?id=eq.${questionId}`;
    try {
        const response = await axios.delete(url, { headers: getHeaders() });
        return [200, 204].includes(response.status);
    } catch (e) {
        console.error("Error deleting question:", e.message);
        OFFLINE_DB.questions = OFFLINE_DB.questions.filter(q => q.id !== questionId);
        return true;
    }
}

async function getMaxQuizDay() {
    const url = `${SUPABASE_URL}/rest/v1/questions?select=day_number&order=day_number.desc&limit=1`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        if (response.data && response.data.length > 0) {
            return response.data[0].day_number;
        }
        return 0;
    } catch (e) {
        console.error("Error getting max day:", e.message);
        return 0;
    }
}

async function getUserQuizProgress(chatId) {
    const url = `${SUPABASE_URL}/rest/v1/user_quiz_progress?chat_id=eq.${chatId}`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data.length > 0 ? response.data[0] : null;
    } catch (e) {
        console.error("Error getting user quiz progress:", e.message);
        return OFFLINE_DB.progress[chatId] || null;
    }
}

async function upsertUserQuizProgress(chatId, data) {
    const prog = await getUserQuizProgress(chatId);
    if (prog) {
        const url = `${SUPABASE_URL}/rest/v1/user_quiz_progress?chat_id=eq.${chatId}`;
        try {
            const response = await axios.patch(url, data, { headers: getHeaders() });
            return [200, 204].includes(response.status);
        } catch (e) {
            console.error("Error updating quiz progress:", e.message);
            if (!OFFLINE_DB.progress[chatId]) {
                OFFLINE_DB.progress[chatId] = {
                    chat_id: chatId,
                    current_day: (prog && prog.current_day) || 1,
                    current_question_index: (prog && prog.current_question_index) || 0,
                    is_completed: (prog && prog.is_completed) || false,
                    created_at: (prog && prog.created_at) || new Date().toISOString()
                };
            }
            Object.assign(OFFLINE_DB.progress[chatId], data);
            return true;
        }
    } else {
        const url = `${SUPABASE_URL}/rest/v1/user_quiz_progress`;
        const payload = { chat_id: chatId, ...data };
        try {
            const response = await axios.post(url, payload, { headers: getHeaders() });
            return [200, 201, 204].includes(response.status);
        } catch (e) {
            console.error("Error inserting quiz progress:", e.message);
            OFFLINE_DB.progress[chatId] = {
                chat_id: chatId,
                current_day: 1,
                current_question_index: 0,
                is_completed: false,
                created_at: new Date().toISOString(),
                ...payload
            };
            return true;
        }
    }
}

// --- Languages & Translations Operations ---

async function getActiveLanguages() {
    const url = `${SUPABASE_URL}/rest/v1/languages?is_active=eq.true&order=created_at.asc`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data;
    } catch (e) {
        console.error("Error getting active languages:", e.message);
        return OFFLINE_DB.languages;
    }
}

async function getAllLanguages() {
    const url = `${SUPABASE_URL}/rest/v1/languages?order=created_at.asc`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data;
    } catch (e) {
        console.error("Error getting all languages:", e.message);
        return OFFLINE_DB.languages;
    }
}

async function upsertLanguage(code, name, isActive = true) {
    const url = `${SUPABASE_URL}/rest/v1/languages`;
    const headers = getHeaders();
    headers["Prefer"] = "resolution=merge-duplicates";
    const data = { code: code, name: name, is_active: isActive };
    try {
        const response = await axios.post(url, data, { headers: headers });
        return [200, 201, 204].includes(response.status);
    } catch (e) {
        console.error("Error upserting language:", e.message);
        const existingIdx = OFFLINE_DB.languages.findIndex(l => l.code === code);
        if (existingIdx !== -1) {
            OFFLINE_DB.languages[existingIdx] = { code, name, is_active: isActive };
        } else {
            OFFLINE_DB.languages.push({ code, name, is_active: isActive });
        }
        return true;
    }
}

async function deleteLanguage(code) {
    const url = `${SUPABASE_URL}/rest/v1/languages?code=eq.${code}`;
    try {
        const response = await axios.delete(url, { headers: getHeaders() });
        return [200, 204].includes(response.status);
    } catch (e) {
        console.error("Error deleting language:", e.message);
        OFFLINE_DB.languages = OFFLINE_DB.languages.filter(l => l.code !== code);
        OFFLINE_DB.translations = OFFLINE_DB.translations.filter(t => t.lang_code !== code);
        return true;
    }
}

async function getAllTranslations() {
    const url = `${SUPABASE_URL}/rest/v1/translations`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data;
    } catch (e) {
        console.error("Error getting all translations:", e.message);
        return OFFLINE_DB.translations;
    }
}

async function upsertTranslations(translations) {
    if (!translations || translations.length === 0) {
        return true;
    }
    const url = `${SUPABASE_URL}/rest/v1/translations`;
    const headers = getHeaders();
    headers["Prefer"] = "resolution=merge-duplicates";
    try {
        const response = await axios.post(url, translations, { headers: headers });
        return [200, 201, 204].includes(response.status);
    } catch (e) {
        console.error("Error upserting translations:", e.message);
        for (const newT of translations) {
            const idx = OFFLINE_DB.translations.findIndex(t => t.lang_code === newT.lang_code && t.key === newT.key);
            if (idx !== -1) {
                OFFLINE_DB.translations[idx].value = newT.value;
            } else {
                OFFLINE_DB.translations.push(newT);
            }
        }
        return true;
    }
}

async function getReferrals(referrerChatId) {
    const url = `${SUPABASE_URL}/rest/v1/registrations?referred_by_chat_id=eq.${referrerChatId}`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        return response.data;
    } catch (e) {
        console.error("Error getting referrals:", e.message);
        return Object.values(OFFLINE_DB.registrations).filter(r => r.referred_by_chat_id === referrerChatId);
    }
}

module.exports = {
    getReferrals,
    getRegistration,
    getRegistrationByPhone,
    getLastCompletedRegistration,
    getRegistrationById,
    upsertRegistration,
    getRegistrationsPaginated,
    getUsersReferralSummary,
    updateRegistrationStatus,
    getAdmin,
    linkAdminChat,
    setAdminVerificationCode,
    setAdminTelegramLinkCode,
    getAdminByLinkCode,
    updateAdminPassword,
    getPaymentSettings,
    updatePaymentSettings,
    getQuestionsByDay,
    getAllQuestions,
    addQuestion,
    deleteQuestion,
    getMaxQuizDay,
    getUserQuizProgress,
    upsertUserQuizProgress,
    getActiveLanguages,
    getAllLanguages,
    upsertLanguage,
    deleteLanguage,
    getAllTranslations,
    upsertTranslations
};
