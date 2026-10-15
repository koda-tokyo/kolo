// ui/src/kolo-chat-shell.ts
// Kurahi Chat Shell - ChatGPT-style interface

import { LitElement, html, css } from "lit";
import { customElement, state, property } from "lit/decorators.js";

type Role = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
}

@customElement("kolo-chat-shell")
export class KoLoChatShell extends LitElement {
  // Base URL for API - you can override from outside if needed.
  @property({ type: String }) apiBaseUrl: string = "/api";

  // Mock mode for development without backend
  @property({ type: Boolean }) mock = false;

  @state() private messages: ChatMessage[] = [];
  @state() private currentInput = "";
  @state() private isSending = false;
  @state() private engineId: string | null = null;
  @state() private rolePack: string = "personal";
  @state() private error: string | null = null;

  static styles = css`
    :host {
      display: block;
      height: 100vh;
      font-family:
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      color: #0b1020;
      background: #f5f5f7;
    }
    
    .app {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      height: 100%;
    }
    
    .sidebar {
      border-right: 1px solid rgba(0, 0, 0, 0.06);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: #ffffff;
    }
    
    .logo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 16px;
    }
    
    .logo-badge {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: #ff6b35;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 16px;
      font-weight: 700;
    }
    
    .nav-section-title {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(0, 0, 0, 0.45);
      margin-top: 8px;
      margin-bottom: 4px;
    }
    
    .nav-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .nav-item {
      padding: 8px 10px;
      border-radius: 8px;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: rgba(0, 0, 0, 0.7);
    }
    
    .nav-item.active {
      background: #0b1020;
      color: #ffffff;
    }
    
    .nav-item .badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.4);
    }
    
    .select-group {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .select-label {
      font-size: 11px;
      color: rgba(0, 0, 0, 0.5);
    }
    
    select {
      width: 100%;
      border-radius: 8px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      padding: 6px 8px;
      font-size: 12px;
      background: #fafafa;
      outline: none;
    }
    
    .main {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    
    .header {
      padding: 12px 16px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #ffffff;
    }
    
    .header-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    
    .header-title span:first-child {
      font-size: 14px;
      font-weight: 600;
    }
    
    .header-title span:last-child {
      font-size: 12px;
      color: rgba(0, 0, 0, 0.6);
    }
    
    .header-meta {
      font-size: 11px;
      color: rgba(0, 0, 0, 0.5);
      display: flex;
      gap: 12px;
    }
    
    .chat {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    
    .message-row {
      display: flex;
    }
    
    .message-row.user {
      justify-content: flex-end;
    }
    
    .message {
      max-width: 70%;
      padding: 10px 12px;
      border-radius: 14px;
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-wrap;
    }
    
    .message.assistant {
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.06);
      border-radius: 14px;
    }
    
    .message.user {
      background: #0b1020;
      color: #ffffff;
      border-radius: 14px;
    }
    
    .input-bar {
      border-top: 1px solid rgba(0, 0, 0, 0.06);
      padding: 10px 12px;
      background: #ffffff;
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    
    textarea {
      flex: 1;
      min-height: 40px;
      max-height: 120px;
      resize: none;
      border-radius: 10px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      padding: 8px 10px;
      font-size: 13px;
      line-height: 1.4;
      outline: none;
    }
    
    .send-button {
      border-radius: 999px;
      border: none;
      background: #ff6b35;
      color: #ffffff;
      font-size: 13px;
      padding: 8px 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      opacity: 1;
      transition: opacity 0.15s ease;
    }
    
    .send-button[disabled] {
      opacity: 0.4;
      cursor: default;
    }
    
    .error {
      padding: 4px 8px;
      font-size: 11px;
      color: #a40000;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    // Welcome message from Kurahi
    if (this.messages.length === 0) {
      const now = new Date().toISOString();
      this.messages = [
        {
          id: "welcome",
          role: "assistant",
          content: "こんにちは、Kurahiです。今日いちばん助けてほしいことを一つ教えてください。",
          createdAt: now,
        },
      ];
    }
  }

  private handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    this.currentInput = target.value;
  }

  private async sendMessage() {
    if (!this.currentInput.trim() || this.isSending) return;

    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: this.currentInput.trim(),
      createdAt: new Date().toISOString(),
    };

    this.messages = [...this.messages, userMessage];
    this.currentInput = "";
    this.isSending = true;
    this.error = null;

    // Mock mode - no backend needed
    if (this.mock) {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
      const mockResponses = [
        `承知しました。「${userMessage.content}」についてお手伝いします。`,
        `なるほど、「${userMessage.content}」ですね。一緒に考えましょう。`,
        `「${userMessage.content}」について、いくつかの選択肢があります。`,
        `はい、Kurahiがお手伝いします。「${userMessage.content}」について詳しく教えてください。`,
      ];
      const assistantMessage: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: `（デモモード）${mockResponses[Math.floor(Math.random() * mockResponses.length)]}`,
        createdAt: new Date().toISOString(),
      };
      this.messages = [...this.messages, assistantMessage];
      this.isSending = false;
      return;
    }

    try {
      const body = {
        messages: this.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        rolePack: this.rolePack,
        engineId: this.engineId,
      };

      const res = await fetch(`${this.apiBaseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const content: string = data.message?.content ?? String(data.content ?? "");

      const assistantMessage: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content,
        createdAt: new Date().toISOString(),
      };

