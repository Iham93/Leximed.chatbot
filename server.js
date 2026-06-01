// =============================================================
// LEXIMED.AI — WhatsApp Agent v3.0
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
const qrcode                = require('qrcode-terminal');
const axios                 = require('axios');
const fs                    = require('fs');
const path                  = require('path');
const FormData              = require('form-data');

// ── API Keys & Config ──────────────────────────────────────────
const GROQ_API_KEY  = process.env.GROQ_API_KEY  || "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";

// Base URL API Laravel — ubah sesuai server kamu
// Contoh production : https://api.leximed.id/api
// Contoh local      : http://localhost:8000/api
const LARAVEL_API   = process.env.LARAVEL_API_URL || "http://localhost:8000/api";
const LARAVEL_TOKEN = process.env.LARAVEL_API_TOKEN || ""; // isi token Sanctum jika dipakai

// =============================================================
// DATA PASIEN DUMMY — Struktur identik dengan Model Patient.php
// no_rm, title, name, age, gender, unit, dpjp, status_treatment
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
        // Data PemeriksaanAwal (tensi/nadi/suhu/spo2/keluhan_awal)
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
            keluhan_awal: "Batuk produktif >3 minggu, dahak kekuningan, penurunan BB 6kg dalam 2 bulan, keringat malam."
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
// KONFIGURASI ROLE — Sama dengan role di User.php & web
// =============================================================
const ROLES = {
    '1': {
        kode: 'dokter',
        nama: 'Dokter',
        icon: '👨‍⚕️',
        // Konsep CDSS dari web (Clinical Decision Support System)
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
        // Fokus TTV, NANDA, intervensi — sesuai PemeriksaanAwal.php
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
            step: 'welcome',     // welcome | menu_utama | pilih_pasien | aksi_pasien | konsultasi | tunggu_gambar
            role: null,          // key dari ROLES ('1'-'5')
            selectedPatient: null
        };
    }
    return userSessions[from];
}

function resetSession(from) {
    userSessions[from] = { step: 'welcome', role: null, selectedPatient: null };
}

// =============================================================
// TEKS MENU
// =============================================================
function msgWelcome() {
    return (
        `╔═══════════════════════════════╗\n` +
        `║  🏥  LexiMed.ai  —  RS UNS   ║\n` +
        `║  Clinical AI Decision System  ║\n` +
        `╚═══════════════════════════════╝\n\n` +
        `Selamat datang! Silakan pilih role Anda:\n\n` +
        `1️⃣   👨‍⚕️  Dokter\n` +
        `2️⃣   👩‍⚕️  Perawat\n` +
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
        menu += `1️⃣   📂  Lihat Daftar Pasien\n`;
        menu += `2️⃣   💬  Konsultasi / Input Klinis\n`;
        if (r.bisaAnalisisGambar) {
            menu += `3️⃣   🩻  Analisis Foto/Gambar Radiologi\n`;
        }
    } else {
        menu += `1️⃣   💬  Input Data / Pertanyaan\n`;
    }

    menu += `\n🎙️  *Voice note* → transkrip otomatis\n`;
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

// =============================================================
// HELPER: Bangun konteks klinis penuh dari data pasien
// (digunakan sebagai input ke AI, sama konsep dgn ClinicalData.php)
// =============================================================
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
// INTEGRASI LARAVEL API — Post hasil AI sebagai ClinicalData
// (status: 'draft', source: 'whatsapp') — menunggu verifikasi dokter
// Jika LARAVEL_TOKEN kosong, skip posting (mode standalone)
// =============================================================
async function postClinicalDataToLaravel(patientId, rawContent, aiSummary, ttvData) {
    if (!LARAVEL_TOKEN) return null; // skip jika token belum diset

    try {
        const payload = {
            patient_id:        patientId,
            blood_pressure:    ttvData.tensi,
            heart_rate:        ttvData.nadi,
            temperature:       ttvData.suhu,
            oxygen_saturation: ttvData.spo2,
            source:            'whatsapp',
            raw_content:       rawContent,
            ai_summary:        aiSummary,
            status:            'draft'   // menunggu verifikasi dokter di web
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
        console.error('[LARAVEL API] Gagal post ClinicalData:', e.message);
        return null;
    }
}

// =============================================================
// GROQ — LLM (Llama 3.1)
// =============================================================
async function tanyaAI(systemPrompt, userContent) {
    const noMarkdown = ` PENTING: Jangan gunakan simbol markdown seperti bintang ganda (**), tagar (#), atau backtick. Hasilkan teks polos terstruktur yang mudah dibaca di WhatsApp.`;
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

// =============================================================
// GROQ WHISPER — Voice Note → Transkrip
// =============================================================
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

        fs.unlinkSync(tmpPath);
        return typeof res.data === 'string' ? res.data : res.data.text || JSON.stringify(res.data);
    } catch (e) {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        throw new Error('Whisper: ' + e.message);
    }
}

// =============================================================
// GROQ LLaMA Vision — Analisis Gambar Medis (Radiologi)
// =============================================================
async function analisisGambar(base64Data, mimeType, systemPrompt) {
    const noMarkdown = ` Jangan gunakan markdown. Teks polos terstruktur untuk WhatsApp.`;
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
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
                        text: 'Analisis gambar medis ini. Buat laporan radiologi lengkap dan sistematis.'
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
// FALLBACK (Groq down)
// =============================================================
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
// WhatsApp CLIENT
// =============================================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
    console.log('\n══════════ LEXIMED.AI v3.0 — QR SYSTEM ══════════');
    console.log('Buka link ini di browser untuk scan QR:');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
    console.log('══════════════════════════════════════════════════\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n══> [ONLINE] LexiMed.ai v3.0 — Role System + Voice + Vision + Laravel Bridge 🚀\n');
});

