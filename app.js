import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoute from "./routes/auth.route.js";
import postRoute from "./routes/post.route.js";
import testRoute from "./routes/test.route.js";
import userRoute from "./routes/user.route.js";
import chatRoute from "./routes/chat.route.js";
import messageRoute from "./routes/message.route.js";
import locationRoutes from "./routes/locations.route.js";
import commentRoute from "./routes/comment.route.js";
import contactRoute from "./routes/contact.route.js";
import dotenv from "dotenv";

dotenv.config();
const app = express();

// app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoute);
app.use("/api/users", userRoute);
app.use("/api/posts", postRoute);
app.use("/api/test", testRoute);
app.use("/api/chats", chatRoute);
app.use("/api/messages", messageRoute);
app.use("/api/locations", locationRoutes);
app.use("/api/auth", authRoute);
app.use("/api/comments", commentRoute);
app.use("/api/contact", contactRoute);
app.get("/", (req, res) => {
  res.send("API çalışıyor!");
});
app.listen(8800, () => {
  console.log("Server is running!");
});
