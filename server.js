// =============================================================
// LEXIMED.AI — WhatsApp Agent v4.3 (Context-Aware Omni Infrastructure)
// Aligned with LexiMed Web Platform (Live Vercel Backend + Supabase)
//
// System Flow: 
//   1. Authority Verification -> Directly mapped to Vercel /token endpoint
//   2. Dynamic State Backtrack -> Fully intercepted 'kembali' on all auth stages
//   3. Natural Language Gateway -> Live Database rows context auto-injected
// =============================================================

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode                 = require('qrcode-terminal');
const axios                  = require('axios');
const fs                     = require('fs');
const path                   = require('path');
const FormData               = require('form-data');

// ── API Keys & Cloud Configurations ─────────────────────────────
const GROQ_API_KEY  = process.env.GROQ_API_KEY  || "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";
const LARAVEL_API   = process.env.LARAVEL_API_URL || "https://lexi-med-ai-llm-rs-back-end.vercel.app/api";
const WEB_PRODUCTION_URL = "https://leximedai-olivia2026-web-technology.vercel.app/";

// Raw Metadata Skema Database public.* untuk Injeksi Contextual AI
const DATABASE_CONTEXT_SCHEMA = `
- TABLE public.users: id, name, username, role, specialization, unit, status
- TABLE public.patients: no_rm (PK), title, name, age, gender, unit, dpjp, status_treatment
- TABLE public.pemeriksaan_awals: id, patient_id (FK to patients.no_rm), tensi, nadi, suhu, spo2, keluhan_awal, source
- TABLE public.clinical_data: id, patient_id, source, raw_content, ai_summary, status, blood_pressure, heart_rate, temperature, oxygen_saturation
- TABLE public.radiology_reports: id, patient_id, modality, raw_findings, ai_result, status, radiologist
`;

function appendWebLinkFooter() {
    return (
        `\n\n🌐 Buka Web Platform untuk verifikasi & kelola data:\n` +
        `${WEB_PRODUCTION_URL}`
    );
}

// =============================================================
// MATRIKS KONFIGURASI OPERASIONAL ROLE DAN KLASTERISASI PROMPT AI
// =============================================================
const ROLES = {
    '1': {
        kode: 'dokter',
        nama: 'Dokter Spesialis',
        icon: '👨‍⚕️',
        systemPrompt: `Kamu adalah Clinical Decision Support System (CDSS) LexiMed.ai milik RS UNS. Analisis data klinis yang diberikan dokter, susun draf assessment medis dalam format SOAP (Subjective, Objective, Assessment, Plan), tentukan tingkat kegawatdaruratan (skala 1-5 ESI), dan berikan rekomendasi tindakan medis.`
    },
    '2': {
        kode: 'perawat',
        nama: 'Perawat Klinis',
        icon: '👩‍⚕️',
        systemPrompt: `Kamu adalah AI Perawat LexiMed.ai RS UNS. Ekstrak data TTV (Tensi, Nadi, Suhu, SpO2) dari narasi bebas perawat, identifikasi masalah keperawatan prioritas menggunakan format NANDA, dan susun intervensi keperawatan NIC yang tepat.`
    },
    '3': {
        kode: 'radiologi',
        nama: 'Radiologi Ekspert',
        icon: '🩻',
        systemPrompt: `Kamu adalah Radiology Expert AI LexiMed.ai RS UNS. Analisis temuan radiologi dari deskripsi teks atau gambar medis (rontgen, CT-scan, MRI). Identifikasi temuan patologis dan buat draf KESAN/KESIMPULAN radiologi.`
    },
    '4': {
        kode: 'asisten',
        nama: 'Asisten Dokter',
        icon: '📋',
        systemPrompt: `Kamu adalah Assistant Medical Registrar LexiMed.ai RS UNS. Strukturkan dan rapikan pencatatan medis dari narasi bebas menjadi format rekam medis elektronik (RME) standar Kemenkes RI.`
    },
    '5': {
        kode: 'manajemen',
        nama: 'Manajemen Eksekutif',
        icon: '📊',
        systemPrompt: `Kamu adalah AI Sistem Manajemen LexiMed.ai RS UNS. Bantu analisis data operasional, laporan statistik pasien, efisiensi unit layanan, dan berikan rekomendasi perbaikan berbasis data.`
    },
    '6': {
        kode: 'admin',
        nama: 'Administrator Sistem',
        icon: '⚙️',
        systemPrompt: `Kamu adalah AI Sistem Administrator LexiMed.ai RS UNS. Membantu kelola manajemen user, monitoring log audit, dan konfigurasi pemeliharaan ekosistem rekam medis elektronik.`
    }
};

