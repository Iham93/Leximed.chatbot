// =============================================================
// LEXIMED.AI — WhatsApp Agent v3.2 (Production & Local Sync Optimized)
// Aligned with LexiMed Web Platform (Laravel + React)
//
// Konsep sama dengan web:
//   - Role: dokter, perawat, radiologi, asisten_dokter, manajemen
//   - Model: Patient (no_rm, title, name, age, gender, unit, dpjp)
//   - Model: ClinicalData (blood_pressure, heart_rate, temperature,
//             oxygen_saturation, raw_content, ai_summary, status)
//   - Model: PemeriksaanAwal (tensi, nadi, suhu, spo2, keluhan_awal)
//   - Flow: Input → AI Ekstraksi → Draf SOAP → Verifikasi
//   - Source: whatsapp (sama seperti field 'source' di ClinicalData)
// =============================================================

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode                 = require('qrcode-terminal');
const axios                  = require('axios');
const fs                     = require('fs');
const path                   = require('path');
const FormData               = require('form-data');

// ── API Keys & Config ──────────────────────────────────────────
const GROQ_API_KEY  = process.env.GROQ_API_KEY  || "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";

// Prioritas ke local backend Laravel port 8000 sesuai dengan konfigurasi React Login
const LARAVEL_API   = process.env.LARAVEL_API_URL || "http://localhost:8000/api";
const LARAVEL_TOKEN = process.env.LARAVEL_API_TOKEN || ""; // Diisi via token Sanctum jika digunakan

// URL Platform Aplikasi Web Resmi yang sudah ter-deploy di Vercel
const WEB_PRODUCTION_URL = "https://leximedai-olivia2026-web-technology.vercel.app/";

// Helper untuk menyisipkan pesan penutup dan link web di setiap akhir response AI
function appendWebLinkFooter() {
    return (
        `\n\n🌐 Buka Web Platform untuk verifikasi & kelola data:\n` +
        `${WEB_PRODUCTION_URL}`
    );
}

// =============================================================
// DATA PASIEN DUMMY — Struktur identik dengan Model Patient.php
// =============================================================
const PASIEN_DUMMY = [
    {
        no_rm: "RM-2024-0001",
        title: "Tn",
        name: "Budi Santoso",
        age: 45,
        gender: "Laki-Laki",
        unit: "IGD",
        dpjp: "dr. Hendra Sp.JP",
        status_treatment: "Kritis",
        pemeriksaan_awal: {
            tensi: "160/100",
            nadi: "102x/mnt",
            suhu: "37.2°C",
            spo2: "94%",
            keluhan_awal: "Nyeri dada kiri menjalar ke lengan kiri, sesak napas mendadak sejak ±2 jam lalu. Riwayat hipertensi dan DM tipe 2."
        },
        alergi: "Aspirin",
        riwayat: "Hipertensi 5 tahun, DM tipe 2"
    },
    {
        no_rm: "RM-2024-0002",
        title: "Ny",
        name: "Siti Rahayu",
        age: 32,
        gender: "Perempuan",
        unit: "Rawat Inap - Ruang Mawar",
        dpjp: "dr. Amalia Sp.PD",
        status_treatment: "Observasi",
        pemeriksaan_awal: {
            tensi: "110/70",
            nadi: "98x/mnt",
            suhu: "39.5°C",
            spo2: "98%",
            keluhan_awal: "Demam tinggi hari ke-3, muncul bintik merah di seluruh tubuh, mual muntah, nafsu makan turun."
        },
        alergi: "Tidak ada",
        riwayat: "Tidak ada riwayat penyakit kronis"
    },
    {
        no_rm: "RM-2024-0003",
        title: "Tn",
        name: "Ahmad Fauzi",
        age: 58,
        gender: "Laki-Laki",
        unit: "Poli Paru",
        dpjp: "dr. Suryo Sp.P",
        status_treatment: "Rawat Jalan",
        pemeriksaan_awal: {
            tensi: "130/85",
            nadi: "88x/mnt",
            suhu: "37.8°C",
            spo2: "96%",
            keluhan_awal: "Batuk produktif >3 minggu, dahak kekuningan, penurunan BB 6kg dalam 2 butter, keringat malam."
        },
        alergi: "Penisilin",
        riwayat: "Mantan perokok aktif 20 tahun, berhenti 3 tahun lalu"
    },
    {
        no_rm: "RM-2024-0004",
        title: "Nn",
        name: "Dewi Kusuma",
        age: 27,
        gender: "Perempuan",
        unit: "IGD",
        dpjp: "dr. Rizki Sp.B",
        status_treatment: "Observasi",
        pemeriksaan_awal: {
            tensi: "120/80",
            nadi: "95x/mnt",
            suhu: "38.1°C",
            spo2: "99%",
            keluhan_awal: "Nyeri perut kanan bawah mendadak sejak 6 jam lalu, mual tanpa muntah, tidak nafsu makan, nyeri menjalar ke pinggang kanan."
        },
        alergi: "Sulfa",
        riwayat: "Tidak ada"
    },
    {
        no_rm: "RM-2024-0005",
        title: "Tn",
        name: "Hendra Wijaya",
        age: 65,
        gender: "Laki-Laki",
        unit: "ICU",
        dpjp: "dr. Bambang Sp.JP",
        status_treatment: "Kritis",
        pemeriksaan_awal: {
            tensi: "145/95",
            nadi: "110x/mnt",
            suhu: "36.9°C",
            spo2: "91%",
            keluhan_awal: "Sesak napas bertambah berat sejak 2 hari, kedua tungkai bengkak, mudah lelah saat aktivitas ringan, penurunan toleransi latihan."
        },
        alergi: "Ibuprofen",
        riwayat: "CHF NYHA III, Hipertensi, Diabetes Melitus tipe 2"
    }
];

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
            selectedPatient: null
        };
    }
    return userSessions[from];
}

