// Content › Blog posts (spec 026). Mounted at /admin (blogs + blog-posts).

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { activeOrgFor } from './adminScope.js';
import blogService from '../../services/BlogService.js';
import blogPostService from '../../services/BlogPostService.js';
import {
  validateBulkPosts,
  validateCreateBlog,
  validateCreateBlogPost,
  validateUpdateBlog,
  validateUpdateBlogPost,
} from '../validators/blogValidators.js';

const router = Router();
router.use(requireAuth);
router.use(requireOrganizer);

// ── Blogs (containers) ──────────────────────────────────────────────────────

router.get('/blogs', async (req, res, next) => {
  try {
    res.json({ blogs: await blogService.list(await activeOrgFor(req)) });
  } catch (error) {
    next(error);
  }
});

router.post('/blogs', validateCreateBlog, async (req, res, next) => {
  try {
    res.status(201).json(await blogService.create(await activeOrgFor(req), req.body));
  } catch (error) {
    next(error);
  }
});

router.patch('/blogs/:blogId', validateUpdateBlog, async (req, res, next) => {
  try {
    res.json(await blogService.update(await activeOrgFor(req), req.params.blogId, req.body));
  } catch (error) {
    next(error);
  }
});

/** DELETE /admin/blogs/:blogId?moveToBlogId= — 409 while posts remain without a target. */
router.delete('/blogs/:blogId', async (req, res, next) => {
  try {
    await blogService.remove(await activeOrgFor(req), req.params.blogId, {
      moveToBlogId: typeof req.query.moveToBlogId === 'string' ? req.query.moveToBlogId : null,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// ── Posts ───────────────────────────────────────────────────────────────────

router.get('/blog-posts', async (req, res, next) => {
  try {
    res.json(await blogPostService.list(await activeOrgFor(req), req.query));
  } catch (error) {
    next(error);
  }
});

router.get('/blog-posts/tags', async (req, res, next) => {
  try {
    res.json({ tags: await blogPostService.tags(await activeOrgFor(req)) });
  } catch (error) {
    next(error);
  }
});

router.post('/blog-posts', validateCreateBlogPost, async (req, res, next) => {
  try {
    res.status(201).json(await blogPostService.create(await activeOrgFor(req), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

router.post('/blog-posts/bulk', validateBulkPosts, async (req, res, next) => {
  try {
    res.json(await blogPostService.bulk(await activeOrgFor(req), req.body.ids, req.body.action));
  } catch (error) {
    next(error);
  }
});

router.get('/blog-posts/:postId', async (req, res, next) => {
  try {
    res.json(await blogPostService.get(await activeOrgFor(req), req.params.postId));
  } catch (error) {
    next(error);
  }
});

router.patch('/blog-posts/:postId', validateUpdateBlogPost, async (req, res, next) => {
  try {
    res.json(await blogPostService.update(await activeOrgFor(req), req.params.postId, req.body));
  } catch (error) {
    next(error);
  }
});

router.delete('/blog-posts/:postId', async (req, res, next) => {
  try {
    await blogPostService.remove(await activeOrgFor(req), req.params.postId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
