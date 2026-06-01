// =============================================================
// LEXIMED.AI — WhatsApp Agent v3.4 (Live Authentication + Local API Sync)
// Aligned with LexiMed Web Platform (Laravel + React Login Control)
//
// Flow: WA Input Credential → Validate via Laravel API /token → 
//       Lock Role Session Token → Live Fetch/Post PostgreSQL (rs_uns_db)
// =============================================================

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode                 = require('qrcode-terminal');
const axios                  = require('axios');
const fs                     = require('fs');
const path                   = require('path');
const FormData               = require('form-data');

// ── API Keys & Config ──────────────────────────────────────────
const GROQ_API_KEY  = process.env.GROQ_API_KEY  || "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";

// Endpoint API Sinkron 100% dengan Environment VITE_API_URL Laravel Lokal Port 8000
const LARAVEL_API   = process.env.LARAVEL_API_URL || "http://localhost:8000/api";

// URL Aplikasi Web Vercel Terdeploy untuk Tautan Redirection
const WEB_PRODUCTION_URL = "https://leximedai-olivia2026-web-technology.vercel.app/";

function appendWebLinkFooter() {
    return (
        `\n\n🌐 Buka Web Platform untuk verifikasi & kelola data:\n` +
        `${WEB_PRODUCTION_URL}`
    );
}

// =============================================================
// KONFIGURASI ROLE & PROMPT REGULASI CDSS RS UNS
// =============================================================
const ROLES = {
    'admin': {
        nama: 'Admin / Administrator',
        icon: '⚙️',
        systemPrompt: `Kamu adalah AI Sistem Administrator LexiMed.ai RS UNS. Bantu kelola manajemen user, monitoring log audit, dan berikan panduan pemeliharaan sistem data rekam medis elektronik.`,
        bisaLihatPasien: true,
        bisaVerifikasi: true,
        bisaAnalisisGambar: false
    },
    'dokter': {
        nama: 'Dokter Spesialis',
        icon: '👨‍⚕️',
        systemPrompt: `Kamu adalah Clinical Decision Support System (CDSS) LexiMed.ai milik RS UNS. Analisis data klinis yang diberikan dokter, susun draf assessment medis dalam format SOAP (Subjective, Objective, Assessment, Plan), tentukan tingkat kegawatdaruratan (skala 1-5 ESI), dan berikan rekomendasi tindakan medis.`,
        bisaLihatPasien: true,
        bisaVerifikasi: true,
        bisaAnalisisGambar: false
    },
    'perawat': {
        nama: 'Perawat Klinis',
        icon: '👩‍⚕️',
        systemPrompt: `Kamu adalah AI Perawat LexiMed.ai RS UNS. Ekstrak data TTV (Tensi, Nadi, Suhu, SpO2) dari narasi, identifikasi masalah keperawatan prioritas menggunakan format NANDA, dan susun intervensi keperawatan NIC yang tepat.`,
        bisaLihatPasien: true,
        bisaVerifikasi: false,
        bisaAnalisisGambar: false
    },
    'radiologi': {
        nama: 'Radiologi Ekspert',
        icon: '🩻',
        systemPrompt: `Kamu adalah Radiology Expert AI LexiMed.ai RS UNS. Analisis temuan radiologi dari deskripsi teks atau gambar medis. Buat draf KESAN/KESIMPULAN radiologi yang ringkas dan sistematis.`,
        bisaLihatPasien: true,
        bisaVerifikasi: false,
        bisaAnalisisGambar: true
    },
    'asisten': {
        nama: 'Asisten Dokter',
        icon: '📋',
        systemPrompt: `Kamu adalah Assistant Medical Registrar LexiMed.ai RS UNS. Strukturkan dan rapikan pencatatan medis dari narasi bebas menjadi format rekam medis elektronik (RME) standar Kemenkes RI.`,
        bisaLihatPasien: true,
        bisaVerifikasi: false,
        bisaAnalisisGambar: false
    },
    'manajemen': {
        nama: 'Manajemen Eksekutif',
        icon: '📊',
        systemPrompt: `Kamu adalah AI Sistem Manajemen LexiMed.ai RS UNS. Bantu analisis data operasional, laporan statistik pasien, dan efisiensi unit layanan rumah sakit.`,
        bisaLihatPasien: false,
        bisaVerifikasi: false,
        bisaAnalisisGambar: false
    }
};