function resetSession(from) {
    userSessions[from] = { step: 'welcome', role: null, selectedPatient: null };
}

// =============================================================
// TEKS INTERAKSI INTERFACES (MODIFIKASI LIVE REDIRECTION VERCEL)
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
        menu += `1️⃣   📂   Lihat Daftar Pasien\n`;
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

function msgDaftarPasien() {
    let txt = `📋 *DAFTAR PASIEN AKTIF*\n${'─'.repeat(32)}\n\n`;
    PASIEN_DUMMY.forEach((p, i) => {
        const statusIcon = p.status_treatment === 'Kritis' ? '🔴' : p.status_treatment === 'Observasi' ? '🟡' : '🟢';
        txt += `*${i + 1}. ${p.title}. ${p.name}*\n`;
        txt += `   🪪 ${p.no_rm}  ${statusIcon} ${p.status_treatment}\n`;
        txt += `   📍 ${p.unit}  |  DPJP: ${p.dpjp}\n\n`;
    });
    txt += `Ketik nomor pasien untuk detail (contoh: *1*)`;
    return txt;
}

function msgDetailPasien(p) {
    const pa = p.pemeriksaan_awal;
    return (
        `📁 *REKAM MEDIS — ${p.title}. ${p.name}*\n${'─'.repeat(32)}\n` +
        `🪪 No. RM  : ${p.no_rm}\n` +
        `👤 Nama    : ${p.title}. ${p.name}\n` +
        `🎂 Umur    : ${p.age} tahun  |  ${p.gender}\n` +
        `🏥 Unit    : ${p.unit}\n` +
        `👨‍⚕️ DPJP    : ${p.dpjp}\n` +
        `📌 Status  : ${p.status_treatment}\n\n` +
        `📊 *Pemeriksaan Awal (TTV):*\n` +
        `   Tensi  : ${pa.tensi}\n` +
        `   Nadi   : ${pa.nadi}\n` +
        `   Suhu   : ${pa.suhu}\n` +
        `   SpO2   : ${pa.spo2}\n\n` +
        `🩺 *Keluhan Awal:*\n${pa.keluhan_awal}\n\n` +
        `📋 *Riwayat:* ${p.riwayat}\n` +
        `⚠️  *Alergi:* ${p.alergi}\n\n` +
        `Pilih aksi:\n` +
        `*A* — 🤖 Analisis AI (buat draf SOAP/NANDA)\n` +
        `*B* — 📝 Ringkasan Rekam Medis\n` +
        `*C* — 🔙 Kembali ke daftar pasien`
    );
}

function buildKonteksKlinis(p) {
    const pa = p.pemeriksaan_awal;
    return (
        `DATA PASIEN (Source: whatsapp)\n` +
        `No. RM    : ${p.no_rm}\n` +
        `Nama      : ${p.title}. ${p.name}, ${p.age} tahun, ${p.gender}\n` +
        `Unit      : ${p.unit}\n` +
        `DPJP      : ${p.dpjp}\n` +
        `Status    : ${p.status_treatment}\n\n` +
        `PEMERIKSAAN AWAL (PemeriksaanAwal):\n` +
        `  Tensi    : ${pa.tensi}\n` +
        `  Nadi     : ${pa.nadi}\n` +
        `  Suhu     : ${pa.suhu}\n` +
        `  SpO2     : ${pa.spo2}\n\n` +
        `KELUHAN AWAL (raw_content):\n${pa.keluhan_awal}\n\n` +
        `Riwayat Penyakit : ${p.riwayat}\n` +
        `Alergi           : ${p.alergi}`
    );
}

