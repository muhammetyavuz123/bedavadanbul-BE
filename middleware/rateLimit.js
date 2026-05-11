import rateLimit from "express-rate-limit";

// ========= GLOBAL LIMIT =========
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 300, // 300 istek
  message: "Çok fazla istek gönderdiniz.",
  standardHeaders: true,
  legacyHeaders: false,
});

// ========= COMMENT LIMIT =========
export const commentLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 dakika
  max: 20,
  message: "Çok fazla yorum yaptınız. Bir süre sonra deneyin.",
});

export const categoryLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
  message: "Günlük kategori ekleme limitine ulaştınız",
});
