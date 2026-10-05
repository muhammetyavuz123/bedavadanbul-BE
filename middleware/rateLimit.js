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

// ===== İşletme dizini: özel soru-cevap & yorumlar =====
// Hepsi giriş gerektiren route'larda kullanılır (req.user dolu), bu yüzden
// IP yerine kullanıcı id'sine göre sayılır. skipFailedRequests: true ile
// doğrulamadan dönen (400/403/404) denemeler hakkı tüketmez.
export const inquiryLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  message: { message: "Günlük soru gönderme limitine ulaştınız." },
  skipFailedRequests: true,
  keyGenerator: (req) => String(req.user.id),
});

export const inquiryMessageLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 60,
  message: { message: "Çok fazla mesaj gönderdiniz. Biraz sonra tekrar deneyin." },
  skipFailedRequests: true,
  keyGenerator: (req) => String(req.user.id),
});

export const reviewLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 15,
  message: { message: "Günlük yorum limitine ulaştınız." },
  skipFailedRequests: true,
  keyGenerator: (req) => String(req.user.id),
});

// Favori ekleme/çıkarma
export const favoriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  message: { message: "Çok fazla favori işlemi yaptınız. Biraz sonra tekrar deneyin." },
  skipFailedRequests: true,
  keyGenerator: (req) => String(req.user.id),
});

// Cihaz bildirim kaydı
export const pushRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { message: "Çok fazla istek. Biraz sonra tekrar deneyin." },
  skipFailedRequests: true,
  keyGenerator: (req) => String(req.user.id),
});

// Yönetici toplu bildirim gönderimi
export const pushAdminLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { message: "Saatlik bildirim gönderme sınırına ulaşıldı." },
  skipFailedRequests: true,
  keyGenerator: (req) => String(req.user.id),
});

// Yoruma işletme yanıtı
export const replyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { message: "Çok fazla yanıt gönderdiniz. Biraz sonra tekrar deneyin." },
  skipFailedRequests: true,
  keyGenerator: (req) => String(req.user.id),
});

// Profil görüntüleme / arama / yol tarifi sayacı (giriş gerektirmez, IP başına)
export const trackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (req, res) => res.status(204).end(),
});
