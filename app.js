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
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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

// LISTEN
app.listen(8800, () => {
  console.log("Server is running on port 8800");
});
