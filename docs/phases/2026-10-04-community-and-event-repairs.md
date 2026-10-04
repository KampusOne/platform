# Community and campus event repair

Community profiles now include an uploaded public picture, description and member list. Community admins can edit these fields and choose whether members or only admins can post. Member posting is enabled by default. Official editorial news and cohort election permissions retain their separate routes and rules.

The community screen uses a profile header and post feed, with a compact composer, expandable poll/urgent options, author photos, and a stored Admin label for admin posts. Following prompts for notifications; the bell changes the per-community preference. New followers start opted out. Existing followers retain their subscriptions. Both queued delivery and the database notification trigger respect the preference and user blocks.

Migration `20261004101000_community_profiles_and_posting.sql` adds optional avatar media, posting policy, membership notification preference and post author role. Existing admin posts are labeled from trusted group membership. Profile edits require community ADMIN membership and owned image media from the same institution; clients cannot promote themselves.

Campus event, sports and opportunity forms now use a calendar and hour/minute/AM-PM options. Numeric local date construction avoids platform string parsing and rejects nonexistent dates before publishing. Selections serialize to an ISO instant for the existing server contract.

Validation: six focused PGlite/API tests cover policy changes, authorization, ownership, subscription opt-in and legacy migration preservation. Three client tests cover date conversion, leap-day rejection and malformed community responses. Migration rehearsal on the isolated October 3 branch also verified database notification preference and block handling without retaining synthetic records.
