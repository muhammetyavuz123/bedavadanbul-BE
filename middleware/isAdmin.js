// Bu middleware `protect` middleware'inden SONRA kullanılmalı,
// çünkü req.user'ın dolu olmasını bekler.
export const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res
      .status(403)
      .json({ message: "Bu işlem için yönetici yetkisi gerekiyor." });
  }
  next();
};