// =============================================================
// MANAGEMENT SESSION STATE
// =============================================================
const userSessions = {};

function getSession(from) {
    if (!userSessions[from]) {
        userSessions[from] = {
            step: 'welcome', 
            selectedRoleKey: null,
            username: '',
            userRealName: '',
            userUnit: '',
            userSpecialization: '',
            token: '',
            roleKode: null,      
            selectedPatient: null,
            fetchedPatients: [] 
        };
    }
    return userSessions[from];
}

function resetSession(from) {
    userSessions[from] = { step: 'welcome', selectedRoleKey: null, username: '', userRealName: '', userUnit: '', userSpecialization: '', token: '', roleKode: null, selectedPatient: null, fetchedPatients: [] };
}

// =============================================================
// DASHBOARD VIEW INTERFACES
// =============================================================
function msgWelcome() {
    return (
        `╔═══════════════════════════════╗\n` +
        `║   🏥   ${WEB_PRODUCTION_URL}   ║\n` +
        `║  Clinical AI Decision System  ║\n` +
        `╚═══════════════════════════════╝\n\n` +
        `Selamat datang! Silakan pilih role Anda:\n\n` +
        `1️⃣   👨‍⚕️   Dokter\n` +
        `2️⃣   👩‍⚕️   Perawat\n` +
        `3️⃣   🩻   Radiologi\n` +
        `4️⃣   📋   Asisten Dokter\n` +
        `5️⃣   📊   Manajemen\n` +
        `6️⃣   ⚙️   Admin\n\n` +
        `Ketik angka pilihan (contoh: *1*)\n` +
        `Ketik *#help* untuk bantuan`
    );
}

function msgMenuRole(session) {
    const targetRole = ROLES[session.selectedRoleKey];
    let menu = `🔓 *OTORISASI MEDIS DISETUJUI*\n`;
    menu += `User Akun : ${session.username.toUpperCase()} (${session.userRealName || 'Medis'})\n`;
    menu += `Unit Kerja: ${session.userUnit || 'Umum'} | ${session.userSpecialization || '-'}\n`;
    menu += `Hak Akses : *${targetRole.nama}* ${targetRole.icon}\n`;
    menu += `${'─'.repeat(32)}\n\n`;
    menu += `Pilih menu aksi:\n\n`;

    if (session.roleKode !== 'manajemen') {
        menu += `1️⃣   📂   Lihat Daftar Pasien (Live Supabase)\n\n`;
    }
    
    menu += `💬 *INTELLIGENT BOT GENERATION AKTIF*\n`;
    menu += `Anda bisa langsung mengetik pertanyaan bebas atau instruksi klinis apa saja di bawah ini tanpa perlu menekan nomor peran lagi.\n`;
    menu += `🎙️ Pesan suara (Voice Note) otomatis diproses oleh Whisper.\n\n`;
    menu += `Ketik *#logout* untuk keluar dari akun`;
    return menu;
}

function buildKonteksKlinis(p) {
    return (
        `DATA PASIEN (Source: PostgreSQL Cloud Supabase via Web Link)\n` +
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
        `KELUHAN UTAMA DI DATABASE TABLE:\n${p.keluhan_awal || p.raw_content || 'Tidak ada keluhan tertulis.'}\n\n` +
        `Riwayat Penyakit : ${p.riwayat || '-'}\n` +
        `Alergi           : ${p.alergi || '-'}`
    );
}

// =============================================================
// OMNI CORE AI CLUSTER PIPELINE (Groq AI API Context Handler)
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
        throw new Error('Whisper Audio Error: ' + e.message);
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
                    { type: 'text', text: 'Analisis gambar medis radiologi ini dan keluarkan impresi laporan klinis.' }
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

function msgFallback(input) {
    return (
        `─── DRAFT ANALISIS LOKAL (Cloud AI Offline) ───\n\n` +
        `Input: "${String(input).substring(0, 100)}"\n\n` +
        `Rekomendasi umum:\n` +
        `1. Lakukan stabilisasi TTV segera di IGD.\n` +
        `2. Posisi semi-fowler jika ada sesak atau nyeri dada.\n` +
        `3. Siapkan EKG dan akses IV line.\n\n` +
        `⚠️ Mode offline — draf ini bukan pengganti keputusan klinis.\n` +
        `Ketik #menu untuk kembali`
    );
}

