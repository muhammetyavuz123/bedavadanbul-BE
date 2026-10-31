import prisma from "../lib/prisma.js";

const text = (v) => (typeof v === "string" ? v.trim() : "");

// POST /api/assistant/miss  { text, city?, district?, label? }
// Asistan sonuç bulamayınca istemci bunu fire-and-forget gönderir.
// Giriş gerekmez; kullanıcı kimliği ve IP kaydedilmez.
export const logMiss = async (req, res) => {
  const msg = text(req.body?.text).slice(0, 120);
  if (!msg) return res.status(204).end();

  try {
    await prisma.assistantMiss.create({
      data: {
        text: msg,
        city: text(req.body?.city).slice(0, 40) || null,
        district: text(req.body?.district).slice(0, 40) || null,
        label: text(req.body?.label).slice(0, 40),
      },
    });
  } catch (err) {
    // Kayıt hatası kullanıcıyı ilgilendirmez
    console.error("logMiss hatası:", err);
  }
  res.status(204).end();
};

// GET /api/assistant/admin/misses?days=30
// Aynı yer + tür aramalarını sayıp en çok arananları üstte verir.
export const adminListMisses = async (req, res) => {
  const days = Math.min(180, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 86400000);

  try {
    const groups = await prisma.assistantMiss.groupBy({
      by: ["city", "district", "label"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _max: { createdAt: true },
    });

    const data = groups
      .map((g) => ({
        city: g.city,
        district: g.district,
        label: g.label,
        count: g._count._all,
        lastAt: g._max.createdAt,
      }))
      .sort((a, b) => b.count - a.count || new Date(b.lastAt) - new Date(a.lastAt))
      .slice(0, 100);

    const total = groups.reduce((n, g) => n + g._count._all, 0);
    res.json({ data, total, days });
  } catch (err) {
    console.error("adminListMisses hatası:", err);
    res.status(500).json({ message: "Aramalar alınamadı" });
  }
};

// POST /api/assistant/admin/misses/clear  { city?, district?, label? }
// "Bu eksiği giderdim": o yer + tür kayıtlarını listeden kaldırır.
export const adminClearMisses = async (req, res) => {
  const where = {
    city: text(req.body?.city) || null,
    district: text(req.body?.district) || null,
    label: text(req.body?.label),
  };

  try {
    const r = await prisma.assistantMiss.deleteMany({ where });
    res.json({ ok: true, deleted: r.count });
  } catch (err) {
    console.error("adminClearMisses hatası:", err);
    res.status(500).json({ message: "Kayıtlar silinemedi" });
  }
};
