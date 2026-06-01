// =============================================================
// LEXIMED.AI — WhatsApp Agent v3.3 (100% Live Local DB PostgreSQL)
// Aligned with LexiMed Web Platform (Laravel + React)
//
// Flow: Input → Tarik Pasien Real DB → AI Ekstraksi → Post DB
// Source: whatsapp (sama seperti field 'source' di ClinicalData)
// =============================================================

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode                 = require('qrcode-terminal');
const axios                  = require('axios');
const fs                     = require('fs');
const path                   = require('path');
const FormData               = require('form-data');

// ── API Keys & Config ──────────────────────────────────────────
const GROQ_API_KEY  = process.env.GROQ_API_KEY  || "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";

// Endpoint API sesuai dengan file .env backend Laravel lokal kamu
const LARAVEL_API   = process.env.LARAVEL_API_URL || "http://localhost:8000/api";
const LARAVEL_TOKEN = process.env.LARAVEL_API_TOKEN || ""; 

// URL Web Application Production untuk Link Redirection di WhatsApp
const WEB_PRODUCTION_URL = "https://leximedai-olivia2026-web-technology.vercel.app/";

// Helper untuk menyisipkan pesan penutup dan link web di setiap akhir response AI
function appendWebLinkFooter() {
    return (
        `\n\n🌐 Buka Web Platform untuk verifikasi & kelola data:\n` +
        `${WEB_PRODUCTION_URL}`
    );
}

// =============================================================
// KONFIGURASI ROLE — Konsep CDSS Integrasi dengan User & Web
// =============================================================
const ROLES = {
    '1': {
        kode: 'dokter',
        nama: 'Dokter',
        icon: '👨‍⚕️',
        systemPrompt: `Kamu adalah Clinical Decision Support System (CDSS) LexiMed.ai milik RS UNS.
Tugasmu: analisis data klinis yang diberikan dokter, susun draf assessment medis dalam format SOAP (Subjective, Objective, Assessment, Plan), tentukan tingkat kegawatdaruratan (skala 1-5 ESI), dan berikan rekomendasi tindakan berbasis evidence-based medicine.
Sertakan juga: kemungkinan diagnosis banding, pemeriksaan penunjang yang direkomendasikan, dan catatan alergi jika relevan.`,
        bisaLihatPasien: true,
        bisaVerifikasi: true
    },
    '2': {
        kode: 'perawat',
        nama: 'Perawat',
        icon: '👩‍⚕️',
        systemPrompt: `Kamu adalah AI Perawat LexiMed.ai RS UNS.
Tugasmu: ekstrak data TTV (Tensi/TD, Nadi/HR, Suhu, SpO2) dari narasi bebas perawat, identifikasi masalah keperawatan prioritas menggunakan format NANDA, dan susun intervensi keperawatan NIC yang tepat.
Format output: 
  DATA TTV: [TD] [Nadi] [Suhu] [SpO2]
  MASALAH KEPERAWATAN (NANDA): ...
  INTERVENSI (NIC): ...
  CATATAN: ...`,
        bisaLihatPasien: true,
        bisaVerifikasi: false
    },
    '3': {
        kode: 'radiologi',
        nama: 'Radiologi',
        icon: '🩻',
        systemPrompt: `Kamu adalah Radiology Expert AI LexiMed.ai RS UNS.
Tugasmu: analisis temuan radiologi dari deskripsi teks atau gambar medis (rontgen, CT-scan, MRI, USG). Identifikasi: organ yang diperiksa, temuan patologis (infiltrat, massa, lesi, fraktur, cairan), ukuran/distribusi jika disebutkan, dan buat draf KESAN/KESIMPULAN radiologi yang ringkas dan sistematis.
Format output:
  JENIS PEMERIKSAAN: ...
  TEMUAN: ...
  KESAN: ...
  SARAN: ...`,
        bisaLihatPasien: true,
        bisaAnalisisGambar: true,
        bisaVerifikasi: false
    },
    '4': {
        kode: 'asisten_dokter',
        nama: 'Asisten Dokter',
        icon: '📋',
        systemPrompt: `Kamu adalah Assistant Medical Registrar LexiMed.ai RS UNS.
Tugasmu: strukturkan dan rapikan pencatatan medis dari narasi bebas tenaga medis. Hasilkan rekam medis terformat meliputi: identitas pasien, keluhan utama, riwayat penyakit sekarang (RPS), riwayat penyakit dahulu (RPD), riwayat alergi, pemeriksaan fisik jika ada, dan kesan awal.
Format standar sesuai rekam medis elektronik (RME) Kemenkes RI.`,
        bisaLihatPasien: true,
        bisaVerifikasi: false
    },
    '5': {
        kode: 'manajemen',
        nama: 'Manajemen',
        icon: '📊',
        systemPrompt: `Kamu adalah AI Sistem Manajemen LexiMed.ai RS UNS.
Bantu analisis data operasional, laporan statistik pasien, efisiensi unit layanan, dan berikan rekomendasi perbaikan berdasarkan data yang disajikan. Gunakan kerangka analisis PDCA atau Balanced Scorecard jika relevan.`,
        bisaLihatPasien: false,
        bisaVerifikasi: false
    }
};

