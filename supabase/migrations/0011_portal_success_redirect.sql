-- Where to send a customer once the hotspot login actually succeeds.
--
-- RouterOS otherwise sends them to $(link-orig) — whatever URL their phone
-- happened to be requesting when the portal intercepted it. In practice that
-- is almost never a page worth landing on: it is usually the OS's own
-- captive-portal probe (connectivitycheck.gstatic.com, captive.apple.com), or
-- an HTTPS URL the hotspot intercepted and can only serve with a certificate
-- that does not match, which is what makes a phone warn that "the login page
-- might not belong to the organisation shown". Sending the customer to a
-- known-good plain URL instead gives them an unambiguous "you are online"
-- moment and avoids re-triggering that warning right at the point of success.
--
-- Null keeps the previous behaviour ($(link-orig)), so this changes nothing
-- until an admin sets it.
alter table captive_portal_themes
  add column if not exists success_redirect_url text;

comment on column captive_portal_themes.success_redirect_url is
  'Absolute URL customers land on after a successful hotspot login. Prefer http:// over https:// — it is loaded at the moment the session transitions to authenticated, and some devices reuse the captive-portal mini-browser for it. Null = fall back to RouterOS $(link-orig).';