// =============================================================
// LARAVEL CENTRAL BRIDGE PIPELINE
// =============================================================
async function postClinicalDataToLaravel(patientId, rawContent, aiSummary, ttvData) {
    if (!LARAVEL_TOKEN) return null; 

    try {
        const payload = {
            patient_id:        patientId,
            blood_pressure:    ttvData.tensi || "-",
            heart_rate:        ttvData.nadi || "-",
            temperature:       ttvData.suhu || "-",
            oxygen_saturation: ttvData.spo2 || "-",
            source:            'whatsapp',
            raw_content:       rawContent,
            ai_summary:        aiSummary,
            status:            'draft'   
        };

        const res = await axios.post(`${LARAVEL_API}/clinical-data`, payload, {
            headers: {
                'Authorization': `Bearer ${LARAVEL_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 8000
        });

        return res.data;
    } catch (e) {
        console.error('[LARAVEL API BRIDGE ERROR]:', e.message);
        return null;
    }
}

// =============================================================
// OMNI CORE ENGINE ENGINE (Llama 3.1 & Whisper & Llama Vision)
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

// =============================================================
// INITIALIZE WHATSAPP CLIENT RUNTIME
// =============================================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
    console.log('\n══════════ LEXIMED.AI v3.2 — QR CORE INTERFACES ══════════');
    console.log('Buka tautan di bawah ini pada browser untuk menampilkan Barcode:');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
    console.log('══════════════════════════════════════════════════════════\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n══> [ONLINE SUCCESS] LexiMed.ai v3.2 — Role Engine + Live Web Link Redirection Active! 🚀\n');
});

// =============================================================
// ROUTING ENGINE MESSAGE HANDLER
// =============================================================
client.on('message', async (msg) => {
    const from    = msg.from;
    const session = getSession(from);
    const text    = msg.body ? msg.body.trim() : '';

    try { const chat = await msg.getChat(); await chat.sendStateTyping(); } catch (_) {}

    console.log(`[INCOMING] ${from.split('@')[0]} | step=${session.step} | role=${session.role} | type=${msg.type}`);

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
            `💡 FITUR AKSELERASI:\n` +
            `• Kirim pesan suara (Voice Note) di mode konsultasi untuk translasi otomatis lewat Groq Whisper Engine.\n` +
            `• Pada mode Radiologi, Anda bisa melampirkan berkas gambar rontgen/CT-Scan langsung untuk diekstraksi AI Vision.\n` +
            `• Setiap draf yang diekstrak akan dialokasikan ke Web Cloud sebagai status 'draft' menunggu validasi dokter.`
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

        if (text === '1' && r.bisaLihatPasien) {
            session.step = 'pilih_pasien';
            return msg.reply(msgDaftarPasien());
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
        if (!isNaN(idx) && PASIEN_DUMMY[idx]) {
            session.selectedPatient = PASIEN_DUMMY[idx];
            session.step = 'aksi_pasien';
            return msg.reply(msgDetailPasien(PASIEN_DUMMY[idx]));
        }
        return msg.reply(`⚠️ Indeks tidak terdaftar. Silakan pilih nomor 1 sampai ${PASIEN_DUMMY.length}.`);
    }

    // ── STEP: ACTION PIPELINE (SOAP / REKAM MEDIS) ───────────
    if (session.step === 'aksi_pasien') {
        const p = session.selectedPatient;
        const r = ROLES[session.role];
        if (!p) { session.step = 'pilih_pasien'; return msg.reply(msgDaftarPasien()); }

        // Opsi A — Ekstraksi AI Agent (SOAP/NANDA/NIC)
        if (text.toLowerCase() === 'a') {
            await msg.reply(`⏳ Mengirim data klinis *${p.title}. ${p.name}* menuju Groq AI Cluster...`);
            const konteks = buildKonteksKlinis(p);
            try {
                const aiResult = await tanyaAI(r.systemPrompt, konteks);
                const saved = await postClinicalDataToLaravel(p.no_rm, p.pemeriksaan_awal.keluhan_awal, aiResult, p.pemeriksaan_awal);
                
                const bridgeTxt = saved
                    ? `\n\n✅ [INTEGRASI LIVE] Data berhasil disinkronkan ke local server backend (status: draft).`
                    : ``;

                session.step = 'menu_utama';
                return msg.reply(
                    `🤖 *ANALISIS CDSS AGENT — ${p.title}. ${p.name}* (${p.no_rm})\n` +
                    `${'─'.repeat(32)}\n\n${aiResult}\n\n${'─'.repeat(32)}` +
                    bridgeTxt +
                    appendWebLinkFooter() +
                    `\n\nKetik *#menu* untuk ke dashboard.`
                );
            } catch (e) {
                return msg.reply(msgFallback(konteks));
            }
        }

        // Opsi B — Kompilasi Ringkasan RME Kemenkes
        if (text.toLowerCase() === 'b') {
            await msg.reply(`📝 Membuat ringkasan dokumen klinis terstruktur *${p.title}. ${p.name}*...`);
            const prompt =
                `Susun resume medis formal berpatokan pada regulasi SatuSehat RME Kemenkes RI berdasarkan resume data pasien berikut:\n\n` +
                buildKonteksKlinis(p) +
                `\n\nWajib memuat identitas komplit, riwayat anamnesis, pencatatan objektif vital sign, draf diagnosis kerja, serta intervensi lanjutan.`;
            try {
                const hasil = await tanyaAI(r.systemPrompt, prompt);
                session.step = 'menu_utama';
                return msg.reply(
                    `📋 *RESUME ELEKTRONIK REKAM MEDIS (RME)*\n` +
                    `${p.title}. ${p.name} — ${p.no_rm}\n` +
                    `${'─'.repeat(32)}\n\n${hasil}\n\n${'─'.repeat(32)}` +
                    appendWebLinkFooter() +
                    `\n\nKetik *#menu* untuk ke dashboard.`
                );
            } catch (e) {
                return msg.reply(`❌ Kegagalan orkestrasi resume engine: ${e.message}`);
            }
        }

        // Opsi C — Rollback List
        if (text.toLowerCase() === 'c') {
            session.step = 'pilih_pasien';
            session.selectedPatient = null;
            return msg.reply(msgDaftarPasien());
        }

        return msg.reply(`Aksi tidak dikenali. Pilih:\n*A* untuk Analisis AI\n*B* untuk Resume Medis\n*C* untuk Kembali`);
    }

    // ── STEP: OPEN CLINICAL CONSULTATION ──────────────────────
    if (session.step === 'konsultasi') {
        const r = ROLES[session.role];

        if (msg.type === 'ptt' || msg.type === 'audio') return handleVoice(msg, session);
        if (msg.type === 'image') {
            if (r.bisaAnalisisGambar) return handleGambar(msg, session);
            return msg.reply(`Analisis citra visual terbatas pada modul penunjang Radiologi.`);
        }
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
        return msg.reply(`Sistem mendeteksi kegagalan lampiran. Silakan upload gambar radiologi Anda atau ketik *#menu*.`);
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
        return msg.reply(`⚠️ Gagal memproses voice note: ${e.message}\n\nSilakan beralih ke input teks manual.`);
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

        const saved = await postClinicalDataToLaravel(
            'RAD-WA-' + Date.now(), 
            '[Media Ekstraksi: Lampiran Gambar Radiologi WhatsApp Gateway]',
            hasil,
            { tensi: '-', nadi: '-', suhu: '-', spo2: '-' }
        );
        const bridgeTxt = saved ? `\n\n✅ Laporan impresi radiologis sukses diposting ke database web (status: draft).` : '';

        return msg.reply(
            `🩻 *DRAF LAPORAN EVALUASI RADIOLOGI AI*\n` +
            `${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}\n` +
            `⚠️ *PERINGATAN AKADEMIK*: Hasil kompilasi ini bersifat draf rekomendasi asisten virtual dan wajib divalidasi oleh spesialis Dokter Sp.Rad.` +
            bridgeTxt +
            appendWebLinkFooter() +
            `\n\nKetik *#menu* untuk kembali.`
        );
    } catch (e) {
        console.error('[MULTIMODAL VISION CORE ERROR]:', e.message);
        return msg.reply(`⚠️ Gagal menganalisis gambar: ${e.message}\n\nPastikan ekstensi file valid (PNG/JPG).`);
    }
}

// Booting service agent
client.initialize();