# AI Video Studio

만들고 싶은 영상을 설명하면 **기획 → 이미지 → 영상 → 편집 → 모션** 노드가 이어진 그래프가 생기고, 실행하면 mp4가 나오는 로컬 노드 편집기입니다. 유료 API 키 없이 이미 로그인된 구독 CLI와 로컬 ffmpeg만 씁니다.

| 노드 | 하는 일 | 엔진 |
| --- | --- | --- |
| 기획 | 영상 설명 → 장면 목록(이미지 프롬프트·자막·길이) | `claude` CLI (Claude Code 구독) |
| 이미지 | 장면별 이미지 생성 | `codex` CLI의 내장 이미지 생성 (ChatGPT 구독) |
| 영상 | 이미지에 줌 모션을 입힌 클립 | 로컬 ffmpeg |
| 편집 | 클립 이어 붙이기 | 로컬 ffmpeg |
| 모션 | 장면별 자막 오버레이 | 로컬 ffmpeg |

영상 노드는 AI 영상 생성(image-to-video)이 아니라 정지 이미지에 줌 모션을 입히는 방식입니다. 구독 CLI만으로는 AI 영상 생성을 할 수 없기 때문입니다.

## 준비

- Node 24, pnpm, ffmpeg
- `claude` CLI 로그인 (Claude Code)
- `codex` CLI 로그인: `codex login status`가 "Logged in"이어야 합니다

## 실행

```sh
pnpm install
pnpm dev          # API http://localhost:8787 + 웹(주소는 터미널에 표시, 기본 http://localhost:5173)
```

웹 화면 오른쪽 에이전트 패널에 영상을 설명하고 보낸 뒤 "전체 실행"을 누릅니다. 이미지 한 장에 30~60초가 걸립니다. 결과물은 `data/files/`에 저장되고 최종 영상은 `data/files/motion.mp4`입니다.

구독을 쓰지 않고 화면만 시험하려면 mock 모드로 띄웁니다(기획은 고정 3장면, 이미지는 단색).

```sh
PROVIDER_MODE=mock pnpm dev
```

## 검증

```sh
pnpm build                              # 타입체크 + 웹 번들
pnpm test                               # 단위·통합 테스트 (ffmpeg 실제 실행)
PROVIDER_MODE=mock pnpm e2e:pipeline    # 헤드리스 전체 파이프라인 → .e2e-out/final.mp4
PROVIDER_MODE=mock pnpm e2e:ui          # 실제 브라우저 E2E (Playwright)
pnpm smoke:real                         # 실제 claude 기획 1회 + codex 이미지 1장
```

## 구조

- `shared/` — 스키마, 기획→그래프 변환, 비용 추정 (서버·웹 공용)
- `server/` — 실행 엔진, 프로바이더(claude·codex·ffmpeg), HTTP API
- `web/` — 노드 캔버스(`@xyflow/react`)와 에이전트 패널

## 알려진 한계

- 프로젝트는 하나(`data/`)만 다룹니다.
- 산출물 서버가 Range 요청을 지원하지 않아 Safari에서는 영상 미리보기가 재생되지 않을 수 있습니다(Chrome에서 확인됨).
