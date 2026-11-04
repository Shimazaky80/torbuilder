-- =============================================================================
-- Migration: App Places lookup (South African provinces and their towns)
--
-- The rent-a-car drop asks where a car is collected and where it goes back, and
-- until now both answers were typed free text. That is the wrong shape for a
-- South African operator: "Cape Town", "Capetown" and "CPT" become three
-- different hires, and nobody can search a contract by the town it starts in.
--
-- This is a shared reference table, not tenant data — the map of South Africa is
-- the same for every company — so it follows the app_countries and
-- library_categories precedent: every authenticated session reads it, only a
-- super admin writes it, and the seed is idempotent so a re-run cannot duplicate
-- a town.
--
-- `alt_name` carries the other name a place is sold under, because official
-- renames left both names in circulation (Mbombela/Nelspruit, Makhanda/
-- Grahamstown, Mahikeng/Mafikeng). The picker searches both, so an operator
-- finds the town whichever name they type.
--
-- `hub` marks a provincial capital, the province's largest city, or a town with
-- an airport a traveller flies into. The drop lists hubs first; everything else
-- is one keystroke away in the search.
--
-- Rows are seeded from src/data/southafricaPlaces.js, the same module the app
-- falls back to when this table is not yet applied. Keep the two in step.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.app_places (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country     TEXT NOT NULL DEFAULT 'South Africa',
    province    TEXT NOT NULL,
    place       TEXT NOT NULL,
    alt_name    TEXT,
    is_hub      BOOLEAN NOT NULL DEFAULT false,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT app_places_place_key UNIQUE (country, province, place)
);

-- One search across a province, and one listing of the hubs in it.
CREATE INDEX IF NOT EXISTS app_places_province_idx ON public.app_places (province, place);
CREATE INDEX IF NOT EXISTS app_places_hub_idx ON public.app_places (country, is_hub) WHERE is_hub;

