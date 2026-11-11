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
| `SUPABASE_ANON_KEY` | Anon key untuk permintaan dengan JWT pengguna; RLS tetap berlaku |
| `OWNER_USER_ID` | UUID akun pemilik dari Supabase Authentication → Users |
| `AUTH_SITE_URL` | Origin HTTPS dashboard utama untuk callback login |
| `AUTH_GOOGLE_ENABLED` | `true` setelah provider Google dikonfigurasi |
| `PLATFORM_HOSTS` | Domain bersama existing, dipisahkan koma |
| `ADMIN_TOKEN` | Opsional: akses pemeliharaan server lama; tidak dipakai untuk login dashboard |
| Domain utama | Diatur melalui Pengaturan → Nama Domain Utama setelah DNS dan HTTPS aktif |

4. Di Supabase Authentication, aktifkan Email/password dengan konfirmasi email. Tambahkan `AUTH_SITE_URL/**` ke Redirect URLs. Untuk Google, konfigurasi OAuth client pada provider Google; authorized redirect Google adalah `https://<project>.supabase.co/auth/v1/callback`.
5. Masuk melalui **Pengaturan → Masuk/Daftar** atau Google. Sesi memakai cookie HttpOnly, Secure pada produksi, SameSite=Lax. Token tidak disimpan di localStorage/sessionStorage. Tautan, statistik, domain, dan pilihan domain utama dipisahkan per pengguna melalui JWT terverifikasi dan RLS. Slug tetap unik secara global pada domain bersama; kapital dipertahankan.
6. Akun pemilik menghubungkan integrasi Vercel melalui dashboard sekali. Pengguna lain dapat memasang domain sendiri, memeriksa DNS/HTTPS, dan mengaktifkannya tanpa mengetahui token Vercel. Domain pribadi hanya melayani tautan pemiliknya. Domain bersama existing perlu dicantumkan di `PLATFORM_HOSTS`.

**SMTP untuk email publik:** bawaan Supabase dibatasi dan tidak cocok untuk pendaftaran publik. Rekomendasi: buat akun Resend, tambahkan domain pengirim dan pasang record DNS yang diberikan (SPF/DKIM). Setelah domain terverifikasi, buka Supabase → Authentication → Email → SMTP: host `smtp.resend.com`, port `465`, username `resend`, password berupa API key Resend, sender misalnya `noreply@domain-anda`. Masukkan secret langsung di pengaturan Supabase, bukan chat atau repositori. Uji email konfirmasi dan lupa password dari akun sendiri sebelum membuka pendaftaran publik. Biarkan konfirmasi email aktif; Google dapat digunakan sementara SMTP belum siap.

Untuk cloud saat pengembangan lokal, salin `.env.example` menjadi `.env`; jangan commit kredensial. `npm run dev` memuat file tersebut.

**Upgrade:** backup database terlebih dahulu, lalu jalankan `migrations/20261110_user_accounts.sql` pada instalasi existing (schema lengkap untuk instalasi baru). Migrasi tidak menghapus tautan/klik atau mengganti pemilik yang sudah ada. Tautan tanpa pemilik tidak dialihkan oleh skrip; pengelola harus menentukan pemiliknya secara eksplisit. Pertahankan domain bersama dan daftar redirect OAuth existing. Data lokal tidak diunggah otomatis. Dalam cloud, daftar tautan dan klik tidak dicache permanen di browser dan dibersihkan saat pergantian akun.

## Fitur

