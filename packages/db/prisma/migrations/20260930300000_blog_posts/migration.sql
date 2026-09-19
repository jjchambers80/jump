-- Spec 026: Content › Blog posts — blogs (containers with a handle) and posts.
CREATE TABLE "Blog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Blog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "blogId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "excerpt" TEXT,
    "authorName" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "featuredFileId" TEXT,
    "isVisible" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Blog_organizationId_handle_key" ON "Blog"("organizationId", "handle");
CREATE UNIQUE INDEX "BlogPost_blogId_handle_key" ON "BlogPost"("blogId", "handle");
CREATE INDEX "BlogPost_organizationId_updatedAt_idx" ON "BlogPost"("organizationId", "updatedAt");
CREATE INDEX "BlogPost_blogId_isVisible_publishedAt_idx" ON "BlogPost"("blogId", "isVisible", "publishedAt");

ALTER TABLE "Blog" ADD CONSTRAINT "Blog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_blogId_fkey" FOREIGN KEY ("blogId") REFERENCES "Blog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_featuredFileId_fkey" FOREIGN KEY ("featuredFileId") REFERENCES "StoreFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
