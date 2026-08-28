---
name: standards-legal-tr-kvkk
description: Mandatory legal pages for Turkish and EU markets - privacy, terms, KVKK aydinlatma metni, cookies and contact - including the seven disclosure sections KVKK requires. Load when creating or reviewing legal pages, footers, consent banners or contact details.
---

# Legal pages: Turkey and EU

## What is checked, and what is not

`legal.pages_present` verifies each required page exists, is longer than 400
characters, and contains no placeholder text.
`legal.kvkk_structure` verifies the KVKK page contains all seven required
disclosure sections.

**Both are structural checks. Neither assesses legal sufficiency, and neither
can.** A green checker means the sections are present, not that the text is
adequate or correct for this business. Scaffolded text ships carrying a
`REVIEW REQUIRED` marker and stays a blocker until a lawyer has reviewed it and
the marker is removed. Say this plainly to the operator rather than letting a
green tick imply more than it means.

## `legal.pages_present` — the five pages

| Page | Route | Purpose |
|---|---|---|
| privacy | `app/(legal)/privacy/page.tsx` | GDPR and KVKK privacy policy |
| terms | `app/(legal)/terms/page.tsx` | Terms of service |
| kvkk | `app/(legal)/kvkk/page.tsx` | KVKK aydinlatma metni |
| cookies | `app/(legal)/cookies/page.tsx` | Cookie policy |
| contact | `app/contact/page.tsx` | Reachable contact details |

A `(legal)` route group keeps them out of the URL path while sharing a layout.
The checker tolerates any route-group nesting.

An empty or placeholder legal page is worse than no page: it is a public claim
that something is true when it is not.

## `legal.kvkk_structure` — the seven sections

The aydinlatma metni must cover all seven. Turkish or English headings satisfy
the check; the page itself should be in the locales the manifest declares.

1. **Veri sorumlusunun kimligi** — data controller identity, with the legal
   entity name and registered address, not a brand name
2. **Isleme amaclari** — the specific purposes personal data is processed for
3. **Hukuki sebep** — the legal basis under KVKK Art. 5, stated per purpose
4. **Aktarim** — transfers to third parties and abroad, naming the categories of
   recipient. On this stack that realistically means Supabase, Vercel, Stripe and
   Resend; naming them is more honest, and more defensible, than "service providers"
5. **Saklama suresi** — the retention period, or the criteria used to set it
6. **Ilgili kisinin haklari** — data subject rights under Art. 11, listed out
7. **Basvuru yontemi** — how to exercise those rights: address, KEP, email

## Contact page

Must carry the details from `compliance.entity`: legal name, address, email, and
MERSIS and KEP where the entity has them. A contact form with no reachable
postal address satisfies neither KVKK nor Turkish e-commerce disclosure
requirements.

## Cookies and advertising

If an ad network or analytics script is present it must sit behind a consent
gate, and ads must not render on legal pages or on any page displaying another
user's personal data. Enforcement arrives in Phase 2 as `ads.policy` and
`legal.cookie_consent`; until then it is your responsibility to get right, and
the absence of a check is not permission.

## Related

- `/mavci-core:standards-nextjs-app-router` — how these pages are rendered