// =============================================================
// STATE INTERACTIVE SESSION MANAGEMENT
// =============================================================
const userSessions = {};

function getSession(from) {
    if (!userSessions[from]) {
        userSessions[from] = {
            step: 'auth_username', // auth_username | auth_password | menu_utama | pilih_pasien | aksi_pasien | konsultasi | tunggu_gambar
            username: '',
            token: '',
            role: null,      
            selectedPatient: null,
            fetchedPatients: [] 
        };
    }
    return userSessions[from];
}

function resetSession(from) {
    userSessions[from] = { step: 'auth_username', username: '', token: '', role: null, selectedPatient: null, fetchedPatients: [] };
}

// =============================================================
// TEXT TEMPLATE INTERFACES
// =============================================================
function msgWelcomeLogin() {
    return (
        `╔═══════════════════════════════╗\n` +
        `║   🏥   LexiMed.ai  —  RS UNS   ║\n` +
        `║     GATEWAY OTORITAS MEDIS    ║\n` +
        `╚═══════════════════════════════╝\n\n` +
        `Sistem terikat dengan database lokal PostgreSQL.\n` +
        `Silakan masukkan *USERNAME* Anda untuk memulai autentikasi:\n` +
        `_(Contoh: ilham_dokter, admin_darsi, ilham_perawat)_`
    );
}

function msgMenuRole(session) {
    const r = ROLES[session.role];
    let menu = `🔓 *OTORISASI DISETUJUI*\n`;
    menu += `User: ${session.username.toUpperCase()}\n`;
    menu += `Role: *${r.nama}* ${r.icon}\n`;
    menu += `${'─'.repeat(32)}\n\n`;
    menu += `Pilih nomor menu instruksi:\n\n`;

    if (r.bisaLihatPasien) {
        menu += `1️⃣   📂   Lihat Daftar Pasien (Live DB)\n`;
        menu += `2️⃣   💬   Konsultasi / Input Klinis\n`;
        if (r.bisaAnalisisGambar) {
            menu += `3️⃣   🩻   Analisis Foto/Gambar Radiologi\n`;
        }
    } else {
        menu += `1️⃣   💬   Input Data / Pertanyaan Eksekutif\n`;
    }

    menu += `\n🎙️   *Voice note* → Transkrip otomatis via Whisper\n`;
    menu += `\nKetik *#logout* untuk keluar dari akun`;
    return menu;
}

function buildKonteksKlinis(p) {
    return (
        `DATA PASIEN (Source: PostgreSQL rs_uns_db via WhatsApp Link)\n` +
        `No. RM    : ${p.no_rm}\n` +
        `Nama      : ${p.title || 'Tn/Ny'}. ${p.name}, ${p.age || '-'} tahun, ${p.gender || '-'}\n` +
        `Unit      : ${p.unit || 'IGD'}\n` +
        `DPJP      : ${p.dpjp || '-'}\n` +
        `Status    : ${p.status_treatment || 'Observasi'}\n\n` +
        `VITAL SIGN PEMERIKSAAN AWAL:\n` +
        `  Tensi    : ${p.blood_pressure || p.tensi || '-'}\n` +
        `  Nadi     : ${p.heart_rate || p.nadi || '-'}\n` +
        `  Suhu     : ${p.temperature || p.suhu || '-'}\n` +
        `  SpO2     : ${p.oxygen_saturation || p.spo2 || '-'}\n\n` +
        `KELUHAN UTAMA (raw_content):\n${p.keluhan_awal || p.raw_content || 'Tidak ada keluhan tertulis.'}\n\n` +
        `Riwayat Penyakit : ${p.riwayat || '-'}\n` +
        `Alergi           : ${p.alergi || '-'}`
    );
}

// =============================================================
// OMNI CORE AI CLUSTER SYSTEM (Groq Engine Pipeline)
// =============================================================
async function tanyaAI(systemPrompt, userContent) {
    const noMarkdown = ` PENTING: Jangan gunakan simbol markdown seperti bintang ganda (**), tagar (#), atau backtick. Hasilkan teks polos terstruktur yang rapi untuk WhatsApp.`;
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: systemPrompt + noMarkdown },
            { role: 'user',   content: userContent }
        ],
        temperature: 0.3,
        max_tokens: 1024
    }, {
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 20000
    });
    return res.data.choices[0].message.content;
}