// =============================================================
// SESSION MANAGEMENT — State per user WhatsApp
// =============================================================
const userSessions = {};

function getSession(from) {
    if (!userSessions[from]) {
        userSessions[from] = {
            step: 'welcome', 
            role: null,      
            selectedPatient: null,
            fetchedPatients: [] // Menyimpan catch data pasien dari API lokal secara dinamis
        };
    }
    return userSessions[from];
}

function resetSession(from) {
    userSessions[from] = { step: 'welcome', role: null, selectedPatient: null, fetchedPatients: [] };
}

// =============================================================
// TEKS INTERAKSI INTERFACES
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
        `5️⃣   📊   Manajemen\n\n` +
        `Ketik angka pilihan (contoh: *1*)\n` +
        `Ketik *#help* untuk bantuan`
    );
}

function msgMenuRole(roleKey) {
    const r = ROLES[roleKey];
    let menu = `✅ Mode *${r.nama}* ${r.icon} aktif\n`;
    menu += `${'─'.repeat(32)}\n\n`;
    menu += `Pilih aksi:\n\n`;

    if (r.bisaLihatPasien) {
        menu += `1️⃣   📂   Lihat Daftar Pasien (Live DB)\n`;
        menu += `2️⃣   💬   Konsultasi / Input Klinis\n`;
        if (r.bisaAnalisisGambar) {
            menu += `3️⃣   🩻   Analisis Foto/Gambar Radiologi\n`;
        }
    } else {
        menu += `1️⃣   💬   Input Data / Pertanyaan\n`;
    }

    menu += `\n🎙️   *Voice note* → transkrip otomatis\n`;
    menu += `\nKetik *#ganti* untuk ganti role\nKetik *#reset* untuk mulai ulang`;
    return menu;
}

function buildKonteksKlinis(p) {
    return (
        `DATA PASIEN (Source: DB rs_uns_db via whatsapp)\n` +
        `No. RM    : ${p.no_rm}\n` +
        `Nama      : ${p.title || 'Tn/Ny'}. ${p.name}, ${p.age || '-'} tahun, ${p.gender || '-'}\n` +
        `Unit      : ${p.unit || 'IGD'}\n` +
        `DPJP      : ${p.dpjp || '-'}\n` +
        `Status    : ${p.status_treatment || 'Observasi'}\n\n` +
        `PEMERIKSAAN AWAL / VITAL SIGN:\n` +
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
// LIVE POST: KIRIM HASIL KE DATABASE POSTGRESQL (LARAVEL API)
// =============================================================
async function postClinicalDataToLaravel(patientId, rawContent, aiSummary, patientObj) {
    try {
        const payload = {
            patient_id:        patientId,
            blood_pressure:    patientObj.blood_pressure || patientObj.tensi || "-",
            heart_rate:        patientObj.heart_rate || patientObj.nadi || "-",
            temperature:       patientObj.temperature || patientObj.suhu || "-",
            oxygen_saturation: patientObj.oxygen_saturation || patientObj.spo2 || "-",
            source:            'whatsapp',
            raw_content:       rawContent || "Input via WhatsApp Gateway",
            ai_summary:        aiSummary,
            status:            'draft'   
        };

        const config = {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            timeout: 8000
        };
        if (LARAVEL_TOKEN) config.headers['Authorization'] = `Bearer ${LARAVEL_TOKEN}`;

        const res = await axios.post(`${LARAVEL_API}/clinical-data`, payload, config);
        return res.data;
    } catch (e) {
        console.error('[LARAVEL API POST ERROR]:', e.message);
        return null;
    }
}

// =============================================================
// OMNI CORE AI CLUSTER (Groq AI API Engine)
// =============================================================
async function tanyaAI(systemPrompt, userContent) {
    const noMarkdown = ` PENTING: Jangan gunakan simbol markdown seperti bintang ganda (**), tagar (#), atau backtick. Hasilkan teks polos terstruktur yang rapi dan mudah dibaca di layar WhatsApp.`;
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: systemPrompt + noMarkdown },
            { role: 'user',   content: userContent }
        ],
        temperature: 0.3,
        max_tokens: 1024
    }, {
        headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json'
        },
        timeout: 20000
    });
    return res.data.choices[0].message.content;
}

