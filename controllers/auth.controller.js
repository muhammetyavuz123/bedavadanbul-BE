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
  const { username, phone, email, password, type, role, city, district } =
    req.body;

  try {
    // Şifreyi hashle
    const hashedPassword = await bcrypt.hash(password, 10);

    // Yeni kullanıcı oluştur
    await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        type: type || "",
        role,
        phone,
        city,
        district,
      },
    });

    res.status(201).json({ message: "Kullanıcı başarıyla oluşturuldu." });
  } catch (err) {
    console.log("❌ Prisma Hatası:", err);

    // ✅ Prisma unique constraint hatası
    if (err.code === "P2002" && err.meta?.target?.includes("phone")) {
      return res
        .status(400)
        .json({ message: "Bu telefon numarasıyla zaten bir hesap mevcut." });
    }

    if (err.code === "P2002" && err.meta?.target?.includes("email")) {
      return res
        .status(400)
        .json({ message: "Bu e-posta adresiyle zaten bir hesap mevcut." });
    }

    res
      .status(500)
      .json({ message: "Kullanıcı oluşturulurken bir hata oluştu!" });
  }
};

export const login = async (req, res) => {
  let { identifier, password } = req.body;
  const cleanedIdentifier = identifier.replace(/[^0-9]/g, ""); // Sadece rakamlar

  try {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const isPhone =
      cleanedIdentifier.length >= 10 && cleanedIdentifier.length <= 15;

    let user;

    if (isEmail) {
      user = await prisma.user.findUnique({
        where: { email: identifier },
      });
    } else if (isPhone) {
      // normalize edilen haliyle veritabanındaki tüm user'ları al
      const users = await prisma.user.findMany({
        where: {
          phone: {
            contains: cleanedIdentifier, // sadece rakamlarla karşılaştır
          },
        },
      });

      // ilk eşleşeni al
      user = users.length > 0 ? users[0] : null;
    } else {
      user = await prisma.user.findUnique({
        where: { username: identifier },
      });
    }

    if (!user) {
      return res.status(400).json({ message: "Geçersiz kullanıcı bilgisi!" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Geçersiz şifre!" });
    }

    const age = 1000 * 60 * 60 * 24 * 7;
    const token = jwt.sign(
      { id: user.id, isAdmin: false },
      process.env.JWT_SECRET,
      {
        expiresIn: age,
      }
    );

    const { password: _, ...userInfo } = user;

    res
      .cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        maxAge: age,
      })
      .status(200)
      .json(userInfo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Giriş işlemi başarısız!" });
  }
};

export const forgotPassword = async (req, res) => {
  const { email } = req.body;

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