- Buat, edit (termasuk slug), jeda/aktifkan, dan hapus tautan; validasi HTTP(S), slug unik 2–64 karakter (huruf kapital dipertahankan; `PromoVIP` dan `promovip` merupakan URL berbeda), serta nama rute sistem yang dicadangkan.
- URL tanpa protokol otomatis memakai HTTPS. Password/PIN (hash scrypt di cloud), kedaluwarsa, tag, dan UTM dapat diatur dari dialog tautan.
- Pencarian judul, URL, slug, dan tag; tampilan kartu atau ringkas; tombol salin, QR, dan analisis per tautan.
- Preview sosial dengan judul, deskripsi, serta unggah PNG/JPG/WebP maksimal 1 MB atau URL gambar. Crawler menerima Open Graph dari server cloud. Tampilan akhir dan pembaruan cache preview mengikuti platform sosial.
- QR dengan warna, latar, quiet zone, resolusi 512/1024/2048 px, unduh PNG, dan salin gambar pada browser yang mendukungnya. Parameter `src=qr` membedakan scan dari klik web.
- Analitik dari kunjungan yang benar-benar melewati redirect; tombol uji membuka tautan sesungguhnya. Tidak ada data pengunjung, negara, kota, atau referrer acak.
- Kunjungan cloud dicatat oleh fungsi SQL atomik. Crawler preview dan request HEAD tidak dihitung. Password salah, tautan dijeda, dan tautan kedaluwarsa tidak dihitung.
- Filter tanggal 1–7 hari (termasuk pemilihan tanggal manual) dan per tautan, grafik per jam untuk rentang 1–2 hari dan per hari untuk 3–7 hari, pengunjung unik, sumber trafik, perangkat, dan 25 aktivitas terbaru. Dashboard memuat ulang cloud setiap 15 detik ketika tab aktif; tombol Segarkan memuat data terbaru.
- Ekspor CSV tautan dan CSV kunjungan sesuai filter (dengan escaping), cetak/simpan PDF, Backup JSON, dan pemulihan cadangan lokal. Reset lokal tidak menghapus database cloud.

Geolokasi cloud berasal dari header Vercel; lokal memakai `Unknown`. Pengunjung unik cloud merupakan estimasi dari hash IP + user-agent, bukan identitas pengguna. Riwayat lokal dibatasi 5.000 kunjungan; analitik cloud dibaca bertahap melewati batas default 1.000 baris Supabase. Jika pencatatan statistik gagal, redirect tetap diteruskan dan server mencatat kegagalannya.

## Pengujian

```sh
npm test
npx playwright install chromium
npm run test:browser
```

Tes API memakai mock database untuk validasi, otorisasi, CRUD, proteksi redirect, pencatatan klik atomik, dan pagination. Tes Chromium menjalankan server lokal terisolasi, mencoba alur pengguna, mendekode QR hasil unduhan, serta memeriksa seluruh halaman pada lebar 320, 390, 768, dan 1440 px (28 kombinasi halaman/ukuran). Screenshot disimpan ke `test-results/`. Cloud diuji menggunakan respons API terkontrol; pengujian terhadap proyek Supabase/Vercel nyata memerlukan konfigurasi deployment Anda. Iklan pihak ketiga dikecualikan dari tes deterministik.

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

### Domain Utama AutoShort (Bersama)
- Akun pemilik/admin (`OWNER_USER_ID`) dapat mengatur domain utama bersama (shared domain) langsung melalui menu **Domain**.
- Domain utama bersama ini otomatis digunakan oleh seluruh akun baru dan pengguna yang belum/tidak memiliki domain pribadi aktif.
- Jika domain utama bersama diganti (misalnya ke `rigeel.id` atau `www.rigeel.id`), domain lama tetap melayani tautan yang sudah dibuat sebelumnya tanpa menghapus data tautan atau melepas domain dari proyek.
- Jika domain di Vercel memiliki pengalihan (misalnya `rigeel.id` dialihkan ke `www.rigeel.id`), gunakan tombol **Gunakan Tanpa Pengalihan** di rincian domain untuk melayani AutoShort langsung pada hostname tersebut, atau gunakan hostname tujuannya (`www.rigeel.id`).

### Domain Pribadi Setiap Pengguna
1. Pengguna masuk ke akun masing-masing → buka menu **Domain**.
2. Pengguna **tidak perlu** memiliki akun Vercel, membuka Vercel, atau memasukkan token Vercel (koneksi Vercel dikelola terpusat oleh server/admin).
3. Masukkan hostname pribadi yang diinginkan (disarankan subdomain seperti `go.domainanda.com`), lalu klik **Tambahkan Domain**.
4. Dashboard secara otomatis mendaftarkan domain ke hosting proyek dan menampilkan record DNS aktual:
   - **Jenis Record:** A, CNAME, atau TXT sesuai kebutuhan.
   - **Nama / Host:** Nilai host yang harus dimasukkan (contoh: `go` untuk subdomain, `@` untuk domain utama/apex).
   - **Target / Nilai:** Nilai tujuan dari Vercel DNS.
   - **TTL:** TTL yang disarankan (Auto / default penyedia).
   - Tombol salin satu klik untuk Nama dan Nilai.
