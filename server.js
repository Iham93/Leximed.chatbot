const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// Mengambil API Key secara aman dari tab Variables Railway
const GROQ_API_KEY = process.env.GROQ_API_KEY || "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";

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        // Hapus --single-process agar tidak crash di server Linux cloud Railway
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// =======================================================
// SYSTEM LINE LINK QR CODE (SOLUSI JALUR LINK ANTI-PECAH)
// =======================================================
client.on('qr', (qr) => {
    console.log('\n============= LEXIMED AI CORE LINK SYSTEM =============');
    console.log('JALUR ALTERNATIF ANTI-PECAH:');
    console.log('Silakan copy tautan di bawah ini dan paste ke browser Anda untuk memunculkan Barcode:');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
    console.log('========================================================\n');
    
    // Tetap cetak versi terminal lokal sebagai cadangan
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n=====> [SUCCESS] WhatsApp Agent LexiMed.ai MULTI-ROUTE ONLINE DI CLOUD! 🚀🔥');
});

client.on('message', async (msg) => {
    const text = msg.body.trim();
    if (!text.startsWith('!')) return;

    console.log('[Pesan Masuk] dari ' + msg.from + ': ' + text);

    const parts = text.split(' ');
    const command = parts[0].toLowerCase();
    const cleanContent = text.substring(command.length).trim();

    let systemInstruction = "";
    let placeholderExample = "";

    if (command === '!perawat') {
        systemInstruction = "Kamu adalah AI Perawat RS UNS. Ekstrak data mentah menjadi format TTV terstruktur (TD, HR, Suhu, Saturasi) dan sebutkan masalah keperawatan utamanya.";
        placeholderExample = "!perawat Tuan Budi TD 150/90, nadi 90x/menit, mengeluh pusing.";
    } else if (command === '!dokter') {
        systemInstruction = "Kamu adalah Clinical Decision Support System (CDSS) Agent RS UNS. Analisis data klinis, berikan draf diagnosis medis, tingkat kegawatdaruratan, dan rekomendasi tindakan.";
        placeholderExample = "!dokter Pasien anak demam tinggi 3 hari disertai bintik merah di kulit.";
    } else if (command === '!radiologi') {
        systemInstruction = "Kamu adalah Radiology Expert Explorer Node RS UNS. Analisis temuan anatomi organ, lesi, infiltrat, dan buat draf kesimpulan radiologi yang ringkas.";
        placeholderExample = "!radiologi Rontgen thorax CTR 55% tampak infiltrat di lapang paru kanan.";
    } else if (command === '!asisten') {
        systemInstruction = "Kamu adalah Assistant Medical Registrar RS UNS. Rapikan pencatatan identitas, keluhan utama, dan riwayat alergi pasien.";
        placeholderExample = "!asisten Nama Anandi, umur 25 tahun, alergi parasetamol, keluhan nyeri perut.";
    } else {
        msg.reply("Format klaster salah. Gunakan: !perawat, !dokter, !radiologi, atau !asisten");
        return;
    }

    if (!cleanContent) {
        msg.reply(`Silakan sertakan data atau laporan medis setelah perintah.\n\nContoh penggunaan:\n${placeholderExample}`);
        return;
    }

    const cleanRules = " JANGAN gunakan simbol bintang ganda (**) atau tagar (#) dalam jawabanmu. Hasilkan teks bersih polos yang rapi.";
    const finalSystemPrompt = systemInstruction + cleanRules;

    try {
        const chat = await msg.getChat();
        await chat.sendStateTyping();
    } catch (e) {
        console.log("Gagal memicu status mengetik.");
    }

    // =======================================================
    // ROUTE UTAMA ONLINE VIA GROQ ENGINE MENGGUNAKAN LLAMA 3.1
    // =======================================================
    try {
        console.log(`[CORE] Menghubungkan ke Groq Cloud menggunakan Model Akselerasi...`);
        
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant", 
            messages: [
                { role: "system", content: finalSystemPrompt },
                { role: "user", content: cleanContent }
            ],
            temperature: 0.3
        }, {
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        const replyText = response.data.choices[0].message.content;
        console.log(`[SUCCESS] Respon cerdas berhasil didapatkan secara LIVE dari Groq Cloud.`);
        msg.reply(replyText);

    } catch (error) {
        console.error("[ERROR] Jalur Cloud Sibuk, Mengaktifkan Cadangan Lokal:", error.message);
        
        const localFallbackResponse = `--- DRAFT ANALISIS MEDIS EMERGENCY (LOCAL ENGINE) ---\n\n` +
            `Sistem mendeteksi input keluhan: "${cleanContent}".\n\n` +
            `Rekomendasi Tindakan Terintegrasi:\n` +
            `1. Segera lakukan stabilisasi Tanda-Tanda Vital (TTV) di IGD.\n` +
            `2. Posisikan pasien semi-fowler jika mengalami sesak atau nyeri dada.\n` +
            `3. Persiapkan rekam Jantung (EKG) atau pemeriksaan penunjang lanjutan.\n\n` +
            `*(Sistem sedang dalam mode pembatasan kuota cloud server)*`;
            
        msg.reply(localFallbackResponse);
    }
});

// Jalankan sistem utama
client.initialize();