// =============================================================
// MAIN MESSAGE HANDLER
// =============================================================
client.on('message', async (msg) => {
    const from    = msg.from;
    const session = getSession(from);
    const text    = msg.body ? msg.body.trim() : '';

    // Typing indicator
    try { const chat = await msg.getChat(); await chat.sendStateTyping(); } catch (_) {}

    console.log(`[MSG] ${from.split('@')[0]} | step=${session.step} | role=${session.role} | type=${msg.type} | text="${text.substring(0,40)}"`);

    // ── Global commands ──────────────────────────────────────
    if (text === '#reset') { resetSession(from); return msg.reply(msgWelcome()); }
    if (text === '#ganti') { session.step = 'welcome'; return msg.reply(msgWelcome()); }
    if (text === '#menu')  {
        if (session.role) { session.step = 'menu_utama'; return msg.reply(msgMenuRole(session.role)); }
        return msg.reply(msgWelcome());
    }
    if (text === '#help') {
        return msg.reply(
            `📖 PANDUAN LEXIMED.AI\n${'─'.repeat(30)}\n\n` +
            `#menu   → kembali ke menu role saat ini\n` +
            `#ganti  → ganti role\n` +
            `#reset  → mulai dari awal\n` +
            `#help   → panduan ini\n\n` +
            `Tips:\n` +
            `• Kirim voice note → langsung ditranskrip & dijawab AI\n` +
            `• Role Radiologi → kirim foto rontgen/CT/MRI langsung\n` +
            `• Semua analisis AI disimpan sebagai 'draft' di sistem web, menunggu verifikasi dokter`
        );
    }

    // ── STEP: WELCOME — Pilih Role ───────────────────────────
    if (session.step === 'welcome') {
        if (!ROLES[text]) return msg.reply(msgWelcome());
        session.role = text;
        session.step = 'menu_utama';
        const r = ROLES[text];
        return msg.reply(`✅ Selamat datang, ${r.icon} *${r.nama}*!\n\n` + msgMenuRole(text));
    }

    // ── STEP: MENU UTAMA ─────────────────────────────────────
    if (session.step === 'menu_utama') {
        const r = ROLES[session.role];

        // Voice note di menu utama
        if (msg.type === 'ptt' || msg.type === 'audio') return handleVoice(msg, session);

        // Foto di menu utama (langsung ke radiologi jika role cocok)
        if (msg.type === 'image') {
            if (r.bisaAnalisisGambar) return handleGambar(msg, session);
            return msg.reply(`🖼️ Analisis gambar hanya tersedia untuk role Radiologi.\nAnda saat ini login sebagai *${r.nama}*.`);
        }

        if (text === '1' && r.bisaLihatPasien) {
            session.step = 'pilih_pasien';
            return msg.reply(msgDaftarPasien());
        }

        const konsultasiKey = (r.bisaLihatPasien ? '2' : '1');
        if (text === konsultasiKey) {
            session.step = 'konsultasi';
            return msg.reply(
                `💬 Mode Konsultasi *${r.nama}* aktif.\n\n` +
                `Kirim data klinis, keluhan pasien, atau pertanyaan medis.\n` +
                `🎙️  Voice note juga diterima — akan ditranskrip otomatis.\n\n` +
                `Ketik *#menu* untuk kembali.`
            );
        }

        if (text === '3' && r.bisaAnalisisGambar) {
            session.step = 'tunggu_gambar';
            return msg.reply(
                `🩻 Mode Analisis Gambar Radiologi aktif.\n\n` +
                `Kirim foto rontgen, CT-scan, MRI, atau USG.\n` +
                `AI akan membuat draf laporan radiologi otomatis.\n\n` +
                `Ketik *#menu* untuk kembali.`
            );
        }

        return msg.reply(msgMenuRole(session.role));
    }

    // ── STEP: PILIH PASIEN ───────────────────────────────────
    if (session.step === 'pilih_pasien') {
        const idx = parseInt(text) - 1;
        if (!isNaN(idx) && PASIEN_DUMMY[idx]) {
            session.selectedPatient = PASIEN_DUMMY[idx];
            session.step = 'aksi_pasien';
            return msg.reply(msgDetailPasien(PASIEN_DUMMY[idx]));
        }
        return msg.reply(`⚠️ Pilihan tidak valid. Ketik angka 1 sampai ${PASIEN_DUMMY.length}.`);
    }

    // ── STEP: AKSI PASIEN (A / B / C) ───────────────────────
    if (session.step === 'aksi_pasien') {
        const p = session.selectedPatient;
        const r = ROLES[session.role];
        if (!p) { session.step = 'pilih_pasien'; return msg.reply(msgDaftarPasien()); }

        // A — Analisis AI (draf SOAP/NANDA sesuai role)
        if (text.toLowerCase() === 'a') {
            await msg.reply(`⏳ Menganalisis data klinis *${p.title}. ${p.name}*...`);
            const konteks = buildKonteksKlinis(p);
            try {
                const aiResult = await tanyaAI(r.systemPrompt, konteks);

                // Coba bridge ke Laravel API (simpan sebagai draft ClinicalData)
                const saved = await postClinicalDataToLaravel(p.no_rm, p.pemeriksaan_awal.keluhan_awal, aiResult, p.pemeriksaan_awal);
                const bridgeTxt = saved
                    ? `\n✅ Draf tersimpan ke sistem web (status: draft, menunggu verifikasi dokter)`
                    : ``;

                session.step = 'menu_utama';
                return msg.reply(
                    `🤖 ANALISIS AI — ${p.title}. ${p.name} (${p.no_rm})\n` +
                    `${'─'.repeat(32)}\n\n${aiResult}\n\n${'─'.repeat(32)}` +
                    bridgeTxt +
                    `\n\nKetik *#menu* untuk kembali`
                );
            } catch (e) {
                return msg.reply(msgFallback(konteks));
            }
        }

        // B — Ringkasan Rekam Medis
        if (text.toLowerCase() === 'b') {
            await msg.reply(`📝 Menyusun ringkasan rekam medis *${p.title}. ${p.name}*...`);
            const prompt =
                `Buat ringkasan rekam medis standar (sesuai format RME Kemenkes RI) untuk pasien berikut:\n\n` +
                buildKonteksKlinis(p) +
                `\n\nSertakan: tanggal (hari ini), identitas, anamnesis singkat, TTV, assessment awal, dan rencana tindak lanjut.`;
            try {
                const hasil = await tanyaAI(r.systemPrompt, prompt);
                session.step = 'menu_utama';
                return msg.reply(
                    `📋 RINGKASAN REKAM MEDIS\n` +
                    `${p.title}. ${p.name} — ${p.no_rm}\n` +
                    `${'─'.repeat(32)}\n\n${hasil}\n\n${'─'.repeat(32)}\n` +
                    `Ketik *#menu* untuk kembali`
                );
            } catch (e) {
                return msg.reply(`❌ Error: ${e.message}`);
            }
        }

        // C — Kembali ke daftar
        if (text.toLowerCase() === 'c') {
            session.step = 'pilih_pasien';
            session.selectedPatient = null;
            return msg.reply(msgDaftarPasien());
        }

        return msg.reply(
            `Pilih aksi:\n*A* — Analisis AI\n*B* — Ringkasan Rekam Medis\n*C* — Kembali ke daftar`
        );
    }

    // ── STEP: KONSULTASI BEBAS ───────────────────────────────
    if (session.step === 'konsultasi') {
        const r = ROLES[session.role];

        if (msg.type === 'ptt' || msg.type === 'audio') return handleVoice(msg, session);
        if (msg.type === 'image') {
            if (r.bisaAnalisisGambar) return handleGambar(msg, session);
            return msg.reply(`Analisis gambar hanya untuk role Radiologi.`);
        }
        if (!text) return;

        try {
            const hasil = await tanyaAI(r.systemPrompt, text);
            return msg.reply(
                `🤖 ${r.nama.toUpperCase()} AI\n${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}\n` +
                `Ketik *#menu* untuk kembali`
            );
        } catch (e) {
            return msg.reply(msgFallback(text));
        }
    }

    // ── STEP: TUNGGU GAMBAR ──────────────────────────────────
    if (session.step === 'tunggu_gambar') {
        if (msg.type === 'image') return handleGambar(msg, session);
        return msg.reply(`Kirim foto/gambar radiologi, atau ketik *#menu* untuk kembali.`);
    }

    // Belum pilih role
    msg.reply(msgWelcome());
});

