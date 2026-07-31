import jwt from "jsonwebtoken";

// Not: Route'ların büyük çoğunluğu Authorization header (Bearer token) ile
// çalışan `middleware/protect.js`'i kullanıyor. Bu dosya cookie tabanlı
// doğrulama gereken durumlar için tutuluyor; artık req.user'ı doğru şekilde
// başlatıyor ve token/cookie değerlerini konsola basmıyor (bunlar hassas veri).
export const verifyToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ message: "Not Authenticated!" });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
    if (err) {
      return res.status(403).json({ message: "Token is not Valid!" });
    }
    req.user = { id: payload.id, role: payload.role };
    next();
  });
};
