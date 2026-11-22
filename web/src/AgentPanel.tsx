import { useState } from "react";
import { CONNECTED_OPTIONS } from "../../shared/schema.ts";

export interface Message {
  role: "user" | "agent" | "error";
  text: string;
}

export interface ModelPick {
  image: string;
  video: string;
}

export function AgentPanel({ messages, busy, onSend }: { messages: Message[]; busy: boolean; onSend: (prompt: string, models: ModelPick) => void }) {
  const [text, setText] = useState("");
  const [models, setModels] = useState<ModelPick>({ image: CONNECTED_OPTIONS.image[0].id, video: CONNECTED_OPTIONS.video[0].id });
  const send = () => {
    if (busy || !text.trim()) return;
    onSend(text.trim(), models);
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
      <div className="models">
        <label>
          이미지 모델
          <select data-testid="agent-image-model" disabled={busy} value={models.image} onChange={(e) => setModels({ ...models, image: e.target.value })}>
            {CONNECTED_OPTIONS.image.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label>
          영상 모델
          <select data-testid="agent-video-model" disabled={busy} value={models.video} onChange={(e) => setModels({ ...models, video: e.target.value })}>
            {CONNECTED_OPTIONS.video.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
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
