import { getToken, getStoredProfile } from "./api.js";

export const CHAT_PRESET_LABELS = {
  ready_now: "Ready to trade now!",
  give_me_a_few_minutes: "Give me a few minutes.",
  whats_your_roblox_username: "What's your Roblox username?",
  added_you_ingame: "I've added you in-game.",
  sending_trade_request: "Sending the trade request now.",
  trade_complete_on_my_end: "Trade complete on my end!",
  cant_find_you_ingame: "Having trouble finding you in-game.",
  can_we_reschedule: "Can we reschedule?",
};

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Mounts a chat panel into `container`. Renders its own markup entirely —
// caller just needs an empty container element. Preset-only messages: no
// free text, so there's nothing to moderate for scams/harassment/contact
// sharing. contextType is "offer" or "commission".
export async function mountChatPanel(container, contextType, contextId) {
  const myProfile = getStoredProfile();
  container.innerHTML = `<div class="chat-panel">
    <div class="chat-counterparty" id="chat-counterparty-${contextId}"></div>
    <div class="chat-messages" id="chat-messages-${contextId}"><p class="hint">Loading...</p></div>
    <div class="chat-presets" id="chat-presets-${contextId}"></div>
  </div>`;

  const counterpartyEl = container.querySelector(`#chat-counterparty-${contextId}`);
  const messagesEl = container.querySelector(`#chat-messages-${contextId}`);
  const presetsEl = container.querySelector(`#chat-presets-${contextId}`);

  presetsEl.innerHTML = Object.entries(CHAT_PRESET_LABELS)
    .map(([key, label]) => `<button data-preset="${key}">${label}</button>`)
    .join("");

  presetsEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const res = await fetch("/.netlify/functions/chat-send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ context_type: contextType, context_id: contextId, preset_key: btn.dataset.preset }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't send message");
        await loadMessages();
      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  async function loadMessages() {
    try {
      const res = await fetch(
        `/.netlify/functions/chat-list?context_type=${contextType}&context_id=${contextId}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load messages");

      if (data.counterparty) {
        const cp = data.counterparty;
        counterpartyEl.innerHTML = `
          <img src="${cp.rbx_avatar_url || ""}" alt="" onerror="this.style.visibility='hidden'">
          <div class="cp-info">
            <div class="cp-name">${escapeHtml(cp.display_name)}</div>
            <div class="cp-rbx">Roblox: <strong>${escapeHtml(cp.rbx_username)}</strong></div>
          </div>
          <a href="https://www.roblox.com/users/${cp.rbx_user_id}/profile" target="_blank" rel="noopener" class="btn-sm accept">Add Friend on Roblox ↗</a>
        `;
      }

      if (!data.messages.length) {
        messagesEl.innerHTML = `<p class="hint">No messages yet — use a quick reply below to say hello.</p>`;
        return;
      }

      messagesEl.innerHTML = data.messages
        .map((m) => {
          const isMe = myProfile && m.sender_profile_id === myProfile.id;
          const label = CHAT_PRESET_LABELS[m.preset_key] || m.preset_key;
          const who = isMe ? "You" : m.profiles?.display_name || "them";
          return `<div class="chat-bubble ${isMe ? "me" : ""}">
            <span class="chat-sender">${escapeHtml(who)}</span>
            <span class="chat-text">${escapeHtml(label)}</span>
          </div>`;
        })
        .join("");
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch (err) {
      messagesEl.innerHTML = `<p class="hint">Couldn't load messages.</p>`;
    }
  }

  await loadMessages();
}
