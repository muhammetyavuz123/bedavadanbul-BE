import prisma from "../lib/prisma.js";
import jwt from "jsonwebtoken";

export const getPosts = async (req, res) => {
  const query = req.query;

  try {
    const filters = {};

    // Dinamik filtreleme
    const filterableFields = ["city", "district"];

    filterableFields.forEach((field) => {
      if (query[field] !== undefined) {
        filters[field] = query[field];
      }
    });

    // ⚠️ FIX: "Sağlık" gibi bir ANA kategoride "Tümü" seçilince, mobil/web
    // tarafı o ana kategorinin id'sini gönderiyor. Ama ilanlar hep ALT
    // kategoriye bağlanıyor (örn. "Ağız ve Diş Sağlığı"), ana kategorinin
    // id'siyle birebir eşleşen hiçbir ilan yok. Eskiden burada düz eşitlik
    // yapıldığı için sonuç hep boş dönüyordu; alt kategori direkt seçilince
    // (örn. "Ağız ve Diş Sağlığı") birebir eşleştiği için çalışıyordu.
    // Çözüm: gelen categoryId bir ANA kategoriyse, o kategoriye bağlı tüm
    // alt kategori id'lerini de sorguya dahil ediyoruz.
    if (query.categoryId) {
      const childCategories = await prisma.category.findMany({
        where: { parentId: query.categoryId },
        select: { id: true },
      });

      filters.categoryId =
        childCategories.length > 0
          ? { in: [query.categoryId, ...childCategories.map((c) => c.id)] }
          : query.categoryId;
    }

    // userId filtre
    if (query.userId) {
      filters.userId = query.userId;
    }

    // ⚠️ FIX: Arama sadece ilan BAŞLIĞında geçiyordu. Kullanıcı "sağlık"
    // veya "diş" gibi bir kategori adı yazdığında, bu kelime ilan
    // başlığında birebir geçmediği sürece (çoğu ilan başlığı işletme/
    // kampanya adı olduğu için genelde geçmiyor) sonuç hep boş dönüyordu
    // — ilan aslında o kategoriye bağlıydı ama arama bunu hiç kontrol
    // etmiyordu. Şimdi başlığın yanında kategori adını ve ilan
    // açıklamasını da (postDetail.desc) kontrol ediyoruz.
    if (query.search) {
      filters.OR = [
        {
          title: {
            contains: query.search,
            mode: "insensitive",
          },
        },
        {
          category: {
            name: {
              contains: query.search,
              mode: "insensitive",
            },
          },
        },
        {
          postDetail: {
            desc: {
              contains: query.search,
              mode: "insensitive",
            },
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

    // ⚠️ FIX: Anasayfadaki "Sona Erecek Kampanyalar" bölümü için eklendi.
    // `sort=expiring` gönderildiğinde, en yakında sona erecek (expireDate'i
    // en yakın olan) ilanlar en başa geliyor. Bu parametre gönderilmediğinde
    // eski davranış (listingType önceliği + en yeni) hiç değişmiyor.
    const sortedPosts = posts.sort((a, b) => {
      if (query.sort === "expiring") {
        return new Date(a.expireDate) - new Date(b.expireDate);
      }

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

    if (!post) {
      return res.status(404).json({ message: "İlan bulunamadı" });
    }

    // ⚠️ ÖNCEKİ HÂL BUGLU: jwt.verify callback'i asenkron olduğu için, altındaki
    // `res.status(200).json({ ...post, isSaved: false })` her zaman HEMEN
    // çalışıyor ve cevabı gönderiyordu; callback daha sonra tekrar cevap
    // göndermeye çalışınca "headers already sent" hatası oluşuyordu ve
    // isSaved alanı fiilen hiçbir zaman true dönmüyordu. Burada tamamen
    // async/await ile tek bir cevap gönderiyoruz.
    let isSaved = false;
    const token = req.cookies?.token;

    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const saved = await prisma.savedPost.findUnique({
          where: {
            userId_postId: {
              postId: id,
              userId: payload.id,
            },
          },
        });
        isSaved = !!saved;
      } catch (err) {
        // Token geçersiz/süresi dolmuşsa sessizce isSaved=false ile devam et
      }
    }

    res.status(200).json({ ...post, isSaved });
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

    // ⚠️ Sadece ilan sahibi DEĞİL, admin de silebilmeli — admin panelinden
    // istediği ilanı kaldırabilmesi lazım.
    const isOwner = post.userId === tokenUserId;
    const isAdminUser = req.user.role === "admin";

    if (!isOwner && !isAdminUser) {
      return res.status(403).json({ message: "Not Authorized" });
    }

    // ⚠️ KRİTİK FİX: schema.prisma'da Comment.post ve SavedPost.post ZORUNLU
    // ilişkiler. Bu post'a ait yorum ya da kaydeden kullanıcı varken sadece
    // postDetail siliniyor, Post'un kendisi silinmeye çalışılınca Prisma bu
    // zorunlu ilişkiyi ihlal ettiği için hata fırlatıyordu — kullanıcı bunu
    // genel "Failed to delete post" (500) olarak görüyordu.
    await prisma.comment.deleteMany({
      where: { postId: id },
    });

    await prisma.savedPost.deleteMany({
      where: { postId: id },
    });

    await prisma.postDetail.deleteMany({
      where: { postId: id },
    });

    await prisma.post.delete({
      where: { id },
    });

    res.status(200).json({ message: "Post deleted" });
  } catch (err) {
    console.error("deletePost hatası:", err);
    res.status(500).json({ message: "Failed to delete post" });
  }
};
