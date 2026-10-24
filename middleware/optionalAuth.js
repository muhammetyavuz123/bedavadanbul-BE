import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";

// Herkese açık (giriş gerektirmeyen) listelerde, giriş yapmış kullanıcıyı
// tanımak için kullanılır — örn. engellediğiniz kişilerin yorumlarını gizlemek.
// Token yoksa ya da geçersizse istek REDDEDİLMEZ; req.user boş kalır ve
// istek anonim olarak devam eder.
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, role: true },
      });
      if (user) req.user = user;
    }
  } catch (err) {
    // Geçersiz token = anonim kullanıcı gibi davran
  }
  next();
};