// =============================================================
// HANDLER: VOICE NOTE → TRANSKRIP → AI
// =============================================================
async function handleVoice(msg, session) {
    await msg.reply(`🎙️ Voice note diterima. Sedang mentranskrip via Whisper...`);
    try {
        const media     = await msg.downloadMedia();
        const transkrip = await transkripVoice(media.data, media.mimetype);

        await msg.reply(`📝 Transkrip:\n"${transkrip}"\n\n⏳ Memproses...`);

        const r     = ROLES[session.role];
        const hasil = await tanyaAI(r.systemPrompt, transkrip);

        return msg.reply(
            `🤖 Respons AI — ${r.nama}\n${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}\n` +
            `Ketik *#menu* untuk kembali`
        );
    } catch (e) {
        console.error('[VOICE ERROR]', e.message);
        return msg.reply(`⚠️ Gagal transkrip voice note: ${e.message}\n\nCoba kirim ulang atau ketik manual.`);
    }
}

// =============================================================
// HANDLER: GAMBAR → AI VISION (Radiologi)
// =============================================================
async function handleGambar(msg, session) {
    await msg.reply(`🩻 Gambar diterima. Menganalisis dengan AI Vision...`);
    try {
        const media   = await msg.downloadMedia();
        const r       = ROLES[session.role];
        const hasil   = await analisisGambar(media.data, media.mimetype, r.systemPrompt);

        // Bridge ke Laravel jika ada token
        const saved = await postClinicalDataToLaravel(
            'RADIOLOGY-' + Date.now(), // no_rm sementara
            '[Gambar radiologi dari WhatsApp]',
            hasil,
            { tensi: '-', nadi: '-', suhu: '-', spo2: '-' }
        );
        const bridgeTxt = saved ? `\n✅ Laporan tersimpan di sistem web sebagai draft` : '';

        return msg.reply(
            `🩻 LAPORAN RADIOLOGI AI\n${'─'.repeat(30)}\n\n${hasil}\n\n${'─'.repeat(30)}\n` +
            `⚠️ Draf AI — bukan diagnosis final. Wajib diverifikasi dokter Sp.Rad.` +
            bridgeTxt +
            `\n\nKetik *#menu* untuk kembali`
        );
    } catch (e) {
        console.error('[IMAGE ERROR]', e.message);
        return msg.reply(`⚠️ Gagal analisis gambar: ${e.message}\n\nPastikan format JPG/PNG dan resolusi cukup.`);
    }
}

// Jalankan
client.initialize();
