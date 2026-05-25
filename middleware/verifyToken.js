import jwt from "jsonwebtoken";

export const verifyToken = (req, res, next) => {
  console.log("TOKEN:", req.cookies.token);
  console.log("COOKIES:", req.cookies);
  console.log("ORIGIN:", req.headers.origin);
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ message: "Not Authenticated!" });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
    if (err) {
      return res.status(403).json({ message: "Token is not Valid!" });
    }
    req.user.id = payload.id;
    next();
  });
};
