// import jwt from "jsonwebtoken";

// export const verifyToken = (req, res, next) => {
//   const token = req.cookies.token;

//   if (!token) return res.status(401).json({ message: "Not Authenticated!" });

//   jwt.verify(token, process.env.JWT_SECRET, async (err, payload) => {
//     if (err) return res.status(403).json({ message: "Token is not Valid!" });
//     req.userId = payload.id;

//     next();
//   });
// };
import jwt from "jsonwebtoken";

export const verifyToken = (req, res, next) => {
  console.log("🧪 Middleware çalıştı - Token kontrolü");
  console.log("🍪 Cookies:", req.cookies);

  const token = req.cookies.token;

  if (!token) {
    console.warn("❌ Token bulunamadı!");
    return res.status(401).json({ message: "Not Authenticated!" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
    if (err) {
      console.warn("❌ Token doğrulama başarısız:", err.message);
      return res.status(403).json({ message: "Token is not Valid!" });
    }

    console.log("✅ Token doğrulandı. Kullanıcı ID:", payload.id);
    req.userId = payload.id;
    next();
  });
};
