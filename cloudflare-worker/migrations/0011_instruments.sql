-- Migration 0011: Instrument hierarchy + user instrument fields
-- 3-tier: Section > Archetype > Specific
-- Global defaults (orchestra_id NULL) shared across all orchestras.

CREATE TABLE IF NOT EXISTS instrument_sections (
  id TEXT PRIMARY KEY,
  orchestra_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instrument_archetypes (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES instrument_sections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon_key TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS instrument_specifics (
  id TEXT PRIMARY KEY,
  archetype_id TEXT NOT NULL REFERENCES instrument_archetypes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Custom instrument groupings per orchestra
CREATE TABLE IF NOT EXISTS custom_instrument_groups (
  id TEXT PRIMARY KEY,
  orchestra_id TEXT NOT NULL REFERENCES orchestras(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  instrument_ids TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User instrument assignment + active orchestra
ALTER TABLE users ADD COLUMN instrument_id TEXT;
ALTER TABLE users ADD COLUMN active_orchestra_id TEXT;

CREATE INDEX IF NOT EXISTS idx_archetypes_section ON instrument_archetypes(section_id);
CREATE INDEX IF NOT EXISTS idx_specifics_archetype ON instrument_specifics(archetype_id);
CREATE INDEX IF NOT EXISTS idx_users_instrument ON users(instrument_id);
CREATE INDEX IF NOT EXISTS idx_users_orchestra ON users(active_orchestra_id);
CREATE INDEX IF NOT EXISTS idx_custom_groups_orch ON custom_instrument_groups(orchestra_id);

-- ─── Seed default instrument hierarchy (global, orchestra_id = NULL) ───

-- Sections
INSERT OR IGNORE INTO instrument_sections (id, orchestra_id, name, sort_order) VALUES
  ('sect_horns', NULL, 'Horns', 0),
  ('sect_rhythm', NULL, 'Rhythm Section', 1),
  ('sect_strings', NULL, 'Strings', 2),
  ('sect_vocals', NULL, 'Vocals', 3);

-- Archetypes: Horns
INSERT OR IGNORE INTO instrument_archetypes (id, section_id, name, icon_key, sort_order) VALUES
  ('arch_saxophone', 'sect_horns', 'Saxophone', 'saxophone', 0),
  ('arch_trumpet', 'sect_horns', 'Trumpet', 'trumpet', 1),
  ('arch_trombone', 'sect_horns', 'Trombone', 'trombone', 2),
  ('arch_french_horn', 'sect_horns', 'French Horn', 'french-horn', 3),
  ('arch_tuba', 'sect_horns', 'Tuba', 'tuba', 4),
  ('arch_flute', 'sect_horns', 'Flute', 'flute', 5),
  ('arch_clarinet', 'sect_horns', 'Clarinet', 'clarinet', 6),
  ('arch_oboe', 'sect_horns', 'Oboe', 'oboe', 7);

-- Archetypes: Rhythm Section
INSERT OR IGNORE INTO instrument_archetypes (id, section_id, name, icon_key, sort_order) VALUES
  ('arch_piano', 'sect_rhythm', 'Piano/Keys', 'piano', 0),
  ('arch_guitar', 'sect_rhythm', 'Guitar', 'guitar', 1),
  ('arch_bass', 'sect_rhythm', 'Bass', 'bass', 2),
  ('arch_drums', 'sect_rhythm', 'Drums', 'drums', 3),
  ('arch_percussion', 'sect_rhythm', 'Percussion', 'percussion', 4),
  ('arch_vibraphone', 'sect_rhythm', 'Vibraphone/Mallet', 'vibraphone', 5),
  ('arch_other_rhythm', 'sect_rhythm', 'Other', 'mandolin', 6);

-- Archetypes: Strings
INSERT OR IGNORE INTO instrument_archetypes (id, section_id, name, icon_key, sort_order) VALUES
  ('arch_violin', 'sect_strings', 'Violin', 'violin', 0),
  ('arch_viola', 'sect_strings', 'Viola', 'viola', 1),
  ('arch_cello', 'sect_strings', 'Cello', 'cello', 2),
  ('arch_upright_bass', 'sect_strings', 'Upright Bass', 'upright-bass', 3),
  ('arch_harp', 'sect_strings', 'Harp', 'harp', 4);

-- Archetypes: Vocals
INSERT OR IGNORE INTO instrument_archetypes (id, section_id, name, icon_key, sort_order) VALUES
  ('arch_lead_vocal', 'sect_vocals', 'Lead Vocal', 'mic-vocal', 0),
  ('arch_bg_vocal', 'sect_vocals', 'Background Vocals', 'mic-stand', 1);

-- Specifics: Saxophone
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_alto_sax', 'arch_saxophone', 'Alto Sax', 0),
  ('inst_tenor_sax', 'arch_saxophone', 'Tenor Sax', 1),
  ('inst_bari_sax', 'arch_saxophone', 'Bari Sax', 2),
  ('inst_soprano_sax', 'arch_saxophone', 'Soprano Sax', 3);

-- Specifics: Trumpet
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_trumpet', 'arch_trumpet', 'Trumpet', 0),
  ('inst_flugelhorn', 'arch_trumpet', 'Flugelhorn', 1),
  ('inst_cornet', 'arch_trumpet', 'Cornet', 2),
  ('inst_piccolo_trumpet', 'arch_trumpet', 'Piccolo Trumpet', 3);

-- Specifics: Trombone
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_tenor_trombone', 'arch_trombone', 'Tenor Trombone', 0),
  ('inst_bass_trombone', 'arch_trombone', 'Bass Trombone', 1),
  ('inst_alto_trombone', 'arch_trombone', 'Alto Trombone', 2);

-- Specifics: French Horn
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_french_horn', 'arch_french_horn', 'French Horn', 0),
  ('inst_mellophone', 'arch_french_horn', 'Mellophone', 1);

-- Specifics: Tuba
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_tuba', 'arch_tuba', 'Tuba', 0),
  ('inst_sousaphone', 'arch_tuba', 'Sousaphone', 1),
  ('inst_euphonium', 'arch_tuba', 'Euphonium', 2);

-- Specifics: Flute
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_flute', 'arch_flute', 'Flute', 0),
  ('inst_piccolo', 'arch_flute', 'Piccolo', 1),
  ('inst_alto_flute', 'arch_flute', 'Alto Flute', 2),
  ('inst_bass_flute', 'arch_flute', 'Bass Flute', 3);

-- Specifics: Clarinet
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_bb_clarinet', 'arch_clarinet', 'Bb Clarinet', 0),
  ('inst_bass_clarinet', 'arch_clarinet', 'Bass Clarinet', 1),
  ('inst_eb_clarinet', 'arch_clarinet', 'Eb Clarinet', 2),
  ('inst_alto_clarinet', 'arch_clarinet', 'Alto Clarinet', 3);

-- Specifics: Oboe
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_oboe', 'arch_oboe', 'Oboe', 0),
  ('inst_english_horn', 'arch_oboe', 'English Horn', 1),
  ('inst_bassoon', 'arch_oboe', 'Bassoon', 2);

-- Specifics: Piano/Keys
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_piano', 'arch_piano', 'Acoustic Piano', 0),
  ('inst_rhodes', 'arch_piano', 'Rhodes', 1),
  ('inst_wurlitzer', 'arch_piano', 'Wurlitzer', 2),
  ('inst_synth', 'arch_piano', 'Synth', 3),
  ('inst_organ', 'arch_piano', 'Organ', 4),
  ('inst_harpsichord', 'arch_piano', 'Harpsichord', 5),
  ('inst_clavinet', 'arch_piano', 'Clavinet', 6);

-- Specifics: Guitar
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_electric_guitar', 'arch_guitar', 'Electric Guitar', 0),
  ('inst_acoustic_guitar', 'arch_guitar', 'Acoustic Guitar', 1),
  ('inst_classical_guitar', 'arch_guitar', 'Classical Guitar', 2),
  ('inst_12_string', 'arch_guitar', '12-String Guitar', 3),
  ('inst_pedal_steel', 'arch_guitar', 'Pedal Steel', 4);

-- Specifics: Bass
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_electric_bass', 'arch_bass', 'Electric Bass', 0),
  ('inst_upright_bass_rhythm', 'arch_bass', 'Upright Bass', 1),
  ('inst_5_string_bass', 'arch_bass', '5-String Bass', 2),
  ('inst_fretless_bass', 'arch_bass', 'Fretless Bass', 3);

-- Specifics: Drums
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_drum_kit', 'arch_drums', 'Drum Kit', 0),
  ('inst_electronic_drums', 'arch_drums', 'Electronic Drums', 1);

-- Specifics: Percussion
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_congas', 'arch_percussion', 'Congas', 0),
  ('inst_bongos', 'arch_percussion', 'Bongos', 1),
  ('inst_timbales', 'arch_percussion', 'Timbales', 2),
  ('inst_djembe', 'arch_percussion', 'Djembe', 3),
  ('inst_cajon', 'arch_percussion', 'Cajon', 4),
  ('inst_shaker', 'arch_percussion', 'Shaker/Tambourine', 5);

-- Specifics: Vibraphone/Mallet
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_vibraphone', 'arch_vibraphone', 'Vibraphone', 0),
  ('inst_marimba', 'arch_vibraphone', 'Marimba', 1),
  ('inst_xylophone', 'arch_vibraphone', 'Xylophone', 2),
  ('inst_glockenspiel', 'arch_vibraphone', 'Glockenspiel', 3);

-- Specifics: Other rhythm
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_mandolin', 'arch_other_rhythm', 'Mandolin', 0),
  ('inst_banjo', 'arch_other_rhythm', 'Banjo', 1),
  ('inst_ukulele', 'arch_other_rhythm', 'Ukulele', 2),
  ('inst_lap_steel', 'arch_other_rhythm', 'Lap Steel', 3);

-- Specifics: Strings
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_violin', 'arch_violin', 'Violin', 0),
  ('inst_fiddle', 'arch_violin', 'Fiddle', 1),
  ('inst_viola', 'arch_viola', 'Viola', 0),
  ('inst_cello', 'arch_cello', 'Cello', 0),
  ('inst_upright_bass_strings', 'arch_upright_bass', 'Upright Bass (Classical)', 0),
  ('inst_upright_bass_jazz', 'arch_upright_bass', 'Upright Bass (Jazz)', 1),
  ('inst_concert_harp', 'arch_harp', 'Concert Harp', 0),
  ('inst_celtic_harp', 'arch_harp', 'Celtic Harp', 1);

-- Specifics: Vocals
INSERT OR IGNORE INTO instrument_specifics (id, archetype_id, name, sort_order) VALUES
  ('inst_lead_vocal', 'arch_lead_vocal', 'Lead Vocal', 0),
  ('inst_bg_vocal', 'arch_bg_vocal', 'Background Vocal', 0);
