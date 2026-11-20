# Admin guide

Open **`/#/admin`** on your site and sign in with your admin account.
Orange numbers in the sidebar show how many items are waiting for you. A good daily routine is **Dashboard → Businesses → Reports → Claims → Messages**.

## Businesses

All directory listings are submitted by registered members and stored in Cloudflare D1. New submissions stay **pending** (hidden from public view) until an administrator reviews them.

| Button | What it does |
|---|---|
| **Approve** | Listing goes live in the directory as an approved (unverified) listing. |
| **Approve & verify** | Goes live **and** awards the Verified badge. Only use this after checking the business's details (for example verifying their CAC number or proof of ownership). |
| **Reject…** | Not published. Your note is shown to the owner under *My Submissions*. |
| **Remove…** | Takes a live listing down (owner sees your note). Reversible with **Restore**. |
| **Delete forever** | Erases the listing permanently from D1 (available on rejected/removed listings). |
| **Edit** | Fix typos or formatting before or after approving. |
| **Mark as verified / Remove verified badge** | Toggles the Verified badge on a live listing. |

Open **Details** on any listing to inspect every field, uploaded R2 media, the Google Maps link, and the owner's account ID. Open unfamiliar external links with care.

## Marketplace

Marketplace ads are submitted by registered members. Ads go live immediately by default unless you switch on **"Marketplace ads need approval"** in *Site settings*, in which case new ads wait in the **Pending** tab until approved. Use **Remove…** with a clear reason (shown to the seller) to take down policy-violating ads, or **Delete forever** on removed ads.

## Reports

Members can click **Report** on any listing, ad, or review. Open **Review** to inspect the item and its authoritative owner record from D1.

- **Remove content…**: takes the item down and closes the report.
- **Remove & suspend owner…**: removes the content and suspends the offending member account.
- **Mark resolved**: records that you handled the report manually.
- **Dismiss**: closes mistaken reports without modifying content.

A badge such as *"3 reports on this item"* helps highlight repeat issues.

## Ownership claims

A business owner can request ownership and verification on an existing directory listing. Inspect their proof, then choose **Approve & verify** (awards the Verified badge and marks the listing claimed) or **Reject…** with a reason.

## Users & admins

- **Suspend…**: prevents the member from listing businesses, posting ads, reviewing, or reporting. Tick *"Also remove all their listings, ads and reviews"* for spam accounts. They see your reason and can appeal via the Contact page.
- **Reinstate**: lifts a suspension (previously removed content stays removed unless restored individually).
- **Make admin / Remove admin**: grant admin rights only to trusted operators. You cannot suspend an admin or revoke your own admin role.
- **Activity**: inspect a member's businesses, marketplace ads, and reviews before taking action.

> Admin actions and user suspensions are stored in Cloudflare D1 (`admin_records`, `user_bans`, and `audit_log`) and enforced server-side on every authenticated API route in the Cloudflare Worker.

## Reviews

Displays the most recent member reviews (up to 400). You can **Delete** abusive or spam reviews, or **Suspend author…**.

## Messages & newsletter

- **Contact messages** submitted through the Contact page. Opening a message marks it read; **Reply by email** opens your mail client. Archive or delete when resolved.
- **Newsletter subscribers**: search, remove, or **Export CSV**.

## Site settings

- **Contact details**: displayed on the Contact page and footer (leave blank to hide).
- **About page story**: replaces the default text (blank line = new paragraph).
- **Announcement bar**: highlighted notice across the top of every page.
- **Posting rules**: toggle whether new marketplace ads require admin approval before going live.

## Activity log

Every admin mutation executes atomically in a Cloudflare D1 batch alongside an immutable `audit_log` entry recording who acted, what changed, and when. Audit entries cannot be edited or deleted through the API.

## How the daily Featured businesses work

Each day at midnight (West Africa Time), the site deterministically selects up to **12 approved and verified businesses** for the Featured spotlight so every visitor sees the same daily picks. Unverified listings are never featured. Once an administrator approves and verifies a business, it automatically joins the eligible pool. Marketplace **TOP** picks rotate the same way (up to 8 live ads per day).

> Admin lists load the **400 most recent** items per section. Use the search box to filter specific records.
