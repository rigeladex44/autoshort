# AutoShort

Dashboard pemendek URL berbahasa Indonesia dengan pengelolaan tautan, preview sosial, QR PNG, dan analitik kunjungan. Mendukung mobile dan desktop, tema terang/gelap, serta navigasi keyboard.

## Jalankan lokal

Gunakan Node.js 22.9+ (disarankan Node.js 24).

```sh
npm ci
npm run dev
```

Buka `http://localhost:3000`. Server lokal menjalankan API dan routing shortlink yang sama dengan deployment Vercel. Membuka `index.html` langsung atau memakai server statis saja tidak menjalankan API.

Tanpa konfigurasi Supabase, aplikasi memakai **mode lokal**. Tautan dan riwayat disimpan di browser pembuat. Tautan lokal **tidak dapat dibagikan ke perangkat/browser lain**. Mode ini cocok untuk mencoba fitur; gunakan cloud untuk tautan publik. Font dan ikon memakai CDN; generator QR disertakan di repositori.

## Aktifkan cloud dan deploy

1. Buat proyek Supabase. Jalankan seluruh isi [`supabase_schema.sql`](supabase_schema.sql) melalui SQL Editor. Skrip ini juga menambah kolom dan fungsi yang diperlukan instalasi lama, mempertahankan data, dan menutup akses langsung melalui anon key.
2. Impor repositori ke Vercel. Gunakan preset **Other**, tanpa build command atau output directory khusus, dan Node.js 24.
3. Tambahkan environment variables berikut di Vercel, lalu redeploy:

| Variable | Fungsi |
| --- | --- |
| `SUPABASE_URL` | URL proyek Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Kunci server Supabase; jangan masukkan ke browser |
| `ADMIN_TOKEN` | Token rahasia acak untuk mengelola tautan dan membaca statistik |
| `CUSTOM_DOMAIN` | Opsional: domain yang sudah terhubung ke deployment Vercel |

4. Buka dashboard → **Pengaturan** → masukkan `ADMIN_TOKEN` → **Hubungkan & Sinkronkan**. Token disimpan di `sessionStorage`, bukan dikirim ke pengunjung shortlink.
5. Buat tautan dan uji dari browser/perangkat lain. Tautan publik menggunakan database server untuk redirect; API pengelolaan memerlukan token admin. Dashboard ini untuk satu pengelola/kelompok yang berbagi token, bukan layanan multiakun.

Untuk cloud saat pengembangan lokal, salin `.env.example` menjadi `.env` dan isi di perangkat Anda. `npm run dev` memuat file tersebut. Jangan commit kredensial. Konfigurasi URL/key lewat browser tidak mengatur backend server; semua konfigurasi database dilakukan di environment server.

**Upgrade dari versi lama:** unduh Backup JSON terlebih dahulu jika ada data lokal. Jalankan ulang schema dan isi service-role key serta token admin sebelum redeploy. `SUPABASE_ANON_KEY` saja tidak lagi digunakan. Data lokal tidak otomatis diunggah atau ditimpa oleh sinkronisasi cloud. Dukungan Upstash lama yang hanya sebagian telah digantikan satu backend Supabase yang konsisten.

## Fitur

- Buat, edit (termasuk slug), jeda/aktifkan, dan hapus tautan; validasi HTTP(S), slug unik 2–64 karakter, serta nama rute sistem yang dicadangkan.
- URL tanpa protokol otomatis memakai HTTPS. Password/PIN (hash scrypt di cloud), kedaluwarsa, tag, dan UTM dapat diatur dari dialog tautan.
- Pencarian judul, URL, slug, dan tag; tampilan kartu atau ringkas; tombol salin, QR, dan analisis per tautan.
- Preview sosial dengan judul, deskripsi, serta unggah PNG/JPG/WebP maksimal 1 MB atau URL gambar. Crawler menerima Open Graph dari server cloud. Tampilan akhir dan pembaruan cache preview mengikuti platform sosial.
- QR dengan warna, latar, quiet zone, resolusi 512/1024/2048 px, unduh PNG, dan salin gambar pada browser yang mendukungnya. Parameter `src=qr` membedakan scan dari klik web.
- Analitik dari kunjungan yang benar-benar melewati redirect; tombol uji membuka tautan sesungguhnya. Tidak ada data pengunjung, negara, kota, atau referrer acak.
- Kunjungan cloud dicatat oleh fungsi SQL atomik. Crawler preview dan request HEAD tidak dihitung. Password salah, tautan dijeda, dan tautan kedaluwarsa tidak dihitung.
- Filter tanggal/per tautan, grafik, pengunjung unik, sumber trafik, perangkat, dan 25 aktivitas terbaru. Dashboard memuat ulang cloud setiap 15 detik ketika tab aktif; tombol Segarkan memuat data terbaru.
- Ekspor CSV tautan dan CSV kunjungan sesuai filter (dengan escaping), cetak/simpan PDF, Backup JSON, dan pemulihan cadangan lokal. Reset lokal tidak menghapus database cloud.

Geolokasi cloud berasal dari header Vercel; lokal memakai `Unknown`. Pengunjung unik cloud merupakan estimasi dari hash IP + user-agent, bukan identitas pengguna. Riwayat lokal dibatasi 5.000 kunjungan; analitik cloud dibaca bertahap melewati batas default 1.000 baris Supabase. Jika pencatatan statistik gagal, redirect tetap diteruskan dan server mencatat kegagalannya.

## Pengujian

```sh
npm test
npx playwright install chromium
npm run test:browser
```

Tes API memakai mock database untuk validasi, otorisasi, CRUD, proteksi redirect, pencatatan klik atomik, dan pagination. Tes Chromium menjalankan server lokal terisolasi, mencoba alur pengguna, mendekode QR hasil unduhan, serta memeriksa seluruh halaman pada lebar 320, 390, 768, dan 1440 px. Screenshot disimpan ke `test-results/`. Cloud diuji menggunakan respons API terkontrol; pengujian terhadap proyek Supabase/Vercel nyata memerlukan konfigurasi deployment Anda. Iklan pihak ketiga dikecualikan dari tes deterministik.

## Struktur

- `app.js`, `index.html`, `styles.css`: dashboard
- `redirect.js`, `redirect.html`: gate password dan redirect lokal
- `api/`: fungsi Vercel untuk CRUD, statistik, redirect publik, config, dan gambar
- `lib/`: validasi bersama serta akses database server
- `server.js`: server pengembangan tanpa dependency runtime
- `supabase_schema.sql`: schema dan migrasi yang dapat dijalankan ulang
- `test/`: tes API dan browser

QRCode.js © David Shim, MIT; lihat [`assets/QRCode-LICENSE.txt`](assets/QRCode-LICENSE.txt).

MIT License © 2026 rigeladex44
