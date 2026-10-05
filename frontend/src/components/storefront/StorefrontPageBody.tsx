// Body of a Content › Pages page. Server-safe: the client StorefrontPageView
// (legacy) and the themed server route render the same markup. A page with a
// template (spec 042) renders the template's sections in order; the contact
// form is the only client island.
// Spec 044D: a page with a standing form adds an Apply band under the title,
// a second button after the content and a phone bar; the ApplyDrawer island
// turns all three links into a panel over the page.

import type { PageTemplateSection } from '@/services/api';
import ContactFormSection from './ContactFormSection';
import ContentHtml from './ContentHtml';
import ApplyDrawer from '@/components/applications/ApplyDrawer';

export interface PublicPage {
  id: string;
  title: string;
  slug: string;
  content: string;
  template?: { name: string; sections: PageTemplateSection[] } | null;
  /** Spec 042: the store has an email a contact form can deliver to. */
  contactFormAvailable?: boolean;
  /** Spec 044D: the standing form behind the page's Apply button; null when none or still a draft. */
  applyForm?: PageApplyForm | null;
}

export interface PageApplyForm {
  slug: string;
  name: string;
  intro: string | null;
  label: string;
  status: 'OPEN' | 'CLOSED';
  opensAt: string | null;
}

const reopens = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

export default function StorefrontPageBody({
  page,
  organizationId,
}: {
  page: PublicPage;
  organizationId: string;
}) {
  const sections = page.template?.sections;
  const apply = page.applyForm ?? null;
  const applyHref = apply ? `/organizations/${organizationId}/apply/${apply.slug}` : '';
  const isOpen = apply?.status === 'OPEN';
  return (
    <main className={`mx-auto max-w-3xl px-4 py-10 sm:px-6 ${isOpen ? 'pb-28 sm:pb-10' : ''}`}>
      <article data-testid="storefront-page" data-template={page.template?.name}>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{page.title}</h1>
        {apply && (
          <aside
            aria-label={apply.name}
            data-testid="apply-cta-band"
            className="relative mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800 sm:flex sm:items-stretch"
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brand" />
            <div className="min-w-0 flex-1 py-4 pl-6 pr-5">
              <p className="font-semibold text-gray-900 dark:text-white">{apply.name}</p>
              {isOpen ? (
                apply.intro && <p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-slate-300">{apply.intro}</p>
              ) : (
                <p className="mt-1 text-sm text-gray-600 dark:text-slate-300" data-testid="apply-cta-closed">
                  Applications are closed right now{apply.opensAt ? ` — they open again ${reopens(apply.opensAt)}` : ''}.
                </p>
              )}
            </div>
            {isOpen && (
              <div className="border-t-2 border-dashed border-gray-200 px-5 py-4 dark:border-slate-700 sm:flex sm:items-center sm:border-l-2 sm:border-t-0">
                <a
                  href={applyHref}
                  data-apply-cta
                  data-testid="apply-cta-button"
                  className="flex h-12 w-full items-center justify-center whitespace-nowrap rounded-xl bg-brand px-6 font-semibold text-brand-fg hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800 sm:w-auto"
                >
                  {apply.label}
                </a>
              </div>
            )}
          </aside>
        )}
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
        {isOpen && (
          <p className="mt-12 flex justify-center">
            <a
              href={applyHref}
              data-apply-cta
              data-testid="apply-end-button"
              className="flex h-12 items-center justify-center rounded-xl border-2 border-brand-link px-6 font-semibold text-brand-link hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-900"
            >
              {apply!.label}
            </a>
          </p>
        )}
      </article>
      {isOpen && (
        <>
          {/* Phones: the button stays in reach while reading (the band scrolls away). */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:hidden">
            <a
              href={applyHref}
              data-apply-cta
              data-testid="apply-sticky-bar"
              className="flex h-12 w-full items-center justify-center rounded-xl bg-brand font-semibold text-brand-fg hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2"
            >
              {apply!.label}
            </a>
          </div>
          <ApplyDrawer organizationId={organizationId} formSlug={apply!.slug} />
        </>
      )}
    </main>
  );
}
