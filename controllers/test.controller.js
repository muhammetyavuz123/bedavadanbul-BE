// Bu route'lar `protect` middleware'inden geçtiği için req.user zaten
// doğrulanmış ve dolu geliyor; burada tekrar token çözmeye gerek yok.
// (Önceki hâlde syntax hatası vardı ve shouldBeAdmin, admin kontrolü
// tamamlanmadan her zaman 200 dönüyordu.)
export const shouldBeLoggedIn = async (req, res) => {
  res.status(200).json({ message: "You are Authenticated", userId: req.user.id });
};

export const shouldBeAdmin = async (req, res) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Not authorized!" });
  }
  res.status(200).json({ message: "You are Authenticated" });
};
