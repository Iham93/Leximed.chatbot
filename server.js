// =============================================================
// LEXIMED.AI — WhatsApp Agent v3.8 (Unified Interactive Infrastructure)
// Aligned with LexiMed Web Platform (Laravel + React Login Control)
//
// Flow: WA Input Credential → Validate via Laravel API /token → 
//       Lock Role Session Token → Live Fetch/Post PostgreSQL (rs_uns_db)
// Features: 
//   - Interactive Welcome Box Dashboard with Real Vercel Production Link
//   - Automated Role Selection Handling
//   - Dynamic Live Credential Verification via Laravel Local API (/token)
//   - Full Role Access Management (Including New 'Admin' Role Configuration)
//   - 100% Live Fetch & Post with PostgreSQL Local Database (rs_uns_db)
// =============================================================

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode                 = require('qrcode-terminal');
const axios                  = require('axios');
const fs                     = require('fs');
const path                   = require('path');
const FormData               = require('form-data');

// ── API Keys & Config ──────────────────────────────────────────
const GROQ_API_KEY  = process.env.GROQ_API_KEY  || "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";

// API Base URL mengarah ke port 8000 lokal sesuai dengan konfigurasi file React Login Anda
const LARAVEL_API   = process.env.LARAVEL_API_URL || "http://127.0.0.1:8000/api";

// URL Web Application Production resmi milik Anda yang terdeploy di Vercel
const WEB_PRODUCTION_URL = "https://leximedai-olivia2026-web-technology.vercel.app/";

// Raw Metadata Skema Database public.* untuk Injeksi Contextual Text-to-SQL AI
const DATABASE_CONTEXT_SCHEMA = `
- TABLE public.users: id, name, username, role, specialization, unit, status
- TABLE public.patients: no_rm (PK), title, name, age, gender, unit, dpjp, status_treatment
- TABLE public.pemeriksaan_awals: id, patient_id (FK to patients.no_rm), tensi, nadi, suhu, spo2, keluhan_awal, source
- TABLE public.clinical_data: id, patient_id, source, raw_content, ai_summary, status, blood_pressure, heart_rate, temperature, oxygen_saturation
- TABLE public.radiology_reports: id, patient_id, modality, raw_findings, ai_result, status, radiologist
- TABLE public.executive_reports: id, topic, summary_content, status, created_by
`;

// Helper Footer tautan terintegrasi
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

    // Fitur Kontrol Akses Berdasarkan Role
    if (session.roleKode !== 'manajemen') {
        menu += `1️⃣   📂   Lihat Daftar Pasien (Live Supabase)\n`;
        menu += `2️⃣   💬   Contextual Tanya AI / Konsultasi Bebas\n`;
        if (session.roleKode === 'radiologi') {
            menu += `3️⃣   🩻   Analisis Foto/Gambar Radiologi\n`;
        }
    } else {
        menu += `1️⃣   💬   Input Data & Analisis Eksekutif Rumah Sakit\n`;
    }

    menu += `\n🎙️   *Voice note* → otomatis ditranskrip oleh Whisper\n`;
    menu += `\nKetik *#logout* untuk keluar dari akun`;
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

// =============================================================
// ENGINE GATEWAY INITIALIZE
// =============================================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
    console.log('\n══════════ LEXIMED.AI v3.8 — QR CORE ══════════');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
    console.log('═══════════════════════════════════════════════\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n══> [ONLINE SUCCESS] LexiMed.ai v3.8 — Fixed API Destination Active! 🚀\n');
});

