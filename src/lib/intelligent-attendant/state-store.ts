import type { ConversationState, ConversationStateStore } from "./types";

export class InMemoryConversationStateStore implements ConversationStateStore {
  private readonly data = new Map<string, ConversationState>();

  async getByPhone(phone: string): Promise<ConversationState | null> {
    return this.data.get(phone) ?? null;
  }

  async save(state: ConversationState): Promise<void> {
    this.data.set(state.phone, state);
  }
}
