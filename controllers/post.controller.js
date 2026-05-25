import prisma from "../lib/prisma.js";
import jwt from "jsonwebtoken";

export const getPosts = async (req, res) => {
  const query = req.query;

  try {
    const filters = {};

    // Dinamik filtreleme
    const filterableFields = ["city", "district", "categoryId"];

    filterableFields.forEach((field) => {
      if (query[field] !== undefined) {
        filters[field] = query[field];
      }
    });

    // userId filtre
    if (query.userId) {
      filters.userId = query.userId;
    }

    // SEARCH
    if (query.search) {
      filters.OR = [
        {
          title: {
            contains: query.search,
            mode: "insensitive",
          },
        },
      ];
    }

    // PRICE FILTER
    if (query.minPrice || query.maxPrice) {
      filters.price = {};

      if (query.minPrice) {
        filters.price.gte = parseFloat(query.minPrice);
      }

      if (query.maxPrice) {
        filters.price.lte = parseFloat(query.maxPrice);
      }
    }

    // DATE FILTER
    if (query.startDate || query.endDate) {
      filters.createdAt = {};

      if (query.startDate) {
        filters.createdAt.gte = new Date(query.startDate);
      }

      if (query.endDate) {
        filters.createdAt.lte = new Date(query.endDate);
      }
    }

    // ✅ PUBLIC ACTIVE POSTS
    // approved=true geldiyse
    if (query.approved === "true") {
      filters.approved = true;

      filters.expireDate = {
        gt: new Date(),
      };
    }

    // ✅ ADMIN PENDING POSTS
    // approved=false geldiyse
    if (query.approved === "false") {
      filters.approved = false;
    }

    // PAGINATION
    const page = parseInt(query.page) || 1;

    const limit = parseInt(query.limit) || 10;

    const skip = (page - 1) * limit;

    // DATABASE
    const posts = await prisma.post.findMany({
      where: filters,
    });

    // CUSTOM SORT
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

    // PAGINATION
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

    res.status(500).json({
      message: "Failed to get posts",
    });
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
  const body = req.body;
  const tokenUserId = req.user.id;

  try {
    const { listingType, adDuration, ...rest } = body.postData;

    const newPost = await prisma.post.create({
      data: {
        ...rest,

        listingType: listingType || "standard",

        approved: false,

        adDuration: Number(adDuration),

        // admin onaylayınca dolacak
        startDate: null,
        expireDate: null,

        userId: tokenUserId,

        postDetail: {
          create: body.postDetail,
        },
      },
    });

    res.status(200).json(newPost);
  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Failed to create post",
    });
  }
};
export const approvePost = async (req, res) => {
  try {
    const postId = req.params.id;

    const post = await prisma.post.findUnique({
      where: {
        id: postId,
      },
    });

    if (!post) {
      return res.status(404).json({
        message: "İlan bulunamadı",
      });
    }

    const now = new Date();

    const expireDate = new Date();

    // 1-3-6-12 ay ekler
    expireDate.setMonth(expireDate.getMonth() + post.adDuration);

    const updatedPost = await prisma.post.update({
      where: {
        id: postId,
      },

      data: {
        approved: true,

        startDate: now,

        expireDate,
      },
    });

    res.status(200).json(updatedPost);
  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Onaylama başarısız",
    });
  }
};
export const updatePost = async (req, res) => {
  const postId = req.params.id;

  try {
    const { postData, postDetail } = req.body;

    // 🔐 (opsiyonel ama önemli) -> sadece kendi postunu güncelleyebilsin
    // const userId = req.user.id;;

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
  const tokenUserId = req.user.id;

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
