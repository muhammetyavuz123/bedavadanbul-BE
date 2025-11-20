import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import dotenv from "dotenv";

// Route'lar
import authRoute from "./routes/auth.route.js";
import postRoute from "./routes/post.route.js";
import testRoute from "./routes/test.route.js";
import userRoute from "./routes/user.route.js";
import chatRoute from "./routes/chat.route.js";
import messageRoute from "./routes/message.route.js";
import locationRoutes from "./routes/locations.route.js";
import commentRoute from "./routes/comment.route.js";
import contactRoute from "./routes/contact.route.js";

dotenv.config();
const app = express();

// CORS yapılandırması
const allowedOrigins = [
  "http://localhost:5173", // Local frontend
  "http://localhost:8800", // Local mobil
  "https://www.bedavadanbul.com", // Canlı frontend
];
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Helmet ile güvenlik
app.use(helmet());

// Rate Limiting (Global rate limiting)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 100, // 15 dakika içinde 100 istek
  message: "Çok fazla istek gönderdiniz. Lütfen biraz bekleyin.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Rate Limiting: Login için ayrı bir limit
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 dakika
  max: 5, // 10 dakika içinde en fazla 5 giriş denemesi
  message:
    "Çok fazla giriş denemesi yaptınız. Lütfen 10 dakika sonra tekrar deneyin.",
});

// Rate Limiting: Register için ayrı bir limit
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 5, // 15 dakika içinde 3 kayıt denemesi
  message: "Çok fazla kayıt denemesi yaptınız. Lütfen biraz bekleyin.",
});

// Rate Limiting: Post oluşturma
// const postLimiter = rateLimit({
//   windowMs: 1 * 60 * 1000, // 1 dakika
//   max: 10, // Dakikada 10 post
//   message: "Çok fazla post attınız. Lütfen bir dakika bekleyin.",
// });

// Rate Limiting: Yorum yapma
const commentLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 dakika
  max: 20, // 30 dakika içinde 20 yorum
  message: "Çok fazla yorum yaptınız. Lütfen bir süre sonra tekrar deneyin.",
});

// Body parsing middleware
app.use(express.json());
app.use(cookieParser());
app.use(mongoSanitize()); // MongoDB injection koruması

// Authentication route'ları
app.use("/api/auth", loginLimiter, registerLimiter, authRoute); // Rate limiting burada
app.use("/api/users", userRoute);
app.use("/api/posts", postRoute);
// app.use("/api/test", testRoute);
// app.use("/api/chats", chatRoute);
app.use("/api/messages", globalLimiter, messageRoute);
app.use("/api/locations", locationRoutes);
app.use("/api/comments", commentLimiter, commentRoute); // Rate limiting burada
app.use("/api/contact", globalLimiter, contactRoute);

app.get("/", (req, res) => {
  res.send("API çalışıyor!");
});

app.listen(8800, () => {
  console.log("Server is running!");
});
