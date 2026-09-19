'use client';

import { useParams } from 'next/navigation';
import PostEditorPage from '../PostEditorPage';

export default function EditBlogPostPage() {
  const params = useParams<{ postId: string }>();
  return <PostEditorPage postId={params.postId} />;
}