      this.messages = [...this.messages, assistantMessage];
    } catch (err) {
      console.error("KoLo chat error", err);
      this.error = "送信中にエラーが発生しました。少し時間をおいてから再度お試しください。";
    } finally {
      this.isSending = false;
    }
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
    }
  }

  private setRolePack(role: string) {
    this.rolePack = role;
  }

  render() {
    return html`
      <div class="app">
        <aside class="sidebar">
          <div class="logo">
            <div class="logo-badge">Ko</div>
            <div>
              <div>Kurahi</div>
              <div style="font-size: 11px; color: rgba(0,0,0,0.5);">
                Kurahi
              </div>
            </div>
          </div>

          <div>
            <div class="nav-section-title">NAVIGATION</div>
            <div class="nav-list">
              <div class="nav-item active">
                <span>Chat</span>
                <span class="badge">Now</span>
              </div>
              <div class="nav-item">
                <span>Today</span>
                <span class="badge">Soon</span>
              </div>
              <div class="nav-item">
                <span>Inbox</span>
                <span class="badge">Soon</span>
              </div>
              <div class="nav-item">
                <span>Family</span>
                <span class="badge">Soon</span>
              </div>
            </div>
          </div>

          <div class="select-group">
            <div class="select-label">Role</div>
            <select
              @change=${(e: Event) => this.setRolePack((e.target as HTMLSelectElement).value)}
            >
              <option value="personal">Personal Kurahi</option>
              <option value="business">Business Kurahi</option>
            </select>
          </div>

          <div class="select-group">
            <div class="select-label">Engine</div>
            <select disabled>
              <option>Default Engine</option>
            </select>
          </div>
        </aside>

        <section class="main">
          <header class="header">
            <div class="header-title">
              <span>Kurahi Chat</span>
              <span>小さなAIチームと話す場所です。</span>
            </div>
            <div class="header-meta">
              ${
                this.mock
                  ? html`
                      <span style="color: #ff6b35">デモモード</span>
                    `
                  : null
              }
              <span>Role: ${this.rolePack}</span>
              <span>Messages: ${this.messages.length}</span>
            </div>
          </header>

          <div class="chat">
            ${this.messages.map(
              (m) => html`
                <div class="message-row ${m.role}">
                  <div class="message ${m.role}">${m.content}</div>
                </div>
              `,
            )}
          </div>

          <div class="input-bar">
            <textarea
              .value=${this.currentInput}
              @input=${this.handleInput}
              @keydown=${this.handleKeyDown}
              placeholder="Kurahiに話しかけてください。Shift+Enterで改行します。"
            ></textarea>
            <button
              class="send-button"
              @click=${this.sendMessage}
              ?disabled=${this.isSending || !this.currentInput.trim()}
            >
              <span>送信</span>
            </button>
          </div>
          ${this.error ? html`<div class="error">${this.error}</div>` : null}
        </section>
      </div>
    `;
  }
}
