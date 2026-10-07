import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { isClean } from "../utils/filter.js";
import {
  findUsableCategory,
  isValidLocation,
  notifyAdminsOfApplication,
} from "../utils/application.js";

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
  const { username, phone, email, password, type, city, district } = req.body;
  // ⚠️ Güvenlik: rol istemciden olduğu gibi alınmaz; yalnızca "business" veya
  // "user" olabilir (kimse kayıt sırasında kendini "admin" yapamasın).
  const role = req.body.role === "business" ? "business" : "user";

  try {
    // İşyeri kaydında işletme başvurusu da aynı anda oluşturulur (onay bekler).
    let businessCreate = null;
    if (role === "business" && req.body.business) {
      const b = req.body.business || {};
      const name = String(username || "").trim();
      const address = String(b.address || "").trim();
      const phoneDigits = String(phone || "").replace(/\D/g, "");

      if (name.length < 2 || name.length > 80) {
        return res.status(400).json({ message: "İşletme adı 2-80 karakter olmalı." });
      }
      if (!isClean(name)) {
        return res.status(400).json({ message: "Uygunsuz içerik tespit edildi." });
      }
      if (address.length < 5 || address.length > 200) {
        return res.status(400).json({ message: "Adres 5-200 karakter olmalı." });
      }
      if (!isValidLocation(city, district)) {
        return res.status(400).json({ message: "Geçerli bir il ve ilçe seçin." });
      }
      if (phoneDigits.length < 10 || phoneDigits.length > 13) {
        return res.status(400).json({ message: "Geçerli bir telefon numarası girin." });
      }
      const category = await findUsableCategory(String(b.categoryId || "").trim());
      if (!category) {
        return res.status(400).json({ message: "Geçerli bir kategori seçin." });
      }

      businessCreate = {
        name,
        address,
        city,
        district,
        phone: phoneDigits,
        status: "pending",
        isActive: false,
        submittedAt: new Date(),
        category: { connect: { id: category.id } },
      };
    }

    // Şifreyi hashle
    const hashedPassword = await bcrypt.hash(password, 10);

    // Yeni kullanıcı oluştur
    const created = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        type: type || "",
        role,
        phone,
        city,
        district,
        ...(businessCreate ? { business: { create: businessCreate } } : {}),
      },
      include: businessCreate
        ? { business: { select: { id: true, name: true, city: true, district: true } } }
        : undefined,
    });

    if (created.business) {
      notifyAdminsOfApplication(created.business, created.email);
    }

    res.status(201).json({
      message: "Kullanıcı başarıyla oluşturuldu.",
      pendingApproval: !!created.business,
    });
  } catch (err) {
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
  const cleanedIdentifier = identifier.replace(/[^0-9]/g, "");

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
      const users = await prisma.user.findMany({
        where: {
          phone: {
            contains: cleanedIdentifier,
          },
        },
      });

      user = users.length > 0 ? users[0] : null;
    } else {
      user = await prisma.user.findUnique({
        where: { username: identifier },
      });
    }

    if (!user) {
      return res.status(400).json({
        message: "Geçersiz kullanıcı bilgisi!",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(400).json({
        message: "Geçersiz şifre!",
      });
    }

    // 6 AY
    const SIX_MONTHS = 1000 * 60 * 60 * 24 * 30 * 6;

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "180d",
      },
    );

    const { password: _, resetToken, resetTokenExpiry, ...safeUser } = user;

    // 🍪 SAFARI UYUMLU COOKIE
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: SIX_MONTHS,
    });

    return res.status(200).json({
      user: {
        ...safeUser,
        loginAt: Date.now(),
      },
      token,
      expiresIn: SIX_MONTHS,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      message: "Giriş işlemi başarısız!",
    });
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

export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    console.log("Deleting account for user:", userId);

    // 1️⃣ Kullanıcının postlarını al
    const posts = await prisma.post.findMany({
      where: { userId },
      select: { id: true },
    });
    const postIds = posts.map((p) => p.id);

    // 2️⃣ Postlara bağlı yorumları sil
    await prisma.comment.deleteMany({ where: { postId: { in: postIds } } });

    // 3️⃣ Kullanıcının yorumlarını sil (başka postlarda olabilir)
    await prisma.comment.deleteMany({ where: { userId } });

    // 4️⃣ PostDetail kayıtlarını sil (PostToPostDetail relation)
    await prisma.postDetail.deleteMany({ where: { postId: { in: postIds } } });

    // 5️⃣ Saved postları sil
    await prisma.savedPost.deleteMany({ where: { userId } });

    // 6️⃣ Postları sil
    await prisma.post.deleteMany({ where: { userId } });

    // 7️⃣ Kullanıcıyı sil
    await prisma.user.delete({ where: { id: userId } });

    console.log("Account deleted successfully:", userId);

    res
      .status(200)
      .json({ message: "Hesap ve tüm veriler başarıyla silindi." });
  } catch (error) {
    console.error("deleteAccount error:", error);
    res.status(500).json({ message: "Hesap silinirken hata oluştu." });
  }
};
