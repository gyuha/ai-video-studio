import { useState } from "react";

export interface Message {
  role: "user" | "agent" | "error";
  text: string;
}

export function AgentPanel({ messages, busy, onSend }: { messages: Message[]; busy: boolean; onSend: (prompt: string) => void }) {
  const [text, setText] = useState("");
  const send = () => {
    if (busy || !text.trim()) return;
    onSend(text.trim());
    setText("");
  };
  return (
    <aside className="agent">
      <h2>에이전트</h2>
      <div className="messages" data-testid="messages">
        {messages.length === 0 && <p className="hint">만들고 싶은 영상을 설명하면 기획 → 이미지 → 영상 → 편집 → 모션 노드를 만들어 드려요.</p>}
        {messages.map((m, i) => (
          <p key={i} className={`msg msg-${m.role}`} data-testid={`msg-${m.role}`}>{m.text}</p>
        ))}
        {busy && <p className="msg msg-agent" data-testid="agent-busy">기획하는 중…</p>}
      </div>
      <div className="composer">
        <textarea
          data-testid="agent-input" rows={3} placeholder="예: 겨울 카페 홍보 영상, 장면 3개" value={text} disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button data-testid="agent-send" disabled={busy || !text.trim()} onClick={send}>보내기</button>
      </div>
    </aside>
  );
}
