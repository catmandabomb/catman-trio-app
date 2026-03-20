-- Add difficulty rating (1-5) to songs
ALTER TABLE songs ADD COLUMN difficulty INTEGER DEFAULT NULL;
