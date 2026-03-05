BEGIN;

-- 1) DEDUPE CONTACTS (organization_id + phone)
WITH ranked_contacts AS (
  SELECT
    id,
    organization_id,
    phone,
    created_at,
    first_value(id) OVER (
      PARTITION BY organization_id, phone
      ORDER BY created_at ASC, id ASC
    ) AS keeper_id,
    row_number() OVER (
      PARTITION BY organization_id, phone
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM contacts
),
to_merge_contacts AS (
  SELECT id, keeper_id
  FROM ranked_contacts
  WHERE rn > 1
)
UPDATE conversations c
SET contact_id = t.keeper_id
FROM to_merge_contacts t
WHERE c.contact_id = t.id;

WITH ranked_contacts AS (
  SELECT
    id,
    organization_id,
    phone,
    created_at,
    first_value(id) OVER (
      PARTITION BY organization_id, phone
      ORDER BY created_at ASC, id ASC
    ) AS keeper_id,
    row_number() OVER (
      PARTITION BY organization_id, phone
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM contacts
),
to_merge_contacts AS (
  SELECT id, keeper_id
  FROM ranked_contacts
  WHERE rn > 1
)
UPDATE reservations r
SET contact_id = t.keeper_id
FROM to_merge_contacts t
WHERE r.contact_id = t.id;

WITH ranked_contacts AS (
  SELECT
    id,
    organization_id,
    phone,
    created_at,
    first_value(id) OVER (
      PARTITION BY organization_id, phone
      ORDER BY created_at ASC, id ASC
    ) AS keeper_id,
    row_number() OVER (
      PARTITION BY organization_id, phone
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM contacts
),
to_merge_contacts AS (
  SELECT id, keeper_id
  FROM ranked_contacts
  WHERE rn > 1
)
DELETE FROM contacts c
USING to_merge_contacts t
WHERE c.id = t.id;

-- 2) DEDUPE CONVERSATIONS (contact_id + whatsapp_session_id)
WITH ranked_conversations AS (
  SELECT
    id,
    contact_id,
    whatsapp_session_id,
    created_at,
    first_value(id) OVER (
      PARTITION BY contact_id, whatsapp_session_id
      ORDER BY created_at ASC, id ASC
    ) AS keeper_id,
    row_number() OVER (
      PARTITION BY contact_id, whatsapp_session_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM conversations
),
to_merge_conversations AS (
  SELECT id, keeper_id
  FROM ranked_conversations
  WHERE rn > 1
)
UPDATE messages m
SET conversation_id = t.keeper_id
FROM to_merge_conversations t
WHERE m.conversation_id = t.id;

WITH ranked_conversations AS (
  SELECT
    id,
    contact_id,
    whatsapp_session_id,
    created_at,
    first_value(id) OVER (
      PARTITION BY contact_id, whatsapp_session_id
      ORDER BY created_at ASC, id ASC
    ) AS keeper_id,
    row_number() OVER (
      PARTITION BY contact_id, whatsapp_session_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM conversations
),
to_merge_conversations AS (
  SELECT id, keeper_id
  FROM ranked_conversations
  WHERE rn > 1
)
UPDATE orchestration_logs l
SET conversation_id = t.keeper_id
FROM to_merge_conversations t
WHERE l.conversation_id = t.id;

WITH ranked_conversations AS (
  SELECT
    id,
    contact_id,
    whatsapp_session_id,
    created_at,
    first_value(id) OVER (
      PARTITION BY contact_id, whatsapp_session_id
      ORDER BY created_at ASC, id ASC
    ) AS keeper_id,
    row_number() OVER (
      PARTITION BY contact_id, whatsapp_session_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM conversations
),
to_merge_conversations AS (
  SELECT id, keeper_id
  FROM ranked_conversations
  WHERE rn > 1
)
DELETE FROM conversations c
USING to_merge_conversations t
WHERE c.id = t.id;

-- 3) GUARANTEE UNIQUENESS FROM NOW ON
CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_phone_idx
  ON contacts (organization_id, phone);

CREATE UNIQUE INDEX IF NOT EXISTS conversations_contact_session_unique_idx
  ON conversations (contact_id, whatsapp_session_id);

COMMIT;
