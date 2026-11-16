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
| Domain default | Diatur oleh pemilik di halaman Domain setelah DNS dan HTTPS aktif |

4. Di Supabase Authentication, aktifkan Email/password dengan konfirmasi email. Tambahkan `AUTH_SITE_URL/**` ke Redirect URLs. Untuk Google, konfigurasi OAuth client pada provider Google; authorized redirect Google adalah `https://<project>.supabase.co/auth/v1/callback`.
5. Masuk melalui **Pengaturan → Masuk/Daftar** atau Google. Sesi memakai cookie HttpOnly, Secure pada produksi, SameSite=Lax. Token tidak disimpan di localStorage/sessionStorage. Tautan, statistik, domain, dan pilihan domain utama dipisahkan per pengguna melalui JWT terverifikasi dan RLS. Slug tetap unik secara global pada domain bersama; kapital dipertahankan.
6. Pemilik mengatur Secret server `VERCEL_DOMAINS_TOKEN` satu kali; dashboard tidak meminta token hosting. Pengguna lain dapat memasang domain sendiri, memeriksa DNS/HTTPS, dan mengaktifkannya tanpa mengetahui token Vercel. Domain pribadi hanya melayani tautan pemiliknya. Domain bersama existing perlu dicantumkan di `PLATFORM_HOSTS`.

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

## Domain default, domain pribadi, dan alamat tautan

- **Domain Default AutoShort** dikelola hanya oleh pemilik (`OWNER_USER_ID`). Akun yang tidak memilih domain pribadi memakainya untuk tautan baru. Tambahkan/periksa hostname, lalu setelah DNS dan HTTPS siap pilih **Jadikan Default AutoShort**. Domain bersama lama tetap terdaftar dalam `shared_domains` dan tetap melayani tautan publik.
- **Domain untuk tautan baru** adalah pilihan akun sendiri. Pengguna menambahkan hostname → menyalin record DNS → **Periksa DNS & HTTPS** → **Gunakan untuk Tautan Baru**. **Gunakan Domain Default AutoShort** menghapus pilihan pribadi dan langsung memuat domain bersama yang benar.
- **Alamat setiap tautan** disimpan di `links.short_domain`. Kartu, preview edit, salin, CSV, dan QR menggunakan alamat tersebut. Mengganti default tidak mengganti alamat tautan lama. API dan trigger database menolak perubahan domain tautan yang sudah diterbitkan. Slug tetap unik global dan kapital dipertahankan.
- Domain pribadi dicatat untuk semua akun, termasuk pemilik aplikasi, dan hanya melayani tautan milik pemilik domain. Domain bersama diperiksa sebelum domain pribadi agar promosi domain tidak membatasi routing ke satu akun.
- Domain yang masih dirujuk tautan atau menjadi domain bersama tidak dapat dilepas. Gangguan DNS/TLS saat pemeriksaan ulang tidak membatalkan kepemilikan yang sebelumnya sudah terverifikasi.

Record A/CNAME/TXT diambil dari API hosting untuk hostname aktual. Dashboard menampilkan Nama/Host, Nilai, TTL, serta tombol salin. Pasang record di penyedia nameserver aktif (misalnya DNS Management Domainesia atau DNS → Records Cloudflare). Gunakan TTL Auto/default dan DNS only di Cloudflare selama penyiapan. Jangan mengganti nameserver atau menghapus record email/hostname lain. Perubahan DNS bisa memerlukan beberapa menit hingga 48 jam; HTTPS diproses otomatis. Verifikasi menguji DNS publik, TLS tanpa pengalihan, dan bukti dari backend AutoShort yang sama. Tombol aktivasi terkunci sebelum pemeriksaan berhasil; server tetap memeriksa ulang saat aktivasi.

Hosting tetap memerlukan autentikasi **di server**: atur `VERCEL_DOMAINS_TOKEN` sebagai encrypted Secret produksi, `AUTOSHORT_VERCEL_PROJECT_ID`, dan `AUTOSHORT_VERCEL_TEAM_ID`. Pengguna tidak perlu akun/token Vercel. Kredensial lama yang sudah terenkripsi tetap didukung untuk kompatibilitas. Jangan menyalin placeholder proxy dari environment agent ke aplikasi. `/api/domain-integration` merupakan endpoint pemeliharaan khusus pemilik; tidak ada formulir token di dashboard.

**Upgrade existing:** backup, lalu jalankan `migrations/20261116_domain_addresses.sql`. Daftarkan seluruh hostname bersama existing (termasuk origin `AUTH_SITE_URL` dan `PLATFORM_HOSTS`) ke `shared_domains`, simpan default bersama yang sedang dipakai, dan isi `short_domain` yang masih NULL dari pilihan pribadi terverifikasi atau default sebelumnya. Jangan menebak alamat historis atau menimpa `short_domain` yang sudah terisi. Data tautan/klik/pemilik tidak dihapus. Fungsi `set_shared_domain` menyimpan default lama dan baru secara atomik, hanya bisa dipanggil server/service role. Instalasi baru memakai schema lengkap dan perlu domain bersama awal yang terverifikasi sebelum membuat tautan cloud.

`AUTH_SITE_URL` tetap menjadi origin callback autentikasi. Mengganti default shortlink tidak otomatis memindahkan origin login/OAuth. Domain dashboard lama tetap dipertahankan; jika origin autentikasi dipindah, perbarui `AUTH_SITE_URL` dan allowlist Supabase secara terpisah sambil mempertahankan callback existing.

## Tampilan dan navigasi

Halaman awal membuka **Beranda**, yang merangkum seluruh link, klik, link aktif, kunjungan QR, lima link terbaru, dan lima aktivitas terakhir. Ringkasan tidak dipengaruhi filter Analitik. Tombol **Buat link** membuka popup pembuatan dan kartu link terbaru membuka detail. Halaman Link menyediakan tombol **Buat link** untuk membuka popup pembuatan dan daftar kartu memanjang satu per baris. Klik kartu untuk melihat detail, menyalin URL, mengedit, membuka QR/statistik, menjeda, atau menghapus link. Pada ponsel, navigasi bawah memberikan akses cepat ke Beranda, Tautan, Analitik, QR, dan Domain; menu samping memuat Aktivitas, Pengaturan, serta pilihan tema. Domain dan Pengaturan merupakan halaman terpisah. Shortcut `/` membuka pencarian tautan; Escape menutup dialog/menu. Menu mobile dan dialog mendukung navigasi keyboard.

Ikon Font Awesome 6.5.1 disajikan dari `assets/fontawesome/` agar navigasi tidak bergantung pada CDN. Lisensi tersedia di `assets/fontawesome/LICENSE.txt`. `workspace.css` memuat komponen tampilan dan penyesuaian layar di atas stylesheet dasar. Dashboard tidak memuat iklan atau font eksternal.

Performa per tautan menampilkan empat kolom ringkas (tautan, klik, unik, QR) tanpa scroll horizontal pada mobile. Klik nama tautan untuk membuka detail lengkap. Detail waktu grafik mengikuti zona waktu browser dan tampil langsung pada sumbu grafik; sentuh/klik batang atau arahkan kursor untuk tooltip detail, tanpa kontrol tambahan di bawah grafik.

Ringkasan di bawah grafik mengikuti filter aktif: Total Link menghitung link dalam pilihan (tetap ada meski tanpa kunjungan), Kunjungan menghitung event dalam rentang tanggal, dan Pengunjung Unik menghitung identitas berbeda di keseluruhan rentang, bukan penjumlahan unik per jam. Sebelum autentikasi cloud, angka ditampilkan sebagai —.