async function transkripVoice(base64Data, mimeType) {
    const tmpPath = path.join('/tmp', `lxm_voice_${Date.now()}.ogg`);
    try {
        fs.writeFileSync(tmpPath, Buffer.from(base64Data, 'base64'));
        const form = new FormData();
        form.append('file', fs.createReadStream(tmpPath), { filename: 'audio.ogg', contentType: mimeType || 'audio/ogg' });
        form.append('model', 'whisper-large-v3');
        form.append('language', 'id');
        form.append('response_format', 'text');

        const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...form.getHeaders() },
            timeout: 30000
        });
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        return typeof res.data === 'string' ? res.data : res.data.text || JSON.stringify(res.data);
    } catch (e) {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        throw new Error('Whisper Failed: ' + e.message);
    }
}

async function analisisGambar(base64Data, mimeType, systemPrompt) {
    const noMarkdown = ` Jangan gunakan markdown bintang ganda atau tagar. Keluarkan output berupa teks polos terstruktur yang rapi untuk WhatsApp.`;
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama-3.2-11b-vision-preview', 
        messages: [
            { role: 'system', content: systemPrompt + noMarkdown },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
                    { type: 'text', text: 'Analisis citra medis radiologi ini dan keluarkan impresi klinis terstruktur.' }
                ]
            }
        ],
        temperature: 0.2,
        max_tokens: 1024
    }, {
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 30000
    });
    return res.data.choices[0].message.content;
}

// =============================================================
// INITIALIZE WHATSAPP CLIENT RUNTIME
// =============================================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
    console.log('\n══════════ LEXIMED.AI v3.4 — QR SYSTEM ══════════');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
    console.log('══════════════════════════════════════════════════\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n══> [ONLINE] LexiMed.ai v3.4 — Secure Live Local Token API Node Activated! 🚀\n');
});

