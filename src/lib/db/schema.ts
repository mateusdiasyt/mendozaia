import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  jsonb,
  integer,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ==================== AUTH (NextAuth/Auth.js compatible) ====================

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compositePk: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  })
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compositePk: primaryKey({
      columns: [vt.identifier, vt.token],
    }),
  })
);

// ==================== ORGANIZAÇÕES ====================

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  plan: text("plan").default("free").notNull(),
  status: text("status").default("active").notNull(), // active, suspended, cancelled
  settings: jsonb("settings").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // admin, member, viewer
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.organizationId] }),
    uniqueIndex("memberships_user_org_idx").on(t.userId, t.organizationId),
  ]
);

// ==================== ETIQUETAS ====================

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").default("#6366f1"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ==================== CONTATOS ====================

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(),
  name: text("name"),
  email: text("email"),
  customFields: jsonb("custom_fields").$type<Record<string, string>>(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Memórias extraídas pela IA sobre o contato (nome, preferências, etc.) */
export const contactMemories = pgTable(
  "contact_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // ex: "name", "email", "preferences"
    value: text("value").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("contact_memories_contact_key_idx").on(t.contactId, t.key)]
);

export const contactTags = pgTable(
  "contact_tags",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] })]
);

// ==================== SESSÕES WHATSAPP ====================

export const whatsappSessions = pgTable("whatsapp_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull().unique(),
  name: text("name"),
  status: text("status").default("disconnected").notNull(), // disconnected, connecting, connected
  phoneNumber: text("phone_number"),
  qrCode: text("qr_code"),
  lastConnectedAt: timestamp("last_connected_at"),
  vpsApiUrl: text("vps_api_url"),
  webhookSecret: text("webhook_secret"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ==================== CONVERSAS E MENSAGENS ====================

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  whatsappSessionId: uuid("whatsapp_session_id")
    .notNull()
    .references(() => whatsappSessions.id, { onDelete: "cascade" }),
  pipelineStage: text("pipeline_stage").default("inbox"), // inbox, qualified, proposal, negotiation, closed_won, closed_lost
  assignedToId: text("assigned_to_id").references(() => users.id, {
    onDelete: "set null",
  }),
  lastMessageAt: timestamp("last_message_at"),
  lastMessagePreview: text("last_message_preview"),
  unreadCount: integer("unread_count").default(0).notNull(),
  isArchived: boolean("is_archived").default(false).notNull(),
  /** Quando preenchido, a IA não responde nesta conversa até esta data/hora */
  aiDisabledUntil: timestamp("ai_disabled_until", { mode: "date" }),
  /** Última vez que o contato estava digitando (para mostrar "digitando...") */
  contactTypingAt: timestamp("contact_typing_at", { mode: "date" }),
  /** Estado da conversa para orquestração: init, collecting_info, awaiting_system, ready_to_confirm, waiting_human, human_active, closed */
  conversationState: text("conversation_state").default("init"),
  /** Motivo do handoff para humano */
  handoffReason: text("handoff_reason"),
  /** Quando foi feito o handoff */
  handoffAt: timestamp("handoff_at", { mode: "date" }),
  /** Prioridade (conversa aguardando humano) */
  isPriority: boolean("is_priority").default(false).notNull(),
  /** Metadados extras do estado (json) */
  conversationStateMetadata: jsonb("conversation_state_metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  waMessageId: text("wa_message_id"),
  direction: text("direction").notNull(), // inbound, outbound
  contentType: text("content_type").default("text").notNull(), // text, image, audio, video, document
  content: text("content"),
  mediaUrl: text("media_url"),
  status: text("status").default("sent"), // sent, delivered, read, failed
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ==================== RESERVAS ====================

export const reservations = pgTable("reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, {
    onDelete: "set null",
  }),
  /** Início da reserva */
  startAt: timestamp("start_at", { mode: "date" }).notNull(),
  /** Duração em minutos (padrão 60) */
  durationMinutes: integer("duration_minutes").default(60).notNull(),
  status: text("status").default("confirmed").notNull(), // pending, confirmed, cancelled
  source: text("source").default("manual").notNull(), // manual, ai
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ==================== REGRAS DE AUTOMAÇÃO ====================
// Estrutura: Gatilho → Condição → Ação
// Modular para expansão futura (construtor visual, IA, integrações)

export const automationRules = pgTable("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),

  // Gatilho: quando a regra é avaliada
  triggerType: text("trigger_type").notNull(),
  // message_received | no_reply_timeout

  // Condição: filtro para executar ou não (condition_type=none = sempre)
  conditionType: text("condition_type").notNull().default("none"),
  // none | keyword_contains | outside_business_hours | minutes_without_reply
  conditionValue: jsonb("condition_value").$type<Record<string, unknown>>(),

  // Ação: o que executar
  actionType: text("action_type").notNull(),
  // reply | add_tag | assign_to_human
  actionPayload: jsonb("action_payload").$type<Record<string, unknown>>(),

  isActive: boolean("is_active").default(true).notNull(),
  priority: integer("priority").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ==================== LOGS DE ORQUESTRAÇÃO ====================

export const orchestrationLogs = pgTable("orchestration_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  event: text("event").notNull(), // state_change, decision, tool_used, ai_called, handoff, etc.
  stateBefore: text("state_before"),
  stateAfter: text("state_after"),
  decision: text("decision"), // ai_respond | human_only | silence | tool_first
  reason: text("reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ==================== TABELAS DE SISTEMA (Admin) ====================
// Organizações são os "clientes" do dono da plataforma
