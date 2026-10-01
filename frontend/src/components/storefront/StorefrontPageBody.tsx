// Body of a Content › Pages page. Server-safe: the client StorefrontPageView
// (legacy) and the themed server route render the same markup. A page with a
// template (spec 042) renders the template's sections in order; the contact
// form is the only client island.

import type { PageTemplateSection } from '@/services/api';
import ContactFormSection from './ContactFormSection';
import ContentHtml from './ContentHtml';

export interface PublicPage {
  id: string;
  title: string;
  slug: string;
  content: string;
  template?: { name: string; sections: PageTemplateSection[] } | null;
  /** Spec 042: the store has an email a contact form can deliver to. */
  contactFormAvailable?: boolean;
}

export default function StorefrontPageBody({
  page,
  organizationId,
}: {
  page: PublicPage;
  organizationId: string;
}) {
  const sections = page.template?.sections;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <article data-testid="storefront-page" data-template={page.template?.name}>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{page.title}</h1>
        {!sections ? (
          <ContentHtml html={page.content} className="mt-8" />
        ) : (
          sections.map((section, index) => {
            switch (section.type) {
              case 'page_content':
                return <ContentHtml key={index} html={page.content} className="mt-8" />;
              case 'rich_text':
                return <ContentHtml key={index} html={section.settings.html} className="mt-8" />;
              case 'contact_form':
                return (
                  <ContactFormSection
                    key={index}
                    organizationId={organizationId}
                    pageSlug={page.slug}
                    settings={section.settings}
                    available={Boolean(page.contactFormAvailable)}
                  />
                );
              default:
                return null;
            }
          })
        )}
      </article>
    </main>
  );
}
