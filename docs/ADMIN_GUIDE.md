# Admin guide

Open **`/#/admin`** on your site and sign in with your admin account. (First time? The README explains the one-time setup.)
Orange numbers in the sidebar show how many items are waiting for you. A good daily routine is **Dashboard → Businesses → Reports → Claims → Messages**.

## Businesses

Members submit new listings; they stay **hidden** until you decide.

| Button | What it does |
|---|---|
| **Approve** | Listing goes live in the directory (no badge). |
| **Approve & verify** | Goes live **and** gets the Verified badge. Only do this after you've checked the details (for example the CAC number on the CAC public search). |
| **Reject…** | Not published. Your note is shown to the owner under *My Submissions*. |
| **Remove…** | Takes a live listing down (owner sees your note). Reversible with **Restore**. |
| **Delete forever** | Erases it permanently (only for rejected/removed listings). |
| **Edit** | Fix typos in the main fields before approving. |
| **Mark as verified / Remove verified badge** | Toggles the badge on a live listing. |

Open **Details** on any listing to see every field, the Google Maps link and the owner's account ID. Links are shown for you to inspect; open unfamiliar ones with care.

**Built-in directory** (tab): search the 37,000 listings that ship with the site and **Hide** any that are wrong or abusive (and **Restore** later). You can't edit those, only hide them.

## Marketplace

Ads go live immediately by default and you remove bad ones afterwards. If spam becomes a problem, switch on **"Marketplace ads need approval"** in *Site settings*: new ads then wait in the **Pending** tab. Use **Remove…** with a reason (the seller sees it). **Built-in ads** works like built-in listings.

## Reports

Members press **Report** on a listing, ad or review. Open **Review** to see the item and its **real owner** (taken from the item itself, never from the reporter).

- **Remove content…**: takes the item down and closes the report.
- **Remove & suspend owner…**: also suspends the account.
- **Mark resolved**: you handled it some other way.
- **Dismiss**: the report was mistaken; nothing changes.

A badge such as *"3 reports on this item"* helps you spot repeat problems.

## Ownership claims

A business owner asks to be verified on an existing listing. Check their proof, then **Approve & verify** (adds the badge and marks the listing as claimed) or **Reject…** with a reason.

## Users & admins

- **Suspend…**: the member can still browse but can no longer list, post, review or report. Tick *"Also remove all their listings, ads and reviews"* for spammers. They see your reason and can appeal through the Contact page.
- **Reinstate**: lifts a suspension (removed content isn't restored automatically).
- **Make admin / Remove admin**: admins can do everything on this page, so add only people you trust. You can't suspend an admin or remove your own admin rights (remove someone's admin role first if you must suspend them).
- **Activity**: see a member's listings, ads and reviews before deciding.

> Suspending stops posting; it doesn't disable the person's login. To block an account entirely, also disable it under Firebase console → Authentication → Users.

## Reviews

The most recent reviews (up to 400). **Delete** fake or abusive ones, or **Suspend author…**.

## Messages & newsletter

- **Contact messages** from the Contact page. Opening one marks it read; **Reply by email** opens your mail app. Archive or delete when done.
- **Newsletter subscribers**: search, remove, or **Export CSV** (safe to open in Excel).

## Site settings

- **Contact details**: shown on the Contact page and footer (leave blank to hide).
- **About page story**: your own words replace the default text (blank line = new paragraph).
- **Announcement bar**: a highlighted message across the top of every page.
- **Posting rules**: whether new marketplace ads need approval.

## Activity log

Every admin action is recorded with who did it and when. The log can't be edited or deleted, even by admins.

## How the daily Featured businesses work

Each day (Nigerian time) the site picks **12 random verified businesses** from those that are approved and verified, so **only verified listings are eligible**. Everyone sees the same picks on a given day, and they change at midnight. A listing you approve **and verify** joins the pool immediately; it shows up in today's picks only if it happens to win a slot, otherwise on a later day. The marketplace's **TOP** ads rotate the same way (8 per day).
The generated placeholder listings are excluded (see the README).

> Admin lists load the **400 most recent** items of each kind. That is plenty for a growing site; if you outgrow it, use the search box or ask a developer to add paging.
