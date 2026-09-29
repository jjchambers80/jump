// Body of a Content › Pages page. Server-safe: the client StorefrontPageView
// (legacy) and the themed server route render the same markup.

import ContentHtml from './ContentHtml';

export interface PublicPage {
  id: string;
  title: string;
  slug: string;
  content: string;
}

export default function StorefrontPageBody({ page }: { page: PublicPage }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <article data-testid="storefront-page">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{page.title}</h1>
        <ContentHtml html={page.content} className="mt-8" />
      </article>
    </main>
  );
}
