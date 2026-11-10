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
| Domain utama | Diatur melalui Pengaturan → Nama Domain Utama setelah DNS dan HTTPS aktif |

4. Buka dashboard → **Pengaturan** → masukkan `ADMIN_TOKEN` → **Masuk admin**. Token disimpan di `sessionStorage`, bukan dikirim ke pengunjung shortlink.
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

Tes API memakai mock database untuk validasi, otorisasi, CRUD, proteksi redirect, pencatatan klik atomik, dan pagination. Tes Chromium menjalankan server lokal terisolasi, mencoba alur pengguna, mendekode QR hasil unduhan, serta memeriksa seluruh halaman pada lebar 320, 390, 768, dan 1440 px (24 kombinasi halaman/ukuran). Screenshot disimpan ke `test-results/`. Cloud diuji menggunakan respons API terkontrol; pengujian terhadap proyek Supabase/Vercel nyata memerlukan konfigurasi deployment Anda. Iklan pihak ketiga dikecualikan dari tes deterministik.

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

## Kelola domain langsung dari dashboard

1. Masuk sebagai admin → **Domain → Koneksi Vercel**. Tempel secret token Vercel dengan akses ke team proyek AutoShort, lalu klik **Hubungkan Vercel**. Token dikirim melalui HTTPS dan disimpan dengan enkripsi AES-256-GCM dalam tabel server `domain_credentials`; nilainya tidak dikembalikan ke browser atau dimasukkan ke backup. Kolom token dikosongkan setelah pengiriman. Token yang kedaluwarsa dapat diganti melalui koneksi ini. Rotasi service-role key memerlukan koneksi ulang karena kunci tersebut menjadi dasar enkripsi kredensial.
2. Isi hostname, misalnya `go.contoh.com`, lalu klik **Tambahkan Domain**. Server mendaftarkannya pada proyek Vercel AutoShort yang sudah dikonfigurasi, tanpa membuat proyek baru atau memindahkan domain dari proyek lain.
3. Dashboard menampilkan rekomendasi record A/CNAME dan TXT verifikasi dari Vercel, lengkap dengan tombol salin. Pasang record di penyedia DNS yang ditunjukkan oleh nameserver Anda. DNS eksternal (misalnya Domainesia) tetap memerlukan akses ke penyedia itu; aplikasi tidak mengklaim sudah mengubah DNS eksternal.
4. Klik **Periksa DNS & HTTPS**. Status menampilkan kepemilikan, konfigurasi DNS, pengalihan, dan kesiapan HTTPS/backend. Record TXT yang belum ada ditampilkan sebagai menunggu verifikasi, bukan sukses palsu.
5. Pilih hostname dan klik **Jadikan Domain Utama**. Server memeriksa DNS publik, TLS, dan bukti dari backend yang sama sebelum menyimpan ke `app_settings`. Pengaturan berlaku untuk semua browser, tautan, salin URL, QR, dan preview sosial tanpa redeploy. Domain yang mengalihkan ke hostname lain tidak dapat dijadikan domain utama; pilih hostname tujuannya atau gunakan **Gunakan Tanpa Pengalihan** di rincian domain untuk menghapus pengalihan dari dashboard.

**Gunakan Alamat Situs** menghapus pilihan domain utama tanpa melepas domain Vercel atau menghapus tautan. **Lepas Domain** melepas hanya hostname yang dipilih dari proyek setelah konfirmasi, tanpa menghapus data tautan. Domain utama, hostname dashboard yang sedang digunakan, dan domain bawaan Vercel dilindungi dari pelepasan. **Putus Koneksi** menghapus kredensial integrasi yang disimpan, tanpa mengubah domain/tautan yang sudah terpasang.

Konfigurasi server satu kali: `AUTOSHORT_VERCEL_PROJECT_ID` (atau system variable `VERCEL_PROJECT_ID`) dan `AUTOSHORT_VERCEL_TEAM_ID` untuk team. Opsional, secret server `VERCEL_DOMAINS_TOKEN` dapat dipakai sebagai pengganti koneksi token di dashboard; koneksi ini dikelola melalui secret server. Jangan masukkan token ke kode, query URL, log, atau chat.

Jalankan kembali `supabase_schema.sql` sebelum menggunakan versi ini untuk membuat tabel `app_settings` dan `domain_credentials`. Data tautan/klik existing tidak dihapus. `CUSTOM_DOMAIN` pada environment tidak lagi menjadi sumber konfigurasi. Mode lokal menonaktifkan pengelolaan domain karena tautan bergantung pada penyimpanan browser. Pemeriksaan HTTPS saat ini membutuhkan IPv4 publik (record A atau CNAME yang mengarah ke A).

## Tampilan dan navigasi

Halaman awal membuka **Tautan**. Halaman Link menyediakan tombol **Buat link** untuk membuka popup pembuatan dan daftar kartu memanjang satu per baris. Klik kartu untuk melihat detail, menyalin URL, mengedit, membuka QR/statistik, menjeda, atau menghapus link. Pada ponsel, navigasi bawah memberikan akses cepat ke Tautan, Analitik, QR, dan Domain; menu samping memuat Aktivitas, Pengaturan, serta pilihan tema. Domain dan Pengaturan merupakan halaman terpisah. Shortcut `/` membuka pencarian tautan; Escape menutup dialog/menu. Menu mobile dan dialog mendukung navigasi keyboard.

Ikon Font Awesome 6.5.1 disajikan dari `assets/fontawesome/` agar navigasi tidak bergantung pada CDN. Lisensi tersedia di `assets/fontawesome/LICENSE.txt`. `workspace.css` memuat komponen tampilan dan penyesuaian layar di atas stylesheet dasar. Dashboard tidak memuat iklan atau font eksternal.
