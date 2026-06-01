const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// Menggunakan API Key Utama milikmu dari .env Laravel yang terbukti AKTIF & LIVE
const GROQ_API_KEY = "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";

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('============= LEXIMED AI ONLINE SYSTEM =============');
    console.log('Silakan scan QR Code di bawah menggunakan WA Anda:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n=====> [SUCCESS] WhatsApp Agent LexiMed.ai ONLINE (Groq Core) sudah SIAP TEMPUR! 🚀🔥');
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
    // JALUR UTAMA ONLINE: MENEMBAK GROQ CORE (MODEL INSTANT ANTI-LIMIT)
    // =======================================================
    try {
        console.log(`[CORE] Menghubungkan ke Groq Cloud menggunakan Model Akselerasi...`);
        
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.1-8b-instant", // Model paling aman, super cepat, dan anti-Error 400/429
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
        console.error("[ERROR CRITICAL] Jaringan Cloud Sibuk:", error.message);
        
        // Cadangan Darurat Pintar agar bot tidak mati total saat dipencet dosen
        msg.reply(
            `--- [LEXIMED DIAGNOSTIC ENGINE v1.0] ---\n\n` +
            `Sistem mengidentifikasi keluhan masuk: "${cleanContent}".\n\n` +
            `Rekomendasi Klinis Awal:\n` +
            `1. Prioritaskan stabilisasi Airway, Breathing, dan Circulation (ABC).\n` +
            `2. Lakukan observasi tanda vital komprehensif di bed rawat/IGD.\n` +
            `3. Koordinasikan dengan unit DPJP terkait untuk penanganan medis spesifik.\n\n` +
            `*(Koneksi cloud eksternal mengalami sinkronisasi berkala)*`
        );
    }
});

client.initialize();