async function transkripVoice(base64Data, mimeType) {
    const tmpPath = path.join('/tmp', `lxm_voice_${Date.now()}.ogg`);
    try {
        fs.writeFileSync(tmpPath, Buffer.from(base64Data, 'base64'));

        const form = new FormData();
        form.append('file', fs.createReadStream(tmpPath), {
            filename: 'audio.ogg',
            contentType: mimeType || 'audio/ogg'
        });
        form.append('model', 'whisper-large-v3');
        form.append('language', 'id');
        form.append('response_format', 'text');

        const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                ...form.getHeaders()
            },
            timeout: 30000
        });

        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        return typeof res.data === 'string' ? res.data : res.data.text || JSON.stringify(res.data);
    } catch (e) {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        throw new Error('Whisper Integration Failed: ' + e.message);
    }
}

async function analisisGambar(base64Data, mimeType, systemPrompt) {
    const noMarkdown = ` Jangan gunakan markdown bintang ganda atau tagar. Keluarkan output berupa teks polos terstruktur yang rapi untuk platform pesan WhatsApp.`;
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama-3.2-11b-vision-preview', 
        messages: [
            { role: 'system', content: systemPrompt + noMarkdown },
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: { url: `data:${mimeType};base64,${base64Data}` }
                    },
                    {
                        type: 'text',
                        text: 'Analisis gambar medis (radiologi/dokumen klinis) ini. Buat hasil pemeriksaan sistematis, draf kesan awal, dan rekomendasi tindak lanjut.'
                    }
                ]
            }
        ],
        temperature: 0.2,
        max_tokens: 1024
    }, {
        headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json'
        },
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
        `3. Siapkan EKG dan akses IV line.\n` +
        `4. Cek riwayat alergi sebelum pemberian obat.\n\n` +
        `⚠️ Mode offline — draf ini bukan pengganti keputusan klinis.\n` +
        `Ketik #menu untuk kembali`
    );
}

// =============================================================
// INITIALIZE WHATSAPP CLIENT RUNTIME
// =============================================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
    console.log('\n══════════ LEXIMED.AI v3.3 — QR CORE INTERFACES ══════════');
    console.log('Buka tautan di bawah ini pada browser untuk menampilkan Barcode:');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
    console.log('══════════════════════════════════════════════════════════\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n══> [ONLINE SUCCESS] LexiMed.ai v3.3 — Connect to PostgreSQL Local DB Active! 🚀\n');
});

