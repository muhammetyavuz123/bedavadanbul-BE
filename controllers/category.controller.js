// controllers/categoryController.js
import prisma from "../lib/prisma.js";
import { isClean } from "../utils/filter.js";

// const prisma = new PrismaClient();

// GET categories (sadece onaylı)
export const getCategories = async (req, res) => {
  const { all } = req.query;

  const categories = await prisma.category.findMany({
    where: all ? {} : { isApproved: true, isActive: true },
  });

  res.json(categories);
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

  // 5. create
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
};

// ADMIN ONAY
export const approveCategory = async (req, res) => {
  const { id } = req.params;

  const updated = await prisma.category.update({
    where: { id },
    data: { isApproved: true },
  });

  res.json(updated);
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

    // 3. sil
    await prisma.category.delete({
      where: { id },
    });

    res.json({ message: "Kategori silindi" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Silme hatası" });
  }
};
