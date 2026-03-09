"use client";

import { useState } from "react";
import { Pencil, Loader2 } from "lucide-react";
import { updateConversationContactData } from "@/app/actions/messages";
import { useRouter } from "next/navigation";

interface ConversationHeaderContactProps {
  conversationId: string;
  contactName: string;
  contactPhone: string;
}

export function ConversationHeaderContact({
  conversationId,
  contactName,
  contactPhone,
}: ConversationHeaderContactProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(contactName);
  const [saving, setSaving] = useState(false);

  async function saveName() {
    const nextName = value.trim();
    if (!nextName || nextName === contactName) {
      setIsEditing(false);
      setValue(contactName);
      return;
    }

    setSaving(true);
    try {
      await updateConversationContactData(conversationId, { name: nextName });
      setIsEditing(false);
      router.refresh();
    } catch {
      setValue(contactName);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {isEditing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveName();
              }
              if (event.key === "Escape") {
                setValue(contactName);
                setIsEditing(false);
              }
            }}
            disabled={saving}
            className="h-8 rounded-md border border-[var(--brand-muted)]/35 bg-white px-2 text-base font-medium text-[var(--brand-deep)] outline-none focus:border-[var(--brand-primary)]"
          />
          {saving ? <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-muted)]" /> : null}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <h1
            className="font-medium text-[var(--brand-deep)]"
            onDoubleClick={() => setIsEditing(true)}
            title="Duplo clique para editar"
          >
            {contactName}
          </h1>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded p-1 text-[var(--brand-muted)] transition-colors hover:bg-[var(--brand-primary)]/10 hover:text-[var(--brand-deep)]"
            title="Editar nome"
            aria-label="Editar nome"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <p className="text-xs text-[var(--brand-muted)]">{contactPhone}</p>
    </div>
  );
}