// =============================================================
// ROUTING ENGINE MESSAGE HANDLER
// =============================================================
client.on('message', async (msg) => {
    const from    = msg.from;
    const session = getSession(from);
    const text    = msg.body ? msg.body.trim() : '';

    try { const chat = await msg.getChat(); await chat.sendStateTyping(); } catch (_) {}

    console.log(`[INCOMING] ${from.split('@')[0]} | step=${session.step} | role=${session.role}`);

    // ── Global Pipeline Command Control ──────────────────────
    if (text === '#reset') { resetSession(from); return msg.reply(msgWelcome()); }
    if (text === '#ganti') { session.step = 'welcome'; return msg.reply(msgWelcome()); }
    if (text === '#menu')  {
        if (session.role) { session.step = 'menu_utama'; return msg.reply(msgMenuRole(session.role)); }
        return msg.reply(msgWelcome());
    }
    if (text === '#help') {
        return msg.reply(
            `=== PANDUAN SYSTEM INTERACTIVE LEXIMED.AI ===\n\n` +
            `#menu   → Kembali ke menu utama role saat ini\n` +
            `#ganti  → Mengubah peran / role akses\n` +
            `#reset  → Mengosongkan session state dari awal\n` +
            `#help   → Menampilkan panduan sistem ini\n\n` +
            `💡 FITUR LIVE DATABASE:\n` +
            `• Angka 1 pada menu role akan langsung menembak API lokal Laravel untuk menarik data rekam medis pasien asli secara real-time dari PostgreSQL.`
        );
    }

    // ── STEP: WELCOME PIPELINE ───────────────────────────────
    if (session.step === 'welcome') {
        if (!ROLES[text]) return msg.reply(msgWelcome());
        session.role = text;
        session.step = 'menu_utama';
        const r = ROLES[text];
        
        return msg.reply(
            `🌐 *${r.nama.toUpperCase()} AI NODE ACTIVATED*\n` +
            `${'─'.repeat(30)}\n\n` +
            `Halo! Saya LexiMed.ai, Clinical Decision Support System (CDSS) RS UNS.\n` +
            `Saya siap membantu Anda menganalisis data klinis dan menyusun dokumen sesuai dengan otoritas Anda.\n\n` +
            `Silakan pilih menu instruksi di bawah untuk mulai memproses data.\n\n` +
            msgMenuRole(text) + `\n` +
            `${'─'.repeat(30)}` + 
            appendWebLinkFooter()
        );
    }

    // ── STEP: MAIN CORE MENU ─────────────────────────────────
    if (session.step === 'menu_utama') {
        const r = ROLES[session.role];

        if (msg.type === 'ptt' || msg.type === 'audio') return handleVoice(msg, session);
        if (msg.type === 'image') {
            if (r.bisaAnalisisGambar) return handleGambar(msg, session);
            return msg.reply(`🖼️ Analisis gambar multimodal hanya diizinkan untuk unit *${ROLES['3'].nama}*.\nAnda saat ini terdaftar sebagai *${r.nama}*.`);
        }

        // AKSI 1: NEMBAK DATA LIVE PATIENTS DARI LARAVEL LOCAL BACKEND
        if (text === '1' && r.bisaLihatPasien) {
            await msg.reply(`⏳ Menghubungkan ke PostgreSQL lokal via ${LARAVEL_API}/patients...`);
            try {
                const config = { headers: { 'Accept': 'application/json' }, timeout: 5000 };
                if (LARAVEL_TOKEN) config.headers['Authorization'] = `Bearer ${LARAVEL_TOKEN}`;
                
                const response = await axios.get(`${LARAVEL_API}/patients`, config);
                const patients = response.data.patients || response.data || [];

                if (patients.length === 0) {
                    return msg.reply(`⚠️ Database PostgreSQL terhubung, namun tidak ada data pasien aktif di tabel.\n\nKetik *#menu* untuk kembali.`);
                }

                session.fetchedPatients = patients; // Simpan cache data riil ke session state
                session.step = 'pilih_pasien';

                let txt = `📋 *DAFTAR PASIEN RIIL (rs_uns_db)*\n${'─'.repeat(32)}\n\n`;
                patients.slice(0, 10).forEach((p, i) => {
                    const st = p.status_treatment || 'Observasi';
                    const icon = st === 'Kritis' ? '🔴' : st === 'Observasi' ? '🟡' : '🟢';
                    txt += `*${i + 1}. ${p.title || 'Tn/Ny'}. ${p.name}*\n`;
                    txt += `   🪪 RM: ${p.no_rm}  ${icon} ${st}\n`;
                    txt += `   📍 Unit: ${p.unit || 'Umum'} | DPJP: ${p.dpjp || '-'}\n\n`;
                });
                txt += `Ketik nomor pasien untuk detail (contoh: *1*)`;
                return msg.reply(txt);

            } catch (err) {
                console.error("Gagal fetch PostgreSQL:", err.message);
                return msg.reply(`❌ Gagal menarik data dari DB Lokal Laravel.\n\nPastikan perintah *php artisan serve* aktif di port 8000.\n\nKetik *#menu* untuk kembali.`);
            }
        }

        const konsultasiKey = (r.bisaLihatPasien ? '2' : '1');
        if (text === konsultasiKey) {
            session.step = 'konsultasi';
            return msg.reply(
                `💬 *KONSULTASI INTERAKTIF AKTIF (${r.nama.toUpperCase()})*\n\n` +
                `Silakan kirim narasi klinis bebas, rekam data penunjang, atau pertanyaan medis.\n` +
                `🎙️ Input Voice Note otomatis diproses Whisper Engine.\n\n` +
                `Ketik *#menu* untuk keluar.`
            );
        }

        if (text === '3' && r.bisaAnalisisGambar) {
            session.step = 'tunggu_gambar';
            return msg.reply(
                `🩻 *UNIT DIAGNOSTIK RADIOLOGI IMAGING*\n\n` +
                `Silakan lampirkan gambar rontgen, CT-scan, MRI, atau USG.\n` +
                `Sistem AI Vision akan mengekstraksi draf impresi radiologis.\n\n` +
                `Ketik *#menu* untuk membatalkan.`
            );
        }

        return msg.reply(msgMenuRole(session.role));
    }

    // ── STEP: PATIENT QUERY LIST ─────────────────────────────
    if (session.step === 'pilih_pasien') {
        const idx = parseInt(text) - 1;
        const p = session.fetchedPatients[idx];
        if (!isNaN(idx) && p) {
            session.selectedPatient = p;
            session.step = 'aksi_pasien';

            // Kompilasi visualisasi detail data riil dari PostgreSQL
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
                `*A* — 🤖 Analisis AI (Buat draf SOAP/NANDA)\n` +
                `*B* — 📝 Ringkasan Rekam Medis (Kemenkes)\n` +
                `*C* — 🔙 Kembali ke daftar pasien`
            );
        }
        return msg.reply(`⚠️ Pilihan salah. Ketik angka 1 sampai ${session.fetchedPatients.length}.`);
    }

    // ── STEP: ACTION PIPELINE (SOAP / REKAM MEDIS) ───────────
    if (session.step === 'aksi_pasien') {
        const p = session.selectedPatient;
        const r = ROLES[session.role];
        if (!p) { session.step = 'menu_utama'; return msg.reply(msgMenuRole(session.role)); }

        if (text.toLowerCase() === 'a') {
            await msg.reply(`⏳ Membaca skema model PostgreSQL & mengekstrak data klinis...`);
            const konteks = buildKonteksKlinis(p);
            try {
                const aiResult = await tanyaAI(r.systemPrompt, konteks);
                const saved = await postClinicalDataToLaravel(p.id || p.no_rm, p.keluhan_awal || p.raw_content, aiResult, p);
                
                const bridgeTxt = saved
                    ? `\n\n✅ [INTEGRASI LIVE] Sukses menyuntikkan draf data menuju tabel clinical_data di rs_uns_db (PostgreSQL)!`
                    : ``;

                session.step = 'menu_utama';
                return msg.reply(
                    `🤖 *ANALISIS CDSS AGENT PASIEN REAL — ${p.name}*\n` +
                    `${'─'.repeat(32)}\n\n${aiResult}\n\n${'─'.repeat(32)}` +
                    bridgeTxt +
                    幕 + appendWebLinkFooter() +
                    `\n\nKetik *#menu* untuk ke dashboard.`
                );
            } catch (e) {
                return msg.reply(msgFallback(konteks));
            }
        }

        if (text.toLowerCase() === 'b') {
            await msg.reply(`📝 Menyusun struktur berkas RME SatuSehat...`);
            const prompt = `Susun resume medis formal berpatokan pada regulasi SatuSehat RME Kemenkes RI berdasarkan data riil database berikut:\n\n` + buildKonteksKlinis(p);
            try {
                const hasil = await tanyaAI(r.systemPrompt, prompt);
                session.step = 'menu_utama';
                return msg.reply(
                    `📋 *RESUME ELEKTRONIK REKAM MEDIS (RME) REAL-DB*\n` +
                    `${p.name} — ${p.no_rm}\n` +
                    `${'─'.repeat(32)}\n\n${hasil}\n\n${'─'.repeat(32)}` +
                    appendWebLinkFooter() +
                    `\n\nKetik *#menu* untuk ke dashboard.`
                );
            } catch (e) {
                return msg.reply(`❌ Gagal kompilasi resume: ${e.message}`);
            }
        }

        if (text.toLowerCase() === 'c') {
            session.step = 'menu_utama';
            return msg.reply(msgMenuRole(session.role));
        }

        return msg.reply(`Pilihan salah. Tekan:\n*A* untuk Analisis AI\n*B* untuk Resume Medis\n*C* untuk Batal`);
    }

    // ── STEP: OPEN CLINICAL CONSULTATION ──────────────────────
    if (session.step === 'konsultasi') {
        const r = ROLES[session.role];
        if (msg.type === 'ptt' || msg.type === 'audio') return handleVoice(msg, session);
        if (!text) return;

        try {
            const hasil = await tanyaAI(r.systemPrompt, text);
            return msg.reply(
                `🤖 *RESPONS INSTAN AGENT (${r.nama.toUpperCase()})*\n` +
                `${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}` +
                appendWebLinkFooter() +
                `\n\nKetik *#menu* untuk kembali.`
            );
        } catch (e) {
            return msg.reply(msgFallback(text));
        }
    }

    // ── STEP: DIAGNOSTIC IMAGING LISTENER ────────────────────
    if (session.step === 'tunggu_gambar') {
        if (msg.type === 'image') return handleGambar(msg, session);
        return msg.reply(`Silakan lampirkan gambar radiologi Anda atau ketik *#menu*.`);
    }

    msg.reply(msgWelcome());
});

