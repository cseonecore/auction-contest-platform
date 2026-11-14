-- Migration 008: Seed Topics, Slots, and Auction Settings
-- ============================================================
-- Seeds all 10 Easy topics and 10 Hard topics directly from
-- the Official Rule Book Section 4 & Section 9.3 (topic criteria).
-- Creates 2 slots per topic (20 easy slots in Round 1, 20 hard slots in Round 2).
-- Inserts standard contest settings in public.settings.
-- ============================================================

-- 1. Contest Settings
insert into public.settings (key, value)
values 
  ('min_bid', '10'::jsonb),
  ('min_raise', '10'::jsonb),
  ('opening_window_seconds', '10'::jsonb),
  ('timer_extension_seconds', '5'::jsonb),
  ('starting_wallet_balance', '100'::jsonb),
  ('bonus_points_rate', '{"points": 1, "per_unspent": 3}'::jsonb)
on conflict (key) do update
set value = excluded.value;


-- 2. Easy Topics (Round 1)
insert into public.topics (id, level, title, description, criterion)
values
  ('11111111-0001-4000-8000-000000000001', 'easy', 'Campus Life Tech', 
   'Lost-and-found, canteen queues, event discovery.', 
   '{"focus": "Real-time updates, notification reliability"}'::jsonb),

  ('11111111-0001-4000-8000-000000000002', 'easy', 'Student Finance', 
   'Budgeting and split-expense apps.', 
   '{"focus": "Calculation accuracy, data privacy"}'::jsonb),

  ('11111111-0001-4000-8000-000000000003', 'easy', 'Hyperlocal Marketplace', 
   'Buy, sell, or rent within campus.', 
   '{"focus": "Listing flow, trust and verification"}'::jsonb),

  ('11111111-0001-4000-8000-000000000004', 'easy', 'Smart Attendance and Timetable', 
   'QR-based attendance, clash-free scheduling.', 
   '{"focus": "Anti-proxy checks, accuracy of clash detection"}'::jsonb),

  ('11111111-0001-4000-8000-000000000005', 'easy', 'Fun and Creative Tech', 
   'Meme generators, music recommenders, campus games.', 
   '{"focus": "Originality, shareability, fun factor"}'::jsonb),

  ('11111111-0001-4000-8000-000000000006', 'easy', 'Gamified Learning', 
   'Quests, points, and levels for boring subjects.', 
   '{"focus": "Engagement loop, learning effectiveness"}'::jsonb),

  ('11111111-0001-4000-8000-000000000007', 'easy', 'Green Campus', 
   'Energy tracking, waste sorting, carpooling.', 
   '{"focus": "Measurable impact, data tracking"}'::jsonb),

  ('11111111-0001-4000-8000-000000000008', 'easy', 'Club and Event Management', 
   'Registrations, volunteer tracking, certificates.', 
   '{"focus": "Workflow completeness, certificate automation"}'::jsonb),

  ('11111111-0001-4000-8000-000000000009', 'easy', 'Hostel and Mess Management', 
   'Menu feedback, room requests, complaint tracking.', 
   '{"focus": "Complaint lifecycle, admin dashboard"}'::jsonb),

  ('11111111-0001-4000-8000-000000000010', 'easy', 'Notes and Resource Sharing', 
   'Platforms to share and organize study material.', 
   '{"focus": "Search and organization, content quality control"}'::jsonb)
on conflict (id) do nothing;


-- 3. Hard Topics (Round 2)
insert into public.topics (id, level, title, description, criterion)
values
  ('22222222-0002-4000-8000-000000000001', 'hard', 'AI Study Buddy', 
   'Personalized notes, doubt solving, exam prep.', 
   '{"focus": "Answer accuracy, personalization, hallucination handling"}'::jsonb),

  ('22222222-0002-4000-8000-000000000002', 'hard', 'Fake News and Deepfake Detection', 
   'Spotting fake media and misinformation.', 
   '{"focus": "Detection accuracy on test samples, explainability"}'::jsonb),

  ('22222222-0002-4000-8000-000000000003', 'hard', 'Accessibility Tools', 
   'Sign language translation, voice navigation.', 
   '{"focus": "Recognition accuracy, latency, inclusive design"}'::jsonb),

  ('22222222-0002-4000-8000-000000000004', 'hard', 'Open Source for NGOs', 
   'Real-world tools with real users and constraints.', 
   '{"focus": "Real stakeholder fit, sustainability, scalability"}'::jsonb),

  ('22222222-0002-4000-8000-000000000005', 'hard', 'Career Readiness', 
   'Resume analyzers, mock interview bots, skill-gap mapping.', 
   '{"focus": "Feedback quality, scoring consistency"}'::jsonb),

  ('22222222-0002-4000-8000-000000000006', 'hard', 'Women''s Safety', 
   'Smart alerts, safe routes, incident reporting.', 
   '{"focus": "Response speed, offline reliability, privacy"}'::jsonb),

  ('22222222-0002-4000-8000-000000000007', 'hard', 'Mental Wellness', 
   'Anonymous peer support, stress trackers, burnout detection.', 
   '{"focus": "Anonymity, safe-response handling, ethical design"}'::jsonb),

  ('22222222-0002-4000-8000-000000000008', 'hard', 'Cybersecurity for Students', 
   'Phishing and scam detection, password safety tools.', 
   '{"focus": "Detection rate, false positives, security of the app itself"}'::jsonb),

  ('22222222-0002-4000-8000-000000000009', 'hard', 'AR/VR Learning', 
   'Immersive labs, virtual campus tours, simulations.', 
   '{"focus": "Immersion, performance, device compatibility"}'::jsonb),

  ('22222222-0002-4000-8000-000000000010', 'hard', 'Disaster and Emergency Response', 
   'Early alerts, evacuation guidance, volunteer coordination.', 
   '{"focus": "Alert reliability, low-connectivity support, coordination flow"}'::jsonb)
on conflict (id) do nothing;


-- 4. Create Slots (2 slots per topic)
-- Slot A and Slot B for each topic
-- Round 1: Easy Slots (20 total)
do $$
declare
  t record;
  slot_count integer;
begin
  for t in select id from public.topics where level = 'easy' loop
    select count(*) into slot_count from public.slots where topic_id = t.id and round = 1;
    if slot_count < 2 then
      insert into public.slots (topic_id, round, status, current_bid)
      values 
        (t.id, 1, 'pending', 0),
        (t.id, 1, 'pending', 0);
    end if;
  end loop;

  -- Round 2: Hard Slots (20 total)
  for t in select id from public.topics where level = 'hard' loop
    select count(*) into slot_count from public.slots where topic_id = t.id and round = 2;
    if slot_count < 2 then
      insert into public.slots (topic_id, round, status, current_bid)
      values 
        (t.id, 2, 'pending', 0),
        (t.id, 2, 'pending', 0);
    end if;
  end loop;
end;
$$;

