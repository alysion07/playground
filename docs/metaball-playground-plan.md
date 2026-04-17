# 메타볼 블롭 플레이그라운드 — 작업 계획서

> SDF 기반 메타볼(블롭) 웹 플레이그라운드. 화면 위의 끈적한 구들이 가까워지면 부드럽게 합쳐지고 멀어지면 분리되는 인터랙티브 토이. 4주 안에 공유 가능한 미니 제품까지.

- **스택**: Vite + TypeScript + Three.js(WebGPURenderer) + 커스텀 WGSL 셰이더
- **범위**: 미니 제품 (3–4주)
- **렌더링**: Three.js + 커스텀 셰이더, 풀스크린 2D SDF 래스터라이즈(프래그먼트 셰이더 1개)
- **타깃**: 데스크탑·모바일 웹, 공유·녹화 가능한 장난감

---

## 1. 프로덕트 정의

### 1.1 한 줄 설명
"브라우저에서 만지는 살아있는 용암 — SDF 메타볼로 만든 블롭 플레이그라운드"

### 1.2 핵심 사용자 경험 (Core Loop)
1. 접속 → 블롭 몇 개가 이미 떠다니고 있음
2. 드래그로 새 블롭을 만들거나 기존 블롭을 끌어당김
3. 슬라이더로 점성(smoothness)·중력·색상 팔레트 조정
4. 예쁜 순간을 스크린샷/GIF로 저장 → SNS 공유
5. 프리셋 갤러리("Lava", "Jelly", "Mercury", "Galaxy"…)로 한 번에 분위기 전환

### 1.3 MVP 성공 기준 (Definition of Done)
- [ ] 모바일 Safari/Chrome에서 60fps (블롭 ≤ 16개 기준)
- [ ] 3초 이내 첫 렌더
- [ ] 스크린샷·GIF 내보내기 동작
- [ ] 상태를 URL로 공유 → 다시 열면 동일 구성 복원
- [ ] 5개 이상 프리셋
- [ ] PageSpeed Mobile 90+

### 1.4 범위 밖(Out of Scope)
- 회원가입·로그인·DB(v1은 전부 클라이언트 상태 + URL 인코딩)
- 3D 입체 블롭(확장 로드맵에 포함, v1은 2D 풀스크린)
- 유료화·결제
- 커뮤니티 갤러리(공개 저장 기능)

---

## 2. 기술 스택 & 아키텍처

### 2.1 스택
- **빌드/런타임**: Vite 5, TypeScript 5
- **렌더러**: Three.js (r160+) `WebGPURenderer`
- **셰이더**: WGSL (fallback으로 GLSL 버전 준비 — WebGPU 미지원 브라우저용)
- **상태**: Zustand (작고, URL sync 붙이기 쉬움)
- **UI**: Tailwind + `leva` 혹은 `tweakpane` (개발자용 컨트롤 패널로 빠르게 시작 → v1은 커스텀 UI로 교체)
- **녹화**: `CCapture.js` 또는 `MediaRecorder API` + `gif.js`
- **테스트**: Vitest(로직), Playwright(스모크)
- **배포**: Cloudflare Pages (또는 Vercel)
- **분석**: Plausible (프라이버시 친화)

### 2.2 아키텍처 (모듈 경계)
```
┌─────────────────────────────────────────────────────┐
│  UI Layer (React-free, 순수 DOM/Tailwind)             │
│   - Control Panel, Preset Gallery, Share Buttons    │
└──────────────────┬──────────────────────────────────┘
                   │ dispatch
                   ▼
┌─────────────────────────────────────────────────────┐
│  State (Zustand)                                    │
│   - blobs[], simParams, renderParams, palette       │
│   - URL sync (debounced)                            │
└──────────────────┬──────────────────────────────────┘
                   │ read
                   ▼
┌─────────────────────────────────────────────────────┐
│  Simulation (CPU, requestAnimationFrame)            │
│   - Verlet integration, soft constraints            │
│   - Boundary handling, mouse forces                 │
└──────────────────┬──────────────────────────────────┘
                   │ push uniforms/storage buffer
                   ▼
┌─────────────────────────────────────────────────────┐
│  Renderer (Three.js WebGPURenderer)                 │
│   - Full-screen triangle + fragment shader          │
│   - WGSL: SDF smin, color blending, lighting fake   │
└─────────────────────────────────────────────────────┘
```

### 2.3 성능 타깃
- 블롭 16개 기준: 데스크탑 120fps, 모바일 60fps
- 고정 해상도 렌더 타깃(viewport × DPR 캡 1.5) + 업스케일
- 프래그먼트 스텝: 블롭 수 N에 대해 O(N)/픽셀. N=32까지는 선형 SDF 평가 수용.

