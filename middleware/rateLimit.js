import rateLimit from "express-rate-limit";

// ========= GLOBAL LIMIT =========
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 300, // 300 istek
  message: "Çok fazla istek gönderdiniz.",
  standardHeaders: true,
  legacyHeaders: false,
});

// ⚠️ FIX: Bu limiter yalnızca YORUM GÖNDERME (POST) için düşünülmüştü, ama
// app.js'te tüm /api/comments route'larının (yorumları OKUMA/GET dahil)
// önüne konulmuştu. Sonuç: bir kullanıcı sadece ilan detay sayfalarında
// gezinip yorumları görüntülese bile (hiç yorum YAZMASA da) bu sayaç
// doluyor ve "Çok fazla yorum yaptınız" hatası alıyordu. Artık sadece
// comment.route.js'teki POST endpoint'ine uygulanıyor (bkz. o dosya).
// skipFailedRequests: true ile de eksik/geçersiz gönderilen (400 dönen)
// denemeler quota'yı tüketmiyor.
export const commentLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 dakika
  max: 20,
  message: "Çok fazla yorum yaptınız. Bir süre sonra deneyin.",
  skipFailedRequests: true,
});

// ⚠️ FIX (1/2): Eskiden başarısız denemeler (ör. "bu isimde kategori zaten
// var" diye 409 dönen istekler) de günlük hakkın içinden sayılıyordu —
// express-rate-limit varsayılan olarak her isteği (başarılı/başarısız fark
// etmeksizin) sayar. skipFailedRequests: true ile artık sadece gerçekten
// BAŞARILI (2xx) kategori oluşturma istekleri sayılıyor.
//
// ⚠️ FIX (2/2): Bu endpoint sadece giriş yapmış kullanıcılara açık (bkz.
// category.routes.js'e eklenen `protect`), ama limit IP'ye göre
// uygulanıyordu — aynı ağı/IP'yi paylaşan farklı kullanıcılar (ör. aynı
// ofis/wifi) birbirinin hakkını tüketebiliyordu. keyGenerator ile artık
// IP yerine kullanıcının kendi id'sine göre sayılıyor.
//
// Limit de 3'ten yükseltildi: tek bir "yeni ana kategori + alt kategori"
// gönderimi zaten 2 ayrı başarılı POST isteği yapıyor (bkz.
// newCategoriesPage.jsx), yani eski limitle günde pratikte sadece 1 tam
// kategori çifti eklenebiliyordu.
export const categoryLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 15,
  message: "Günlük kategori ekleme limitine ulaştınız",
  skipFailedRequests: true,
  keyGenerator: (req) => req.user?.id || req.ip,
});
