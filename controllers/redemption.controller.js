import prisma from "../lib/prisma.js";

const OID = /^[a-f\d]{24}$/i;
const isObjectId = (v) => typeof v === "string" && OID.test(v);

// "Kampanyayı kullandım": kullanıcının kendi beyanı. Kampanya başına kullanıcı
// başına tek kayıt tutulur. Amaç: (1) kampanyaya "N kişi kullandı" sayacı,
// (2) yorumlarda "Kampanyayı kullandı" rozeti, (3) işletmeye sonuç raporu.
// Not: Bu bir doğrulama değil, kullanıcı beyanıdır; bu yüzden sayaçlar
// "yaklaşık" olarak sunulmalı.

const countFor = (postId) => prisma.campaignRedemption.count({ where: { postId } });

// GET /api/posts/:id/redemption  (giriş isteğe bağlı)
export const getRedemption = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.json({ count: 0, redeemed: false });

  try {
    const [count, mine] = await Promise.all([
      countFor(id),
      req.user
        ? prisma.campaignRedemption.findUnique({
            where: { postId_userId: { postId: id, userId: req.user.id } },
            select: { id: true },
          })
        : null,
    ]);
    res.json({ count, redeemed: !!mine });
  } catch (err) {
    console.error("getRedemption hatası:", err);
    res.status(500).json({ message: "Bilgi alınamadı" });
  }
};

// POST /api/posts/:id/redeem
export const redeemPost = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(404).json({ message: "Kampanya bulunamadı" });

  try {
    const post = await prisma.post.findUnique({
      where: { id },
      select: { id: true, userId: true, businessId: true, approved: true, expireDate: true },
    });
    if (!post) return res.status(404).json({ message: "Kampanya bulunamadı" });

    const live = post.approved === true && post.expireDate && post.expireDate > new Date();
    if (!live) {
      return res.status(400).json({ message: "Bu kampanya şu an geçerli değil." });
    }

    // Kampanya sahibi (ya da bağlı işletmenin sahibi) kendi kampanyasını "kullanamaz"
    if (post.userId === req.user.id) {
      return res.status(403).json({ message: "Kendi kampanyanızı kullanamazsınız." });
    }
    if (post.businessId) {
      const own = await prisma.business.findUnique({
        where: { ownerId: req.user.id },
        select: { id: true },
      });
      if (own && own.id === post.businessId) {
        return res.status(403).json({ message: "Kendi kampanyanızı kullanamazsınız." });
      }
    }

    await prisma.campaignRedemption.upsert({
      where: { postId_userId: { postId: id, userId: req.user.id } },
      create: {
        post: { connect: { id } },
        user: { connect: { id: req.user.id } },
        ...(post.businessId ? { businessId: post.businessId } : {}),
      },
      update: {},
    });

    res.status(201).json({
      redeemed: true,
      count: await countFor(id),
      businessId: post.businessId || null,
    });
  } catch (err) {
    console.error("redeemPost hatası:", err);
    res.status(500).json({ message: "İşlem yapılamadı" });
  }
};

// DELETE /api/posts/:id/redeem  (yanlışlıkla işaretlediyse geri al)
export const unredeemPost = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(404).json({ message: "Kampanya bulunamadı" });

  try {
    await prisma.campaignRedemption.deleteMany({
      where: { postId: id, userId: req.user.id },
    });
    res.json({ redeemed: false, count: await countFor(id) });
  } catch (err) {
    console.error("unredeemPost hatası:", err);
    res.status(500).json({ message: "İşlem yapılamadı" });
  }
};
