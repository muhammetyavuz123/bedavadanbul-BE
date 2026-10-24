import prisma from "../lib/prisma.js";

// Bu kullanıcının engellediği kişilerin id listesi. Giriş yapılmamışsa boş.
// Hata olursa listeyi boş döndürür: engel listesi okunamadı diye yorumların
// tamamı görünmez olmasın.
export async function blockedIdsFor(userId) {
  if (!userId) return [];
  try {
    const rows = await prisma.userBlock.findMany({
      where: { blockerId: String(userId) },
      select: { blockedId: true },
    });
    return rows.map((r) => r.blockedId);
  } catch (err) {
    console.error("Engel listesi okunamadı:", err);
    return [];
  }
}
