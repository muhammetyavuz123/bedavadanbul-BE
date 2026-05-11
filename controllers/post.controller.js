import prisma from "../lib/prisma.js";
import jwt from "jsonwebtoken";

export const getPosts = async (req, res) => {
  const query = req.query;

  try {
    const filters = {};

    // Dinamik filtreleme
    const filterableFields = ["city", "district", "categoryId", "approved"];
    filterableFields.forEach((field) => {
      if (query[field] !== undefined) {
        if (field === "approved") {
          filters[field] = query[field] === "true";
        } else {
          filters[field] = query[field];
        }
      }
    });

    // userId ile filtreleme
    if (query.userId) {
      filters.userId = query.userId;
    }

    // Search: title ve description içinde
    if (query.search) {
      filters.OR = [
        { title: { contains: query.search, mode: "insensitive" } },
        // { desc: { contains: query.search, mode: "insensitive" } },
      ];
    }

    // Fiyat aralığı filtreleme
    if (query.minPrice || query.maxPrice) {
      filters.price = {};
      if (query.minPrice) filters.price.gte = parseFloat(query.minPrice);
      if (query.maxPrice) filters.price.lte = parseFloat(query.maxPrice);
    }

    // Tarih aralığı filtreleme (createdAt)
    if (query.startDate || query.endDate) {
      filters.createdAt = {};
      if (query.startDate) filters.createdAt.gte = new Date(query.startDate);
      if (query.endDate) filters.createdAt.lte = new Date(query.endDate);
    }

    // Pagination
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const skip = (page - 1) * limit;

    // Toplam kayıt sayısı
    const total = await prisma.post.count({
      where: filters,
    });

    // Kayıtlar
    // 1. TÜM VERİYİ ÇEK (orderBy kaldır!)
    const posts = await prisma.post.findMany({
      where: filters,
    });

    // 2. SIRALA
    const sortedPosts = posts.sort((a, b) => {
      const order = {
        doping: 3,
        featured: 2,
        standard: 1,
      };

      if (order[b.listingType] !== order[a.listingType]) {
        return order[b.listingType] - order[a.listingType];
      }

      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // 3. PAGINATION
    const start = (page - 1) * limit;
    const paginatedPosts = sortedPosts.slice(start, start + limit);

    res.status(200).json({
      data: paginatedPosts,
      total: sortedPosts.length,
      page,
      totalPages: Math.ceil(sortedPosts.length / limit),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to get posts" });
  }
};

export const getPost = async (req, res) => {
  const id = req.params.id;
  try {
    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        category: true,
        postDetail: true,
        user: {
          select: {
            username: true,
            avatar: true,
          },
        },
      },
    });

    const token = req.cookies?.token;

    if (token) {
      jwt.verify(token, process.env.JWT_SECRET, async (err, payload) => {
        if (!err) {
          const saved = await prisma.savedPost.findUnique({
            where: {
              userId_postId: {
                postId: id,
                userId: payload.id,
              },
            },
          });
          try {
            res.status(200).json({ ...post, isSaved: saved ? true : false });
            return;
          } catch (err) {
            if (!res.headersSent) {
              res.status(500).json({ message: "Something went wrong" });
            }
          }
        }
      });
    }
    res.status(200).json({ ...post, isSaved: false });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to get post" });
  }
};

export const addPost = async (req, res) => {
  console.log("🚀 ~ addPost ~ req:", req);
  const body = req.body;
  const tokenUserId = req.userId;

  try {
    const { listingType, ...rest } = body.postData;

    const newPost = await prisma.post.create({
      data: {
        ...rest,

        // sadece kaydet
        listingType: listingType || "standard",

        userId: tokenUserId,
        postDetail: {
          create: body.postDetail,
        },
      },
    });

    res.status(200).json(newPost);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to create post" });
  }
};

export const updatePost = async (req, res) => {
  const postId = req.params.id;

  try {
    const { postData, postDetail } = req.body;

    // 🔐 (opsiyonel ama önemli) -> sadece kendi postunu güncelleyebilsin
    // const userId = req.userId;

    const updatedPost = await prisma.post.update({
      where: { id: postId },
      data: {
        title: postData.title,
        price: postData.price,
        address: postData.address,
        city: postData.city,
        district: postData.district,
        categoryId: postData.categoryId,
        businessName: postData.businessName,
        latitude: postData.latitude,
        longitude: postData.longitude,
        phoneNumber: postData.phoneNumber,
        images: postData.images,
        listingType: postData.listingType, // ⚠️ schema’da olmalı
        approved: false,

        postDetail: {
          update: {
            desc: postDetail.desc,
            campaignDuration: postDetail.campaignDuration,
            discountAmount: postDetail.discountAmount,
          },
        },
      },
      include: {
        postDetail: true,
      },
    });

    res.status(200).json(updatedPost);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to update post" });
  }
};

export const deletePost = async (req, res) => {
  const id = req.params.id;
  const tokenUserId = req.userId;

  try {
    const post = await prisma.post.findUnique({
      where: { id },
    });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (post.userId !== tokenUserId) {
      return res.status(403).json({ message: "Not Authorized" });
    }

    await prisma.postDetail.deleteMany({
      where: { postId: id },
    });

    await prisma.post.delete({
      where: { id },
    });

    res.status(200).json({ message: "Post deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete post" });
  }
};

export const confirmPost = async (req, res) => {
  const { id } = req.params;

  try {
    const updatedPost = await prisma.post.update({
      where: {
        id: id, // ID'nin number olduğundan emin ol
      },
      data: {
        approved: true, // 👈 Postu onaylıyoruz
      },
    });

    res
      .status(200)
      .json({ message: "Post başarıyla onaylandı", post: updatedPost });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Post güncellenemedi" });
  }
};