// =============================================================
// MAIN INTERACTIVE ROUTING MESSAGE HANDLER
// =============================================================
client.on('message', async (msg) => {
    const from    = msg.from;
    const session = getSession(from);
    const text    = msg.body ? msg.body.trim() : '';

    try { const chat = await msg.getChat(); await chat.sendStateTyping(); } catch (_) {}

    // ── Global Command Controls ──────────────────────────────
    if (text === '#logout' || text === '#reset') { resetSession(from); return msg.reply(msgWelcomeLogin()); }
    if (text === '#menu' && session.role) { session.step = 'menu_utama'; return msg.reply(msgMenuRole(session)); }

    // ── STEP A1: INPUT USERNAME ──────────────────────────────
    if (session.step === 'auth_username') {
        if (!text) return msg.reply(`Username tidak boleh kosong.`);
        session.username = text;
        session.step = 'auth_password';
        return msg.reply(`🔐 Username diterima: *${text}*\n\nSilakan masukkan *KATA SANDI* akun Anda:`);
    }

    // ── STEP A2: VALIDASI VIA POST FETCH /TOKEN KE BACKEND LARAVEL LOCAL
    if (session.step === 'auth_password') {
        await msg.reply(`⏳ Memverifikasi kredensial ke database PostgreSQL lokal via API...`);
        try {
            const form = new FormData();
            form.append('username', session.username);
            form.append('password', text);

            const res = await axios.post(`${LARAVEL_API}/token`, form, {
                headers: { ...form.getHeaders(), 'Accept': 'application/json' },
                timeout: 7000
            });

            const data = res.data;
            if (data.success === false || !data.user) {
                session.step = 'auth_username';
                return msg.reply(`❌ Autentikasi Gagal: Kredensial akun salah. Kembali ke awal.\n\nMasukkan *USERNAME* Anda:`);
            }

            // Normalisasi data role dari backend Laravel
            let matchedRole = data.user.role ? data.user.role.toLowerCase() : '';
            if (matchedRole === 'asisten_dokter') matchedRole = 'asisten'; // Sinkronisasi key ROLES

            if (!ROLES[matchedRole]) {
                session.step = 'auth_username';
                return msg.reply(`❌ Hak akses ditolak: Role *${matchedRole.toUpperCase()}* tidak memiliki hak otorisasi di WhatsApp Node. Kembali ke awal.`);
            }

            // Kunci token Sanctum, data username, dan hak akses role secara dinamis ke session state
            session.token = data.access_token || '';
            session.role = matchedRole;
            session.step = 'menu_utama';

            return msg.reply(
                `🌐 *LEXIMED AI NODE ACTIVATED*\n` +
                `${'─'.repeat(30)}\n\n` +
                `Halo! Saya LexiMed.ai, Clinical Decision Support System (CDSS) RS UNS.\n` +
                `Login berhasil terhubung dengan PostgreSQL local server.\n\n` +
                msgMenuRole(session) + `\n` +
                `${'─'.repeat(30)}` + 
                appendWebLinkFooter()
            );

        } catch (err) {
            console.error('[API AUTH ERROR]:', err.message);
            session.step = 'auth_username';
            return msg.reply(`❌ Koneksi gagal: Pastikan backend Laravel lokal (*php artisan serve*) Anda aktif di port 8000.\n\nMasukkan kembali *USERNAME* Anda:`);
        }
    }

    // ── STEP 1: INTERACTIVE MENU UTAMA ROLE ACCESSIBILITY ────
    if (session.step === 'menu_utama') {
        const r = ROLES[session.role];

        if (msg.type === 'ptt' || msg.type === 'audio') return handleVoice(msg, session);
        if (msg.type === 'image') {
            if (r.bisaAnalisisGambar) return handleGambar(msg, session);
            return msg.reply(`🖼️ Analisis gambar multimodal eksklusif untuk unit Radiologi.\nAnda login sebagai *${r.nama}*.`);
        }

        // AKSI 1: NEMBAK DATA LIVE PATIENTS DARI LARAVEL LOCAL DB MENGGUNAKAN SANCTUM TOKEN YANG LOGIN
        if (text === '1' && r.bisaLihatPasien) {
            await msg.reply(`⏳ Menarik daftar data pasien riil dari rs_uns_db (PostgreSQL)...`);
            try {
                const headers = { 'Accept': 'application/json' };
                if (session.token) headers['Authorization'] = `Bearer ${session.token}`;

                const response = await axios.get(`${LARAVEL_API}/patients`, { headers, timeout: 6000 });
                const patients = response.data.patients || response.data || [];

                if (patients.length === 0) {
                    return msg.reply(`⚠️ Database terkoneksi, namun tidak ada record pasien aktif.\n\nKetik *#menu* untuk kembali.`);
                }

                session.fetchedPatients = patients; 
                session.step = 'pilih_pasien';

                let txt = `📋 *DAFTAR PASIEN RIIL (rs_uns_db)*\n${'─'.repeat(32)}\n\n`;
                patients.slice(0, 10).forEach((p, i) => {
                    const st = p.status_treatment || 'Observasi';
                    const icon = st === 'Kritis' ? '🔴' : st === 'Observasi' ? '🟡' : '🟢';
                    txt += `*${i + 1}. ${p.title || 'Tn/Ny'}. ${p.name}*\n`;
                    txt += `   🪪 RM: ${p.no_rm}  ${icon} ${st}\n`;
                    txt += `   📍 Unit: ${p.unit || 'Umum'} | DPJP: ${p.dpjp || '-'}\n\n`;
                });
                txt += `Ketik nomor pasien untuk melihat detail rekam medis:`;
                return msg.reply(txt);

            } catch (err) {
                return msg.reply(`❌ Gagal terhubung ke database via API Local. Cek status server Laravel Anda.\n\nKetik *#menu* untuk kembali.`);
            }
        }

        const konsultasiKey = (r.bisaLihatPasien ? '2' : '1');
        if (text === konsultasiKey) {
            session.step = 'konsultasi';
            return msg.reply(`💬 *KONSULTASI INTERAKTIF AKTIF (${session.role.toUpperCase()})*\n\nKirim narasi klinis bebas atau pertanyaan medis.\n🎙️ Input Voice Note otomatis ditranskrip Whisper.\n\nKetik *#menu* untuk keluar.`);
        }

        if (text === '3' && r.bisaAnalisisGambar) {
            session.step = 'tunggu_gambar';
            return msg.reply(`🩻 *UNIT DIAGNOSTIK RADIOLOGI IMAGING*\n\nSilakan lampirkan gambar rontgen, CT-scan, atau MRI Anda.\n\nKetik *#menu* untuk kembali.`);
        }

        return msg.reply(msgMenuRole(session));
    }

    // ── STEP 2: DETAIL DATA PASIEN POSTGRESQL ────────────────
    if (session.step === 'pilih_pasien') {
        const idx = parseInt(text) - 1;
        const p = session.fetchedPatients[idx];
        if (!isNaN(idx) && p) {
            session.selectedPatient = p;
            session.step = 'aksi_pasien';

            return msg.reply(
                `📁 *REKAM MEDIS PASIEN — ${p.title || 'Tn/Ny'}. ${p.name}*\n${'─'.repeat(32)}\n` +
                `🪪 No. RM  : ${p.no_rm}\n` +
                `👤 Nama    : ${p.name}\n` +
                `🎂 Umur    : ${p.age || '-'} tahun | ${p.gender || '-'}\n` +
                `🏥 Unit    : ${p.unit || 'IGD'}\n` +
                `👨‍⚕️ DPJP    : ${p.dpjp || '-'}\n` +
                `📌 Status  : ${p.status_treatment || 'Observasi'}\n\n` +
                `📊 *Vital Sign (Pemeriksaan Awal):*\n` +
                `   Tensi  : ${p.blood_pressure || p.tensi || '-'}\n` +
                `   Nadi   : ${p.heart_rate || p.nadi || '-'}\n` +
                `   Suhu   : ${p.temperature || p.suhu || '-'}\n` +
                `   SpO2   : ${p.oxygen_saturation || p.spo2 || '-'}\n\n` +
                `🩺 *Keluhan:* ${p.keluhan_awal || p.raw_content || '-'}\n\n` +
                `Pilih aksi:\n` +
                `*A* — 🤖 Ekstrak Analisis AI Medis\n` +
                `*B* — 📝 Buat Ringkasan RME (Kemenkes)\n` +
                `*C* — 🔙 Kembali ke daftar pasien`
            );
        }
        return msg.reply(`⚠️ Pilihan salah. Ketik angka 1 sampai ${session.fetchedPatients.length}.`);
    }

    // ── STEP 3: EKSEKUSI DATA KLINIS PASIEN & POST KE LIVE DB ──
    if (session.step === 'aksi_pasien') {
        const p = session.selectedPatient;
        const r = ROLES[session.role];
        if (!p) { session.step = 'menu_utama'; return msg.reply(msgMenuRole(session)); }

        if (text.toLowerCase() === 'a') {
            await msg.reply(`⏳ Membaca skema model & mengekstrak data klinis ke Groq AI Cluster...`);
            const konteks = buildKonteksKlinis(p);
            try {
                const aiResult = await tanyaAI(r.systemPrompt, konteks);
                
                // Menyuntikkan draf hasil ekstraksi AI langsung ke tabel clinical_data via Laravel API
                const payload = {
                    patient_id: p.id || p.no_rm,
                    blood_pressure: p.blood_pressure || p.tensi || "-",
                    heart_rate: p.heart_rate || p.nadi || "-",
                    temperature: p.temperature || p.suhu || "-",
                    oxygen_saturation: p.oxygen_saturation || p.spo2 || "-",
                    source: 'whatsapp',
                    raw_content: p.keluhan_awal || p.raw_content || "Input via WhatsApp",
                    ai_summary: aiResult,
                    status: 'draft'
                };

                const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
                if (session.token) headers['Authorization'] = `Bearer ${session.token}`;
                await axios.post(`${LARAVEL_API}/clinical-data`, payload, { headers, timeout: 8000 });

                session.step = 'menu_utama';
                return msg.reply(
                    `🤖 *ANALISIS CDSS PASIEN REAL — ${p.name}*\n` +
                    `${'─'.repeat(32)}\n\n${aiResult}\n\n${'─'.repeat(32)}\n\n` +
                    `✅ [POSTGRESQL SYNCED] Sukses menyuntikkan draf data menuju tabel clinical_data di rs_uns_db!` +
                    appendWebLinkFooter() + `\n\nKetik *#menu* untuk kembali.`
                );
            } catch (e) {
                return msg.reply(msgFallback(konteks));
            }
        }

        if (text.toLowerCase() === 'b') {
            await msg.reply(`📝 Menyusun struktur berkas RME Kemenkes SatuSehat...`);
            const prompt = `Susun resume medis formal berpatokan pada regulasi SatuSehat RME Kemenkes RI berdasarkan data riil database berikut:\n\n` + buildKonteksKlinis(p);
            try {
                const hasil = await tanyaAI(r.systemPrompt, prompt);
                session.step = 'menu_utama';
                return msg.reply(
                    `📋 *RESUME ELEKTRONIK REKAM MEDIS (RME) REAL-DB*\n` +
                    `${p.name} — ${p.no_rm}\n` +
                    `${'─'.repeat(32)}\n\n${hasil}\n\n${'─'.repeat(32)}` +
                    appendWebLinkFooter() + `\n\nKetik *#menu* untuk kembali.`
                );
            } catch (e) {
                return msg.reply(`❌ Gagal kompilasi resume: ${e.message}`);
            }
        }

        if (text.toLowerCase() === 'c') {
            session.step = 'menu_utama';
            return msg.reply(msgMenuRole(session));
        }
        return msg.reply(`Pilihan salah. Tekan A, B, atau C.`);
    }

    // ── STEP: KONSULTASI BEBAS / VOICE NOTE TRANSCRIPT ────────
    if (session.step === 'konsultasi') {
        const r = ROLES[session.role];
        if (msg.type === 'ptt' || msg.type === 'audio') return handleVoice(msg, session);
        if (!text) return;

        try {
            const hasil = await tanyaAI(r.systemPrompt, text);
            return msg.reply(
                `🤖 *RESPONS INSTAN AGENT (${session.role.toUpperCase()})*\n` +
                `${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}` +
                appendWebLinkFooter() + `\n\nKetik *#menu* untuk kembali.`
            );
        } catch (e) {
            return msg.reply(msgFallback(text));
        }
    }

    // ── STEP: WAIT IMAGE RADIOLOGI ───────────────────────────
    if (session.step === 'tunggu_gambar') {
        if (msg.type === 'image') return handleGambar(msg, session);
        return msg.reply(`Silakan lampirkan file gambar radiologi Anda atau ketik *#menu*.`);
    }

    msg.reply(msgWelcomeLogin());
});

