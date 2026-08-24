# Message to send friends

Copy the block below. It is written to be pasted into WhatsApp or a group chat
as-is.

**Do not attach a QA checklist.** The goal is natural usage — people using the
app the way they actually would. A checklist produces checklist-shaped feedback
and hides the things you most need to know, like where someone hesitated or
gave up.

---

## The message

> Hey — I've been building an app called Mad Buddy and it's finally ready for
> people to actually try. I'd really appreciate it if you'd use it for a bit.
>
> **https://mad-buddy.com**
>
> It's about knowing when your friends are nearby without sharing your exact
> location — no maps, no pins, no location history. You add friends (Muddies),
> and you can see roughly how close they are. There's also making plans,
> messaging, and a safety feature for letting people know you got home.
>
> Just make an account and use it however makes sense to you. Add me, add
> anyone else you know on it, poke around whatever looks interesting.
>
> If something breaks, confuses you, looks ugly, or feels slow — screenshot it
> and tell me:
>
> - what you were trying to do
> - what you expected to happen
> - what actually happened
> - what phone you're on
>
> **Please don't try to be nice.** If something doesn't make sense, tell me it
> doesn't make sense. "I didn't get what this screen was for" is genuinely more
> useful to me than "looks great". I can't fix polite.
>
> It's free. There are two features (Linkr and UpFor) that become paid later,
> but you get 14 days of them automatically once you add your first friend, and
> I'm not asking anyone for card details — nothing will charge you.

---

## If you are asking someone to test payment

Only send this to people who have **already agreed** to test paying. Never
spring it on the group.

> One more thing — would you be up for testing the payment side? It's **GHS 5 a
> month and it does recur until you cancel**, so only say yes if you're
> genuinely fine with that. I mainly need to check the payment actually works
> end to end. Happy to sort you out for it, and you can cancel straight after.

---

## What to expect back, and what to do with it

Most of what you get will be small: a button in an odd place, a word that
didn't land, a screen that felt slow. That is the point — log it in
`BETA-ISSUES.md` and **resist fixing it immediately**. Patterns across several
testers are worth far more than any single report.

Act instantly on only: anything security-related, data loss, payment
misbehaving, or people unable to sign up or log in.

When several people trip on the same thing, that is your real signal. One
person disliking something is taste; four people hesitating in the same place
is a design problem.