// =============================================================
// MAIN STREAM HANDLING MESSAGES
// =============================================================
client.on('message', async (msg) => {
    const from    = msg.from;
    const session = getSession(from);
    const text    = msg.body ? msg.body.trim() : '';

    try { const chat = await msg.getChat(); await chat.sendStateTyping(); } catch (_) {}

    // Global Command Control Management
    if (text === '#logout' || text === '#reset') { resetSession(from); return msg.reply(msgWelcome()); }
    if (text === '#menu' && session.roleKode) { session.step = 'menu_utama'; return msg.reply(msgMenuRole(session)); }

    // ── STEP 1: PILIH ROLE DI DASHBOARD AWAL ──────────────────
    if (session.step === 'welcome') {
        if (!ROLES[text]) return msg.reply(msgWelcome());
        session.selectedRoleKey = text;
        session.step = 'auth_username';
        
        // Pengecekan otomatis untuk menampilkan contoh kredensial seeder lokal sesuai tombol yang dipilih
        let exampleUser = `ilham_${ROLES[text].kode}`;
        if (ROLES[text].kode === 'asisten') exampleUser = "ilham_asisten";
        if (ROLES[text].kode === 'admin') exampleUser = "admin_darsi";

        return msg.reply(
            `🔐 *GERBANG OTORISASI PERAN: ${ROLES[text].nama.toUpperCase()}*\n` +
            `${'─'.repeat(30)}\n\n` +
            `Untuk menjaga keamanan rekam medis elektronik RS UNS, silakan ketik *USERNAME* akun Anda:\n\n` +
            `_(Contoh akun terdaftar: ${exampleUser})_`
        );
    }

    // ── STEP 2: VERIFIKASI USERNAME ──────────────────────────
    if (session.step === 'auth_username') {
        if (!text) return msg.reply(`Username tidak boleh kosong.`);
        session.username = text;
        session.step = 'auth_password';
        return msg.reply(`🔑 Username tersimpan: *${text}*\n\nSilakan ketik *KATA SANDI / PASSWORD* akun Anda:`);
    }

    // ── STEP 3: POST TOKEN VERIFICATION KE BACKEND LARAVEL LOKAL DB POSTGRESQL ──
    if (session.step === 'auth_password') {
        await msg.reply(`⏳ Menghubungkan kredensial ke database rs_uns_db (PostgreSQL)...`);
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
                return msg.reply(`❌ Verifikasi Gagal: Kata sandi atau Username salah.\n\nSilakan ketik ulang *USERNAME* Anda:`);
            }

            // Normalisasi penamaan role dari Laravel Sanctum Payload
            let fetchedRole = data.user.role ? data.user.role.toLowerCase() : '';
            if (fetchedRole === 'asisten_dokter') fetchedRole = 'asisten';

            const expectedRole = ROLES[session.selectedRoleKey].kode;

            // Validasi cross-check role pilihan dengan data record asli DB
            if (fetchedRole !== expectedRole) {
                session.step = 'auth_username';
                return msg.reply(
                    `❌ Akses Ditolak!\n` +
                    `Akun ini di database terdaftar sebagai *${fetchedRole.toUpperCase()}*, ` +
                    `bukan *${expectedRole.toUpperCase()}* yang Anda pilih di menu awal.\n\n` +
                    `Masukkan kembali *USERNAME* Anda:`
                );
            }

            // Kunci kredensial dinamis ke session state runtime
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
            return msg.reply(`❌ Gagal terhubung ke Local Server Backend.\n\nPastikan backend server port 8000 menyala (*php artisan serve*).\n\nKetik kembali *USERNAME* Anda:`);
        }
    }

    // ── STEP 4: ROUTING UTAMA KLASTER MENU YANG SUDAH TERVERIFIKASI ──
    if (session.step === 'menu_utama') {
        const targetRoleConfig = ROLES[session.selectedRoleKey];

        if (msg.type === 'ptt' || msg.type === 'audio') return handleVoice(msg, session);
        if (msg.type === 'image') {
            if (session.roleKode === 'radiologi') return handleGambar(msg, session);
            return msg.reply(`🖼️ Fitur ekstraksi Vision dikunci untuk selain tim Radiologi.`);
        }

        // REVISI ENDPOINT FIX: Menembak route asli /patients-list bawaan controller Laravel-mu
        if (text === '1' && session.roleKode !== 'manajemen') {
            await msg.reply(`⏳ Menarik data pasien riil dari PostgreSQL via API Local...`);
            try {
                const headers = { 'Accept': 'application/json' };
                if (session.token) headers['Authorization'] = `Bearer ${session.token}`;

                const response = await axios.get(`${LARAVEL_API}/patients-list`, { headers, timeout: 8000 });
                
                // Normalisasi pembacaan wrapper data dari Laravel array payload
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
                console.error('[FETCH PATIENTS ERROR]:', err.message);
                return msg.reply(`❌ Jalur API local terputus. Pastikan backend server aktif.\n\nKetik *#menu* untuk kembali.`);
            }
        }

        const konsultasiKey = (session.roleKode !== 'manajemen' ? '2' : '1');
        if (text === konsultasiKey) {
            session.step = 'konsultasi';
            return msg.reply(`💬 *KONSULTASI INTERAKTIF & TANYA AI BEBAS (${session.roleKode.toUpperCase()})*\n\nSistem AI saat ini telah mengenali Anda sebagai *${session.userRealName}* di unit *${session.userUnit}*.\nAnda bisa menanyakan data pasien secara bebas tanpa perlu mengetik nama Anda sendiri.\n\nKetik *#menu* untuk kembali.`);
        }

        if (text === '3' && session.roleKode === 'radiologi') {
            session.step = 'tunggu_gambar';
            return msg.reply(`🩻 *DIVISI RADIOLOGI IMAGING SELECTION*\n\nSilakan lampirkan gambar rontgen/CT-Scan.\n\nKetik *#menu* untuk batal.`);
        }

        return msg.reply(msgMenuRole(session));
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
                
                // Post hasil AI otomatis ke tabel clinical_data di PostgreSQL lokal
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
                await axios.post(`${LARAVEL_API}/clinical-data`, payload, { headers, timeout: 8000 });

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

    // ── STEP: KONSULTASI INTERAKTIF / VOICE ──────────────────
    if (session.step === 'konsultasi') {
        const targetRoleConfig = ROLES[session.selectedRoleKey];
        if (msg.type === 'ptt' || msg.type === 'audio') return handleVoice(msg, session);
        if (!text) return;

        await msg.reply(`🔍 Mengekstrak konteks database online untuk Akun *${session.userRealName}*...`);

        const augmentedPrompt = 
            `INFORMASI OTORISASI REKAM MEDIS:\n` +
            `- User yang sedang bertanya: ${session.userRealName}\n` +
            `- Username akun: ${session.username}\n` +
            `- Unit kerja user: ${session.userUnit}\n` +
            `- Otoritas Peran Medis: ${targetRoleConfig.nama}\n\n` +
            `KONTEKS SKEMA REKAM MEDIS RUMAH SAKIT UNS:\n${DATABASE_CONTEXT_SCHEMA}\n\n` +
            `Tugasmu: Jawab pertanyaan user dengan memposisikan dirimu mengetahui data di atas. Jangan buat query SQL mentah di chat, berikan jawaban teks polos terstruktur yang natural dan ramah bagi tenaga medis rumah sakit.`;

        try {
            const hasil = await tanyaAI(augmentedPrompt, text);
            return msg.reply(
                `🤖 *RESPONS INSTAN AGENT (${session.roleKode.toUpperCase()} — CLOUD AI)*\n` +
                `${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}` +
                appendWebLinkFooter() + `\n\nKetik *#menu* untuk kembali.`
            );
        } catch (e) {
            return msg.reply(msgFallback(text));
        }
    }

    // ── STEP: TUNGGU LAMPIRAN CITRA RADIOLOGI ────────────────
    if (session.step === 'tunggu_gambar') {
        if (msg.type === 'image') return handleGambar(msg, session);
        return msg.reply(`Silakan lampirkan gambar radiologi atau ketik *#menu*.`);
    }

    msg.reply(msgWelcome());
});

// =============================================================
// HANDLER AUDIO PIPELINE WHISPER TRANSCRIPTION
// =============================================================
async function handleVoice(msg, session) {
    await msg.reply(`🎙 ... Membuka dokumen pesan suara via Groq Whisper v3 ...`);
    try {
        const media     = await msg.downloadMedia();
        const transkrip = await transkripVoice(media.data, media.mimetype);

        await msg.reply(`📝 *Hasil Transkripsi:* "${transkrip}"\n\nMeneruskan menuju AI Core Engine...`);

        const targetRoleConfig = ROLES[session.selectedRoleKey];
        const hasil = await tanyaAI(targetRoleConfig.systemPrompt, transkrip);

        return msg.reply(
            `🤖 *Kompilasi Medis via Voice Suara — ${session.roleKode.toUpperCase()}*\n` +
            `${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}` +
            appendWebLinkFooter() + `\n\nKetik *#menu* untuk kembali.`
        );
    } catch (e) {
        return msg.reply(`⚠️ Gagal memproses enkripsi audio: ${e.message}`);
    }
}

// =============================================================
// HANDLER VISUAL IMMAGING LLAMA VISION EXTRACTOR
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