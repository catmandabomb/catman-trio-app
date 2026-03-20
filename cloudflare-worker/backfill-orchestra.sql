-- Backfill: Create Catman Trio orchestra and assign all existing users + data

-- Create the orchestra with cat (owner) as conductr
INSERT INTO orchestras (id, name, description, genres, conductr_id)
VALUES ('orch_001', 'Catman Trio', 'The original Catman Trio band', '["Jazz","Blues","Funk"]', '61bed45e45edc673');

-- Add all 5 users as members
INSERT INTO orchestra_members (orchestra_id, user_id) VALUES ('orch_001', '61bed45e45edc673');
INSERT INTO orchestra_members (orchestra_id, user_id) VALUES ('orch_001', 'ae48df11477ef50b');
INSERT INTO orchestra_members (orchestra_id, user_id) VALUES ('orch_001', 'cd21e16ada7137c7');
INSERT INTO orchestra_members (orchestra_id, user_id) VALUES ('orch_001', '740770bbcccea03f');
INSERT INTO orchestra_members (orchestra_id, user_id) VALUES ('orch_001', 'c45744b3a3e9fb47');

-- Backfill orchestra_id on all data tables
UPDATE songs SET orchestra_id = 'orch_001' WHERE orchestra_id IS NULL;
UPDATE setlists SET orchestra_id = 'orch_001' WHERE orchestra_id IS NULL;
UPDATE practice_lists SET orchestra_id = 'orch_001' WHERE orchestra_id IS NULL;
UPDATE wiki_charts SET orchestra_id = 'orch_001' WHERE orchestra_id IS NULL;
UPDATE files SET orchestra_id = 'orch_001' WHERE orchestra_id IS NULL;
