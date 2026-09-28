# ⚡ AutoShort — Modern URL Shortener & Analytics Dashboard

> **Platform Shortlink & Analytics Modern seperti Bitly, s.id, dan Dub.co.**  
> Siap di-deploy langsung ke **Vercel** dengan arsitektur **Hybrid** (Zero-Config out-of-the-box + Cloud Database Sync via Supabase / Upstash Redis).

---

## ✨ Fitur Utama (Features)

### 🔗 1. Mesin Pemendek Tautan (Shortlink Engine)
- **Kustomisasi Slug (Back-half):** Tentukan alias tautan sendiri (contoh: `domain.com/promo-heboh` atau `domain.com/wa-order`) dengan validasi ketersediaan langsung.
- **Generator Slug Acak:** Tombol 🎲 untuk membuat hash unik 6 karakter secara otomatis.
- **Validasi Cerdas:** Otomatis menambahkan protokol `https://` jika belum ada.
- **Quick Shorten Bar:** Input cepat di bagian atas dashboard dengan tombol salin dari clipboard langsung.

### 📊 2. Analitik & Statistik Real-Time (Bitly & s.id Style)
- **Ringkasan KPI:** Total link dibuat, total klik seluruh tautan, rasio link aktif, dan sumber perujuk (referrer) nomor 1.
- **Grafik Tren Klik:** Visualisasi interaktif riwayat klik harian / mingguan.
- **Pelacakan Sumber Trafik (Referrers):** Identifikasi klik dari WhatsApp, Instagram, Facebook, TikTok, Google, atau Direct.
- **Distribusi Perangkat (Devices):** Persentase pengunjung Mobile (Smartphone), Desktop (PC/Mac), dan Tablet (iPad).
- **Riwayat Klik Terkini:** Log 10 pengunjung terakhir dengan timestamp relatif.

### 📱 3. QR Code Studio
- **Generator QR Code Resolusi Tinggi:** Otomatis dibuat untuk setiap tautan pendek.
- **Kustomisasi Warna:** Ubah warna foreground (QR) dan background sesuai identitas merek Anda.
- **Pilihan Resolusi Unduhan:** Unduh file PNG dalam ukuran 512px, 1024px (HD), atau 2048px (Ultra HD untuk spanduk / cetak).
- **Salin Gambar:** Salin file gambar QR langsung ke clipboard untuk ditempel ke aplikasi chat atau desain.

### 🔒 4. Keamanan & Kontrol Tingkat Lanjut
- **Proteksi Kata Sandi / PIN:** Kunci shortlink dengan password sehingga hanya pengunjung berotorisasi yang dapat membukanya.
- **Batas Waktu Tautan (Expiration Date):** Atur tanggal & jam kedaluwarsa tautan.
- **Toggle Pause / Aktif:** Hentikan atau aktifkan kembali tautan sewaktu-waktu dengan 1 klik tanpa menghapusnya.
- **UTM Campaign Builder:** Sisipkan parameter `utm_source`, `utm_medium`, dan `utm_campaign` untuk pelacakan kampanye Google Analytics.

### 🗂️ 5. Manajemen & Portabilitas Data
- **Sistem Tag & Kategori:** Kelompokkan link (Sosmed, Bisnis, WhatsApp, Promo, Kampanye).
- **Pencarian Global Instan:** Cari berdasarkan judul, slug, URL tujuan, atau tag (Tekan tombol keyboard `/`).
- **Mode Tampilan Ganda:** Pilihan tampilan Kartu Modern (*Card View*) atau Tabel Ringkas (*Table View*).
- **Ekspor CSV:** Unduh seluruh daftar tautan dan performanya ke dalam format spreadsheet CSV.
- **Dukungan Dark & Light Mode:** Antarmuka responsif dengan transisi tema gelap dan terang.

---

## 🏗️ Arsitektur & Struktur File

```
autoshort/
├── index.html            # Dashboard Web Single-Page Application (SPA)
├── styles.css            # Design System (CSS Variables, Glassmorphism, Responsive)
├── app.js                # State Manager, Analytics Engine, QR Studio, UTM Builder
├── redirect.html         # Layar pengalihan cerdas (Fallback, Password Gate, Expired)
├── vercel.json           # Konfigurasi routing & rewrites Vercel (/:slug -> redirect engine)
├── api/
│   ├── redirect.js       # Vercel Serverless Function: Engine 307/302 Redirect & Analytics Logger
│   ├── links.js          # Vercel Serverless Function: CRUD REST API untuk Tautan
│   └── analytics.js      # Vercel Serverless Function: Agregator Metrik Pengunjung
├── supabase_schema.sql   # Skrip DDL PostgreSQL untuk Supabase
├── .env.example          # Template Environment Variables Vercel
└── package.json          # Metadata & script pengembangan
```

---

## 🚀 Panduan Deploy ke Vercel

### Langkah 1: Push ke GitHub
Simpan dan push semua perubahan kode ini ke repositori GitHub Anda:
```bash
git add .
git commit -m "Upgrade: Complete Bitly/s.id style Shortlink Dashboard"
git push origin main
```

### Langkah 2: Deploy Otomatis di Vercel
1. Buka [vercel.com](https://vercel.com) dan login ke akun Anda.
2. Proyek `autoshort` akan otomatis mendeteksi commit baru di branch `main` dan menjalankan build deployment.
3. Buka URL Vercel Anda (contoh: `https://autoshort-alpha.vercel.app`). Dashboard short link Anda sudah langsung aktif dan siap dipakai!

---

## ☁️ Menghubungkan Database Cloud (Opsional)

Aplikasi ini menggunakan sistem **Hybrid**:
- **Bawaan (Zero-Config):** Langsung bekerja di browser menggunakan LocalStorage tanpa database apa pun.
- **Cloud Sync Permanen:** Jika Anda ingin data tersinkronisasi lintas perangkat (laptop, handphone, pengunjung lain), gunakan **Supabase** (gratis selamanya).

### Cara Setup Supabase:
1. Daftar gratis di [supabase.com](https://supabase.com) dan buat proyek baru.
2. Buka menu **SQL Editor**, salin isi file [`supabase_schema.sql`](supabase_schema.sql), lalu klik **Run**.
3. Di Supabase, buka **Project Settings > API**, salin:
   - `Project URL`
   - `anon public key`
4. Di Vercel Dashboard, buka **Project Settings > Environment Variables**, tambahkan:
   - `SUPABASE_URL` = URL Supabase Anda
   - `SUPABASE_ANON_KEY` = Anon Key Anda
5. Redeploy proyek di Vercel. Selesai! Semua link dan klik kini tersimpan di database PostgreSQL cloud.

---

## 💻 Menjalankan Secara Lokal (Local Development)

```bash
# Menggunakan Node.js / npx serve
npx serve . -p 3000

# Atau buka index.html langsung di browser Anda!
```

---

## 📄 Lisensi
MIT License © 2026 rigeladex44
