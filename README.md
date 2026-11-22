# AI Video Studio

만들고 싶은 영상을 설명하면 **기획 → 이미지 → 영상 → 편집 → 모션** 노드가 이어진 그래프가 생기고, 실행하면 mp4가 나오는 로컬 노드 편집기입니다. 기본 경로는 이미 로그인된 구독 CLI와 로컬 ffmpeg만 씁니다. 선택하면 로컬 Draw Things 앱으로 이미지와 영상도 만들 수 있습니다.

| 노드 | 하는 일 | 기본 엔진 | 선택할 수 있는 엔진 |
| --- | --- | --- | --- |
| 기획 | 영상 설명 → 장면 목록(이미지 프롬프트·자막·길이) | `claude` CLI (Claude Code 구독) | — |
| 이미지 | 장면별 이미지 생성 | `codex` CLI의 내장 이미지 생성 (ChatGPT 구독) | Draw Things 이미지 (로컬) |
| 영상 | 장면 클립 만들기 | ffmpeg 줌 (정지 이미지에 줌 모션) | Draw Things MiniMax H3 (로컬, 텍스트→영상) |
| 편집 | 클립 이어 붙이기 | 로컬 ffmpeg | — |
| 모션 | 장면별 자막 오버레이 | 로컬 ffmpeg | — |

기획 때 이미지·영상 모델의 기본값을 하나씩 정하고, 노드마다 따로 바꿀 수 있습니다. 모델을 바꾸면 그 노드와 뒤 노드는 대기 상태로 돌아가고, 옛 결과 파일은 남습니다. 선택한 엔진이 실행되지 않으면 노드를 오류로 멈추며, 다른 엔진으로 자동 대체하지 않습니다.

## 준비

- Node 24, pnpm, ffmpeg
- `claude` CLI 로그인 (Claude Code)
- `codex` CLI 로그인: `codex login status`가 "Logged in"이어야 합니다
- (선택) Draw Things 앱 — 아래 "Draw Things 연결" 참고

## 실행

```sh
pnpm install
pnpm dev          # API http://localhost:18787 + 웹 http://localhost:15173
```

웹 화면 오른쪽 에이전트 패널에서 이미지·영상 모델을 고르고 영상을 설명해 보냅니다. 그다음 "전체 실행"을 누릅니다. 구독 CLI로 만든 이미지 한 장에는 30~60초가 걸립니다. 결과물은 `data/files/`에 저장되고 최종 영상은 `data/files/motion.mp4`입니다.

구독을 쓰지 않고 화면만 시험하려면 mock 모드로 띄웁니다(기획은 고정 3장면, 이미지·드로우띵 호출은 단색 그림, 영상은 테스트 패턴).

```sh
PROVIDER_MODE=mock pnpm dev
```

### 새 워크플로우

툴바의 **새 워크플로우** 버튼은 현재 그래프를 `data/workflows/<UTC 시각>/`로 옮기고 빈 캔버스로 시작합니다. 산출 파일도 함께 옮겨서 옛 미리보기가 깨지지 않습니다. 실행 중에는 누를 수 없습니다. 보관된 워크플로우를 다시 여는 기능은 아직 없습니다.

## Draw Things 연결

Draw Things 앱의 로컬 API를 호출합니다. 기본 주소는 `http://localhost:7860`이고, `DRAWTHINGS_URL` 환경변수로 바꿀 수 있습니다.

1. Draw Things 앱을 켜고, 설정에서 **API 서버**를 켭니다.
2. 확인: `curl -s -o /dev/null -w "%{http_code}" http://localhost:7860/` 결과가 `200`이어야 합니다.
3. 모델 파일이 완성되어 있어야 합니다(`.ckpt`, `.partial`이면 아직 받는 중입니다).
   - 이미지: `qwen_image_2.1_turbo_q6p.ckpt`
   - 영상: `minimax_h3_fl2va_i4x.ckpt`, `minimax_h3_vae_f16.ckpt`
4. 실행해서 노드가 오류를 내면 메시지를 확인하세요.

| 메시지 | 조치 |
| --- | --- |
| "드로우띵 API에 연결할 수 없습니다" | 앱이 꺼져 있거나 API 서버가 꺼져 있습니다. 앱을 켜고 API 서버를 켠 뒤 다시 실행하세요. |
| "이미지를 돌려주지 않았습니다" / "영상 프레임을 돌려주지 않았습니다" | 모델 파일이 없거나 덜 받았습니다. 모델 목록과 파일 상태를 확인하세요. |
| "아직 연결되지 않은 모델입니다" | 목록에서 비활성인 항목이 저장된 것입니다. 연결된 모델을 골라 다시 실행하세요. |

영상 생성은 프롬프트로 텍스트→영상을 만듭니다. 장면 이미지 노드의 그림은 이 경로에 쓰이지 않고, 같은 장면의 프롬프트만 씁니다. 기본 설정은 124프레임(약 5.2초, 24fps)이며, 장면이 더 길면 마지막 프레임을 멈춰 채우고 카드에 정지 구간을 표시합니다.

**시간:** 영상 한 장면은 오래 걸립니다. 프리셋(124프레임, 50 steps)은 측정하지 않았고, 짧은 조건(16프레임, 8 steps)이 약 170초였던 것으로 비례 추정하면 장면당 1~2시간입니다. 실행 중에는 앱을 닫지 말고, 다른 무거운 작업을 같이 돌리지 마세요. 길이는 `server/providers/drawthings.ts`의 `VIDEO_FRAMES`로 바꿀 수 있습니다.

## 검증

```sh
pnpm build                              # 타입체크 + 웹 번들
pnpm test                               # 단위·통합 테스트 (ffmpeg 실제 실행, 드로우띵 API는 가짜 서버)
PROVIDER_MODE=mock pnpm e2e:pipeline    # 헤드리스 전체 파이프라인 → .e2e-out/final.mp4
PROVIDER_MODE=mock pnpm e2e:ui          # 실제 브라우저 E2E (Playwright)
pnpm smoke:real                         # 실제 claude 기획 1회 + codex 이미지 1장
```

## 구조

- `shared/` — 스키마, 모델 목록(`models.json`), 기획→그래프 변환, 비용 추정 (서버·웹 공용)
- `server/` — 실행 엔진, 프로바이더(claude·codex·ffmpeg·drawthings), HTTP API
- `web/` — 노드 캔버스(`@xyflow/react`)와 에이전트 패널

## 알려진 한계

- 프로젝트는 하나(`data/`)만 다룹니다. 보관된 워크플로우는 `data/workflows/`에 남지만 앱에서 다시 열 수 없습니다.
- 드로우띵 영상은 오디오가 없습니다. 생성된 영상은 무음입니다.
- 드로우띵 영상 방식은 텍스트→영상입니다. 장면 이미지를 첫 프레임으로 고정하는 방식은 확인하지 못했습니다.
- 산출물 서버가 Range 요청을 지원하지 않아 Safari에서는 영상 미리보기가 재생되지 않을 수 있습니다(Chrome에서 확인됨).
