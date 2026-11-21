import { addEdge, Background, Controls, ReactFlow, type Edge, type OnConnect, type OnEdgesChange, type OnNodesChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { estimateGraphCost } from "../../shared/cost.ts";
import { NODE_TYPES, type Graph, type GraphNode, type NodeType } from "../../shared/schema.ts";
import { AgentPanel, type Message } from "./AgentPanel.tsx";
import { api, ApiError, type State } from "./api.ts";
import { NodeCard, StudioContext, TYPE_META, type CardNode, type Studio } from "./NodeCard.tsx";
import "./style.css";

const nodeTypes = { card: NodeCard };

const DEFAULT_DATA: { [T in NodeType]: Extract<GraphNode, { type: T }>["data"] } = {
  plan: { prompt: "" },
  image: { imagePrompt: "" },
  video: { durationSec: 3 },
  edit: {},
  motion: { captions: [] },
};

const toGraph = (nodes: CardNode[], edges: Edge[]): Graph => ({
  nodes: nodes.map((n) => ({ ...n.data.node, position: n.position })),
  edges: edges.map(({ id, source, target }) => ({ id, source, target })),
});

export function App() {
  const [nodes, setNodes] = useState<CardNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [running, setRunning] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(0); // 올릴 때마다 현재 그래프를 서버에 저장한다
  const [layout, setLayout] = useState(0); // 올릴 때마다 캔버스를 화면에 다시 맞춘다
  const locked = running || agentBusy;

  const load = useCallback((state: State) => {
    setNodes((prev) => state.graph.nodes.map((node) => ({ id: node.id, type: "card", position: node.position, data: { node }, selected: prev.find((p) => p.id === node.id)?.selected })));
    setEdges((prev) => state.graph.edges.map((e) => ({ ...e, selected: prev.find((p) => p.id === e.id)?.selected })));
    setRunning(state.running);
  }, []);
  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  useEffect(() => {
    api.state().then((s) => { load(s); setLayout((n) => n + 1); }, fail);
  }, [load]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => api.state().then(load, fail), 700);
    return () => clearInterval(timer);
  }, [running, load]);

  useEffect(() => {
    if (dirty === 0) return;
    // 실행 직전에 같은 내용을 이미 저장하므로, 실행 중이라 거절된(409) 저장은 무시해도 잃는 것이 없다.
    api.save(toGraph(nodes, edges)).catch((err) => { if (!(err instanceof ApiError && err.status === 409)) fail(err); });
  }, [dirty]);
  const commit = useCallback(() => setDirty((n) => n + 1), []);

  const onNodesChange: OnNodesChange<CardNode> = useCallback((changes) => setNodes((prev) => changes.applyTo(prev)), []);
  const onEdgesChange: OnEdgesChange = useCallback((changes) => setEdges((prev) => changes.applyTo(prev)), []);
  const onConnect: OnConnect = useCallback((c) => {
    setEdges((prev) => addEdge({ ...c, id: `${c.source}->${c.target}` }, prev));
    commit();
  }, [commit]);

  const start = async (run: () => Promise<State>) => {
    setError("");
    try {
      await api.save(toGraph(nodes, edges));
      load(await run());
    } catch (err) {
      fail(err);
    }
  };

  const agent = async (prompt: string) => {
    setError("");
    setAgentBusy(true);
    setMessages((prev) => [...prev, { role: "user", text: prompt }]);
    try {
      const state = await api.agent(prompt);
      load(state);
      setLayout((n) => n + 1);
      const plan = state.graph.nodes.find((n) => n.type === "plan")?.output?.plan;
      setMessages((prev) => [...prev, { role: "agent", text: `「${plan?.title}」 기획으로 장면 ${plan?.scenes.length}개, 노드 ${state.graph.nodes.length}개를 만들었어요. "전체 실행"을 누르면 영상이 만들어집니다.` }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "error", text: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setAgentBusy(false);
    }
  };

  const addNode = (type: NodeType) => {
    const node = { id: `${type}-${Date.now().toString(36)}`, type, position: { x: 80 + nodes.length * 30, y: 80 + nodes.length * 30 }, status: "idle", data: DEFAULT_DATA[type] } as GraphNode;
    setNodes((prev) => [...prev, { id: node.id, type: "card", position: node.position, data: { node } }]);
    commit();
  };

  const studio: Studio = {
    locked,
    commit,
    agent,
    update: (id, data) => setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { node: { ...n.data.node, data } as GraphNode } } : n))),
    run: (id) => start(() => api.runNode(id)),
    remove: (id) => {
      setNodes((prev) => prev.filter((n) => n.id !== id));
      setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
      commit();
    },
  };

  const cost = useMemo(() => estimateGraphCost(toGraph(nodes, edges)), [nodes, edges]);
  const pending = nodes.filter((n) => n.data.node.status !== "done").length;

  return (
    <StudioContext.Provider value={studio}>
      <div className="app">
        <header className="toolbar">
          <h1>AI Video Studio</h1>
          <nav>
            {NODE_TYPES.map((type) => (
              <button key={type} className={`add add-${type}`} data-testid={`add-${type}`} disabled={locked} onClick={() => addNode(type)}>
                {TYPE_META[type].icon} {TYPE_META[type].name}
              </button>
            ))}
          </nav>
          <span className="total" data-testid="total-cost" title={Object.entries(cost.units).map(([unit, n]) => `${unit} × ${n}`).join("\n")}>
            예상 비용 {cost.krw.toLocaleString()}원 · 노드 {nodes.length}개
          </span>
          <button className="primary" data-testid="run-all" disabled={locked || pending === 0} onClick={() => start(api.runAll)}>
            {running ? "실행 중…" : "전체 실행"}
          </button>
        </header>
        {error && <p className="banner" data-testid="banner" onClick={() => setError("")}>{error}</p>}
        <main>
          <ReactFlow
            key={layout} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.2}
            nodesDraggable={!locked} nodesConnectable={!locked} elementsSelectable={!locked}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeDragStop={commit} onNodesDelete={commit} onEdgesDelete={commit}
          >
            <Background gap={24} />
            <Controls />
          </ReactFlow>
        </main>
        <AgentPanel messages={messages} busy={agentBusy} onSend={agent} />
      </div>
    </StudioContext.Provider>
  );
}