// =============================================================
// SUB-ROUTINE HANDLER: VOICE NOTE WHISPER ENGINE
// =============================================================
async function handleVoice(msg, session) {
    await msg.reply(`🎙️ Pesan suara diterima. Melakukan ekstraksi transkripsi via Groq Whisper v3...`);
    try {
        const media     = await msg.downloadMedia();
        const transkrip = await transkripVoice(media.data, media.mimetype);

        await msg.reply(`📝 *Hasil Transkripsi:* "${transkrip}"\n\nMeneruskan data menuju AI Cluster...`);

        const r     = ROLES[session.role];
        const hasil = await tanyaAI(r.systemPrompt, transkrip);

        return msg.reply(
            `🤖 *Respons AI Medis via Voice Suara — ${session.role.toUpperCase()}*\n` +
            `${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}` +
            appendWebLinkFooter() + `\n\nKetik *#menu* untuk kembali.`
        );
    } catch (e) {
        return msg.reply(`⚠️ Gagal memproses berkas audio: ${e.message}`);
    }
}

// =============================================================
// SUB-ROUTINE HANDLER: LLAMA VISION MEDIS EXTRACTOR
// =============================================================
async function handleGambar(msg, session) {
    await msg.reply(`🩻 Citra visual diterima. Membuka cluster Llama Vision Multimodal...`);
    try {
        const media   = await msg.downloadMedia();
        const r       = ROLES[session.role];
        const hasil   = await analisisGambar(media.data, media.mimetype, r.systemPrompt);

        return msg.reply(
            `🩻 *DRAF LAPORAN EVALUASI RADIOLOGI AI*\n` +
            `${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}\n` +
            `⚠️ *PERINGATAN*: Hasil kompilasi ini bersifat rekomendasi virtual dan wajib divalidasi oleh Dokter Sp.Rad.` +
            appendWebLinkFooter() + `\n\nKetik *#menu* untuk kembali.`
        );
    } catch (e) {
        return msg.reply(`⚠️ Gagal mengekstrak berkas gambar: ${e.message}`);
    }
}

client.initialize();