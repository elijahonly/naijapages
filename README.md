# NaijaPages — Nigeria Business Directory & Marketplace

A React + Firebase site with a business directory, a marketplace, member accounts, and a full **admin site** for moderation.

> **What's new in v2** — shared database for listings and ads, member-only posting, an admin site, About and Contact pages,
> daily random Featured picks, and a hardened security setup. Details are in [What changed](#what-changed-in-v2).

---

## 1. Run it on your computer

You need **Node.js 20.19+ or 22.12+**.

```bash
npm install
npm run dev          # opens on http://localhost:3000
```

Other commands: `npm run build` (production build into `dist/`), `npm run lint` (type check).

## 2. One-time Firebase setup (about 10 minutes)

The site stores everything in the Firebase project named in `firebase-applet-config.json`.
Do these steps **once**, in this order:

1. **Turn on sign-in methods.** Firebase console → *Authentication* → *Sign-in method* → enable **Email/Password** and **Google**.
2. **Authorise your website address.** *Authentication* → *Settings* → *Authorized domains* → add your live domain (and keep `localhost` for testing).
   If sign-in says *"This website address is not authorised"*, this is the fix.
3. **Publish the security rules.** The rules in `firestore.rules` are what actually protect your data.
   - With the Firebase CLI: `npx firebase-tools login`, then `npm run rules:deploy`.
   - Or by hand: Firebase console → *Firestore Database* → pick the database named in `firebase-applet-config.json` (`firestoreDatabaseId`) → *Rules* → paste the contents of `firestore.rules` → *Publish*.
   - ⚠ Until you do this, member posting, reviews, reports and the admin site will not work. The public site keeps working with the built-in directory.
4. **Create your admin account.** Open your site at `/#/admin`, sign in (or create an account on the site first), and follow the on-screen steps. It shows your user ID and exactly what to add in the Firebase console. This one-time step is deliberate: nobody can make themselves an admin from the website.
5. **Fill in your details.** In the admin site open *Site settings* and add your contact email, phone, WhatsApp, address, About-page story, and (optionally) an announcement.
6. **Read [docs/SECURITY.md](docs/SECURITY.md)** and tick off the production checklist (restrict the API key, turn on App Check, set a budget alert).

## 3. Put it online

- **Firebase Hosting** (recommended; headers and routing are already configured in `firebase.json`):
  `npm run deploy` publishes both the rules and the site.
- **Netlify / Cloudflare Pages / any static host:** run `npm run build` and upload `dist/`. A ready-made `dist/_headers` file carries the security headers for Netlify and Cloudflare Pages.

The admin site lives at **`https://your-site/#/admin`** (also reachable via `/admin.html`). It only loads for people who open it.

## 4. Day-to-day: managing the site

Everything is in the admin site. See **[docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)** for a walkthrough.
In short: approve new business listings, remove bad listings and ads, suspend abusive members, handle reports and ownership claims, read contact messages, and edit contact details and announcements.

## What changed in v2

| Area | Before | Now |
|---|---|---|
| Listings, ads, reviews | Saved in each visitor's own browser (nobody else could see them; nothing to moderate) | Saved in the shared Firestore database |
| Who can add a business / post an ad | Anyone, no account | **Signed-in members with a verified email** (enforced by the database rules, not just the buttons) |
| New listings | Instantly "verified" with a fake 5.0 rating (anyone typing any CAC text) | Start as **pending** with no rating; an admin approves them. The Verified badge is awarded only by an admin |
| Featured businesses | Same top-rated list every day | **Random, rotating daily** at midnight Nigerian time (same picks for every visitor) |
| Ownership claims | One click instantly verified any listing | Sent to an admin for review |
| Reviews | Anyone, any name | Members only, one per business, under their own name |
| Pages | — | **About us** and **Contact us** (with FAQ), editable text from the admin |
| Admin | — | Full admin site (dashboard, moderation queues, users, reports, claims, messages, settings, audit log) |
| Security | Open database rules, loose link checks | Locked-down rules, link/input validation, security headers + CSP, email verification, reports, suspensions |

Also fixed: `npm install` failed because of an `esbuild` version clash; modals now close with the Escape key; many dialogs got proper accessibility labels; the mobile header no longer overflows; dark mode added to the sign-in dialog.

## About the built-in directory data

`src/data` ships **37,000 listings**, but **36,570 of them are generated placeholders** (names, phone numbers and CAC numbers are invented; they carry `isSample: true`) and are all marked "verified". They remain searchable, but are **kept out of the daily Featured picks** (see `src/lib/config.ts` → `FEATURED_INCLUDE_SAMPLE_LISTINGS`).
Displaying invented businesses and phone numbers as "Verified" can mislead visitors and may reach real people's phones, so consider replacing them with real, confirmed data (you can hide any single one from *Admin → Businesses → Built-in directory*).
The old static copy under `public/assets/aistudio/` is not used by the app; delete it if you don't need it.

## Project layout

```
firestore.rules            Database security rules  ← the real security boundary
firebase.json / .firebaserc  Deploy settings (rules, hosting, security headers)
config/security-headers.ts   Content-Security-Policy + headers (one source of truth)
src/
  App.tsx, Root.tsx          Public site + router (hash routes: #/, #/marketplace, #/about, #/contact, #/admin)
  pages/                     About and Contact pages
  components/                Public UI (cards, modals, header, footer …)
  context/                   Auth (roles, verification) and shared data (live Firestore + built-in data)
  services/content.ts        All member writes, with validation
  lib/                       config, security helpers, daily-pick engine, router
  admin/                     The admin site (loaded only when /#/admin is opened)
  data/                      Built-in directory and marketplace data
```

Knobs you may want (all in `src/lib/config.ts`): number of Featured businesses/ads per day, whether placeholders may be featured, and whether a verified email is required to post (change `firestore.rules` too if you switch that off).
