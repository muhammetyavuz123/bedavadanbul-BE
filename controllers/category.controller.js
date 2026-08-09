// controllers/categoryController.js
import prisma from "../lib/prisma.js";
import { isClean } from "../utils/filter.js";

// const prisma = new PrismaClient();

// GET categories (sadece onaylı)
export const getCategories = async (req, res) => {
  const { all } = req.query;

  // ⚠️ KRİTİK FİX: burada try/catch yoktu. Prisma sorgusu herhangi bir
  // sebeple (Mongo Atlas'ta geçici bağlantı/timeout hatası vb.) reddedilirse
  // bu, Express 4'ün YAKALAYAMADIĞI bir "unhandled promise rejection" oluyordu.
  // Node.js bu durumda TÜM sunucu process'ini çökertiyor (varsayılan davranış).
  // Railway bunu görüp container'ı yeniden başlatıyor — bu da o birkaç
  // saniyelik pencerede kategoriler/postlar/lokasyonlar dahil TÜM isteklerin
  // 502 dönmesine, tarayıcının bunu (cevap hiç gelmediği için ACAO header'ı
  // da okuyamadığından) CORS hatası gibi göstermesine yol açıyordu.
  try {
    const categories = await prisma.category.findMany({
      where: all ? {} : { isApproved: true, isActive: true },
    });

    res.json(categories);
  } catch (err) {
    console.error("getCategories hatası:", err);
    res.status(500).json({ message: "Kategoriler alınamadı" });
  }
};

export const createCategory = async (req, res) => {
  const { name, parentId } = req.body;

  // 1. validation
  if (!name) {
    return res.status(400).json({ message: "İsim zorunlu" });
  }

  // 2. küfür filtresi
  if (!isClean(name)) {
    return res.status(400).json({ message: "Uygunsuz içerik" });
  }

  // 3. slug
  const slug = name.toLowerCase().trim().replace(/\s+/g, "-");

  // 4. parentId temizle
  const cleanParentId = parentId && parentId !== "" ? parentId : null;

  // 5. create (aynı çökme riski — bkz. getCategories'teki not)
  try {
    // ⚠️ Aynı isimde kategori zaten varsa (onaylı ya da onay bekleyen fark
    // etmeksizin) tekrar oluşturmak yerine mevcut olanı bildiriyoruz.
    // Not: schema.prisma'da slug @unique olsa da bu index MongoDB'ye her
    // zaman uygulanmamış olabilir, o yüzden burada ayrıca elle de
    // kontrol ediyoruz — aksi halde aynı isimden birden fazla kategori
    // sessizce oluşabiliyordu.
    const existing = await prisma.category.findFirst({ where: { slug } });

    if (existing) {
      return res.status(409).json({
        message: `"${existing.name}" adında bir kategori zaten var.`,
        existingId: existing.id,
        existingName: existing.name,
      });
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug,
        parentId: cleanParentId,
        isApproved: false,
        createdBy: req.user?.id || "guest",
      },
    });

    res.json(category);
  } catch (err) {
    console.error("createCategory hatası:", err);
    res.status(500).json({ message: "Kategori oluşturulamadı" });
  }
};

// ADMIN ONAY
export const approveCategory = async (req, res) => {
  const { id } = req.params;

  // Aynı çökme riski burada da vardı (bkz. getCategories'teki not).
  try {
    const updated = await prisma.category.update({
      where: { id },
      data: { isApproved: true },
    });

    res.json(updated);
  } catch (err) {
    console.error("approveCategory hatası:", err);
    res.status(500).json({ message: "Kategori onaylanamadı" });
  }
};

export const deleteCategory = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. alt kategori var mı kontrol et
    const children = await prisma.category.findMany({
      where: { parentId: id },
    });

    // 2. eğer alt kategori varsa
    if (children.length > 0) {
      return res.status(400).json({
        message: "Bu kategoriye bağlı alt kategoriler var. Önce onları sil.",
      });
    }

    // 2b. bu kategoriye bağlı ilan var mı kontrol et
    // ⚠️ schema.prisma'da Post.category ZORUNLU bir ilişki. Bu kategoriye
    // bağlı en az 1 ilan varken kategori silinmeye çalışılırsa Prisma bunu
    // reddediyordu ve kullanıcı sadece genel "Silme hatası" görüyordu,
    // gerçek sebebi (bağlı ilanlar) hiç anlayamıyordu.
    const linkedPosts = await prisma.post.findMany({
      where: { categoryId: id },
      select: { id: true },
    });

    if (linkedPosts.length > 0) {
      return res.status(400).json({
        message: `Bu kategoriye bağlı ${linkedPosts.length} ilan var. Önce bu ilanları silin veya başka bir kategoriye taşıyın.`,
      });
    }

    // 3. sil
    await prisma.category.delete({
      where: { id },
    });

    res.json({ message: "Kategori silindi" });
  } catch (err) {
    console.error("deleteCategory hatası:", err);
    res.status(500).json({ message: "Silme hatası" });
  }
};
