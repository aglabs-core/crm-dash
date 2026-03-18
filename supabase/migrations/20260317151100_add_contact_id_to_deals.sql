-- Add contact_id to deals table
ALTER TABLE deals ADD COLUMN contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