5. Panduan pemasangan DNS disediakan di dashboard untuk berbagai penyedia DNS termasuk **Domainesia** (Kelola Domain → DNS Management) dan **Cloudflare** (DNS → Records, pilih opsi *DNS only* / awan abu-abu).
6. Klik **Periksa DNS & HTTPS** untuk memverifikasi propagasi DNS, kepemilikan domain, dan penerbitan sertifikat SSL/HTTPS secara nyata.
7. Tombol **Jadikan Domain Pribadi Utama** hanya akan aktif setelah domain lolos seluruh pemeriksaan DNS, HTTPS, dan pembuktian backend AutoShort.
8. Pengguna bebas memilih menggunakan domain pribadi miliknya atau kembali menggunakan domain utama bersama melalui tombol **Gunakan Alamat Situs / Bersama**.
9. Domain pribadi pengguna hanya melayani tautan milik akun pemilik domain tersebut dan tidak dapat dilihat atau diubah oleh akun lain.

Konfigurasi server satu kali: `AUTOSHORT_VERCEL_PROJECT_ID` (atau system variable `VERCEL_PROJECT_ID`) dan `AUTOSHORT_VERCEL_TEAM_ID` untuk team. Opsional, secret server `VERCEL_DOMAINS_TOKEN` dapat dipakai sebagai pengganti koneksi token di dashboard; koneksi ini dikelola melalui secret server. Jangan masukkan token ke kode, query URL, log, atau chat.

Jalankan kembali `supabase_schema.sql` sebelum menggunakan versi ini untuk membuat tabel `app_settings` dan `domain_credentials`. Data tautan/klik existing tidak dihapus. `CUSTOM_DOMAIN` pada environment tidak lagi menjadi sumber konfigurasi. Mode lokal menonaktifkan pengelolaan domain karena tautan bergantung pada penyimpanan browser. Pemeriksaan HTTPS saat ini membutuhkan IPv4 publik (record A atau CNAME yang mengarah ke A).

## Tampilan dan navigasi

Halaman awal membuka **Beranda**, yang merangkum seluruh link, klik, link aktif, kunjungan QR, lima link terbaru, dan lima aktivitas terakhir. Ringkasan tidak dipengaruhi filter Analitik. Tombol **Buat link** membuka popup pembuatan dan kartu link terbaru membuka detail. Halaman Link menyediakan tombol **Buat link** untuk membuka popup pembuatan dan daftar kartu memanjang satu per baris. Klik kartu untuk melihat detail, menyalin URL, mengedit, membuka QR/statistik, menjeda, atau menghapus link. Pada ponsel, navigasi bawah memberikan akses cepat ke Beranda, Tautan, Analitik, QR, dan Domain; menu samping memuat Aktivitas, Pengaturan, serta pilihan tema. Domain dan Pengaturan merupakan halaman terpisah. Shortcut `/` membuka pencarian tautan; Escape menutup dialog/menu. Menu mobile dan dialog mendukung navigasi keyboard.

Ikon Font Awesome 6.5.1 disajikan dari `assets/fontawesome/` agar navigasi tidak bergantung pada CDN. Lisensi tersedia di `assets/fontawesome/LICENSE.txt`. `workspace.css` memuat komponen tampilan dan penyesuaian layar di atas stylesheet dasar. Dashboard tidak memuat iklan atau font eksternal.

Performa per tautan menampilkan empat kolom ringkas (tautan, klik, unik, QR) tanpa scroll horizontal pada mobile. Klik nama tautan untuk membuka detail lengkap. Detail waktu grafik mengikuti zona waktu browser dan tampil langsung pada sumbu grafik; sentuh/klik batang atau arahkan kursor untuk tooltip detail, tanpa kontrol tambahan di bawah grafik.

Ringkasan di bawah grafik mengikuti filter aktif: Total Link menghitung link dalam pilihan (tetap ada meski tanpa kunjungan), Kunjungan menghitung event dalam rentang tanggal, dan Pengunjung Unik menghitung identitas berbeda di keseluruhan rentang, bukan penjumlahan unik per jam. Sebelum autentikasi cloud, angka ditampilkan sebagai —.