---

## 3. 폴더 구조

```
metaball-playground/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── README.md
├── public/
│   ├── og-image.png
│   └── favicon.svg
└── src/
    ├── main.ts                    # 진입점
    ├── app/
    │   ├── bootstrap.ts           # 렌더러/캔버스/이벤트 초기화
    │   └── loop.ts                # RAF 루프
    ├── state/
    │   ├── store.ts               # Zustand store
    │   ├── types.ts
    │   └── url-sync.ts            # 상태 ↔ URL 인코딩
    ├── sim/
    │   ├── blob.ts                # Blob 타입/팩토리
    │   ├── physics.ts             # Verlet + 경계 + 마우스 힘
    │   └── presets.ts             # Lava, Jelly, Mercury…
    ├── render/
    │   ├── renderer.ts            # Three.js WebGPURenderer 셋업
    │   ├── material.ts            # ShaderMaterial/NodeMaterial
    │   ├── fullscreen-quad.ts
    │   └── shaders/
    │       ├── metaball.wgsl      # 메인 프래그먼트 셰이더
    │       └── metaball.glsl      # WebGL2 폴백
    ├── ui/
    │   ├── controls.ts            # 슬라이더 패널
    │   ├── presets-gallery.ts
    │   └── share-panel.ts         # 스크린샷·GIF·URL 복사
    ├── capture/
    │   ├── screenshot.ts
    │   └── gif-recorder.ts
    ├── util/
    │   ├── color.ts               # 팔레트, OKLCH 보간
    │   ├── pointer.ts             # 터치/마우스 통합
    │   └── rng.ts
    └── styles/
        └── app.css
```

---

## 4. 핵심 수학: SDF 메타볼

### 4.1 Sphere SDF (2D disk)
```
d_i(p) = length(p - c_i) - r_i
```

### 4.2 Polynomial smooth-min (k는 점성)
```
smin(a, b, k):
  h = max(k - |a - b|, 0) / k
  return min(a, b) - h^2 * k * 0.25
```
k가 크면 더 말랑말랑하게 합쳐짐, k=0이면 일반 min(날카로운 교차).

### 4.3 N개 블롭 결합
```
d(p) = reduce(smin, [d_1(p), d_2(p), ..., d_N(p)], k)
```

### 4.4 렌더링
- `d(p) < 0` → 내부(블롭), 그 외 → 배경
- 가장자리는 `smoothstep(0, 2px, d)`로 AA
- 각 블롭의 영향도를 가중치로 사용해 **색상 블렌딩** (각 블롭 색 × exp(-d_i * softness)의 정규화 가중합)
- 가짜 라이팅: `∇d` 근사로 노멀 뽑고 간단한 하이라이트 (rim + specular)
- 선택 요소: SSS 느낌을 위한 `d` 내부 distance-based tint

### 4.5 물리(클라이언트 CPU)
Verlet 적분 + 다음 힘:
- 약한 중력 (옵션)
- 이웃 블롭 간 약한 인력 (뭉치는 느낌)
- 포인터 드래그 시 스프링 힘
- 경계 소프트 반사(damping)

블롭이 많아지면 공간 해시로 O(N²)를 O(N)에 가깝게.

---

## 5. 4주 로드맵

### Week 1 — Foundation (렌더 파이프라인 확립)
**목표**: 검은 화면에 블롭 여러 개가 smooth-min으로 합쳐지는 모습, 60fps

- [ ] 리포 초기화, Vite + TS + Tailwind + ESLint + Prettier
- [ ] Three.js `WebGPURenderer` 셋업, 풀스크린 트라이앵글
- [ ] 첫 WGSL 셰이더: 구 3개 하드코딩된 SDF + smooth-min
- [ ] DPR·리사이즈 핸들링, 픽셀 퍼펙트
- [ ] WebGPU 미지원 시 GLSL 폴백 경로 확인
- [ ] FPS overlay(개발용)

**산출물**: `renderer.ts`, `metaball.wgsl`, 데모 페이지

### Week 2 — Interaction & Physics
**목표**: 마우스/터치로 블롭을 만들고 당기고 밀기, 블롭 N개까지 확장

- [ ] Zustand store(`blobs`, `simParams`, `renderParams`)
- [ ] CPU 물리 루프 + Verlet
- [ ] 포인터 핸들러(터치·마우스 통합), 드래그 추가·이동·제거
- [ ] 블롭 → 유니폼/스토리지 버퍼 업로드, 동적 N 처리
- [ ] tweakpane 임시 컨트롤 패널(smoothness, gravity, damping, count)
- [ ] 색상 팔레트 시스템(OKLCH 보간)