ALTER TABLE public.app_places ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_places' AND policyname='Users can view app places') THEN
    CREATE POLICY "Users can view app places" ON public.app_places
      FOR SELECT USING (auth.role() = 'authenticated' OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_places' AND policyname='Super admins can manage app places') THEN
    CREATE POLICY "Super admins can manage app places" ON public.app_places
      FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
  END IF;
END $$;

GRANT SELECT ON TABLE public.app_places TO authenticated;
-- The seed above runs as the dashboard owner, so a tenant never needs to write
-- this table to read it. These privileges are here for the super-admin edit path
-- only; RLS still refuses the write for anyone who is not a super admin.
GRANT INSERT, UPDATE, DELETE ON TABLE public.app_places TO authenticated;

-- =============================================================================
-- Seed: 377 places across the nine provinces.
-- Generated from supabase/data/south_africa_places.json — edit that file and
-- regenerate; do not hand-edit the inserts below.
-- =============================================================================

-- Eastern Cape (48 places, 4 hubs)
INSERT INTO public.app_places (country, province, place, alt_name, is_hub) VALUES
  ('South Africa', 'Eastern Cape', 'Aberdeen', NULL, false),
  ('South Africa', 'Eastern Cape', 'Addo', NULL, false),
  ('South Africa', 'Eastern Cape', 'Alice', NULL, false),
  ('South Africa', 'Eastern Cape', 'Aliwal North', NULL, false),
  ('South Africa', 'Eastern Cape', 'Bhisho', 'Bisho', true),
  ('South Africa', 'Eastern Cape', 'Butterworth', NULL, false),
  ('South Africa', 'Eastern Cape', 'Cathcart', NULL, false),
  ('South Africa', 'Eastern Cape', 'Chintsa', 'Cintsa', false),
  ('South Africa', 'Eastern Cape', 'Coffee Bay', NULL, false),
  ('South Africa', 'Eastern Cape', 'Cofimvaba', NULL, false),
  ('South Africa', 'Eastern Cape', 'Cookhouse', NULL, false),
  ('South Africa', 'Eastern Cape', 'Cradock', NULL, false),
  ('South Africa', 'Eastern Cape', 'Despatch', NULL, false),
  ('South Africa', 'Eastern Cape', 'Dordrecht', NULL, false),
  ('South Africa', 'Eastern Cape', 'East London', NULL, true),
  ('South Africa', 'Eastern Cape', 'Elliot', NULL, false),
  ('South Africa', 'Eastern Cape', 'Fort Beaufort', NULL, false),
  ('South Africa', 'Eastern Cape', 'Gqeberha', 'Port Elizabeth', true),
  ('South Africa', 'Eastern Cape', 'Graaff-Reinet', NULL, false),
  ('South Africa', 'Eastern Cape', 'Hogsback', NULL, false),
  ('South Africa', 'Eastern Cape', 'Humansdorp', NULL, false),
  ('South Africa', 'Eastern Cape', 'Idutywa', NULL, false),
  ('South Africa', 'Eastern Cape', 'Jeffreys Bay', NULL, false),
  ('South Africa', 'Eastern Cape', 'Joubertina', NULL, false),
  ('South Africa', 'Eastern Cape', 'Kariega', 'Uitenhage', false),
  ('South Africa', 'Eastern Cape', 'Kenton-on-Sea', NULL, false),
  ('South Africa', 'Eastern Cape', 'Kirkwood', NULL, false),
  ('South Africa', 'Eastern Cape', 'Komani', 'Queenstown', false),
  ('South Africa', 'Eastern Cape', 'Lusikisiki', NULL, false),
  ('South Africa', 'Eastern Cape', 'Maclear', NULL, false),
  ('South Africa', 'Eastern Cape', 'Makhanda', 'Grahamstown', false),
  ('South Africa', 'Eastern Cape', 'Middelburg', NULL, false),
  ('South Africa', 'Eastern Cape', 'Molteno', NULL, false),
  ('South Africa', 'Eastern Cape', 'Mount Frere', NULL, false),
  ('South Africa', 'Eastern Cape', 'Mthatha', 'Umtata', true),
  ('South Africa', 'Eastern Cape', 'Ngcobo', NULL, false),
  ('South Africa', 'Eastern Cape', 'Nieu-Bethesda', NULL, false),
  ('South Africa', 'Eastern Cape', 'Pearston', NULL, false),
  ('South Africa', 'Eastern Cape', 'Peddie', NULL, false),
  ('South Africa', 'Eastern Cape', 'Port Alfred', NULL, false),
  ('South Africa', 'Eastern Cape', 'Port St Johns', NULL, false),
  ('South Africa', 'Eastern Cape', 'Qonce', 'King William''s Town', false),
  ('South Africa', 'Eastern Cape', 'Somerset East', NULL, false),
  ('South Africa', 'Eastern Cape', 'St Francis Bay', NULL, false),
  ('South Africa', 'Eastern Cape', 'Stutterheim', NULL, false),
  ('South Africa', 'Eastern Cape', 'Tarkastad', NULL, false),
  ('South Africa', 'Eastern Cape', 'Ugie', NULL, false),
  ('South Africa', 'Eastern Cape', 'Willowmore', NULL, false)
ON CONFLICT (country, province, place) DO NOTHING;

-- Free State (39 places, 1 hubs)
INSERT INTO public.app_places (country, province, place, alt_name, is_hub) VALUES
  ('South Africa', 'Free State', 'Bethlehem', NULL, false),
  ('South Africa', 'Free State', 'Bethulie', NULL, false),
  ('South Africa', 'Free State', 'Bloemfontein', NULL, true),
  ('South Africa', 'Free State', 'Boshof', NULL, false),
  ('South Africa', 'Free State', 'Bothaville', NULL, false),
  ('South Africa', 'Free State', 'Botshabelo', NULL, false),
  ('South Africa', 'Free State', 'Brandfort', NULL, false),
  ('South Africa', 'Free State', 'Clarens', NULL, false),
  ('South Africa', 'Free State', 'Deneysville', NULL, false),
  ('South Africa', 'Free State', 'Ficksburg', NULL, false),
  ('South Africa', 'Free State', 'Fouriesburg', NULL, false),
  ('South Africa', 'Free State', 'Gariep Dam', NULL, false),
  ('South Africa', 'Free State', 'Harrismith', NULL, false),
  ('South Africa', 'Free State', 'Heilbron', NULL, false),
  ('South Africa', 'Free State', 'Hoopstad', NULL, false),
  ('South Africa', 'Free State', 'Koppies', NULL, false),
  ('South Africa', 'Free State', 'Kroonstad', NULL, false),
  ('South Africa', 'Free State', 'Ladybrand', NULL, false),
  ('South Africa', 'Free State', 'Memel', NULL, false),
  ('South Africa', 'Free State', 'Odendaalsrus', NULL, false),
  ('South Africa', 'Free State', 'Parys', NULL, false),
  ('South Africa', 'Free State', 'Petrus Steyn', 'Mamafubedu', false),
  ('South Africa', 'Free State', 'Philippolis', NULL, false),
  ('South Africa', 'Free State', 'Phuthaditjhaba', 'Witsieshoek', false),
  ('South Africa', 'Free State', 'Rouxville', NULL, false),
  ('South Africa', 'Free State', 'Sasolburg', NULL, false),
  ('South Africa', 'Free State', 'Smithfield', NULL, false),
  ('South Africa', 'Free State', 'Springfontein', NULL, false),
  ('South Africa', 'Free State', 'Thaba ''Nchu', NULL, false),
  ('South Africa', 'Free State', 'Van Reenen', NULL, false),
  ('South Africa', 'Free State', 'Ventersburg', NULL, false),
  ('South Africa', 'Free State', 'Viljoenskroon', NULL, false),
  ('South Africa', 'Free State', 'Virginia', NULL, false),
  ('South Africa', 'Free State', 'Vrede', NULL, false),
  ('South Africa', 'Free State', 'Vredefort', NULL, false),
  ('South Africa', 'Free State', 'Welkom', NULL, false),
  ('South Africa', 'Free State', 'Wepener', NULL, false),
  ('South Africa', 'Free State', 'Wesselsbron', NULL, false),
  ('South Africa', 'Free State', 'Winburg', NULL, false)
ON CONFLICT (country, province, place) DO NOTHING;

-- Gauteng (41 places, 5 hubs)
INSERT INTO public.app_places (country, province, place, alt_name, is_hub) VALUES
  ('South Africa', 'Gauteng', 'Alberton', NULL, false),
  ('South Africa', 'Gauteng', 'Bedfordview', NULL, false),
  ('South Africa', 'Gauteng', 'Benoni', NULL, false),
  ('South Africa', 'Gauteng', 'Boksburg', NULL, false),
  ('South Africa', 'Gauteng', 'Brakpan', NULL, false),
  ('South Africa', 'Gauteng', 'Bronkhorstspruit', NULL, false),
  ('South Africa', 'Gauteng', 'Carletonville', NULL, false),
  ('South Africa', 'Gauteng', 'Centurion', NULL, false),
  ('South Africa', 'Gauteng', 'Cullinan', NULL, false),
  ('South Africa', 'Gauteng', 'Daveyton', NULL, false),
  ('South Africa', 'Gauteng', 'Edenvale', NULL, false),
  ('South Africa', 'Gauteng', 'Germiston', NULL, false),
  ('South Africa', 'Gauteng', 'Hammanskraal', NULL, false),
  ('South Africa', 'Gauteng', 'Heidelberg', NULL, false),
  ('South Africa', 'Gauteng', 'Johannesburg', NULL, true),
  ('South Africa', 'Gauteng', 'Katlehong', NULL, false),
  ('South Africa', 'Gauteng', 'Kempton Park', NULL, false),
  ('South Africa', 'Gauteng', 'Krugersdorp', NULL, false),
  ('South Africa', 'Gauteng', 'Lanseria', NULL, true),
  ('South Africa', 'Gauteng', 'Lanseria International Airport', NULL, true),
  ('South Africa', 'Gauteng', 'Lenasia', NULL, false),
  ('South Africa', 'Gauteng', 'Magaliesburg', NULL, false),
  ('South Africa', 'Gauteng', 'Mamelodi', NULL, false),
  ('South Africa', 'Gauteng', 'Meyerton', NULL, false),
  ('South Africa', 'Gauteng', 'Midrand', NULL, false),
  ('South Africa', 'Gauteng', 'Muldersdrift', NULL, false),
  ('South Africa', 'Gauteng', 'Nigel', NULL, false),
  ('South Africa', 'Gauteng', 'O.R. Tambo International Airport', NULL, true),
  ('South Africa', 'Gauteng', 'Pretoria', NULL, true),
  ('South Africa', 'Gauteng', 'Randburg', NULL, false),
  ('South Africa', 'Gauteng', 'Randfontein', NULL, false),
  ('South Africa', 'Gauteng', 'Roodepoort', NULL, false),
  ('South Africa', 'Gauteng', 'Sandton', NULL, false),
  ('South Africa', 'Gauteng', 'Soshanguve', NULL, false),
  ('South Africa', 'Gauteng', 'Soweto', NULL, false),
  ('South Africa', 'Gauteng', 'Springs', NULL, false),
  ('South Africa', 'Gauteng', 'Tembisa', NULL, false),
  ('South Africa', 'Gauteng', 'Thokoza', NULL, false),
  ('South Africa', 'Gauteng', 'Vanderbijlpark', NULL, false),
  ('South Africa', 'Gauteng', 'Vereeniging', NULL, false),
  ('South Africa', 'Gauteng', 'Westonaria', NULL, false)
ON CONFLICT (country, province, place) DO NOTHING;

-- KwaZulu-Natal (49 places, 4 hubs)
INSERT INTO public.app_places (country, province, place, alt_name, is_hub) VALUES
  ('South Africa', 'KwaZulu-Natal', 'Amanzimtoti', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Babanango', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Ballito', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Bergville', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Camperdown', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Dundee', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Durban', NULL, true),
  ('South Africa', 'KwaZulu-Natal', 'Empangeni', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Eshowe', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Estcourt', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Greytown', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Harding', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Hilton', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Himeville', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Hluhluwe', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Howick', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Jozini', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'King Shaka International Airport', NULL, true),
  ('South Africa', 'KwaZulu-Natal', 'Kloof', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Kosi Bay', 'Kwangwanase', false),
  ('South Africa', 'KwaZulu-Natal', 'Ladysmith', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Margate', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Mbazwana', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Melmoth', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Mkuze', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Mooi River', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Mtubatuba', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Newcastle', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Nongoma', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Paulpietersburg', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Pietermaritzburg', NULL, true),
  ('South Africa', 'KwaZulu-Natal', 'Pongola', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Port Edward', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Port Shepstone', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Richards Bay', NULL, true),
  ('South Africa', 'KwaZulu-Natal', 'Richmond', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Salt Rock', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Scottburgh', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Sodwana Bay', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Stanger', 'KwaDukuza', false),
  ('South Africa', 'KwaZulu-Natal', 'St Lucia', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Tongaat', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Ulundi', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Umhlanga', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Umkomaas', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Underberg', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Verulam', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Vryheid', NULL, false),
  ('South Africa', 'KwaZulu-Natal', 'Winterton', NULL, false)
ON CONFLICT (country, province, place) DO NOTHING;

-- Limpopo (31 places, 3 hubs)
INSERT INTO public.app_places (country, province, place, alt_name, is_hub) VALUES
  ('South Africa', 'Limpopo', 'Alldays', NULL, false),
  ('South Africa', 'Limpopo', 'Bandelierkop', NULL, false),
  ('South Africa', 'Limpopo', 'Bela-Bela', 'Warmbaths', false),
  ('South Africa', 'Limpopo', 'Giyani', NULL, false),
  ('South Africa', 'Limpopo', 'Gravelotte', NULL, false),
  ('South Africa', 'Limpopo', 'Groblersdal', NULL, false),
  ('South Africa', 'Limpopo', 'Haenertsburg', NULL, false),
  ('South Africa', 'Limpopo', 'Hoedspruit', NULL, true),
  ('South Africa', 'Limpopo', 'Lebowakgomo', NULL, false),
  ('South Africa', 'Limpopo', 'Lephalale', 'Ellisras', false),
  ('South Africa', 'Limpopo', 'Letsitele', NULL, false),
  ('South Africa', 'Limpopo', 'Louis Trichardt', 'Makhado', false),
  ('South Africa', 'Limpopo', 'Mankweng', NULL, false),
  ('South Africa', 'Limpopo', 'Marble Hall', NULL, false),
  ('South Africa', 'Limpopo', 'Modimolle', 'Nylstroom', false),
  ('South Africa', 'Limpopo', 'Modjadjiskloof', 'Duiwelskloof', false),
  ('South Africa', 'Limpopo', 'Mogwadi', 'Dendron', false),
  ('South Africa', 'Limpopo', 'Mokopane', 'Potgietersrus', false),
  ('South Africa', 'Limpopo', 'Mookgophong', 'Naboomspruit', false),
  ('South Africa', 'Limpopo', 'Musina', NULL, false),
  ('South Africa', 'Limpopo', 'Nkowankowa', NULL, false),
  ('South Africa', 'Limpopo', 'Ofcolaco', NULL, false),
  ('South Africa', 'Limpopo', 'Phalaborwa', NULL, true),
  ('South Africa', 'Limpopo', 'Polokwane', 'Pietersburg', true),
  ('South Africa', 'Limpopo', 'Steelpoort', NULL, false),
  ('South Africa', 'Limpopo', 'Thabazimbi', NULL, false),
  ('South Africa', 'Limpopo', 'Thohoyandou', NULL, false),
  ('South Africa', 'Limpopo', 'Tshipise', NULL, false),
  ('South Africa', 'Limpopo', 'Tzaneen', NULL, false),
  ('South Africa', 'Limpopo', 'Vaalwater', NULL, false),
  ('South Africa', 'Limpopo', 'Zebediela', NULL, false)
ON CONFLICT (country, province, place) DO NOTHING;

-- Mpumalanga (39 places, 3 hubs)
INSERT INTO public.app_places (country, province, place, alt_name, is_hub) VALUES
  ('South Africa', 'Mpumalanga', 'Acornhoek', NULL, false),
  ('South Africa', 'Mpumalanga', 'Badplaas', NULL, false),
  ('South Africa', 'Mpumalanga', 'Balfour', NULL, false),
  ('South Africa', 'Mpumalanga', 'Barberton', NULL, false),
  ('South Africa', 'Mpumalanga', 'Belfast', NULL, false),
  ('South Africa', 'Mpumalanga', 'Bethal', NULL, false),
  ('South Africa', 'Mpumalanga', 'Carolina', NULL, false),
  ('South Africa', 'Mpumalanga', 'Chrissiesmeer', NULL, false),
  ('South Africa', 'Mpumalanga', 'Delmas', NULL, false),
  ('South Africa', 'Mpumalanga', 'Dullstroom', NULL, false),
  ('South Africa', 'Mpumalanga', 'eMalahleni', 'Witbank', false),
  ('South Africa', 'Mpumalanga', 'Ermelo', NULL, false),
  ('South Africa', 'Mpumalanga', 'Graskop', NULL, false),
  ('South Africa', 'Mpumalanga', 'Hazyview', NULL, false),
  ('South Africa', 'Mpumalanga', 'Kaapmuiden', NULL, false),
  ('South Africa', 'Mpumalanga', 'Kinross', NULL, false),
  ('South Africa', 'Mpumalanga', 'Komatipoort', NULL, false),
  ('South Africa', 'Mpumalanga', 'Kriel', NULL, false),
  ('South Africa', 'Mpumalanga', 'Kruger Mpumalanga International Airport', NULL, true),
  ('South Africa', 'Mpumalanga', 'Lydenburg', 'Mashishing', false),
  ('South Africa', 'Mpumalanga', 'Machadodorp', NULL, false),
  ('South Africa', 'Mpumalanga', 'Malelane', NULL, false),
  ('South Africa', 'Mpumalanga', 'Marloth Park', NULL, false),
  ('South Africa', 'Mpumalanga', 'Mbombela', 'Nelspruit', true),
  ('South Africa', 'Mpumalanga', 'Middelburg', NULL, false),
  ('South Africa', 'Mpumalanga', 'Ohrigstad', NULL, false),
  ('South Africa', 'Mpumalanga', 'Piet Retief', 'eMkhondo', false),
  ('South Africa', 'Mpumalanga', 'Pilgrim''s Rest', NULL, false),
  ('South Africa', 'Mpumalanga', 'Sabie', NULL, false),
  ('South Africa', 'Mpumalanga', 'Secunda', NULL, false),
  ('South Africa', 'Mpumalanga', 'Siyabuswa', NULL, false),
  ('South Africa', 'Mpumalanga', 'Skukuza', NULL, true),
  ('South Africa', 'Mpumalanga', 'Standerton', NULL, false),
  ('South Africa', 'Mpumalanga', 'Trichardt', NULL, false),
  ('South Africa', 'Mpumalanga', 'Volksrust', NULL, false),
  ('South Africa', 'Mpumalanga', 'Wakkerstroom', NULL, false),
  ('South Africa', 'Mpumalanga', 'Waterval Boven', NULL, false),
  ('South Africa', 'Mpumalanga', 'Waterval Onder', NULL, false),
  ('South Africa', 'Mpumalanga', 'White River', NULL, false)
ON CONFLICT (country, province, place) DO NOTHING;

-- Northern Cape (40 places, 3 hubs)
INSERT INTO public.app_places (country, province, place, alt_name, is_hub) VALUES
  ('South Africa', 'Northern Cape', 'Aggeneys', NULL, false),
  ('South Africa', 'Northern Cape', 'Alexander Bay', NULL, false),
  ('South Africa', 'Northern Cape', 'Augrabies', NULL, false),
  ('South Africa', 'Northern Cape', 'Barkly West', NULL, false),
  ('South Africa', 'Northern Cape', 'Calvinia', NULL, false),
  ('South Africa', 'Northern Cape', 'Carnarvon', NULL, false),
  ('South Africa', 'Northern Cape', 'Colesberg', NULL, false),
  ('South Africa', 'Northern Cape', 'De Aar', NULL, false),
  ('South Africa', 'Northern Cape', 'Douglas', NULL, false),
  ('South Africa', 'Northern Cape', 'Fraserburg', NULL, false),
  ('South Africa', 'Northern Cape', 'Garies', NULL, false),
  ('South Africa', 'Northern Cape', 'Griquatown', NULL, false),
  ('South Africa', 'Northern Cape', 'Groblershoop', NULL, false),
  ('South Africa', 'Northern Cape', 'Hanover', NULL, false),
  ('South Africa', 'Northern Cape', 'Hondeklipbaai', NULL, false),
  ('South Africa', 'Northern Cape', 'Hopetown', NULL, false),
  ('South Africa', 'Northern Cape', 'Jan Kempdorp', NULL, false),
  ('South Africa', 'Northern Cape', 'Kamieskroon', NULL, false),
  ('South Africa', 'Northern Cape', 'Kathu', NULL, false),
  ('South Africa', 'Northern Cape', 'Keimoes', NULL, false),
  ('South Africa', 'Northern Cape', 'Kenhardt', NULL, false),
  ('South Africa', 'Northern Cape', 'Kimberley', NULL, true),
  ('South Africa', 'Northern Cape', 'Kuruman', NULL, false),
  ('South Africa', 'Northern Cape', 'Nieuwoudtville', NULL, false),
  ('South Africa', 'Northern Cape', 'Noupoort', NULL, false),
  ('South Africa', 'Northern Cape', 'Okiep', NULL, false),
  ('South Africa', 'Northern Cape', 'Pofadder', NULL, false),
  ('South Africa', 'Northern Cape', 'Port Nolloth', NULL, false),
  ('South Africa', 'Northern Cape', 'Postmasburg', NULL, false),
  ('South Africa', 'Northern Cape', 'Prieska', NULL, false),
  ('South Africa', 'Northern Cape', 'Richmond', NULL, false),
  ('South Africa', 'Northern Cape', 'Riemvasmaak', NULL, false),
  ('South Africa', 'Northern Cape', 'Springbok', NULL, true),
  ('South Africa', 'Northern Cape', 'Steinkopf', NULL, false),
  ('South Africa', 'Northern Cape', 'Sutherland', NULL, false),
  ('South Africa', 'Northern Cape', 'Upington', NULL, true),
  ('South Africa', 'Northern Cape', 'Victoria West', NULL, false),
  ('South Africa', 'Northern Cape', 'Vioolsdrift', 'Vioolsdrif', false),
  ('South Africa', 'Northern Cape', 'Warrenton', NULL, false),
  ('South Africa', 'Northern Cape', 'Williston', NULL, false)
ON CONFLICT (country, province, place) DO NOTHING;

-- North West (35 places, 2 hubs)
INSERT INTO public.app_places (country, province, place, alt_name, is_hub) VALUES
  ('South Africa', 'North West', 'Amalia', NULL, false),
  ('South Africa', 'North West', 'Bloemhof', NULL, false),
  ('South Africa', 'North West', 'Bray', NULL, false),
  ('South Africa', 'North West', 'Brits', NULL, false),
  ('South Africa', 'North West', 'Christiana', NULL, false),
  ('South Africa', 'North West', 'Coligny', NULL, false),
  ('South Africa', 'North West', 'Delareyville', NULL, false),
  ('South Africa', 'North West', 'Ganyesa', NULL, false),
  ('South Africa', 'North West', 'Groot Marico', NULL, false),
  ('South Africa', 'North West', 'Hartbeespoort', NULL, false),
  ('South Africa', 'North West', 'Klerksdorp', NULL, false),
  ('South Africa', 'North West', 'Koster', NULL, false),
  ('South Africa', 'North West', 'Leeudoringstad', NULL, false),
  ('South Africa', 'North West', 'Lichtenburg', NULL, false),
  ('South Africa', 'North West', 'Mahikeng', 'Mafikeng', true),
  ('South Africa', 'North West', 'Mankwe', NULL, false),
  ('South Africa', 'North West', 'Marikana', NULL, false),
  ('South Africa', 'North West', 'Mmabatho', NULL, false),
  ('South Africa', 'North West', 'Mogwase', NULL, false),
  ('South Africa', 'North West', 'Orkney', NULL, false),
  ('South Africa', 'North West', 'Ottosdal', NULL, false),
  ('South Africa', 'North West', 'Potchefstroom', NULL, false),
  ('South Africa', 'North West', 'Ramatlabama', NULL, false),
  ('South Africa', 'North West', 'Rustenburg', NULL, true),
  ('South Africa', 'North West', 'Sannieshof', NULL, false),
  ('South Africa', 'North West', 'Schweizer-Reneke', NULL, false),
  ('South Africa', 'North West', 'Skeerpoort', NULL, false),
  ('South Africa', 'North West', 'Stilfontein', NULL, false),
  ('South Africa', 'North West', 'Sun City', NULL, false),
  ('South Africa', 'North West', 'Swartruggens', NULL, false),
  ('South Africa', 'North West', 'Taung', NULL, false),
  ('South Africa', 'North West', 'Ventersdorp', NULL, false),
  ('South Africa', 'North West', 'Vryburg', NULL, false),
  ('South Africa', 'North West', 'Wolmaransstad', NULL, false),
  ('South Africa', 'North West', 'Zeerust', NULL, false)
ON CONFLICT (country, province, place) DO NOTHING;

-- Western Cape (55 places, 3 hubs)
INSERT INTO public.app_places (country, province, place, alt_name, is_hub) VALUES
  ('South Africa', 'Western Cape', 'Barrydale', NULL, false),
  ('South Africa', 'Western Cape', 'Beaufort West', NULL, false),
  ('South Africa', 'Western Cape', 'Bredasdorp', NULL, false),
  ('South Africa', 'Western Cape', 'Caledon', NULL, false),
  ('South Africa', 'Western Cape', 'Calitzdorp', NULL, false),
  ('South Africa', 'Western Cape', 'Cape Town', NULL, true),
  ('South Africa', 'Western Cape', 'Cape Town International Airport', NULL, true),
  ('South Africa', 'Western Cape', 'Ceres', NULL, false),
  ('South Africa', 'Western Cape', 'Citrusdal', NULL, false),
  ('South Africa', 'Western Cape', 'Clanwilliam', NULL, false),
  ('South Africa', 'Western Cape', 'De Rust', NULL, false),
  ('South Africa', 'Western Cape', 'Elgin', NULL, false),
  ('South Africa', 'Western Cape', 'Franschhoek', NULL, false),
  ('South Africa', 'Western Cape', 'Gansbaai', NULL, false),
  ('South Africa', 'Western Cape', 'George', NULL, true),
  ('South Africa', 'Western Cape', 'Heidelberg', NULL, false),
  ('South Africa', 'Western Cape', 'Hermanus', NULL, false),
  ('South Africa', 'Western Cape', 'Hopefield', NULL, false),
  ('South Africa', 'Western Cape', 'Hout Bay', NULL, false),
  ('South Africa', 'Western Cape', 'Kleinmond', NULL, false),
  ('South Africa', 'Western Cape', 'Knysna', NULL, false),
  ('South Africa', 'Western Cape', 'Ladismith', NULL, false),
  ('South Africa', 'Western Cape', 'Laingsburg', NULL, false),
  ('South Africa', 'Western Cape', 'Lamberts Bay', NULL, false),
  ('South Africa', 'Western Cape', 'Langebaan', NULL, false),
  ('South Africa', 'Western Cape', 'Malmesbury', NULL, false),
  ('South Africa', 'Western Cape', 'Matjiesfontein', NULL, false),
  ('South Africa', 'Western Cape', 'Montagu', NULL, false),
  ('South Africa', 'Western Cape', 'Mossel Bay', NULL, false),
  ('South Africa', 'Western Cape', 'Murraysburg', NULL, false),
  ('South Africa', 'Western Cape', 'Oudtshoorn', NULL, false),
  ('South Africa', 'Western Cape', 'Paarl', NULL, false),
  ('South Africa', 'Western Cape', 'Paternoster', NULL, false),
  ('South Africa', 'Western Cape', 'Piketberg', NULL, false),
  ('South Africa', 'Western Cape', 'Plettenberg Bay', NULL, false),
  ('South Africa', 'Western Cape', 'Porterville', NULL, false),
  ('South Africa', 'Western Cape', 'Prince Albert', 'Prins Albert', false),
  ('South Africa', 'Western Cape', 'Riversdale', NULL, false),
  ('South Africa', 'Western Cape', 'Robertson', NULL, false),
  ('South Africa', 'Western Cape', 'Saldanha', NULL, false),
  ('South Africa', 'Western Cape', 'Simon''s Town', NULL, false),
  ('South Africa', 'Western Cape', 'Somerset West', NULL, false),
  ('South Africa', 'Western Cape', 'Stellenbosch', NULL, false),
  ('South Africa', 'Western Cape', 'Still Bay', NULL, false),
  ('South Africa', 'Western Cape', 'Struisbaai', NULL, false),
  ('South Africa', 'Western Cape', 'Swellendam', NULL, false),
  ('South Africa', 'Western Cape', 'Tulbagh', NULL, false),
  ('South Africa', 'Western Cape', 'Uniondale', NULL, false),
  ('South Africa', 'Western Cape', 'Vanrhynsdorp', NULL, false),
  ('South Africa', 'Western Cape', 'Vredendal', NULL, false),
  ('South Africa', 'Western Cape', 'Wellington', NULL, false),
  ('South Africa', 'Western Cape', 'Wilderness', NULL, false),
  ('South Africa', 'Western Cape', 'Worcester', NULL, false),
  ('South Africa', 'Western Cape', 'Wupperthal', NULL, false),
  ('South Africa', 'Western Cape', 'Yzerfontein', NULL, false)
ON CONFLICT (country, province, place) DO NOTHING;


NOTIFY pgrst, 'reload schema';
