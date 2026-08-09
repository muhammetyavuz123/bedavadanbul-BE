import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";
import dotenv from "dotenv";

import authRoute from "./routes/auth.route.js";
import userRoute from "./routes/user.route.js";
import postRoute from "./routes/post.route.js";
import messageRoute from "./routes/message.route.js";
import locationRoutes from "./routes/locations.route.js";
import commentRoute from "./routes/comment.route.js";
import contactRoute from "./routes/contact.route.js";
import categoryRoute from "./routes/category.routes.js";

import { globalLimiter, commentLimiter } from "./middleware/rateLimit.js";

dotenv.config();

// ⚠️ GÜVENLİK AĞI: Express 4, async route handler'lar içindeki reddedilen
// (rejected) promise'leri OTOMATİK yakalamaz. Böyle bir yerde (örn. Mongo
// Atlas'ta geçici bir bağlantı hatası) try/catch unutulmuşsa, Node.js bunu
// "unhandled rejection" sayıp VARSAYILAN OLARAK TÜM PROCESS'İ ÇÖKERTİR.
// Railway bunu görüp container'ı restart eder — bu da o birkaç saniyelik
// pencerede İLGİSİZ endpoint'ler dahil TÜM isteklerin 502 dönmesine, ve
// tarayıcının bunu (cevap hiç gelmediği için) CORS hatası gibi göstermesine
// yol açar. category.controller.js'te tam olarak bu bug bulundu ve
// düzeltildi; burası ileride benzer bir yerin process'i çökertmesini
// önleyen ek bir güvenlik katmanı.
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION (process çökmedi):", reason);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION (process çökmedi):", err);
});

const app = express();

// Proxy (Railway / Render / Nginx için şart)
app.set("trust proxy", 1);

// BODY + COOKIE
app.use(express.json());
app.use(cookieParser());
app.use(mongoSanitize());

// SECURITY
app.use(helmet());

// CORS (SAFARI + CROSS DOMAIN FIX)
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:8081",
  "https://bedavadanbul.com",
  "https://www.bedavadanbul.com",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // mobile / postman / server-to-server
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS blocked"));
    },
    credentials: true,
    // ⚠️ "PATCH" eksikti — kategori onaylama endpoint'i (PATCH /categories/approve/:id)
    // bu yüzden tarayıcının preflight (OPTIONS) kontrolünden geçemiyor, istek
    // sunucuya hiç ulaşmadan CORS tarafından engelleniyordu.
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

// preflight fix (SAFARI CRITICAL)
app.options("*", cors({ credentials: true }));

// RATE LIMIT
app.use(globalLimiter);

// ROUTES
app.use("/api/auth", authRoute);
app.use("/api/users", userRoute);
app.use("/api/posts", postRoute);
app.use("/api/messages", messageRoute);
app.use("/api/locations", locationRoutes);
app.use("/api/comments", commentLimiter, commentRoute);
app.use("/api/contact", contactRoute);
app.use("/api/categories", categoryRoute);

app.get("/", (req, res) => res.send("API çalışıyor!"));

// 404 — tanımlı olmayan route'lar için
app.use((req, res) => {
  res.status(404).json({ message: "Endpoint bulunamadı" });
});

// Merkezi hata yakalayıcı (her zaman en sonda tanımlanmalı)
app.use((err, req, res, next) => {
  console.error(err);

  if (err.message === "CORS blocked") {
    return res.status(403).json({ message: "CORS tarafından engellendi" });
  }

  res.status(500).json({ message: "Sunucu hatası" });
});

// LISTEN
const PORT = process.env.PORT || 8800;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
