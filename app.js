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

// Rate Limit
import { globalLimiter, commentLimiter } from "./middleware/rateLimit.js";

dotenv.config();
const app = express();

// Eğer reverse proxy varsa (Nginx, Vercel, Render…) bu ŞART
app.set("trust proxy", 1);

// CORS
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:8081",
  "https://www.bedavadanbul.com",
];
app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use(mongoSanitize());

// Global limit – sadece 1 kere uygulanır
app.use(globalLimiter);

// Routes
app.use("/api/auth", authRoute);
app.use("/api/users", userRoute);
app.use("/api/posts", postRoute);
app.use("/api/messages", messageRoute);
app.use("/api/locations", locationRoutes);
app.use("/api/comments", commentLimiter, commentRoute);
app.use("/api/contact", contactRoute);

app.get("/", (req, res) => res.send("API çalışıyor!"));

app.listen(8800, () => console.log("Server is running!"));