**산출물**: `physics.ts`, `store.ts`, `pointer.ts`, 컨트롤 패널

### Week 3 — Polish & Share
**목표**: 예쁘고, 공유 가능하고, 모바일에서 잘 돔

- [ ] 프리셋 5개: Lava / Jelly / Mercury / Soap Bubble / Galaxy
- [ ] 배경 그라디언트, 비네트, 선택적 블룸
- [ ] 스크린샷 내보내기(PNG)
- [ ] GIF 녹화(3–5초), 진행 표시
- [ ] 상태 → URL 인코딩(LZ-String), 공유 버튼
- [ ] 모바일 최적화(해상도 캡, 블롭 상한)
- [ ] 온보딩 팁(3초 후 자동 사라짐)

**산출물**: 프리셋 갤러리, 공유 패널, 모바일 QA 패스

### Week 4 — Ship
**목표**: 공개·관측·정리

- [ ] 랜딩 헤더, OG 이미지, 메타 태그
- [ ] Cloudflare Pages 배포 + 커스텀 도메인(옵션)
- [ ] Plausible 분석 삽입(이벤트: `preset_load`, `screenshot`, `gif_export`, `share_url`)
- [ ] Lighthouse 90+ 정리
- [ ] README, CLAUDE.md, CONTRIBUTING 정리
- [ ] 버그 바쉬 1회(친구 3–5명 플레이테스트)

**산출물**: 라이브 URL, 분석 대시보드, 공개용 README

---

## 6. 구현 상세 노트

### 6.1 셰이더 스니펫 (WGSL, 핵심부만)
```wgsl
struct Blob { pos: vec2<f32>, radius: f32, color: vec3<f32> };
@group(0) @binding(0) var<storage, read> blobs: array<Blob>;
@group(0) @binding(1) var<uniform> params: Params; // count, k, aa, ...

fn sdCircle(p: vec2<f32>, c: vec2<f32>, r: f32) -> f32 {
  return length(p - c) - r;
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var d: f32 = 1e9;
  var cAcc: vec3<f32> = vec3<f32>(0.0);
  var wAcc: f32 = 0.0;
  for (var i: u32 = 0u; i < params.count; i = i + 1u) {
    let di = sdCircle(uv, blobs[i].pos, blobs[i].radius);
    d = smin(d, di, params.k);
    let w = exp(-max(di, 0.0) * params.colorSoftness);
    cAcc = cAcc + blobs[i].color * w;
    wAcc = wAcc + w;
  }
  let color = select(cAcc / wAcc, vec3<f32>(0.05), wAcc < 1e-5);
  let mask = 1.0 - smoothstep(0.0, params.aa, d);
  return vec4<f32>(color * mask, mask);
}
```

### 6.2 Blob 타입
```ts
export type Blob = {
  id: string;
  pos: [number, number];
  vel: [number, number];
  radius: number;
  color: [number, number, number]; // 0..1
  mass: number;
};
```

### 6.3 URL 상태 인코딩
- JSON → LZ-String → base64url → `?s=...`
- 핵심 필드만 인코딩(블롭 수·위치·반지름·색·params)

### 6.4 녹화 전략
- `MediaRecorder`로 캔버스 스트림 캡처 → webm
- GIF은 `gif.js`로 15fps × 3초 = 45프레임
- 녹화 중엔 물리 시드 고정으로 재현 가능성 확보(선택)

---

## 7. 리스크 & 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| WebGPU 브라우저 지원 편차 | 높음 | GLSL(WebGL2) 폴백 경로 유지, 기능 감지 후 렌더러 선택 |
| 모바일 성능 | 중 | 해상도 캡(1.5x), 블롭 상한, smoothstep AA 단순화 |
| GIF 용량 | 낮음 | 해상도 다운샘플 + 팔레트 제한, 웹 공유 시 webm 우선 |
| URL 길이 폭발 | 낮음 | 블롭 수 상한(프리셋은 고정 시드로 저장) |
| 스코프 크립 | 중 | v1은 "2D·클라이언트만". 3D·커뮤니티 갤러리는 v2 백로그 |

---

## 8. v2 백로그 (참고)
- 3D 입체 블롭(레이마칭), 환경맵 반사
- 프리셋 커뮤니티 갤러리(Supabase)
- 오디오 리액티브 모드(마이크 입력 → 블롭 펄스)
- "Toy Collection" 확장: 용암 램프, 아이스크림 메이커도 모노레포에 합류