async function fetchSupabaseDataRows(session) {
    try {
        const headers = { 'Accept': 'application/json' };
        if (session.token) headers['Authorization'] = `Bearer ${session.token}`;
        const res = await axios.get(`${LARAVEL_API}/patients-list`, { headers, timeout: 8000 });
        const data = res.data.patients || res.data.data || res.data || [];
        if (data.length > 0) {
            return data.map((p, idx) => 
                `Pasien ${idx + 1}: RM=${p.no_rm || p.id}, Nama=${p.name}, Title=${p.title || 'Tn/Ny'}, Umur=${p.age}, Gender=${p.gender}, Unit=${p.unit || 'IGD'}, DPJP=${p.dpjp || '-'}, StatusKondisi=${p.status_treatment || 'Observasi'}, DiagnosaAwal=${p.keluhan_awal || p.raw_content || 'Tidak ada'}`
            ).join('\n');
        }
    } catch (_) {}
    return "TIDAK ADA REKAMAN DATA PASIEN AKTIF DI TABEL DATABASE.";
}

// =============================================================
// ENGINE GATEWAY INITIALIZE
// =============================================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
    console.log('\n══════════ LEXIMED.AI v4.3 — QR CORE ══════════');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
    console.log('═══════════════════════════════════════════════\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n══> [ONLINE SUCCESS] LexiMed.ai v4.3 — Navigation Guard Fixed! 🚀\n');
});

