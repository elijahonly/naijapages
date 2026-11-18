# Security guide

## How the protection is layered

| Layer | What it stops | Where it lives |
|---|---|---|
| **Firestore rules** | Anyone (even with browser dev tools) writing data they shouldn't: self-approving listings, faking ratings or badges, reading messages, becoming admin, posting while suspended | `firestore.rules` |
| **Accounts** | Anonymous spam. Posting, reviewing, reporting and claiming need a signed-in member with a **verified email** | `AuthContext`, rules (`isActiveMember`) |
| **Admin-only moderation** | Only accounts with an `admins/<uid>` record can approve, verify, remove, suspend or read private data | rules + admin site |
| **Input validation** | `javascript:` / look-alike links (e.g. `google.evil.com`), invisible/spoofing characters, oversized text, non-https images | `src/lib/security.ts`, `src/services/content.ts`, rules |
| **Browser policy** | Injected scripts, clickjacking, MIME sniffing, referrer leaks | Content-Security-Policy + headers (`config/security-headers.ts`, `firebase.json`, `dist/_headers`) |
| **Audit trail** | Unaccountable admin changes | `audit_log` (append-only; each change and its log entry are saved in one atomic batch) |

The buttons on the website are **conveniences**; the rules are the **enforcement**. Always test security by checking the rules, not the UI.

### What members can and cannot do

Members **can**: create business listings (always *pending*), post ads, write one review per business, report items, claim a business, delete their own listings/ads/reviews.
Members **cannot**: approve or verify anything, set a rating, mark an ad as "verified seller" or "featured", edit an existing listing, review their own business, read other people's reports/claims/messages, create or change admin or suspension records, or post while suspended or unverified.

## Production checklist

Do these once before you advertise the site:

- [ ] **Publish `firestore.rules`** to the database named in `firebase-applet-config.json` (README step 3).
- [ ] **Authorized domains**: only your real domain(s) + `localhost` (*Authentication → Settings*).
- [ ] **Restrict the web API key.** Google Cloud console → *APIs & Services → Credentials* → the browser key → *Application restrictions: Websites (HTTP referrers)* → add `https://your-domain/*` (and `http://localhost:3000/*` for development). The key is meant to be public, but restricting it stops other sites from using your quota.
- [ ] **Turn on App Check** (below) to block bots that call your Firebase project directly.
- [ ] **Set a budget alert**: Google Cloud console → *Billing → Budgets & alerts*. Abuse shows up as cost first.
- [ ] **Keep "Email enumeration protection" on** (*Authentication → Settings → User actions*) so attackers can't discover which emails have accounts.
- [ ] **Password policy**: *Authentication → Settings → Password policy* → require length 8+ and a mix of characters (the site already asks for 8+ with letters and numbers).
- [ ] **Backups**: Firestore → *Disaster recovery* → turn on scheduled backups / point-in-time recovery.
- [ ] **Admin hygiene**: keep admins to the few people who need it; use Google sign-in with 2-step verification for admin accounts.
- [ ] **Customise the verification email** (*Authentication → Templates*) so it comes from your brand and doesn't look like spam.
- [ ] **Remove** `public/assets/aistudio/` if unused (it's an old static copy of the site that would keep showing removed listings).

### Turn on App Check

1. Google reCAPTCHA admin → create a **reCAPTCHA v3** key for your domain.
2. Firebase console → *App Check* → register your web app with that key.
3. Put the **site key** in `.env.local` as `VITE_RECAPTCHA_SITE_KEY="…"` (or in `firebase-applet-config.json` → `recaptchaSiteKey`) and rebuild.
4. Watch *App Check → APIs* for a day to confirm requests are verified, then click **Enforce** for Cloud Firestore and Authentication.

## Verify the rules yourself (15 minutes)

I could not run the Firestore emulator in the environment where this was built, so please confirm the rules in your own project. In the Firebase console go to *Firestore → Rules → Rules playground* (or use the emulator). Each row should behave as shown:

| # | Signed in as | Action | Expected |
|---|---|---|---|
| 1 | nobody | read an **approved** business | ✅ allowed |
| 2 | nobody | read a **pending** business | ❌ denied |
| 3 | nobody | create a business | ❌ denied |
| 4 | verified member | create a business with `status: "approved"` | ❌ denied |
| 5 | verified member | create a business with `isVerified: true` or `rating: 5` | ❌ denied |
| 6 | verified member | create a business with `googleMapUrl: "https://google.evil.com/maps"` | ❌ denied |
| 7 | verified member | create a valid business (`status: "pending"`, `isVerified: false`, `rating: 0`, `reviewsCount: 0`, `ownerId` = their uid, `createdAt` = request time) | ✅ allowed |
| 8 | member with **unverified email** | create an ad | ❌ denied |
| 9 | **suspended** member (`bans/<uid>` exists) | create an ad or review | ❌ denied |
| 10 | verified member | create an ad with `isVerifiedSeller: true` or `featured: true` | ❌ denied |
| 11 | verified member | update their own business | ❌ denied |
| 12 | verified member | review their **own** community business | ❌ denied |
| 13 | verified member | write `/admins/<their uid>` | ❌ denied |
| 14 | verified member | read `/reports`, `/contact_messages`, `/audit_log` | ❌ denied |
| 15 | anyone | create a contact message with `status: "read"` | ❌ denied |
| 16 | admin | update a business `status` | ✅ allowed |
| 17 | admin | ban another admin / delete an `audit_log` entry | ❌ denied |

The "Rules playground" lets you set the signed-in user (including `email_verified`) and the request data for each case.

## Known limits (honest list)

- **Suspension is a posting ban, not a login ban.** To fully block someone, also disable them in *Authentication → Users*.
- **Rate limiting** is client-side only (a cooldown on the contact and newsletter forms). Real abuse protection comes from App Check, email verification and admin moderation. Adding Cloud Functions-based throttling is the next step if you grow.
- **Images are links, not uploads.** Members paste an `https` image URL, and the admin site loads previews only when you click. A future upload feature would need Firebase Storage rules and image scanning.
- **Spam cannot be fully prevented**, only made costly: verified email + review queue + reports + suspensions. Keep an eye on *Reports* and *Marketplace* early on.
- **Content Security Policy.** If something stops loading after deployment, open the browser console and look for *"Refused to load … Content Security Policy"*, then add that host to `config/security-headers.ts` (and the same value in `firebase.json`). To debug quickly, build with `VITE_DISABLE_CSP=true`.
- **Older browser-only data.** Listings and reviews that visitors created before this upgrade lived only in their own browsers and are not migrated.
- **Admin lists** show the most recent 400 items per section.
