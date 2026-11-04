// The privacy policy and account-deletion pages Google Play links to. Plain
// HTML with no scripts, in Turkish for the app's users. Keep the facts here in
// step with what the code does; a policy that drifts from the product is worse
// than none.

export const CONTACT_EMAIL = 'erenkamilgoksel96@gmail.com';
const UPDATED = '4 Kasım 2026';

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 28px; line-height: 1.25; margin: 0 0 4px; }
  h2 { font-size: 20px; margin: 32px 0 8px; }
  .muted { opacity: 0.7; font-size: 14px; }
  li { margin: 6px 0; }
  a { color: #4f46e5; }
  @media (prefers-color-scheme: dark) { a { color: #a5b4fc; } }
</style>
</head>
<body><main>
${body}
</main></body>
</html>`;
}

const mail = `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;

export const privacyPolicy = page(
  'Etkin Gizlilik Politikası',
  `<h1>Etkin Gizlilik Politikası</h1>
<p class="muted">Son güncelleme: ${UPDATED}</p>

<p>Etkin, üniversite kulüplerinin etkinliklerine bilet almayı, kapıda QR kodla girişi ve
katılım puanlarını sağlayan bir mobil uygulamadır. Bu sayfa hangi kişisel verileri neden
işlediğimizi, kimlerin görebildiğini ve haklarını anlatır. Uygulamayı geliştiren ve verilerden
sorumlu olan: Eren Göksel (bireysel geliştirici), ${mail}.</p>

<h2>Topladığımız veriler</h2>
<ul>
  <li><strong>Hesap bilgileri:</strong> ad soyad, e-posta adresi ve şifre. Şifren düz metin olarak
  değil, geri döndürülemez biçimde (argon2id ile) saklanır. İstersen üniversiteni ve öğrenci
  numaranı da eklersin.</li>
  <li><strong>Bilet ve katılım bilgileri:</strong> aldığın ve iptal ettiğin biletler, kapıda giriş
  yaptığın zaman ve kapı, bu girişlerden kazandığın kulüp puanları ve rozetler.</li>
  <li><strong>Kulüp ekibi bilgileri:</strong> bir kulübün ekibindeysen rolün, oluşturduğun
  etkinlikler ve kapıda yaptığın okutmalar (zaman, sonuç, kapı adı).</li>
  <li><strong>Cihaz kimliği:</strong> uygulama kurulurken telefonunda rastgele bir kimlik üretir.
  Biletinin QR kodunun yalnızca tek bir telefonda gösterilmesi için kullanılır. Telefonunun
  donanım kimliği, reklam kimliği veya konumu toplanmaz.</li>
  <li><strong>Kamera:</strong> yalnızca kulüp ekibi kapıda bilet okuturken kullanılır. Görüntü
  kaydedilmez ve sunucuya gönderilmez; sadece okunan QR kodunun içeriği gönderilir.</li>
  <li><strong>Teknik kayıtlar:</strong> sunucu, güvenlik ve hata ayıklama için istek kayıtları
  (IP adresi, zaman, istenen adres) tutar.</li>
</ul>

<h2>Verileri neden kullanıyoruz</h2>
<ul>
  <li>Hesabını oluşturmak ve oturumunu açık tutmak.</li>
  <li>Bilet vermek, kapıda biletin geçerli olduğunu doğrulamak ve aynı biletin iki kez
  kullanılmasını engellemek.</li>
  <li>Katılımın için kulüp puanı ve rozet vermek; kontenjanı sınırlı etkinliklerde puanı yüksek
  üyelere öncelik tanımak.</li>
  <li>Kulüplere etkinliklerinin katılım sayılarını göstermek.</li>
  <li>Hizmetin güvenliğini sağlamak ve kötüye kullanımı (ör. art arda yanlış şifre denemeleri)
  engellemek.</li>
</ul>
<p>Etkin reklam göstermez, verilerini satmaz ve reklam ya da analitik amaçlı takip araçları
kullanmaz.</p>

<h2>Kimler görebilir</h2>
<ul>
  <li><strong>Etkinliği düzenleyen kulübün organizatörleri:</strong> bilet aldığın etkinlik için
  adını, öğrenci numaranı, bilet türünü ve giriş durumunu görür (katılımcı listesi ve kapıda
  kimlik kontrolü için).</li>
  <li><strong>Kapı görevlileri:</strong> biletini okuttuklarında adını ve öğrenci numaranı görür.</li>
  <li><strong>Altyapı sağlayıcıları:</strong> sunucu ve veritabanı Railway tarafından Avrupa
  Birliği'nde (Hollanda, Amsterdam) barındırılır. Uygulama Expo ile derlenir ve Google Play
  üzerinden dağıtılır.</li>
  <li>Kanunen zorunlu olduğunda yetkili kurumlar.</li>
</ul>

<h2>Verilerin saklandığı yer</h2>
<p>Sunucularımız Avrupa Birliği'nde (Hollanda) bulunduğu için verilerin Türkiye dışında saklanır.
Altyapı sağlayıcımız AB veri koruma mevzuatına (GDPR) tabidir.</p>

<h2>Ne kadar saklıyoruz</h2>
<ul>
  <li>Hesabın açık olduğu sürece.</li>
  <li>Hesabını sildiğinde adın, e-postan, öğrenci numaran, üniversiten ve şifren hemen silinir.
  Geçmiş katılım ve puan kayıtları, kulüplerin istatistikleri doğru kalsın diye kimseyle
  ilişkilendirilemeyecek biçimde (anonim) kalır.</li>
  <li>Teknik kayıtlar en fazla 30 gün saklanır.</li>
</ul>

<h2>Güvenlik</h2>
<p>Uygulama ile sunucu arasındaki tüm trafik şifrelidir (HTTPS). Oturum anahtarların ve bilet QR
anahtarların telefonunun güvenli deposunda tutulur. Bilet QR kodları her 15 saniyede değişir ve
bilet ekranında ekran görüntüsü alınması engellenir.</p>

<h2>Hakların</h2>
<p>6698 sayılı Kişisel Verilerin Korunması Kanunu'nun 11. maddesi kapsamında verilerinin işlenip
işlenmediğini öğrenme, bilgi isteme, düzeltilmesini veya silinmesini isteme, işlemeye itiraz etme
ve zarara uğramışsan bunun giderilmesini isteme haklarına sahipsin. Taleplerini ${mail} adresine
gönderebilirsin; en geç 30 gün içinde yanıtlanır.</p>

<h2>Hesabını silmek</h2>
<p>Uygulamada <strong>Profil → Hesabımı sil</strong>. Uygulamaya erişemiyorsan
<a href="/account-deletion">hesap silme sayfasındaki</a> yolu izle.</p>

<h2>Çocuklar</h2>
<p>Etkin üniversite öğrencilerine yöneliktir; 18 yaşından küçüklere yönelik değildir.</p>

<h2>Değişiklikler</h2>
<p>Bu politika değişirse güncel hali bu sayfada yayımlanır ve tarihi güncellenir. Önemli
değişiklikleri uygulamada da duyururuz.</p>

<h2>İletişim</h2>
<p>${mail}</p>`,
);

export const accountDeletion = page(
  'Etkin hesabını silme',
  `<h1>Etkin hesabını silme</h1>
<p class="muted">Son güncelleme: ${UPDATED}</p>

<h2>Uygulamadan</h2>
<ol>
  <li>Etkin uygulamasında <strong>Profil</strong> sekmesini aç.</li>
  <li>En alttaki <strong>Hesabımı sil</strong>'e dokun.</li>
  <li>Şifreni yaz ve onayla. Hesabın hemen silinir.</li>
</ol>

<h2>Uygulamaya erişemiyorsan</h2>
<p>Hesabına kayıtlı e-posta adresinden ${mail} adresine <strong>"Etkin hesap silme"</strong> konulu
bir e-posta gönder. Hesabın en geç 30 gün içinde silinir ve sana bilgi verilir.</p>

<h2>Silinenler</h2>
<ul>
  <li>Ad soyad, e-posta adresi, şifre, üniversite ve öğrenci numarası</li>
  <li>Tüm oturumların ve biletlerin telefonuna bağlantısı</li>
  <li>Kulüp ekibi üyeliklerin</li>
  <li>Henüz başlamamış etkinliklerdeki biletlerin (iptal edilir, yerler başkalarına açılır)</li>
</ul>

<h2>Anonim olarak kalanlar</h2>
<ul>
  <li>Geçmiş etkinlik girişleri, kazanılan puanlar ve rozetler. Kimseyle ilişkilendirilemez;
  kulüplerin katılım istatistikleri için tutulur.</li>
  <li>Teknik kayıtlar en fazla 30 gün sonra silinir.</li>
</ul>

<p>Ayrıntılar için <a href="/privacy">gizlilik politikası</a>.</p>`,
);