// =============================================================
// MAIN STREAM HANDLING MESSAGES
// =============================================================
client.on('message', async (msg) => {
    const from    = msg.from;
    const session = getSession(from);
    const text    = msg.body ? msg.body.trim() : '';

    try { const chat = await msg.getChat(); await chat.sendStateTyping(); } catch (_) {}

    if (text === '#logout' || text === '#reset') { resetSession(from); return msg.reply(msgWelcome()); }
    if (text === '#menu' && session.roleKode) { session.step = 'menu_utama'; return msg.reply(msgMenuRole(session)); }

    // ── STEP 1: PILIH ROLE DI DASHBOARD AWAL ──────────────────
    if (session.step === 'welcome') {
        if (!ROLES[text]) return msg.reply(msgWelcome());
        session.selectedRoleKey = text;
        session.step = 'auth_username';
        
        let exampleUser = `ilham_${ROLES[text].kode}`;
        if (ROLES[text].kode === 'asisten') exampleUser = "ilham_asisten";
        if (ROLES[text].kode === 'admin') exampleUser = "admin_darsi";

        return msg.reply(
            `🔐 *GERBANG OTORISASI PERAN: ${ROLES[text].nama.toUpperCase()}*\n` +
            `${'─'.repeat(30)}\n\n` +
            `Untuk menjaga keamanan rekam medis elektronik RS UNS, silakan ketik *USERNAME* akun Anda:\n\n` +
            `_(Contoh akun terdaftar: ${exampleUser})_\n\n` +
            `👉 Ketik *kembali* untuk memilih ulang Peran/Role.`
        );
    }

    // ── STEP 2: VERIFIKASI USERNAME ──────────────────────────
    if (session.step === 'auth_username') {
        if (!text) return msg.reply(`Username tidak boleh kosong.`);
        
        if (text.toLowerCase() === 'kembali' || text === '#menu' || text === '#reset') {
            resetSession(from);
            return msg.reply(msgWelcome());
        }

        session.username = text;
        session.step = 'auth_password';
        
        return msg.reply(
            `🔑 Username tersimpan: *${text}*\n\n` +
            `Silakan ketik *KATA SANDI / PASSWORD* akun Anda:\n\n` +
            `👉 Ketik *kembali* jika ingin mengubah atau memperbaiki username Anda.`
        );
    }

    // ── STEP 3: VERIFIKASI LIVE VIA ENDPOINT VERCEL BACKEND CLOUD DENGAN OPSI KEMBALI ──
    if (session.step === 'auth_password') {
        if (text.toLowerCase() === 'kembali') {
            session.step = 'auth_username';
            return msg.reply(`🔙 Berhasil kembali ke langkah sebelumnya.\n\nSilakan ketik kembali *USERNAME* Anda yang benar:`);
        }

        await msg.reply(`⏳ Menghubungkan kredensial ke database rs_uns_db (PostgreSQL Cloud)...`);
        try {
            const form = new FormData();
            form.append('username', session.username);
            form.append('password', text);

            const res = await axios.post(`${LARAVEL_API}/token`, form, {
                headers: { ...form.getHeaders(), 'Accept': 'application/json' },
                timeout: 12000
            });

            const data = res.data;
            if (data.success === false || !data.user) {
                session.step = 'auth_username';
                return msg.reply(`❌ Verifikasi Gagal: Kata sandi atau Username salah.\n\nSilakan ketik ulang *USERNAME* Anda:`);
            }

            let fetchedRole = data.user.role ? data.user.role.toLowerCase() : '';
            if (fetchedRole === 'asisten_dokter') fetchedRole = 'asisten';

            const expectedRole = ROLES[session.selectedRoleKey].kode;

            if (fetchedRole !== expectedRole) {
                session.step = 'auth_username';
                return msg.reply(
                    `❌ Akses Ditolak!\n` +
                    `Akun ini di database terdaftar sebagai *${fetchedRole.toUpperCase()}*, ` +
                    `bukan *${expectedRole.toUpperCase()}* yang Anda pilih di menu awal.\n\n` +
                    `Masukkan kembali *USERNAME* Anda:`
                );
            }

            session.token              = data.access_token || '';
            session.roleKode           = fetchedRole;
            session.userRealName       = data.user.name || session.username;
            session.userUnit           = data.user.unit || 'Umum';
            session.userSpecialization = data.user.specialization || 'Umum';
            session.step               = 'menu_utama';

            return msg.reply(msgMenuRole(session) + appendWebLinkFooter());

        } catch (err) {
            console.error('[API AUTH CORRUPTION]:', err.message);
            session.step = 'auth_username';
            return msg.reply(`❌ Verifikasi Gagal: Gagal sinkronisasi data kredensial.\n\nPastikan format teks besar/kecil sesuai dan web backend merespon.\n\nKetik kembali *USERNAME* Anda:`);
        }
    }

    // ── STEP 4: ROUTING UTAMA KLASTER MENU YANG SUDAH TERVERIFIKASI ──
    if (session.step === 'menu_utama') {
        const targetRoleConfig = ROLES[session.selectedRoleKey];

        if (msg.type === 'ptt' || msg.type === 'audio') {
            await msg.reply(`🎙️ Membuka dokumen pesan suara via Groq Whisper v3...`);
            try {
                const media     = await msg.downloadMedia();
                const transkrip = await transkripVoice(media.data, media.mimetype);
                await msg.reply(`📝 *Hasil Transkripsi Suara:* "${transkrip}"\n\nMencari relasi data klinis...`);
                
                const dbContext = await fetchSupabaseDataRows(session);
                const combinedPrompt = `USER REALNAME: ${session.userRealName}\nUNIT: ${session.userUnit}\nROLE: ${targetRoleConfig.nama}\n\nDATA PASIEN AKTIF SUPABASE:\n${dbContext}\n\nJawab transkripsi suara user secara terstruktur polos tanpa simbol markdown.`;
                const aiRes = await tanyaAI(combinedPrompt, transkrip);
                return msg.reply(`🤖 *RESPONS INSTAN AGENT (VOICE — LIVE CLOUD)*\n${'─'.repeat(30)}\n\n${aiRes}\n\n${'─'.repeat(30)}` + appendWebLinkFooter());
            } catch (err) {
                return msg.reply(`⚠️ Gagal mengenali enkripsi audio: ${err.message}`);
            }
        }

        if (msg.type === 'image') {
            if (session.roleKode === 'radiologi') return handleGambar(msg, session);
            return msg.reply(`🖼️ Fitur ekstraksi Vision dikunci untuk selain tim Radiologi.`);
        }

        if (text === '1' && session.roleKode !== 'manajemen') {
            await msg.reply(`⏳ Menarik data pasien riil dari PostgreSQL via API Cloud Vercel...`);
            try {
                const headers = { 'Accept': 'application/json' };
                if (session.token) headers['Authorization'] = `Bearer ${session.token}`;

                const response = await axios.get(`${LARAVEL_API}/patients-list`, { headers, timeout: 10000 });
                const patients = response.data.patients || response.data.data || response.data || [];

                if (patients.length === 0) {
                    return msg.reply(`⚠️ Koneksi berhasil, namun data tabel pasien kosong.\n\nKetik *#menu* untuk kembali.`);
                }

                session.fetchedPatients = patients;
                session.step = 'pilih_pasien';

                const totalPasien = patients.length;

                let txt = `📋 *DAFTAR PASIEN RIIL (${totalPasien} TERDAFTAR DI SUPABASE)*\n`;
                txt += `${'─'.repeat(32)}\n\n`;
                patients.slice(0, 10).forEach((p, i) => {
                    const st = p.status_treatment || 'Observasi';
                    const icon = st === 'Kritis' ? '🔴' : st === 'Observasi' ? '🟡' : '🟢';
                    txt += `*${i + 1}. ${p.title || 'Tn/Ny'}. ${p.name}* (RM: ${p.no_rm || p.id})\n`;
                    txt += `   🩺 Kondisi: ${icon} ${st} | Unit: ${p.unit || 'IGD'}\n`;
                    txt += `   👨‍⚕️ DPJP: ${p.dpjp || '-'}\n`;
                    txt += `   📝 Diagnosa Awal: ${p.keluhan_awal || p.raw_content || 'Belum ada input keluhan.'}\n\n`;
                });
                txt += `Ketik nomor urutan pasien untuk detail rekam medis:`;
                return msg.reply(txt);

            } catch (err) {
                return msg.reply(`❌ Jalur API Cloud Vercel terputus. Pastikan deployment aktif.`);
            }
        }

        if (text && text !== '1') {
            await msg.reply(`🔍 Mengekstrak konteks database online untuk Akun *${session.userRealName}*...`);
            try {
                const dbContext = await fetchSupabaseDataRows(session);
                
                const augmentedPrompt = 
                    `INFORMASI OTORISASI REKAM MEDIS:\n` +
                    `- User yang sedang bertanya: ${session.userRealName}\n` +
                    `- Username akun: ${session.username}\n` +
                    `- Unit kerja user: ${session.userUnit}\n` +
                    `- Otoritas Peran Medis: ${targetRoleConfig.nama}\n\n` +
                    `KONTEKS DATA REKAM MEDIS REALTIME DI DATABASE SUPABASE:\n${dbContext}\n\n` +
                    `SKEMA STRUKTUR DATABASE:\n${DATABASE_CONTEXT_SCHEMA}\n\n` +
                    `Tugasmu: Jawab pertanyaan user secara akurat, spesifik, and hitung jumlah baris data di atas jika ditanya kuantitas (misal: total pasien hari ini). Hasilkan keluaran berupa teks polos terstruktur yang rapi bagi tenaga medis rumah sakit tanpa simbol markdown bintang ganda atau tagar.`;

                const hasil = await tanyaAI(augmentedPrompt, text);
                return msg.reply(
                    `🤖 *RESPONS INSTAN AGENT (${session.roleKode.toUpperCase()} — LIVE CLOUD)*\n` +
                    `${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}` +
                    appendWebLinkFooter()
                );
            } catch (e) {
                return msg.reply(msgFallback(text));
            }
        }
    }

    // ── STEP 5: TAMPILAN DETAIL REKAM MEDIS REAL PASIEN ───────
    if (session.step === 'pilih_pasien') {
        const idx = parseInt(text) - 1;
        const p = session.fetchedPatients[idx];
        if (!isNaN(idx) && p) {
            session.selectedPatient = p;
            session.step = 'aksi_pasien';

            return msg.reply(
                `📁 *REKAM MEDIS PASIEN — ${p.title || 'Tn/Ny'}. ${p.name}*\n${'─'.repeat(32)}\n` +
                `🪪 No. RM  : ${p.no_rm || p.id}\n` +
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
                `*B* — 📝 Buat Ringkasan RME Kemenkes\n` +
                `*C* — 🔙 Kembali ke dashboard`
            );
        }
        return msg.reply(`⚠️ Indeks salah. Pilih nomor 1 sampai ${session.fetchedPatients.length}.`);
    }

    // ── STEP 6: PROSES DATA KLINIS & PUSH KE LIVE CLINICAL_DATA DB ──
    if (session.step === 'aksi_pasien') {
        const p = session.selectedPatient;
        const targetRoleConfig = ROLES[session.selectedRoleKey];
        if (!p) { session.step = 'menu_utama'; return msg.reply(msgMenuRole(session)); }

        if (text.toLowerCase() === 'a') {
            await msg.reply(`⏳ Menghubungkan klaster AI untuk mengekstrak draf rekam medis...`);
            const konteks = buildKonteksKlinis(p);
            try {
                const aiResult = await tanyaAI(targetRoleConfig.systemPrompt, konteks);
                
                const payload = {
                    patient_id: p.no_rm || p.id,
                    blood_pressure: p.blood_pressure || p.tensi || "-",
                    heart_rate: p.heart_rate || p.nadi || "-",
                    temperature: p.temperature || p.suhu || "-",
                    oxygen_saturation: p.oxygen_saturation || p.spo2 || "-",
                    source: 'whatsapp',
                    raw_content: p.keluhan_awal || p.raw_content || "WhatsApp Input Data",
                    ai_summary: aiResult,
                    status: 'draft'
                };

                const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
                if (session.token) headers['Authorization'] = `Bearer ${session.token}`;
                await axios.post(`${LARAVEL_API}/clinical-data`, payload, { headers, timeout: 10000 });

                session.step = 'menu_utama';
                return msg.reply(
                    `🤖 *ANALISIS AI PASIEN — ${p.name}*\n` +
                    `${'─'.repeat(32)}\n\n${aiResult}\n\n${'─'.repeat(32)}\n\n` +
                    `✅ [POSTGRESQL SYNCED] Sukses menyisipkan berkas menuju tabel clinical_data!` +
                    appendWebLinkFooter() + `\n\nKetik *#menu* untuk kembali.`
                );
            } catch (e) {
                return msg.reply(msgFallback(konteks));
            }
        }

        if (text.toLowerCase() === 'b') {
            await msg.reply(`📝 Menyusun resume medis standar regulasi SatuSehat...`);
            const prompt = `Susun resume medis formal berpatokan pada regulasi SatuSehat RME Kemenkes RI berdasarkan data riil database berikut:\n\n` + buildKonteksKlinis(p);
            try {
                const hasil = await tanyaAI(targetRoleConfig.systemPrompt, prompt);
                session.step = 'menu_utama';
                return msg.reply(
                    `📋 *RESUME ELEKTRONIK REKAM MEDIS (RME)*\n` +
                    `${p.name} — ${p.no_rm || p.id}\n` +
                    `${'─'.repeat(32)}\n\n${hasil}\n\n${'─'.repeat(32)}` +
                    appendWebLinkFooter() + `\n\nKetik *#menu* untuk kembali.`
                );
            } catch (e) {
                return msg.reply(`❌ Gagal merangkum resume: ${e.message}`);
            }
        }

        if (text.toLowerCase() === 'c') {
            session.step = 'menu_utama';
            return msg.reply(msgMenuRole(session));
        }
        return msg.reply(`Ketik opsi A, B, atau C.`);
    }

    // ── STEP: TUNGGU LAMPIRAN CITRA RADIOLOGI ────────────────
    if (session.step === 'tunggu_gambar') {
        if (msg.type === 'image') return handleGambar(msg, session);
        return msg.reply(`Silakan lampirkan gambar radiologi atau ketik *#menu*.`);
    }

    msg.reply(msgWelcome());
});

// =============================================================
// SUB-ROUTINE HANDLER: VISUAL IMAGING LLAMA VISION EXTRACTOR
// =============================================================
async function handleGambar(msg, session) {
    await msg.reply(`🩻 Citra rontgen diterima. Memproses analisis multimodal...`);
    try {
        const media   = await msg.downloadMedia();
        const targetRoleConfig = ROLES[session.selectedRoleKey];
        const hasil   = await analisisGambar(media.data, media.mimetype, targetRoleConfig.systemPrompt);

        return msg.reply(
            `🩻 *DRAF LAPORAN EVALUASI RADIOLOGI AI*\n` +
            `${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}\n` +
            `⚠️ *PERINGATAN*: Hasil interpretasi ini wajib divalidasi ulang oleh spesialis Dokter Sp.Rad.` +
            appendWebLinkFooter() + `\n\nKetik *#menu* untuk kembali.`
        );
    } catch (e) {
        return msg.reply(`⚠️ Gagal membedah berkas citra: ${e.message}`);
    }
}

client.initialize();