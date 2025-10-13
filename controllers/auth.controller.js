import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const register = async (req, res) => {
  const { username, email, password, workplaceName, role } = req.body;

  try {
    // HASH THE PASSWORD

    const hashedPassword = await bcrypt.hash(password, 10);

    console.log(hashedPassword);

    // CREATE A NEW USER AND SAVE TO DB
    const newUser = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        workplaceName: workplaceName ? workplaceName : "",
        role,
      },
    });

    console.log(newUser);

    res.status(201).json({ message: "User created successfully" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to create user!" });
  }
};

export const login = async (req, res) => {
  const { identifier, password } = req.body;

  try {
    // E-POSTA MI KULLANICI ADI MI KONTROLÜ
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);

    // KULLANICIYI VERİTABANINDAN BUL
    const user = await prisma.user.findUnique({
      where: isEmail ? { email: identifier } : { username: identifier },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid Credentials!" });
    }

    // ŞİFRE KONTROLÜ
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(400).json({ message: "Invalid Credentials!" });
    }

    // JWT TOKEN OLUŞTUR
    const age = 1000 * 60 * 60 * 24 * 7; // 7 gün

    const token = jwt.sign(
      {
        id: user.id,
        isAdmin: false,
      },
      process.env.JWT_SECRET,
      { expiresIn: age }
    );

    const { password: userPassword, ...userInfo } = user;

    // COOKIE GÖNDER
    res
      .cookie("token", token, {
        httpOnly: true,
        maxAge: age,
      })
      .status(200)
      .json(userInfo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to login!" });
  }
};

export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  console.log("🚀 ~ forgotPassword ~ forgotPassword:", email);

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    // Kullanıcı yoksa bile aynı cevabı ver
    if (!user) {
      return res.status(200).json({
        message: "Eğer e-posta kayıtlıysa sıfırlama linki gönderildi.",
      });
    }

    // Token oluştur
    const token = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const expiry = new Date(Date.now() + 1000 * 60 * 60); // 1 saat geçerli

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: hashedToken,
        resetTokenExpiry: expiry,
      },
    });

    // Reset linki
    const resetUrl = `${process.env.CLIENT_URL}reset-password/${token}`;

    await transporter.sendMail({
      from: `"No-Reply" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: "Şifre sıfırlama isteği",
      html: `
        <p>Şifre sıfırlamak için aşağıdaki linke tıklayın (1 saat geçerli):</p>
        <a href="${resetUrl}">${resetUrl}</a>
        <p>Bu isteği siz yapmadıysanız bu maili görmezden gelin.</p>
      `,
    });

    res
      .status(200)
      .json({ message: "Eğer e-posta kayıtlıysa sıfırlama linki gönderildi." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Sunucu hatası" });
  }
};

// 2) Token ile şifre sıfırlama
export const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;
  try {
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await prisma.user.findFirst({
      where: {
        resetToken: hashedToken,
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      return res
        .status(400)
        .json({ message: "Token geçersiz veya süresi dolmuş." });
    }

    // Şifreyi hash’le
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    res.status(200).json({ message: "Şifre başarıyla değiştirildi." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Sunucu hatası" });
  }
};

export const logout = (req, res) => {
  res.clearCookie("token").status(200).json({ message: "Logout Successful" });
};
