-- Add editor_json column for storing the visual editor JSON state
ALTER TABLE communication_templates
ADD COLUMN IF NOT EXISTS editor_json jsonb;

-- Add comment for clarity
COMMENT ON COLUMN communication_templates.editor_json IS 'EmailBuilder.js JSON document for WYSIWYG editing';
