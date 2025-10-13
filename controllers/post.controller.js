import prisma from "../lib/prisma.js";
import jwt from "jsonwebtoken";

export const getPosts = async (req, res) => {
  const query = req.query;

  try {
    const filters = {
      city: query.city || undefined,
      type: query.type || undefined,
      district: query.district || undefined,
      approved: query.approved === "true", // default zaten true olacak aşağıda
    };

    if (query.approved === undefined) {
      filters.approved = true;
    }

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const skip = (page - 1) * limit;

    // Toplam kaç kayıt var? (sayfalama bilgisi için)
    const total = await prisma.post.count({
      where: filters,
    });

    // Belirli sayfaya göre veri getir
    const posts = await prisma.post.findMany({
      where: filters,
      skip: skip,
      take: limit,
      orderBy: {
        createdAt: "desc", // isteğe bağlı sıralama
      },
    });

    res.status(200).json({
      data: posts,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to get posts" });
  }
};

export const getPost = async (req, res) => {
  const id = req.params.id;
  try {
    const post = await prisma.post.findUnique({
      where: { id },
      include: {
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
  const tokenUserId = req.userId;

  try {
    const newPost = await prisma.post.create({
      data: {
        ...body.postData,
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
  try {
    res.status(200).json();
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to update posts" });
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
  console.log("🚀 ~ confirmPost ~ id:", id);

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
