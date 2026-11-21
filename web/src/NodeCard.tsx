import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { createContext, useContext, useMemo } from "react";
import { estimateCost } from "../../shared/cost.ts";
import type { GraphNode, NodeType } from "../../shared/schema.ts";
import { fileUrl } from "./api.ts";

export type CardNode = Node<{ node: GraphNode }, "card">;

export const TYPE_META: Record<NodeType, { name: string; icon: string }> = {
  plan: { name: "기획", icon: "✎" },
  image: { name: "이미지", icon: "▣" },
  video: { name: "영상", icon: "▶" },
  edit: { name: "편집", icon: "✂" },
  motion: { name: "모션", icon: "✦" },
};

const STATUS_LABEL = { idle: "대기", running: "실행 중", done: "완료", error: "오류" } as const;

export interface Studio {
  /** 실행 중이거나 에이전트가 일하는 동안에는 편집·실행을 막는다. */
  locked: boolean;
  update: (id: string, data: GraphNode["data"]) => void;
  commit: () => void;
  run: (id: string) => void;
  remove: (id: string) => void;
  agent: (prompt: string) => void;
}
export const StudioContext = createContext<Studio>(null!);

function Fields({ node }: { node: GraphNode }) {
  const { locked, update, commit } = useContext(StudioContext);
  switch (node.type) {
    case "plan":
      return (
        <textarea
          className="nodrag" data-testid="field" rows={3} placeholder="만들고 싶은 영상을 설명하세요" disabled={locked}
          value={node.data.prompt} onChange={(e) => update(node.id, { prompt: e.target.value })} onBlur={commit}
        />
      );
    case "image":
      return (
        <textarea
          className="nodrag" data-testid="field" rows={4} placeholder="이미지 프롬프트" disabled={locked}
          value={node.data.imagePrompt} onChange={(e) => update(node.id, { imagePrompt: e.target.value })} onBlur={commit}
        />
      );
    case "video":
      return (
        <label className="inline">
          길이(초)
          <input
            className="nodrag" data-testid="field" type="number" min={1} max={30} step={0.5} disabled={locked}
            value={node.data.durationSec} onChange={(e) => update(node.id, { durationSec: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })} onBlur={commit}
          />
        </label>
      );
    case "edit":
      return <p className="hint">연결된 영상 클립을 순서대로 이어 붙입니다.</p>;
    case "motion":
      if (node.data.captions.length === 0) return <p className="hint">자막이 없습니다. 에이전트로 만든 그래프에는 장면별 자막이 들어옵니다.</p>;
      return (
        <>
          {node.data.captions.map((c, i) => (
            <label className="caption" key={i}>
              <span>{c.startSec}–{c.endSec}초</span>
              <input
                className="nodrag" data-testid="field" disabled={locked} value={c.text} onBlur={commit}
                onChange={(e) => update(node.id, { captions: node.data.captions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
              />
            </label>
          ))}
        </>
      );
  }
}

function Preview({ node }: { node: GraphNode }) {
  // 다시 실행하면 같은 경로의 파일이 바뀌므로, 완료될 때마다 주소를 새로 만든다.
  const version = useMemo(() => Date.now(), [node.status]);
  if (node.status !== "done" || !node.output) return null;
  if (node.output.plan) {
    return (
      <ol className="scenes" data-testid="preview">
        {node.output.plan.scenes.map((s) => (
          <li key={s.id}>{s.caption} <span>{s.durationSec}초</span></li>
        ))}
      </ol>
    );
  }
  if (!node.output.path) return null;
  const src = `${fileUrl(node.output.path)}?v=${version}`;
  return node.type === "image"
    ? <img data-testid="preview" src={src} alt="생성된 이미지" />
    : <video className="nodrag" data-testid="preview" src={src} controls muted playsInline />;
}

export function NodeCard({ data }: NodeProps<CardNode>) {
  const { node } = data;
  const { locked, run, remove, agent } = useContext(StudioContext);
  const meta = TYPE_META[node.type];
  const cost = estimateCost(node);
  return (
    <div className={`card card-${node.type}`} data-testid="node" data-type={node.type} data-status={node.status}>
      {node.type !== "plan" && <Handle type="target" position={Position.Left} />}
      <header>
        <span className="icon">{meta.icon}</span>
        <strong>{meta.name}</strong>
        <span className={`status status-${node.status}`} data-testid="status">{STATUS_LABEL[node.status]}</span>
        <button className="nodrag ghost" title="노드 삭제" aria-label="노드 삭제" data-testid="delete" disabled={locked} onClick={() => remove(node.id)}>×</button>
      </header>
      <Fields node={node} />
      {node.error && <p className="error" data-testid="error">{node.error}</p>}
      <Preview node={node} />
      <footer>
        <span className="cost" data-testid="cost" title={cost.unit}>{cost.label} · {cost.unit}</span>
        {node.type === "plan" ? (
          <button className="nodrag" data-testid="run" disabled={locked || !node.data.prompt.trim()} onClick={() => agent(node.data.prompt)}>그래프 만들기</button>
        ) : (
          <button className="nodrag" data-testid="run" disabled={locked} onClick={() => run(node.id)}>실행</button>
        )}
      </footer>
      {node.type !== "motion" && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