// =============================================================
// HANDLER SUB-ROUTINE: SPEECH TRANSCRIPTION AUTOMATION
// =============================================================
async function handleVoice(msg, session) {
    await msg.reply(`🎙️ Dokumen audio terdeteksi. Melakukan transkripsi via Groq Whisper v3...`);
    try {
        const media     = await msg.downloadMedia();
        const transkrip = await transkripVoice(media.data, media.mimetype);

        await msg.reply(`📝 *Hasil Transkripsi Suara:*\n"${transkrip}"\n\n⏳ Meneruskan hasil transkrip ke modul AI Agent...`);

        const r     = ROLES[session.role];
        const hasil = await tanyaAI(r.systemPrompt, transkrip);

        return msg.reply(
            `🤖 *Kompilasi AI Medis via Voice — ${r.nama}*\n` +
            `${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}` +
            appendWebLinkFooter() +
            `\n\nKetik *#menu* untuk ke dashboard.`
        );
    } catch (e) {
        console.error('[SPEECH PROCESSING PIPELINE CRASH]:', e.message);
        return msg.reply(`⚠️ Gagal memproses voice note: ${e.message}`);
    }
}

// =============================================================
// HANDLER SUB-ROUTINE: MULTIMODAL VISION RECOGNITION
// =============================================================
async function handleGambar(msg, session) {
    await msg.reply(`🩻 Berkas citra diterima. Membuka cluster Llama Vision Multimodal Core...`);
    try {
        const media   = await msg.downloadMedia();
        const r       = ROLES[session.role];
        const hasil   = await analisisGambar(media.data, media.mimetype, r.systemPrompt);

        const saved = await postClinicalDataToLaravel('RAD-LIVE-' + Date.now(), '[Media Gambar Radiologi]', hasil, { tensi: '-', nadi: '-', suhu: '-', spo2: '-' });
        const bridgeTxt = saved ? `\n\n✅ Laporan citra sukses disuntikkan ke database PostgreSQL local server!` : '';

        return msg.reply(
            `🩻 *DRAF LAPORAN EVALUASI RADIOLOGI AI*\n` +
            `${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}\n` +
            `⚠️ *PERINGATAN AKADEMIK*: Hasil kompilasi ini wajib divalidasi oleh spesialis Dokter Sp.Rad.` +
            bridgeTxt +
            appendWebLinkFooter() +
            `\n\nKetik *#menu* untuk kembali.`
        );
    } catch (e) {
        console.error('[MULTIMODAL VISION CORE ERROR]:', e.message);
        return msg.reply(`⚠️ Gagal menganalisis gambar: ${e.message}`);
    }
}

// Booting service agent
client.initialize();